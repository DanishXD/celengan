"""Application runtime state — wires engine, policy engine and Action Desk.

Holds the sandbox session for the API and demo CLI: the deterministic
pipeline results, executed plays (receipts), applied effects (recurring
exclusions + one-time credits), and the user's consent envelope.

Thread-safe: FastAPI sync endpoints run in a threadpool.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.config import settings
from app.engine.detectors import run_leak_radar
from app.engine.models import LeakFinding, SandboxBundle
from app.engine.normalizer import normalize_all
from app.engine.ranking import rank
from app.engine.recurring import detect_recurring
from app.policy.audit import AuditLog
from app.policy.engine import ActionRequest, Consent, PolicyDecision, PolicyEngine, PolicyViolation
from seed.synthetic import generate_maya


@dataclass
class Receipt:
    """Proof of one executed Action-Desk play — the 'receipt' UX artifact."""

    id: str
    created_at: str
    finding_id: str
    playbook: str
    tier: int
    status: str                       # draft_ready | autopilot_active | undone
    subject: str
    body: str
    generator: str                    # template | llm
    impact_monthly: float
    impact_note: str
    evidence_txn_ids: tuple[str, ...]
    effect: dict                      # {"type": ..., ...} for undo
    undone: bool = False


@dataclass
class AppliedPlays:
    """Effects of approved plays that Future Oracle must honor."""

    exclusions: set[str] = field(default_factory=set)      # merchants removed from bill schedule
    credits: list[float] = field(default_factory=list)     # one-time refunds/waivers expected
    discounts: dict[str, float] = field(default_factory=dict)  # merchant -> monthly bill reduction

    @property
    def credits_total(self) -> float:
        return round(sum(self.credits), 2)

    @property
    def discounts_total_monthly(self) -> float:
        return round(sum(self.discounts.values()), 2)


class AppState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.audit = AuditLog(settings.audit_path)
        self.policy = PolicyEngine(settings, self.audit)
        self.receipts: list[Receipt] = []
        self.applied = AppliedPlays()
        self._receipt_seq = 0
        self.reload()

    # ------------------------------------------------------------ lifecycle
    def reload(self) -> None:
        """Rebuild the sandbox session (deterministic seed). Audit log persists."""
        with self._lock:
            self.bundle: SandboxBundle = generate_maya(seed=settings.seed)
            self.txns = normalize_all(self.bundle.transactions)
            self.recurring = detect_recurring(self.txns)
            self.findings: list[LeakFinding] = rank(
                run_leak_radar(self.txns, self.recurring, self.bundle.usage_90d)
            )
            self._finding_by_id = {f.id: f for f in self.findings}
            self.receipts = []
            self.applied = AppliedPlays()
            self._receipt_seq = 0
            # A fresh session starts with a fresh consent envelope.
            self.policy.consent = Consent()
            self.audit.append("session.reloaded", seed=settings.seed, findings=len(self.findings))

    # ----------------------------------------------------------- Action Desk
    def plays(self) -> list[dict]:
        from app.agent.planner import build_plays

        return build_plays(self.findings)

    def execute_action(self, finding_id: str, tier: int, confirm: bool = False) -> Receipt:
        with self._lock:
            finding = self._finding_by_id.get(finding_id)
            if finding is None:
                raise KeyError(f"unknown finding {finding_id}")

            from app.agent.planner import PLAY_TIERS

            tier_spec = next((t for t in PLAY_TIERS.get(finding.playbook, []) if t["tier"] == tier), None)
            if tier_spec is None:
                raise PolicyViolation(
                    PolicyDecision(False, tier, f"playbook {finding.playbook!r} has no tier-{tier} play")
                )
            if any(
                r.finding_id == finding_id and r.playbook == finding.playbook and not r.undone
                for r in self.receipts
            ):
                raise ValueError("this play is already active — undo it first")

            req = ActionRequest(
                finding_id=finding.id,
                playbook=finding.playbook,
                tier=tier,
                amount=finding.impact_monthly if tier == 2 else 0.0,
                confirm=confirm,
            )
            decision = self.policy.evaluate(req)
            if not decision.approved:
                raise PolicyViolation(decision)

            self._receipt_seq += 1
            receipt_id = f"R{self._receipt_seq:03d}"
            if tier == 1:
                from app.agent.planner import build_draft

                subject, body, generator = build_draft(finding)
                receipt = Receipt(
                    id=receipt_id,
                    created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    finding_id=finding.id,
                    playbook=finding.playbook,
                    tier=tier,
                    status="draft_ready",
                    subject=subject,
                    body=body,
                    generator=generator,
                    impact_monthly=finding.impact_monthly,
                    impact_note=self._impact_note(finding, tier_spec["effect"]),
                    evidence_txn_ids=finding.evidence_txn_ids,
                    effect={"type": tier_spec["effect"], "credit": finding.impact_monthly},
                    undone=False,
                )
                self.applied.credits.append(finding.impact_monthly)
            else:  # tier 2
                is_discount = tier_spec["effect"] == "recurring_discount"
                receipt = Receipt(
                    id=receipt_id,
                    created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    finding_id=finding.id,
                    playbook=finding.playbook,
                    tier=tier,
                    status="autopilot_active",
                    subject=(
                        f"Autopilot: downgrade {finding.merchant} at next renewal"
                        if is_discount
                        else f"Autopilot: pause {finding.merchant} at next renewal"
                    ),
                    body=(
                        f"Bounded autopilot active: {finding.merchant} will be "
                        f"{'moved to the previous rate' if is_discount else 'paused'} "
                        f"before its next renewal. Monthly cap "
                        f"${settings.tier2_monthly_cap:,.2f}, per-action cap "
                        f"${settings.tier2_max_single_action:,.2f}, instant undo, "
                        f"full audit trail."
                    ),
                    generator="policy",
                    impact_monthly=finding.impact_monthly,
                    impact_note=self._impact_note(finding, tier_spec["effect"]),
                    evidence_txn_ids=finding.evidence_txn_ids,
                    effect=(
                        {"type": "recurring_discount", "merchant": finding.merchant}
                        if is_discount
                        else {"type": "recurring_exclusion", "merchant": finding.merchant}
                    ),
                    undone=False,
                )
                if is_discount:
                    self.applied.discounts[finding.merchant] = finding.impact_monthly
                else:
                    self.applied.exclusions.add(finding.merchant)
                self.policy.record_tier2_spend(finding.impact_monthly)

            self.receipts.append(receipt)
            self.audit.append(
                "receipt.created",
                receipt_id=receipt.id,
                finding_id=finding.id,
                tier=tier,
                status=receipt.status,
                impact_monthly=receipt.impact_monthly,
            )
            return receipt

    def undo(self, receipt_id: str) -> Receipt:
        with self._lock:
            receipt = next((r for r in self.receipts if r.id == receipt_id), None)
            if receipt is None:
                raise KeyError(f"unknown receipt {receipt_id}")
            if receipt.undone:
                raise ValueError("receipt already undone")

            effect = receipt.effect
            if effect["type"] == "recurring_exclusion":
                self.applied.exclusions.discard(effect["merchant"])
                self.policy.release_tier2_spend(receipt.impact_monthly)
            elif effect["type"] == "recurring_discount":
                self.applied.discounts.pop(effect["merchant"], None)
                self.policy.release_tier2_spend(receipt.impact_monthly)
            elif effect["type"] == "one_time_credit" and receipt.impact_monthly in self.applied.credits:
                self.applied.credits.remove(receipt.impact_monthly)

            receipt.undone = True
            receipt.status = "undone"
            self.audit.append("action.undone", receipt_id=receipt.id)
            return receipt

    def set_consent(self, tier2_enabled: bool) -> dict:
        return self.policy.set_consent(tier2_enabled)

    def set_kill_switch(self, enabled: bool) -> dict:
        return self.policy.set_kill_switch(enabled)

    # ------------------------------------------------------------- helpers
    @staticmethod
    def _impact_note(finding: LeakFinding, effect: str) -> str:
        if effect == "recurring_exclusion":
            return f"saves ~${finding.impact_monthly:,.2f}/month (${finding.impact_annual:,.2f}/year)"
        if effect == "recurring_discount":
            return f"reduces the bill by ~${finding.impact_monthly:,.2f}/month (${finding.impact_annual:,.2f}/year)"
        if effect == "one_time_credit":
            return f"one-time credit of ~${finding.impact_monthly:,.2f} expected"
        return f"potential saving ~${finding.impact_monthly:,.2f}/month if accepted"

    # --------------------------------------------------------------- views
    def forecast(self, days: int, state: str = "current") -> dict:
        from app.engine.forecaster import project

        exclusions: tuple[str, ...] = ()
        credits: tuple[float, ...] = ()
        discounts: dict[str, float] = {}
        if state == "current":
            exclusions = tuple(sorted(self.applied.exclusions))
            credits = tuple(self.applied.credits)
            discounts = dict(self.applied.discounts)
        result = project(
            self.bundle, self.recurring, days=days,
            exclusions=exclusions, one_time_credits=credits, discounts=discounts,
        )
        return {
            "state": state,
            "window_days": days,
            "doom_day": result.doom_day.isoformat() if result.doom_day else None,
            "lowest_balance": result.lowest_balance,
            "applied_exclusions": sorted(self.applied.exclusions),
            "applied_credits_total": self.applied.credits_total,
            "applied_discounts": dict(self.applied.discounts),
            "points": [
                {"day_offset": p.day_offset, "date": p.date.isoformat(), "balance": p.balance}
                for p in result.points
            ],
        }


STATE = AppState()

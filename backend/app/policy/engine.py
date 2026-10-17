"""Policy Engine — the deterministic gate for every agent action.

Design principle: the LLM (or any planner) may only PROPOSE actions; this
engine — plain, non-LLM, testable code — decides whether an action may run,
under which tier, and within which caps. Prompt injection cannot reach money
because the money path terminates here.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings
from app.policy.audit import AuditLog


@dataclass
class Consent:
    """User-configured autonomy envelope."""

    tier2_enabled: bool = False          # user explicitly opted into micro-autopilot
    kill_switch: bool = False            # emergency stop for ALL Tier-2 activity
    tier2_spent_this_month: float = 0.0  # running total of approved Tier-2 amounts


@dataclass(frozen=True)
class ActionRequest:
    finding_id: str
    playbook: str
    tier: int                  # 1 = draft, 2 = micro-autopilot
    amount: float              # money touched by the action (0.0 for pure drafts)
    confirm: bool = False      # human one-tap confirmation (required for Tier 1)


@dataclass(frozen=True)
class PolicyDecision:
    approved: bool
    tier: int
    reason: str


class PolicyEngine:
    def __init__(self, settings: Settings, audit: AuditLog) -> None:
        self.settings = settings
        self.audit = audit
        self.consent = Consent()

    # ------------------------------------------------------------------ API
    def evaluate(self, req: ActionRequest) -> PolicyDecision:
        decision = self._decide(req)
        self.audit.append(
            "policy.decision",
            finding_id=req.finding_id,
            playbook=req.playbook,
            tier=req.tier,
            amount=req.amount,
            approved=decision.approved,
            reason=decision.reason,
        )
        return decision

    def set_consent(self, tier2_enabled: bool) -> dict:
        self.consent.tier2_enabled = tier2_enabled
        return self.audit.append("consent.updated", tier2_enabled=tier2_enabled)

    def set_kill_switch(self, enabled: bool) -> dict:
        self.consent.kill_switch = enabled
        return self.audit.append("kill_switch", enabled=enabled)

    def record_tier2_spend(self, amount: float) -> None:
        self.consent.tier2_spent_this_month += amount
        self.audit.append("tier2.spend_recorded", amount=amount, month_total=self.consent.tier2_spent_this_month)

    def release_tier2_spend(self, amount: float) -> None:
        self.consent.tier2_spent_this_month = max(0.0, self.consent.tier2_spent_this_month - amount)
        self.audit.append("tier2.spend_released", amount=amount, month_total=self.consent.tier2_spent_this_month)

    # ------------------------------------------------------------- internals
    def _decide(self, req: ActionRequest) -> PolicyDecision:
        if req.tier == 0:
            return PolicyDecision(True, 0, "read-only analysis, always permitted")

        if req.tier == 1:
            if not req.confirm:
                return PolicyDecision(False, 1, "Tier 1 requires one-tap human confirmation")
            return PolicyDecision(True, 1, "confirmed draft action")

        if req.tier == 2:
            if self.consent.kill_switch:
                return PolicyDecision(False, 2, "kill switch engaged — all autopilot halted")
            if not self.consent.tier2_enabled:
                return PolicyDecision(False, 2, "Tier 2 micro-autopilot not consented by user")
            if req.amount > self.settings.tier2_max_single_action:
                return PolicyDecision(
                    False, 2,
                    f"amount ${req.amount:.2f} exceeds per-action cap "
                    f"${self.settings.tier2_max_single_action:.2f}",
                )
            if self.consent.tier2_spent_this_month + req.amount > self.settings.tier2_monthly_cap:
                return PolicyDecision(
                    False, 2,
                    f"would exceed monthly autopilot cap "
                    f"(${self.consent.tier2_spent_this_month:.2f} spent + "
                    f"${req.amount:.2f} > ${self.settings.tier2_monthly_cap:.2f})",
                )
            return PolicyDecision(True, 2, "within consented autopilot envelope")

        return PolicyDecision(False, req.tier, f"unknown tier {req.tier}")


class PolicyViolation(Exception):
    """Raised when an action was rejected by the Policy Engine."""

    def __init__(self, decision: PolicyDecision) -> None:
        super().__init__(decision.reason)
        self.decision = decision

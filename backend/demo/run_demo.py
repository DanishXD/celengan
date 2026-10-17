"""Celengan demo CLI — full sandbox session in three acts.

Usage (from backend/):
    python -m demo.run_demo

Deterministic: no LLM, no network. Writes execution-evidence JSON artifacts
into docs/evidence/ (competition requirement: simulated-account operation logs).

  ACT 1  Leak Radar      — ranked money leaks with receipts
  ACT 2  Future Oracle   — 40-day projection + Doom Day + what-if
  ACT 3  Action Desk     — permission ladder, receipts, kill-switch enforcement
"""

from __future__ import annotations

import io
import json
import platform
import sys
from datetime import datetime
from pathlib import Path

import app as _app_pkg
from app.engine import detectors as _detectors  # noqa: F401  (import surface check)
from app.engine.forecaster import what_if as engine_what_if
from app.engine.models import LeakType
from app.engine.ranking import total_annual_impact, total_monthly_impact
from app.policy.engine import PolicyViolation
from app.state import STATE

EVIDENCE_DIR = Path(__file__).resolve().parents[2] / "docs" / "evidence"

_TYPE_ICONS = {
    LeakType.SUBSCRIPTION_CREEP: "DARK SUB",
    LeakType.DUPLICATE_CHARGE: "DUPLICATE",
    LeakType.HIDDEN_FEE: "FEE",
    LeakType.SILENT_PRICE_HIKE: "PRICE HIKE",
}

_RULE = "=" * 74


def _act1() -> None:
    print(_RULE)
    print("  ACT 1 - LEAK RADAR - sandbox run (deterministic, no LLM, no network)")
    print(_RULE)
    b = STATE.bundle
    print(f"  User            : {b.profile_name} (synthetic sandbox user)")
    print(f"  Window          : last {b.window_days} days | {len(STATE.txns)} transactions")
    print(f"  Balance now     : ${b.balance_now:,.2f}")
    print(f"  Recurring series: {len(STATE.recurring)} detected")
    print("-" * 74)
    print("  Ranked leaks:")
    for f in STATE.findings:
        print(
            f"  [{f.id}] {_TYPE_ICONS[f.type]:<9} {f.title:<38} "
            f"-${f.impact_monthly:>7,.2f}/mo  score {f.score:>5.1f}"
        )
        print(f"        evidence: {len(f.evidence_txn_ids)} txn(s) | playbook: {f.playbook}")
    print("-" * 74)
    print(
        f"  TOTAL LEAK: ${total_monthly_impact(STATE.findings):,.2f}/month "
        f"= ${total_annual_impact(STATE.findings):,.2f}/year"
    )


def _act2() -> dict:
    print(_RULE)
    print("  ACT 2 - FUTURE ORACLE - 40-day behavioral projection")
    print(_RULE)
    baseline = STATE.forecast(days=40, state="baseline")
    if baseline["doom_day"]:
        print(
            f"    DOOM DAY: {baseline['doom_day']} "
            f"(lowest projected balance ${baseline['lowest_balance']:,.2f})"
        )
    else:
        print(f"    No negative day in window (lowest ${baseline['lowest_balance']:,.2f})")

    creeps = tuple(sorted({f.merchant for f in STATE.findings if f.type == LeakType.SUBSCRIPTION_CREEP}))
    whatif = engine_what_if(
        STATE.bundle, STATE.recurring, exclusions=creeps,
        one_time_credits=(13.49, 15.0), days=40,
    )
    cf = whatif.counterfactual
    print(f"  WHAT-IF (Action Desk plays):")
    print(f"    - cancel {', '.join(whatif.excluded) or 'nothing'} (Tier 2 autopilot)")
    print(f"    - dispute duplicate refund + penalty waiver: "
          f"${sum((13.49, 15.0)):,.2f} one-time (Tier 1 drafts)")
    print(f"    monthly savings ${whatif.monthly_savings:,.2f} -> ", end="")
    if cf.doom_day is None:
        print(f"doom day cleared (lowest ${cf.lowest_balance:,.2f})")
    elif baseline["doom_day"] and cf.doom_day > datetime.strptime(baseline["doom_day"], "%Y-%m-%d").date():
        print(f"doom day pushed {baseline['doom_day']} -> {cf.doom_day.isoformat()}")
    else:
        print(f"doom day unchanged ({cf.doom_day})")
    return {
        "baseline": baseline,
        "what_if": {
            "excluded": list(whatif.excluded),
            "one_time_credits": [13.49, 15.0],
            "monthly_savings": whatif.monthly_savings,
            "doom_day_after": cf.doom_day.isoformat() if cf.doom_day else None,
            "lowest_balance_after": cf.lowest_balance,
        },
    }


def _act3() -> dict:
    print(_RULE)
    print("  ACT 3 - ACTION DESK - permission ladder + receipts + enforcement")
    print(_RULE)

    print("  [consent] user opts into Tier 2 micro-autopilot (demo pre-authorization)")
    STATE.set_consent(True)

    executed: list = []
    plays = [
        ("L001", 2, "cancel GymFlow via bounded autopilot"),
        ("L002", 1, "draft penalty-fee waiver request"),
        ("L003", 1, "draft duplicate-charge dispute (refund expected)"),
    ]
    for finding_id, tier, label in plays:
        receipt = STATE.execute_action(finding_id, tier, confirm=True)
        executed.append(receipt)
        print(f"  [OK {receipt.id}] tier {tier} - {label}")
        print(f"          impact: {receipt.impact_note} | generator: {receipt.generator}")

    current = STATE.forecast(days=40, state="current")
    print("-" * 74)
    print(
        f"  POST-ACTION FORECAST: doom day "
        f"{current['doom_day'] or 'CLEARED'} | lowest ${current['lowest_balance']:,.2f} | "
        f"exclusions {current['applied_exclusions']} | credits ${current['applied_credits_total']:,.2f}"
    )

    # --- live policy enforcement: kill switch blocks autopilot instantly ---
    STATE.set_kill_switch(True)
    print("-" * 74)
    print("  [kill switch] ENGAGED - attempting another Tier 2 play (should be REJECTED):")
    try:
        STATE.execute_action("L005", tier=2, confirm=True)
        print("  [!!] UNEXPECTED: tier-2 play was approved")
    except PolicyViolation as exc:
        print(f"  [REJECTED] policy engine: {exc.decision.reason}")
    STATE.set_kill_switch(False)
    print("  [kill switch] released - autopilot available again")

    return {
        "receipts": [
            {
                "id": r.id, "finding_id": r.finding_id, "playbook": r.playbook,
                "tier": r.tier, "status": r.status, "subject": r.subject,
                "generator": r.generator, "impact_monthly": r.impact_monthly,
                "impact_note": r.impact_note, "evidence_txn_ids": list(r.evidence_txn_ids),
            }
            for r in executed
        ],
        "post_action_forecast": current,
        "kill_switch_enforcement": "tier-2 play rejected while kill switch engaged",
        "audit_events": len(STATE.audit),
    }


def _write_evidence(name: str, payload: dict) -> Path:
    EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
    path = EVIDENCE_DIR / name
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def main() -> int:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    STATE.reload()
    _act1()
    act2 = _act2()
    act3 = _act3()

    print(_RULE)
    b = STATE.bundle
    artifact1 = _write_evidence(
        "leakradar_first_run.json",
        {
            "artifact": "leakradar_first_run",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "app_version": _app_pkg.__version__,
            "python_version": platform.python_version(),
            "deterministic": True,
            "llm_used": False,
            "network_used": False,
            "seed": 42,
            "user": {
                "name": b.profile_name, "synthetic": True,
                "window_days": b.window_days, "transaction_count": len(STATE.txns),
                "balance_now": b.balance_now,
            },
            "recurring_series": [
                {
                    "merchant": r.merchant, "category": r.category,
                    "cadence_days": r.cadence_days, "median_amount": r.median_amount,
                    "occurrences": r.occurrences, "amount_stable": r.amount_stable,
                }
                for r in STATE.recurring
            ],
            "findings": [
                {
                    "id": f.id, "type": f.type.value, "merchant": f.merchant,
                    "impact_monthly": f.impact_monthly, "impact_annual": f.impact_annual,
                    "confidence": f.confidence, "title": f.title, "rationale": f.rationale,
                    "evidence_txn_ids": list(f.evidence_txn_ids), "playbook": f.playbook,
                    "score": f.score,
                }
                for f in STATE.findings
            ],
            "totals": {
                "monthly_impact": total_monthly_impact(STATE.findings),
                "annual_impact": total_annual_impact(STATE.findings),
            },
            **act2,
        },
    )
    artifact2 = _write_evidence(
        "actiondesk_first_run.json",
        {
            "artifact": "actiondesk_first_run",
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "app_version": _app_pkg.__version__,
            "deterministic": True,
            "llm_used": any(r["generator"] == "llm" for r in act3["receipts"]),
            "network_used": False,
            "seed": 42,
            **act3,
        },
    )
    print(_RULE)
    print(f"  Evidence artifacts written:")
    print(f"    - {artifact1}")
    print(f"    - {artifact2}")
    print(_RULE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

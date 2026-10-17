"""Celengan demo CLI — full Leak Radar + Future Oracle sandbox run.

Usage (from backend/):
    python -m demo.run_demo

Deterministic: no LLM, no network. Writes an execution-evidence JSON artifact
into docs/evidence/ (competition requirement: simulated-account operation logs).
"""

from __future__ import annotations

import io
import json
import platform
import sys
from datetime import datetime
from pathlib import Path

import app as _app_pkg
from app.engine import detectors as _detectors  # noqa: F401  (ensure module import surface)
from app.engine.forecaster import project, what_if
from app.engine.models import LeakType
from app.engine.normalizer import normalize_all
from app.engine.ranking import rank, total_annual_impact, total_monthly_impact
from app.engine.recurring import detect_recurring
from seed.synthetic import generate_maya

EVIDENCE_PATH = Path(__file__).resolve().parents[2] / "docs" / "evidence" / "leakradar_first_run.json"

_TYPE_ICONS = {
    LeakType.SUBSCRIPTION_CREEP: "DARK SUB",
    LeakType.DUPLICATE_CHARGE: "DUPLICATE",
    LeakType.HIDDEN_FEE: "FEE",
    LeakType.SILENT_PRICE_HIKE: "PRICE HIKE",
}


def main() -> int:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

    bundle = generate_maya()
    txns = normalize_all(bundle.transactions)
    recurring = detect_recurring(txns)
    findings = rank(_detectors.run_leak_radar(txns, recurring, bundle.usage_90d))

    horizon_days = 40
    baseline = project(bundle, recurring, days=horizon_days)

    creep_merchants = tuple(sorted({f.merchant for f in findings if f.type == LeakType.SUBSCRIPTION_CREEP}))
    # Action-Desk one-off plays modelled as expected credits posting in 3 days:
    #   dispute duplicate (StreamVibe $13.49 refund) + penalty-fee waiver ($15.00)
    one_time_credits = (13.49, 15.0)
    whatif = what_if(
        bundle, recurring, exclusions=creep_merchants, days=horizon_days,
        one_time_credits=one_time_credits,
    )

    # ---------------- report ----------------
    print("=" * 74)
    print("  CELENGAN - LEAK RADAR + FUTURE ORACLE - sandbox run (deterministic)")
    print("  no LLM, no network, seed=42")
    print("=" * 74)
    print(f"  User            : {bundle.profile_name} (synthetic sandbox user)")
    print(f"  Window          : last {bundle.window_days} days | {len(txns)} transactions")
    print(f"  Balance now     : ${bundle.balance_now:,.2f}")
    print(f"  Recurring series: {len(recurring)} detected")
    print("-" * 74)
    print("  LEAK RADAR - ranked leaks:")
    for f in findings:
        print(
            f"  [{f.id}] {_TYPE_ICONS[f.type]:<9} {f.title:<38} "
            f"-${f.impact_monthly:>7,.2f}/mo  score {f.score:>5.1f}"
        )
        print(f"        evidence: {len(f.evidence_txn_ids)} txn(s) | playbook: {f.playbook}")
    print("-" * 74)
    print(
        f"  TOTAL LEAK: ${total_monthly_impact(findings):,.2f}/month "
        f"= ${total_annual_impact(findings):,.2f}/year"
    )
    print("-" * 74)
    print(f"  FUTURE ORACLE - {horizon_days}-day projection:")
    if baseline.doom_day is not None:
        print(
            f"    DOOM DAY: {baseline.doom_day.isoformat()} "
            f"(lowest projected balance ${baseline.lowest_balance:,.2f})"
        )
    else:
        print(
            f"    No negative day within {horizon_days} days "
            f"(lowest projected ${baseline.lowest_balance:,.2f})"
        )
    print(f"  WHAT-IF (Action Desk plays):")
    print(f"    - cancel {', '.join(whatif.excluded) or 'nothing'} (Tier 2 autopilot)")
    print(f"    - dispute duplicate refund + penalty waiver: "
          f"${sum(one_time_credits):,.2f} one-time (Tier 1 drafts)")
    print(f"    monthly savings ${whatif.monthly_savings:,.2f} -> ", end="")
    cf = whatif.counterfactual
    if cf.doom_day is None:
        print(f"doom day cleared (lowest ${cf.lowest_balance:,.2f})")
    elif cf.doom_day > (baseline.doom_day or cf.doom_day):
        print(f"doom day pushed {baseline.doom_day} -> {cf.doom_day}")
    else:
        print(f"doom day unchanged ({cf.doom_day})")
    print("=" * 74)

    # ---------------- execution evidence artifact ----------------
    evidence = {
        "artifact": "leakradar_first_run",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "app_version": _app_pkg.__version__,
        "python_version": platform.python_version(),
        "deterministic": True,
        "llm_used": False,
        "network_used": False,
        "seed": 42,
        "user": {
            "name": bundle.profile_name,
            "synthetic": True,
            "window_days": bundle.window_days,
            "transaction_count": len(txns),
            "balance_now": bundle.balance_now,
        },
        "recurring_series": [
            {
                "merchant": r.merchant,
                "category": r.category,
                "cadence_days": r.cadence_days,
                "median_amount": r.median_amount,
                "occurrences": r.occurrences,
                "amount_stable": r.amount_stable,
            }
            for r in recurring
        ],
        "findings": [
            {
                "id": f.id,
                "type": f.type.value,
                "merchant": f.merchant,
                "impact_monthly": f.impact_monthly,
                "impact_annual": f.impact_annual,
                "confidence": f.confidence,
                "title": f.title,
                "rationale": f.rationale,
                "evidence_txn_ids": list(f.evidence_txn_ids),
                "playbook": f.playbook,
                "score": f.score,
            }
            for f in findings
        ],
        "totals": {
            "monthly_impact": total_monthly_impact(findings),
            "annual_impact": total_annual_impact(findings),
        },
        "forecast": {
            "window_days": baseline.window_days,
            "doom_day": baseline.doom_day.isoformat() if baseline.doom_day else None,
            "lowest_balance": baseline.lowest_balance,
        },
        "what_if": {
            "excluded": list(whatif.excluded),
            "one_time_credits": list(one_time_credits),
            "monthly_savings": whatif.monthly_savings,
            "doom_day_after": cf.doom_day.isoformat() if cf.doom_day else None,
            "lowest_balance_after": cf.lowest_balance,
        },
    }
    EVIDENCE_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE_PATH.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(f"  Evidence artifact written: {EVIDENCE_PATH}")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

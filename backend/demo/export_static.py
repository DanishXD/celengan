"""Export the deterministic sandbox snapshot as static JSON for the GitHub
Pages demo (`frontend/public/demo-data/`).

The bundle lets the React PWA run the entire Detect → Simulate → Execute
story with NO backend: frozen engine outputs (leaks, plays, projection
inputs) plus parity fixtures, which the frontend parity test replays through
the browser-side TypeScript port of the projection + Policy Engine to prove
byte-level equivalence with this Python truth.

Run from the backend directory:
    python -m demo.export_static
"""

from __future__ import annotations

import json
from pathlib import Path

from app.agent.planner import build_plays
from app.config import settings
from app.engine.forecaster import _daily_burn, _detect_scheduled_series, project
from app.engine.ranking import total_annual_impact, total_monthly_impact
from app.state import STATE

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo-data"

# The canonical demo story, identical to the Action Desk evidence artifacts:
# exclude the dark subscription, dispute the duplicate, waive one-off fees,
# downgrade the silently hiked plan.
STORY = {
    "exclusions": ["GymFlow"],
    "one_time_credits": [13.49, 15.0],
    "discounts": {"Spotify": 3.0},
}

VERSION = "0.1.0"


def _forecast_view(fr) -> dict:
    return {
        "doom_day": fr.doom_day.isoformat() if fr.doom_day else None,
        "lowest_balance": fr.lowest_balance,
        "points": [
            {"day_offset": p.day_offset, "date": p.date.isoformat(), "balance": p.balance}
            for p in fr.points
        ],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    bundle, recurring, findings = STATE.bundle, STATE.recurring, STATE.findings
    anchor = bundle.anchor

    # ----------------------------------------------------------- meta.json
    meta = {
        "version": VERSION,
        "app": "Celengan",
        "mode": "static-demo",
        "note": (
            "Frozen snapshot of the deterministic engine. Leaks, plays and "
            "projection inputs are engine output; the Policy Engine runs "
            "client-side in this demo and is verified against the Python "
            "original by the parity test in CI."
        ),
        "user": bundle.profile_name,
        "synthetic": True,
        "seed": settings.seed,
        "window_days": bundle.window_days,
        "transaction_count": len(bundle.transactions),
        "balance_now": bundle.balance_now,
        "recurring_count": len(recurring),
        "findings_count": len(findings),
        "anchor": anchor.isoformat(),
        "burn_daily": _daily_burn(
            bundle.transactions, anchor, scheduled_merchants={r.merchant for r in recurring}
        ),
        "income_series": [
            {"merchant": m, "cadence_days": c, "amount": a, "last_date": last.isoformat()}
            for m, c, a, last in _detect_scheduled_series(bundle.transactions, +1)
        ],
        "recurring": [
            {
                "merchant": r.merchant,
                "cadence_days": r.cadence_days,
                "median_amount": r.median_amount,
                "last_due": r.dates[-1].isoformat(),
            }
            for r in recurring
        ],
        "tier2_monthly_cap": settings.tier2_monthly_cap,
        "tier2_max_single_action": settings.tier2_max_single_action,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")

    # ---------------------------------------------------------- leaks.json
    leaks = {
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
                "context": f.context,
            }
            for f in findings
        ],
        "totals": {
            "monthly_impact": total_monthly_impact(findings),
            "annual_impact": total_annual_impact(findings),
        },
    }
    (OUT / "leaks.json").write_text(json.dumps(leaks, indent=1), encoding="utf-8")

    # ---------------------------------------------------------- plays.json
    (OUT / "plays.json").write_text(
        json.dumps(build_plays(findings), indent=1), encoding="utf-8"
    )

    # ---------------------------------------- expected.json (parity truth)
    expected = {
        "story": STORY,
        "generated_by": f"python -m demo.export_static (celengan v{VERSION}, seed {settings.seed})",
        "runs": {},
    }
    for days in (40, 90):
        baseline = project(bundle, recurring, days=days)
        story = project(
            bundle,
            recurring,
            days=days,
            exclusions=tuple(STORY["exclusions"]),
            one_time_credits=tuple(STORY["one_time_credits"]),
            discounts=dict(STORY["discounts"]),
        )
        assert story.doom_day is None, "story must clear the doom day"
        assert story.lowest_balance > 0, "story must stay solvent"
        expected["runs"][str(days)] = {
            "baseline": _forecast_view(baseline),
            "story": _forecast_view(story),
        }
    story = expected["runs"]["40"]["story"]
    expected["story_result"] = {
        "doom_day": story["doom_day"],
        "lowest_balance": story["lowest_balance"],
        "monthly_savings": 29.0,  # gym exclusion at 30-day cadence
    }
    (OUT / "expected.json").write_text(json.dumps(expected, indent=1), encoding="utf-8")

    total = 0
    for p in sorted(OUT.iterdir()):
        total += p.stat().st_size
        print(f"wrote {p.name:15s} {p.stat().st_size:7,d} bytes")
    print(f"demo-data bundle: {total:,d} bytes -> {OUT}")


if __name__ == "__main__":
    main()

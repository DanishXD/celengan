"""Leak detectors — the four seed leak classes from the competition pitch.

All detectors are deterministic and explainable: every finding carries hard
evidence (transaction ids, amounts, dates) that becomes the user's receipt.
"""

from __future__ import annotations

import math
from datetime import date
from statistics import median

from .models import LeakFinding, LeakType, PLAYBOOK, Recurring, Txn

#: categories where a repeated near-twin charge is suspicious (vs. groceries,
#: dining, transport where twin charges within days can be perfectly normal)
_DUPLICATE_SUSPECT_CATEGORIES = {"subscription", "gym", "shopping", "internet", "phone", "utility"}

#: non-essential categories eligible for subscription-creep analysis
_NON_ESSENTIAL = {"subscription", "gym"}


def detect_subscription_creep(
    recurring: list[Recurring],
    usage_90d: dict[str, int],
    min_usage_ratio: float = 0.34,
) -> list[LeakFinding]:
    """Flag recurring non-essential services used well below billing frequency.

    Rule: if you are billed ~every `cadence_days` but (over the last 90 days)
    you used the service less than ~34% of the times you were billed for
    (rounded up to at least once), that money is leaking.
    """
    findings: list[LeakFinding] = []
    for r in recurring:
        if r.category not in _NON_ESSENTIAL:
            continue
        billed_cycles_90d = 90 / r.cadence_days
        # Convert a suggested "prudent usage" fraction into a minimum count.
        expected_uses = max(1, round(billed_cycles_90d * min_usage_ratio))
        used = usage_90d.get(r.merchant, 0)
        if used < expected_uses:
            monthly_impact = r.median_amount * (30 / r.cadence_days)
            findings.append(
                LeakFinding(
                    type=LeakType.SUBSCRIPTION_CREEP,
                    merchant=r.merchant,
                    impact_monthly=round(monthly_impact, 2),
                    impact_annual=round(monthly_impact * 12, 2),
                    confidence=0.75,
                    title=f"Dark subscription: {r.merchant}",
                    rationale=(
                        f"Charged ${r.median_amount:.2f} every ~{r.cadence_days} days "
                        f"({r.occurrences} times) but only {used} uses logged in the "
                        f"last 90 days. Cancelling saves ~${monthly_impact:.2f}/mo."
                    ),
                    evidence_txn_ids=r.txn_ids,
                    playbook=PLAYBOOK[LeakType.SUBSCRIPTION_CREEP],
                    context={
                        "occurrences": r.occurrences,
                        "uses_90d": used,
                        "expected_uses": expected_uses,
                        "cadence_days": r.cadence_days,
                        "price": r.median_amount,
                    },
                )
            )
    return findings


def detect_duplicate_charges(txns: list[Txn], max_gap_days: int = 2) -> list[LeakFinding]:
    """Find twin charges (same merchant, same amount, within a short window)."""
    buckets: dict[tuple[str, float], list[Txn]] = {}
    for t in txns:
        if not t.is_out or t.category not in _DUPLICATE_SUSPECT_CATEGORIES or not t.merchant:
            continue
        buckets.setdefault((t.merchant, round(abs(t.amount), 2)), []).append(t)

    findings: list[LeakFinding] = []
    for (merchant, amount), rows in buckets.items():
        rows.sort(key=lambda t: t.date)
        for a, b in zip(rows, rows[1:]):
            gap = (b.date - a.date).days
            if 0 <= gap <= max_gap_days:
                findings.append(
                    LeakFinding(
                        type=LeakType.DUPLICATE_CHARGE,
                        merchant=merchant,
                        impact_monthly=amount,
                        impact_annual=amount,
                        confidence=0.98,
                        title=f"Duplicate charge: {merchant}",
                        rationale=(
                            f"${amount:.2f} charged on {a.date.isoformat()} and again on "
                            f"{b.date.isoformat()} ({gap} day(s) apart). Refundable via "
                            f"merchant dispute."
                        ),
                        evidence_txn_ids=(a.id, b.id),
                        playbook=PLAYBOOK[LeakType.DUPLICATE_CHARGE],
                        context={
                            "gap_days": gap,
                            "dates": [a.date.isoformat(), b.date.isoformat()],
                            "amount": amount,
                        },
                    )
                )
    return findings


def detect_hidden_fees(
    txns: list[Txn],
    min_recurring_count: int = 4,
) -> list[LeakFinding]:
    """Bank/service fees: aggregated per merchant, split recurring vs one-off."""
    groups: dict[str, list[Txn]] = {}
    for t in txns:
        if not t.is_out or t.category != "fee" or not t.merchant:
            continue
        groups.setdefault(t.merchant, []).append(t)

    findings: list[LeakFinding] = []
    for merchant, rows in groups.items():
        rows.sort(key=lambda t: t.date)
        amounts = [abs(t.amount) for t in rows]
        if len(rows) >= min_recurring_count:
            impact = float(median(amounts))
            findings.append(
                LeakFinding(
                    type=LeakType.HIDDEN_FEE,
                    merchant=merchant,
                    impact_monthly=round(impact, 2),
                    impact_annual=round(impact * 12, 2),
                    confidence=0.95,
                    title=f"Recurring fees from {merchant}",
                    rationale=(
                        f"{len(rows)} fee charges totaling ${sum(amounts):.2f} "
                        f"(~${impact:.2f}/month). Bank fee waivers are commonly "
                        f"available on request."
                    ),
                    evidence_txn_ids=tuple(t.id for t in rows),
                    playbook=PLAYBOOK[LeakType.HIDDEN_FEE],
                    context={"count": len(rows), "total": round(float(sum(amounts)), 2)},
                )
            )
        else:
            impact = float(median(amounts))
            findings.append(
                LeakFinding(
                    type=LeakType.HIDDEN_FEE,
                    merchant=merchant,
                    impact_monthly=round(impact, 2),
                    impact_annual=round(float(sum(amounts)), 2),
                    confidence=0.95,
                    title=f"Penalty fee from {merchant}",
                    rationale=(
                        f"{len(rows)} penalty charge(s) totaling ${sum(amounts):.2f}. "
                        f"One-off — often refundable on first offense."
                    ),
                    evidence_txn_ids=tuple(t.id for t in rows),
                    playbook=PLAYBOOK[LeakType.HIDDEN_FEE],
                    context={"count": len(rows), "total": round(float(sum(amounts)), 2), "one_off": True},
                )
            )
    return findings


def detect_silent_price_hikes(
    recurring: list[Recurring],
    baseline_n: int = 4,
    hike_ratio: float = 1.15,
    confirm_occurrences: int = 2,
) -> list[LeakFinding]:
    """Detect a sustained step-up in a stable recurring series."""
    findings: list[LeakFinding] = []
    for r in recurring:
        if r.category not in _NON_ESSENTIAL:
            continue
        amounts = r.amounts
        if len(amounts) < baseline_n + confirm_occurrences:
            continue
        baseline = float(median(amounts[:baseline_n]))
        tail = amounts[-confirm_occurrences:]
        new_price = float(median(tail))
        if all(a >= baseline * hike_ratio for a in tail):
            delta = new_price - baseline
            impact_monthly = delta * (30 / r.cadence_days)
            pct = (new_price / baseline - 1) * 100
            findings.append(
                LeakFinding(
                    type=LeakType.SILENT_PRICE_HIKE,
                    merchant=r.merchant,
                    impact_monthly=round(impact_monthly, 2),
                    impact_annual=round(impact_monthly * 12, 2),
                    confidence=0.9,
                    title=f"Silent price hike: {r.merchant}",
                    rationale=(
                        f"Last {confirm_occurrences} bills are ${new_price:.2f} vs "
                        f"previous ~${baseline:.2f} (+{pct:.0f}%) with no notice on "
                        f"the statements. Consider a plan downgrade or renegotiation."
                    ),
                    evidence_txn_ids=r.txn_ids[-confirm_occurrences:],
                    playbook=PLAYBOOK[LeakType.SILENT_PRICE_HIKE],
                    context={
                        "previous_price": round(baseline, 2),
                        "new_price": round(new_price, 2),
                        "pct": round(pct, 1),
                    },
                )
            )
    return findings


def run_leak_radar(
    txns: list[Txn],
    recurring: list[Recurring],
    usage_90d: dict[str, int],
) -> list[LeakFinding]:
    """Run all four detectors. Ids are assigned later by the ranking step."""
    findings: list[LeakFinding] = []
    findings += detect_subscription_creep(recurring, usage_90d)
    findings += detect_duplicate_charges(txns)
    findings += detect_hidden_fees(txns)
    findings += detect_silent_price_hikes(recurring)
    return findings

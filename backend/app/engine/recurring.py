"""Recurring-cycle detection from a normalized transaction ledger.

A series qualifies when: >= min_count occurrences, gaps are near-constant,
and the cadence is plausibly periodic (>= 5 days).
"""

from __future__ import annotations

from datetime import date
from statistics import median

from .models import Recurring, Txn


def detect_recurring(
    txns: list[Txn],
    min_count: int = 4,
    cadence_tolerance_days: int = 5,
    amount_tolerance: float = 0.10,
    stability_fraction: float = 0.8,
) -> list[Recurring]:
    """Group debit transactions by merchant and extract periodic series.

    Fee-category transactions are excluded here: the fee detector owns them,
    which keeps detectors mutually exclusive by design.
    """
    by_merchant: dict[str, list[Txn]] = {}
    for t in txns:
        if not t.is_out or t.category == "fee" or not t.merchant:
            continue
        by_merchant.setdefault(t.merchant, []).append(t)

    results: list[Recurring] = []
    for merchant, rows in by_merchant.items():
        rows.sort(key=lambda t: t.date)
        if len(rows) < min_count:
            continue

        gaps = [(rows[i + 1].date - rows[i].date).days for i in range(len(rows) - 1)]
        cadence = float(median(gaps))
        if cadence < 5:
            continue
        stable_gaps = sum(1 for g in gaps if abs(g - cadence) <= cadence_tolerance_days)
        if stable_gaps / len(gaps) < stability_fraction:
            continue

        amounts = [abs(t.amount) for t in rows]
        med_amount = float(median(amounts))
        if med_amount <= 0:
            continue
        within = sum(1 for a in amounts if abs(a - med_amount) <= amount_tolerance * med_amount)
        amount_stable = (within / len(amounts)) >= stability_fraction

        results.append(
            Recurring(
                merchant=merchant,
                category=rows[0].category or "unknown",
                cadence_days=round(cadence),
                median_amount=round(med_amount, 2),
                occurrences=len(rows),
                amount_stable=amount_stable,
                txn_ids=tuple(t.id for t in rows),
                dates=tuple(t.date for t in rows),
                amounts=tuple(amounts),
            )
        )
    return results

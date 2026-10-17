"""Future Oracle: behavioral cash-flow projection + Doom Day detection.

Deterministic projection: current balance + scheduled recurring bills +
scheduled recurring income - discretionary burn rate. The same function runs
counterfactual ("what-if") projections by excluding merchants from the bill
schedule — that is what makes the what-if toggle honest: the delta is computed,
not hand-waved.
"""

from __future__ import annotations

from datetime import date, timedelta
from statistics import median

from .models import ForecastPoint, ForecastResult, Recurring, SandboxBundle, Txn, WhatIfResult

#: categories that make up the smoothed daily "burn" in projections
BURN_CATEGORIES = {"grocery", "dining", "transport", "shopping", "health", "fee"}

_INCOME_CATEGORIES = {"income"}


def _detect_scheduled_series(
    txns: list[Txn],
    amount_sign: float,
    min_count: int = 4,
    cadence_tolerance_days: int = 5,
) -> list[tuple[str, int, float, date]]:
    """Generic schedule extraction for out- or in-flows.

    Returns (merchant, cadence_days, median_amount, last_date) tuples.
    """
    by_merchant: dict[str, list[Txn]] = {}
    for t in txns:
        if amount_sign < 0 and not t.is_out:
            continue
        if amount_sign > 0 and t.is_out:
            continue
        if not t.merchant:
            continue
        if amount_sign < 0 and t.category == "fee":
            continue
        by_merchant.setdefault(t.merchant, []).append(t)

    schedules: list[tuple[str, int, float, date]] = []
    for merchant, rows in by_merchant.items():
        rows.sort(key=lambda t: t.date)
        if len(rows) < min_count:
            continue
        gaps = [(rows[i + 1].date - rows[i].date).days for i in range(len(rows) - 1)]
        cadence = float(median(gaps))
        if cadence < 5:
            continue
        if sum(1 for g in gaps if abs(g - cadence) <= cadence_tolerance_days) / len(gaps) < 0.8:
            continue
        amounts = [abs(t.amount) for t in rows]
        schedules.append((merchant, round(cadence), round(float(median(amounts)), 2), rows[-1].date))
    return schedules


def _daily_burn(
    txns: list[Txn],
    anchor: date,
    scheduled_merchants: set[str],
    window_days: int = 28,
) -> float:
    """Mean daily discretionary outflow over the trailing window.

    Transactions belonging to merchants already captured as recurring series
    (weekly groceries, transport top-ups) are excluded — their future hits are
    modeled exactly by the bill schedule, so counting them in the burn rate
    would double-count.
    """
    cutoff = anchor - timedelta(days=window_days)
    total = sum(
        abs(t.amount)
        for t in txns
        if t.is_out
        and t.category in BURN_CATEGORIES
        and cutoff <= t.date < anchor
        and t.merchant not in scheduled_merchants
    )
    return total / window_days


def project(
    bundle: SandboxBundle,
    recurring: list[Recurring],
    days: int = 40,
    exclusions: tuple[str, ...] = (),
    one_time_credits: tuple[float, ...] = (),
) -> ForecastResult:
    """Project daily balances for `days` days. Deterministic.

    `one_time_credits` are refunds/fee-waivers assumed to post 3 days out —
    they model Action Desk one-off plays (dispute duplicate, claim waiver).
    """
    anchor = bundle.anchor or date.today()
    end = anchor + timedelta(days=days)
    excluded = set(exclusions)

    # Scheduled outflow events (recurring bills)
    events: list[tuple[date, float]] = []
    for r in recurring:
        if r.merchant in excluded:
            continue
        due = r.dates[-1] + timedelta(days=r.cadence_days)
        while due <= end:
            events.append((due, -r.median_amount))
            due += timedelta(days=r.cadence_days)

    # Scheduled income events (payroll, remittance, ...)
    for merchant, cadence, amount, last in _detect_scheduled_series(bundle.transactions, +1):
        due = last + timedelta(days=cadence)
        while due <= end:
            events.append((due, amount))
            due += timedelta(days=cadence)

    events.sort(key=lambda e: e[0])
    idx = 0
    balance = bundle.balance_now

    # Events due exactly on the anchor day are part of "now".
    while idx < len(events) and events[idx][0] <= anchor:
        balance += events[idx][1]
        idx += 1

    burn = _daily_burn(
        bundle.transactions,
        anchor,
        scheduled_merchants={r.merchant for r in recurring},
    )
    credit_total = sum(one_time_credits)
    points: list[ForecastPoint] = []
    doom_day: date | None = None
    lowest = balance

    for day in range(1, days + 1):
        current = anchor + timedelta(days=day)
        while idx < len(events) and events[idx][0] <= current:
            balance += events[idx][1]
            idx += 1
        if day == 3 and credit_total:  # refunds/waivers post in 3 days
            balance += credit_total
        balance -= burn
        points.append(ForecastPoint(day_offset=day, date=current, balance=round(balance, 2)))
        lowest = min(lowest, balance)
        if doom_day is None and balance < 0:
            doom_day = current

    return ForecastResult(
        points=points,
        doom_day=doom_day,
        lowest_balance=round(lowest, 2),
        window_days=days,
    )


def what_if(
    bundle: SandboxBundle,
    recurring: list[Recurring],
    exclusions: tuple[str, ...] = (),
    days: int = 40,
    one_time_credits: tuple[float, ...] = (),
) -> WhatIfResult:
    """Counterfactual projection with `exclusions` removed from bill schedules
    and `one_time_credits` (expected refunds/waivers) posting on day 3."""
    baseline = project(bundle, recurring, days=days)
    counterfactual = project(
        bundle, recurring, days=days, exclusions=exclusions, one_time_credits=one_time_credits
    )

    excluded = set(exclusions)
    savings = sum(
        r.median_amount * (30 / r.cadence_days)
        for r in recurring
        if r.merchant in excluded
    )
    return WhatIfResult(
        excluded=tuple(sorted(excluded)),
        baseline=baseline,
        counterfactual=counterfactual,
        monthly_savings=round(savings, 2),
    )

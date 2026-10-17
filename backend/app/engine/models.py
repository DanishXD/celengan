"""Engine core data models (pure dataclasses — no ORM dependency).

The deterministic engine works on these structures so tests stay simple and
the same code path powers both the demo CLI and the REST API.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class LeakType(str, Enum):
    SUBSCRIPTION_CREEP = "subscription_creep"
    DUPLICATE_CHARGE = "duplicate_charge"
    HIDDEN_FEE = "hidden_fee"
    SILENT_PRICE_HIKE = "silent_price_hike"


#: Leak type -> Action Desk playbook reference (wired in the agent layer).
PLAYBOOK: dict[LeakType, str] = {
    LeakType.SUBSCRIPTION_CREEP: "cancel_subscription",
    LeakType.DUPLICATE_CHARGE: "dispute_duplicate",
    LeakType.HIDDEN_FEE: "claim_fee_refund",
    LeakType.SILENT_PRICE_HIKE: "renegotiate_hike",
}


@dataclass
class Txn:
    """One sandbox transaction. `amount` < 0 = money out (debit)."""

    id: str
    date: date
    description: str          # raw, messy bank-style description
    amount: float
    merchant: str | None = None   # assigned by the normalizer
    category: str | None = None   # assigned by the normalizer

    @property
    def is_out(self) -> bool:
        return self.amount < 0


@dataclass(frozen=True)
class Recurring:
    """A detected recurring outflow series (bill/subscription)."""

    merchant: str
    category: str
    cadence_days: int
    median_amount: float
    occurrences: int
    amount_stable: bool
    txn_ids: tuple[str, ...]
    dates: tuple[date, ...]
    amounts: tuple[float, ...]


@dataclass
class LeakFinding:
    """A quantified money-leak finding. Ships with its own 'receipt' data."""

    id: str = ""
    type: LeakType = LeakType.HIDDEN_FEE
    merchant: str = ""
    impact_monthly: float = 0.0
    impact_annual: float = 0.0
    confidence: float = 0.5
    title: str = ""
    rationale: str = ""
    evidence_txn_ids: tuple[str, ...] = ()
    playbook: str = PLAYBOOK[LeakType.HIDDEN_FEE]
    score: float | None = None
    context: dict = field(default_factory=dict)   # detector-specific hints (counts, prices)


@dataclass
class SandboxBundle:
    """Everything the engine needs for one sandbox user."""

    profile_name: str = "Maya"
    window_days: int = 185
    anchor: date | None = None            # "today" at generation time
    start_balance: float = 0.0
    balance_now: float = 0.0
    usage_90d: dict[str, int] = field(default_factory=dict)
    transactions: list[Txn] = field(default_factory=list)


@dataclass(frozen=True)
class ForecastPoint:
    day_offset: int
    date: date
    balance: float


@dataclass(frozen=True)
class ForecastResult:
    points: list[ForecastPoint]
    doom_day: date | None            # first projected negative-balance day
    lowest_balance: float
    window_days: int


@dataclass(frozen=True)
class WhatIfResult:
    excluded: tuple[str, ...]
    baseline: ForecastResult
    counterfactual: ForecastResult
    monthly_savings: float

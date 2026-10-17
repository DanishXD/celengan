"""Pydantic response models for the Celengan API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SandboxOut(BaseModel):
    user: str
    synthetic: bool = True
    window_days: int
    transaction_count: int
    balance_now: float
    recurring_count: int
    findings_count: int


class TxnOut(BaseModel):
    id: str
    date: str
    description: str
    amount: float
    merchant: str | None = None
    category: str | None = None


class LeakOut(BaseModel):
    id: str
    type: str
    merchant: str
    impact_monthly: float
    impact_annual: float
    confidence: float
    title: str
    rationale: str
    evidence_txn_ids: list[str]
    playbook: str
    score: float | None = None
    context: dict = Field(default_factory=dict)


class TotalsOut(BaseModel):
    monthly_impact: float
    annual_impact: float


class ForecastPointOut(BaseModel):
    day_offset: int
    date: str
    balance: float


class ForecastOut(BaseModel):
    state: str
    window_days: int
    doom_day: str | None = None
    lowest_balance: float
    applied_exclusions: list[str] = Field(default_factory=list)
    applied_credits_total: float = 0.0
    applied_discounts: dict[str, float] = Field(default_factory=dict)
    points: list[ForecastPointOut] = Field(default_factory=list)


class WhatIfOut(BaseModel):
    excluded: list[str]
    monthly_savings: float
    baseline: ForecastOut
    counterfactual: ForecastOut


class PlayOut(BaseModel):
    finding_id: str
    playbook: str
    tier: int
    label: str
    effect: str
    merchant: str
    impact_monthly: float


class ReceiptOut(BaseModel):
    id: str
    created_at: str
    finding_id: str
    playbook: str
    tier: int
    status: str
    subject: str
    body: str
    generator: str
    impact_monthly: float
    impact_note: str
    evidence_txn_ids: list[str]
    undone: bool


class ConsentOut(BaseModel):
    tier2_enabled: bool
    kill_switch: bool
    tier2_spent_this_month: float
    tier2_monthly_cap: float
    tier2_max_single_action: float


class AuditEventOut(BaseModel):
    ts: str
    event: str
    details: dict = Field(default_factory=dict)


class MessageOut(BaseModel):
    message: str

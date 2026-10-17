"""API routers — thin controllers over AppState.

Error semantics:
  404 — unknown finding / receipt
  409 — domain rule violation (duplicate play, already undone)
  422 — rejected by the Policy Engine (consent, caps, kill switch)
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api import schemas as S
from app.engine.ranking import total_annual_impact, total_monthly_impact
from app.engine.forecaster import what_if as engine_what_if
from app.policy.engine import PolicyViolation
from app.state import STATE, Receipt

router = APIRouter()


# ------------------------------------------------------------------- sandbox
@router.get("/sandbox", response_model=S.SandboxOut)
def sandbox_summary() -> S.SandboxOut:
    b = STATE.bundle
    return S.SandboxOut(
        user=b.profile_name,
        window_days=b.window_days,
        transaction_count=len(b.transactions),
        balance_now=b.balance_now,
        recurring_count=len(STATE.recurring),
        findings_count=len(STATE.findings),
    )


@router.post("/sandbox/reload", response_model=S.MessageOut)
def sandbox_reload() -> S.MessageOut:
    STATE.reload()
    return S.MessageOut(message="sandbox session reloaded (deterministic seed)")


@router.get("/transactions", response_model=list[S.TxnOut])
def transactions() -> list[S.TxnOut]:
    return [
        S.TxnOut(
            id=t.id, date=t.date.isoformat(), description=t.description,
            amount=t.amount, merchant=t.merchant, category=t.category,
        )
        for t in STATE.txns
    ]


# --------------------------------------------------------------------- leaks
@router.get("/leaks")
def leaks() -> dict:
    findings = [
        S.LeakOut(
            id=f.id, type=f.type.value, merchant=f.merchant,
            impact_monthly=f.impact_monthly, impact_annual=f.impact_annual,
            confidence=f.confidence, title=f.title, rationale=f.rationale,
            evidence_txn_ids=list(f.evidence_txn_ids), playbook=f.playbook,
            score=f.score, context=f.context,
        )
        for f in STATE.findings
    ]
    return {
        "findings": findings,
        "totals": S.TotalsOut(
            monthly_impact=total_monthly_impact(STATE.findings),
            annual_impact=total_annual_impact(STATE.findings),
        ),
    }


# ------------------------------------------------------------------ forecast
def _forecast_out(state_name: str, days: int) -> S.ForecastOut:
    data = STATE.forecast(days=days, state=state_name)
    return S.ForecastOut(
        state=data["state"],
        window_days=data["window_days"],
        doom_day=data["doom_day"],
        lowest_balance=data["lowest_balance"],
        applied_exclusions=data["applied_exclusions"],
        applied_credits_total=data["applied_credits_total"],
        applied_discounts=data["applied_discounts"],
        points=[S.ForecastPointOut(**p) for p in data["points"]],
    )


@router.get("/forecast")
def forecast(days: int = Query(default=40, ge=5, le=120)) -> dict:
    return {
        "baseline": _forecast_out("baseline", days),
        "current": _forecast_out("current", days),
    }


@router.get("/forecast/what-if", response_model=S.WhatIfOut)
def what_if(
    exclude: str = Query(default="", description="comma-separated merchant names"),
    credits: str = Query(
        default="", description="comma-separated one-time credits (e.g. refunds), max 8"
    ),
    days: int = Query(default=40, ge=5, le=120),
) -> S.WhatIfOut:
    exclusions = tuple(m.strip() for m in exclude.split(",") if m.strip())
    try:
        one_time = tuple(float(c) for c in credits.split(",") if c.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="credits must be comma-separated numbers")
    if len(one_time) > 8:
        raise HTTPException(status_code=400, detail="too many credits (max 8)")

    result = engine_what_if(
        STATE.bundle, STATE.recurring, exclusions=exclusions, days=days, one_time_credits=one_time
    )

    def to_out(state_name: str, fr) -> S.ForecastOut:
        return S.ForecastOut(
            state=state_name,
            window_days=fr.window_days,
            doom_day=fr.doom_day.isoformat() if fr.doom_day else None,
            lowest_balance=fr.lowest_balance,
            points=[
                S.ForecastPointOut(day_offset=p.day_offset, date=p.date.isoformat(), balance=p.balance)
                for p in fr.points
            ],
        )

    return S.WhatIfOut(
        excluded=list(result.excluded),
        one_time_credits=list(one_time),
        monthly_savings=result.monthly_savings,
        baseline=to_out("baseline", result.baseline),
        counterfactual=to_out("counterfactual", result.counterfactual),
    )


# ------------------------------------------------------------------- actions
class ActionRequestIn(BaseModel):
    finding_id: str
    tier: int
    confirm: bool = False


class UndoIn(BaseModel):
    receipt_id: str


class FlagIn(BaseModel):
    enabled: bool


def _receipt_out(r: Receipt) -> S.ReceiptOut:
    return S.ReceiptOut(
        id=r.id, created_at=r.created_at, finding_id=r.finding_id,
        playbook=r.playbook, tier=r.tier, status=r.status,
        subject=r.subject, body=r.body, generator=r.generator,
        impact_monthly=r.impact_monthly, impact_note=r.impact_note,
        evidence_txn_ids=list(r.evidence_txn_ids), undone=r.undone,
    )


@router.get("/actions/plays", response_model=list[S.PlayOut])
def action_plays() -> list[S.PlayOut]:
    return [S.PlayOut(**p) for p in STATE.plays()]


@router.post("/actions/request", response_model=S.ReceiptOut)
def request_action(body: ActionRequestIn) -> S.ReceiptOut:
    try:
        receipt = STATE.execute_action(body.finding_id, body.tier, body.confirm)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except PolicyViolation as exc:
        raise HTTPException(status_code=422, detail=exc.decision.reason)
    return _receipt_out(receipt)


@router.post("/actions/undo", response_model=S.ReceiptOut)
def undo_action(body: UndoIn) -> S.ReceiptOut:
    try:
        receipt = STATE.undo(body.receipt_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return _receipt_out(receipt)


@router.post("/actions/kill-switch", response_model=S.MessageOut)
def kill_switch(body: FlagIn) -> S.MessageOut:
    STATE.set_kill_switch(body.enabled)
    return S.MessageOut(message=f"kill switch {'ENGAGED — autopilot halted' if body.enabled else 'released'}")


@router.get("/consent", response_model=S.ConsentOut)
def get_consent() -> S.ConsentOut:
    c = STATE.policy.consent
    return S.ConsentOut(
        tier2_enabled=c.tier2_enabled,
        kill_switch=c.kill_switch,
        tier2_spent_this_month=c.tier2_spent_this_month,
        tier2_monthly_cap=STATE.policy.settings.tier2_monthly_cap,
        tier2_max_single_action=STATE.policy.settings.tier2_max_single_action,
    )


@router.post("/consent", response_model=S.ConsentOut)
def set_consent(body: FlagIn) -> S.ConsentOut:
    STATE.set_consent(body.enabled)
    return get_consent()


@router.get("/receipts", response_model=list[S.ReceiptOut])
def receipts() -> list[S.ReceiptOut]:
    return [_receipt_out(r) for r in STATE.receipts]


# --------------------------------------------------------------------- audit
@router.get("/audit", response_model=list[S.AuditEventOut])
def audit(limit: int = Query(default=100, ge=1, le=1000)) -> list[S.AuditEventOut]:
    events = STATE.audit.tail(limit)
    return [
        S.AuditEventOut(
            ts=e["ts"], event=e["event"],
            details={k: v for k, v in e.items() if k not in ("ts", "event")},
        )
        for e in events
    ]

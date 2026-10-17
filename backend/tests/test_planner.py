"""Planner tests: play catalog + deterministic drafts (LLM off)."""

from __future__ import annotations

from app.agent.planner import build_draft, build_plays, plays_for
from app.engine.models import LeakFinding, LeakType
from app.config import settings


def test_every_leak_type_has_plays() -> None:
    for lt in LeakType:
        f = LeakFinding(type=lt, playbook={
            LeakType.SUBSCRIPTION_CREEP: "cancel_subscription",
            LeakType.DUPLICATE_CHARGE: "dispute_duplicate",
            LeakType.HIDDEN_FEE: "claim_fee_refund",
            LeakType.SILENT_PRICE_HIKE: "renegotiate_hike",
        }[lt])
        assert plays_for(f), f"no plays for {lt}"


def test_build_plays_covers_findings() -> None:
    findings = [
        LeakFinding(id="L001", playbook="cancel_subscription", merchant="GymFlow"),
        LeakFinding(id="L002", playbook="claim_fee_refund", merchant="Card Penalty (Fees)"),
    ]
    plays = build_plays(findings)
    ids = {p["finding_id"] for p in plays}
    assert ids == {"L001", "L002"}
    assert all(p["tier"] in (1, 2) for p in plays)


def test_drafts_are_deterministic_without_llm(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_enabled", False)
    finding = LeakFinding(
        id="L003", playbook="dispute_duplicate", merchant="StreamVibe",
        impact_monthly=13.49, evidence_txn_ids=("T0101", "T0102"),
        context={"gap_days": 1, "amount": 13.49},
    )
    subject, body, generator = build_draft(finding)
    assert generator == "template"
    assert "StreamVibe" in subject and "13.49" in subject
    assert "T0101" in body and "refund" in body.lower()


def test_renegotiation_draft_uses_context_prices(monkeypatch) -> None:
    monkeypatch.setattr(settings, "llm_enabled", False)
    finding = LeakFinding(
        id="L005", playbook="renegotiate_hike", merchant="Spotify",
        impact_monthly=3.0, evidence_txn_ids=("T0099",),
        context={"previous_price": 9.99, "new_price": 12.99},
    )
    subject, body, generator = build_draft(finding)
    assert generator == "template"
    assert "9.99" in body and "12.99" in body

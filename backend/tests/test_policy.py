"""Policy Engine tests — the permission ladder must be airtight."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import settings
from app.policy.audit import AuditLog
from app.policy.engine import ActionRequest, PolicyEngine


@pytest.fixture()
def engine(tmp_path: Path) -> PolicyEngine:
    return PolicyEngine(settings, AuditLog(tmp_path / "audit.jsonl"))


def _req(tier: int, amount: float = 0.0, confirm: bool = False, fid: str = "L001") -> ActionRequest:
    return ActionRequest(finding_id=fid, playbook="cancel_subscription", tier=tier, amount=amount, confirm=confirm)


def test_tier0_always_allowed(engine: PolicyEngine) -> None:
    assert engine.evaluate(_req(0)).approved is True


def test_tier1_requires_confirmation(engine: PolicyEngine) -> None:
    assert engine.evaluate(_req(1)).approved is False
    assert engine.evaluate(_req(1, confirm=True)).approved is True


def test_tier2_requires_consent(engine: PolicyEngine) -> None:
    d = engine.evaluate(_req(2, amount=29.0))
    assert d.approved is False and "consent" in d.reason.lower()

    engine.set_consent(True)
    assert engine.evaluate(_req(2, amount=29.0)).approved is True


def test_tier2_per_action_cap(engine: PolicyEngine) -> None:
    engine.set_consent(True)
    d = engine.evaluate(_req(2, amount=settings.tier2_max_single_action + 0.01, fid="L009"))
    assert d.approved is False and "cap" in d.reason.lower()


def test_tier2_monthly_cap(engine: PolicyEngine) -> None:
    engine.set_consent(True)
    # drain the monthly budget with the largest allowed actions
    amount = settings.tier2_max_single_action
    while engine.consent.tier2_spent_this_month + amount <= settings.tier2_monthly_cap:
        assert engine.evaluate(_req(2, amount=amount, fid=f"LX{engine.consent.tier2_spent_this_month:.0f}")).approved
        engine.record_tier2_spend(amount)
    d = engine.evaluate(_req(2, amount=amount, fid="LX-final"))
    assert d.approved is False and "monthly" in d.reason.lower()


def test_kill_switch_blocks_tier2_even_with_consent(engine: PolicyEngine) -> None:
    engine.set_consent(True)
    engine.set_kill_switch(True)
    d = engine.evaluate(_req(2, amount=29.0))
    assert d.approved is False and "kill" in d.reason.lower()
    engine.set_kill_switch(False)
    assert engine.evaluate(_req(2, amount=29.0)).approved is True


def test_every_decision_is_audited(engine: PolicyEngine) -> None:
    engine.evaluate(_req(1, confirm=True))
    engine.evaluate(_req(2, amount=29.0))
    events = engine.audit.tail(10)
    assert any(e["event"] == "policy.decision" and e["approved"] for e in events)
    assert any(e["event"] == "policy.decision" and not e["approved"] for e in events)

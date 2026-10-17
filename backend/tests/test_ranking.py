"""Ranking tests: ordering, ids, and scores."""

from __future__ import annotations

from app.engine.models import LeakFinding, LeakType
from app.engine.ranking import rank, total_annual_impact, total_monthly_impact


def test_rank_orders_and_assigns_ids() -> None:
    findings = [
        LeakFinding(type=LeakType.HIDDEN_FEE, merchant="A", impact_monthly=5.0, confidence=0.9),
        LeakFinding(type=LeakType.SUBSCRIPTION_CREEP, merchant="B", impact_monthly=29.0, confidence=0.7),
        LeakFinding(type=LeakType.DUPLICATE_CHARGE, merchant="C", impact_monthly=13.49, confidence=0.98),
    ]
    ranked = rank(findings)
    assert [f.merchant for f in ranked] == ["B", "C", "A"]
    assert [f.id for f in ranked] == ["L001", "L002", "L003"]
    assert ranked[0].score == 100.0
    assert all(f.score is not None and f.score >= ranked[-1].score for f in ranked)


def test_totals() -> None:
    findings = [
        LeakFinding(impact_monthly=29.0),
        LeakFinding(impact_monthly=13.49),
        LeakFinding(impact_monthly=4.95),
    ]
    assert total_monthly_impact(findings) == 47.44
    assert total_annual_impact(findings) == round(47.44 * 12, 2)


def test_rank_empty_list() -> None:
    assert rank([]) == []

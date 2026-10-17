"""Detector tests against the seeded Maya sandbox bundle."""

from __future__ import annotations

import pytest

from app.engine.detectors import (
    detect_duplicate_charges,
    detect_hidden_fees,
    detect_silent_price_hikes,
    detect_subscription_creep,
    run_leak_radar,
)
from app.engine.models import LeakType
from app.engine.normalizer import normalize_all
from app.engine.recurring import detect_recurring
from seed.synthetic import generate_maya


@pytest.fixture(scope="module")
def radar() -> tuple:
    bundle = generate_maya()
    txns = normalize_all(bundle.transactions)
    recurring = detect_recurring(txns)
    findings = run_leak_radar(txns, recurring, bundle.usage_90d)
    return bundle, txns, recurring, findings


def test_all_four_leak_classes_are_found(radar) -> None:
    _, _, _, findings = radar
    types = {f.type for f in findings}
    assert LeakType.SUBSCRIPTION_CREEP in types
    assert LeakType.DUPLICATE_CHARGE in types
    assert LeakType.HIDDEN_FEE in types
    assert LeakType.SILENT_PRICE_HIKE in types


def test_creep_catches_gymflow_not_netflix(radar) -> None:
    _, _, _, findings = radar
    creeps = [f for f in findings if f.type == LeakType.SUBSCRIPTION_CREEP]
    assert [f.merchant for f in creeps] == ["GymFlow"]


def test_duplicate_catches_streamvibe_twin(radar) -> None:
    _, _, _, findings = radar
    dups = [f for f in findings if f.type == LeakType.DUPLICATE_CHARGE]
    assert len(dups) == 1
    assert dups[0].merchant == "StreamVibe"
    assert dups[0].impact_monthly == 13.49
    assert len(dups[0].evidence_txn_ids) == 2


def test_fees_catch_maintenance_and_penalty(radar) -> None:
    _, _, _, findings = radar
    fees = [f for f in findings if f.type == LeakType.HIDDEN_FEE]
    merchants = {f.merchant for f in fees}
    assert "State Bank (Fees)" in merchants
    assert "Card Penalty (Fees)" in merchants


def test_hike_catches_spotify_stepup(radar) -> None:
    _, _, _, findings = radar
    hikes = [f for f in findings if f.type == LeakType.SILENT_PRICE_HIKE]
    assert len(hikes) == 1
    assert hikes[0].merchant == "Spotify"
    assert pytest.approx(hikes[0].impact_monthly, abs=0.02) == 3.0


def test_recurring_extracts_expected_series(radar) -> None:
    _, _, recurring, _ = radar
    by_merchant = {r.merchant: r for r in recurring}
    assert "Netflix" in by_merchant
    assert by_merchant["Netflix"].cadence_days == 30
    assert by_merchant["Netflix"].occurrences >= 5
    assert by_merchant["Spotify"].amount_stable is False
    assert by_merchant["GymFlow"].amount_stable is True


def test_unit_detectors_on_minimal_fixtures() -> None:
    import datetime as dt

    from app.engine.models import Recurring, Txn
    from app.engine.normalizer import normalize_all

    txns = normalize_all([
        Txn(id="A", date=dt.date(2026, 1, 1), description="STREAMVIBE SUBSCRIPTION", amount=-13.49),
        Txn(id="B", date=dt.date(2026, 1, 2), description="STREAMVIBE SUBSCRIPTION", amount=-13.49),
    ])
    dups = detect_duplicate_charges(txns)
    assert len(dups) == 1

    fees = normalize_all([
        Txn(id="F1", date=dt.date(2026, 1, 1), description="STATE BANK MONTHLY MAINT FEE", amount=-4.95),
        Txn(id="F2", date=dt.date(2026, 2, 1), description="STATE BANK MONTHLY MAINT FEE", amount=-4.95),
        Txn(id="F3", date=dt.date(2026, 3, 1), description="STATE BANK MONTHLY MAINT FEE", amount=-4.95),
        Txn(id="F4", date=dt.date(2026, 4, 1), description="STATE BANK MONTHLY MAINT FEE", amount=-4.95),
    ])
    fee_findings = detect_hidden_fees(fees)
    assert len(fee_findings) == 1
    assert fee_findings[0].impact_monthly == 4.95

    recurring = [
        Recurring(  # 4 stable baseline bills then a sustained step-up
            merchant="Spotify",
            category="subscription",
            cadence_days=30,
            median_amount=11.99,
            occurrences=6,
            amount_stable=False,
            txn_ids=tuple(f"S{i}" for i in range(6)),
            dates=tuple(dt.date(2026, 1, 1) + dt.timedelta(days=30 * i) for i in range(6)),
            amounts=(9.99, 9.99, 9.99, 9.99, 13.99, 13.99),
        )
    ]
    hikes = detect_silent_price_hikes(recurring)
    assert len(hikes) == 1
    assert hikes[0].merchant == "Spotify"

    creeps = detect_subscription_creep(
        [
            Recurring(
                merchant="GymFlow",
                category="gym",
                cadence_days=30,
                median_amount=29.0,
                occurrences=6,
                amount_stable=True,
                txn_ids=(),
                dates=(),
                amounts=(29.0, 29.0, 29.0, 29.0, 29.0, 29.0),
            )
        ],
        {"GymFlow": 0},
    )
    assert len(creeps) == 1

"""Forecaster tests: projection shape, doom-day logic, and what-if deltas."""

from __future__ import annotations

from app.engine.forecaster import project, what_if
from app.engine.normalizer import normalize_all
from app.engine.recurring import detect_recurring
from seed.synthetic import generate_maya


def _setup() -> tuple:
    bundle = generate_maya()
    txns = normalize_all(bundle.transactions)
    recurring = detect_recurring(txns)
    return bundle, recurring


def test_projection_shape_and_margins() -> None:
    bundle, recurring = _setup()
    result = project(bundle, recurring, days=40)
    assert len(result.points) == 40
    assert result.points[0].day_offset == 1
    assert result.points[-1].day_offset == 40
    assert result.lowest_balance <= result.points[0].balance


def test_maya_story_produces_doom_day() -> None:
    """The seeded sandbox user must hit a negative-balance day inside the window.

    Story lock (verified empirically, seed=42): Doom Day lands ~day 33 —
    two days before Maya's next payday (paycheck-to-paycheck pattern).
    """
    bundle, recurring = _setup()
    result = project(bundle, recurring, days=40)
    assert result.doom_day is not None
    assert result.lowest_balance < 0
    offset = (result.doom_day - (bundle.anchor or result.doom_day)).days
    assert 25 <= offset <= 40


def test_what_if_cancelling_creep_improves_outlook() -> None:
    bundle, recurring = _setup()
    result = what_if(
        bundle, recurring, exclusions=("GymFlow",),
        one_time_credits=(13.49, 15.0), days=40,
    )
    assert result.monthly_savings > 25.0        # gym at $29/mo
    assert result.counterfactual.lowest_balance > result.baseline.lowest_balance
    assert "GymFlow" in result.excluded
    # Story lock: the Action Desk plays clear the doom day entirely.
    assert result.counterfactual.doom_day is None

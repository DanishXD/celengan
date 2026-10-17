"""Impact ranking: turn findings into a prioritized leak list with scores."""

from __future__ import annotations

from .models import LeakFinding


def rank(findings: list[LeakFinding]) -> list[LeakFinding]:
    """Sort by quantified monthly impact (desc, confidence as tiebreak),
    assign stable ids (L001...) and a 0-100 score relative to the top leak."""
    if not findings:
        return []
    max_impact = max(f.impact_monthly for f in findings) or 1.0
    ordered = sorted(findings, key=lambda f: (-f.impact_monthly, -f.confidence))
    for i, f in enumerate(ordered, start=1):
        f.id = f"L{i:03d}"
        f.score = round(100.0 * f.impact_monthly / max_impact, 1)
    return ordered


def total_monthly_impact(findings: list[LeakFinding]) -> float:
    return round(sum(f.impact_monthly for f in findings), 2)


def total_annual_impact(findings: list[LeakFinding]) -> float:
    return round(total_monthly_impact(findings) * 12, 2)

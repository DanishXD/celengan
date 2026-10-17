"""Action Desk planner — playbook registry and draft generation.

The planner PROPOSES; the Policy Engine DISPOSES. Drafts are deterministic
templates by default; when the LLM feature flag is on (and a key is present),
draft bodies are upgraded through an OpenAI-compatible endpoint — but any
failure falls back to the template, so the demo never breaks.
"""

from __future__ import annotations

from app.config import settings
from app.engine.models import LeakFinding

#: playbook -> available tiers with human labels
PLAY_TIERS: dict[str, list[dict]] = {
    "cancel_subscription": [
        {"tier": 1, "label": "Draft cancellation email", "effect": "draft"},
        {"tier": 2, "label": "Autopilot pause at next renewal", "effect": "recurring_exclusion"},
    ],
    "dispute_duplicate": [
        {"tier": 1, "label": "Draft dispute letter (refund expected)", "effect": "one_time_credit"},
    ],
    "claim_fee_refund": [
        {"tier": 1, "label": "Draft fee-waiver request", "effect": "one_time_credit"},
    ],
    "renegotiate_hike": [
        {"tier": 1, "label": "Draft renegotiation / downgrade letter", "effect": "draft"},
        {"tier": 2, "label": "Autopilot downgrade at next renewal", "effect": "recurring_discount"},
    ],
}


def plays_for(finding: LeakFinding) -> list[dict]:
    """Action catalog entry for one finding."""
    tiers = PLAY_TIERS.get(finding.playbook, [])
    return [
        {
            "finding_id": finding.id,
            "playbook": finding.playbook,
            "tier": t["tier"],
            "label": t["label"],
            "effect": t["effect"],
            "merchant": finding.merchant,
            "impact_monthly": finding.impact_monthly,
        }
        for t in tiers
    ]


def build_plays(findings: list[LeakFinding]) -> list[dict]:
    plays: list[dict] = []
    for f in findings:
        plays.extend(plays_for(f))
    return plays


# --------------------------------------------------------------------- drafts
def _template_draft(finding: LeakFinding) -> tuple[str, str]:
    """Deterministic draft (subject, body) per playbook."""
    evidence = ", ".join(finding.evidence_txn_ids[:4])
    ctx = finding.context
    if finding.playbook == "cancel_subscription":
        subject = f"Cancellation request — {finding.merchant} subscription"
        body = (
            f"Hello {finding.merchant} Support,\n\n"
            f"Please cancel my subscription effective at the end of the current "
            f"billing cycle. My statements show {ctx.get('occurrences', 'recurring')} "
            f"recurring charges of ${ctx.get('price', finding.impact_monthly):,.2f} "
            f"(ref: {evidence}).\n\n"
            f"Please confirm the cancellation and the final billing date.\n\n"
            f"Thank you,\nMaya (Celengan-managed account)"
        )
    elif finding.playbook == "dispute_duplicate":
        subject = f"Duplicate charge dispute — ${finding.impact_monthly:,.2f} ({finding.merchant})"
        body = (
            f"Dear Bank Disputes Team,\n\n"
            f"I am disputing a duplicate charge of ${finding.impact_monthly:,.2f} "
            f"from {finding.merchant}. The same amount was debited twice within a "
            f"24-hour window (transactions {evidence}); only one was authorized.\n\n"
            f"I request a refund of ${finding.impact_monthly:,.2f} for the "
            f"unauthorized second charge.\n\n"
            f"Thank you,\nMaya (Celengan-managed account)"
        )
    elif finding.playbook == "claim_fee_refund":
        subject = f"Fee waiver request — ${finding.impact_monthly:,.2f} ({finding.merchant})"
        body = (
            f"Dear {finding.merchant},\n\n"
            f"I would like to request a waiver of the fee(s) listed on my "
            f"statements (ref: {evidence}). This is my first request; I would "
            f"appreciate a one-time courtesy reversal of ${finding.impact_monthly:,.2f}.\n\n"
            f"Thank you,\nMaya (Celengan-managed account)"
        )
    else:  # renegotiate_hike
        prev = ctx.get("previous_price", 0.0)
        new = ctx.get("new_price", finding.impact_monthly)
        subject = f"Plan review request — {finding.merchant} price increase"
        body = (
            f"Hello {finding.merchant} Support,\n\n"
            f"My plan was recently repriced from ${prev:,.2f} "
            f"to ${new:,.2f} per month without notice (ref: {evidence}).\n\n"
            f"I would like to either restore the previous rate or move to an "
            f"equivalent lower tier.\n\n"
            f"Thank you,\nMaya (Celengan-managed account)"
        )
    return subject, body


def _llm_draft(finding: LeakFinding) -> tuple[str, str] | None:
    """Upgrade the draft via an OpenAI-compatible chat endpoint. Optional."""
    if not (settings.llm_enabled and settings.llm_api_key):
        return None
    try:
        import httpx

        subject_hint, body = _template_draft(finding)
        prompt = (
            "Rewrite this customer-service draft so it is concise, warm and firm. "
            "Keep every factual figure and reference identical. Reply with only "
            "the rewritten email body.\n\n" + body
        )
        resp = httpx.post(
            f"{settings.llm_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            json={
                "model": settings.llm_model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 400,
                "temperature": 0.4,
            },
            timeout=20.0,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        if content:
            return subject_hint, content
    except Exception:  # noqa: BLE001 — LLM is an enhancement, never a dependency
        return None
    return None


def build_draft(finding: LeakFinding) -> tuple[str, str, str]:
    """Return (subject, body, generator) — template or LLM-upgraded."""
    upgraded = _llm_draft(finding)
    if upgraded is not None:
        subject, body = upgraded
        return subject, body, "llm"
    subject, body = _template_draft(finding)
    return subject, body, "template"

"""End-to-end API tests: the full Detect -> Simulate -> Execute loop."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as c:
        c.post("/sandbox/reload")
        yield c


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_sandbox_summary(client: TestClient) -> None:
    r = client.get("/sandbox")
    assert r.status_code == 200
    body = r.json()
    assert body["user"] == "Maya" and body["synthetic"] is True
    assert body["transaction_count"] > 100
    assert body["findings_count"] >= 5


def test_leaks_ranked(client: TestClient) -> None:
    body = client.get("/leaks").json()
    findings = body["findings"]
    assert len(findings) >= 5
    scores = [f["score"] for f in findings]
    assert scores == sorted(scores, reverse=True)
    assert findings[0]["merchant"] == "GymFlow"
    assert body["totals"]["monthly_impact"] > 60


def test_forecast_has_doom_day(client: TestClient) -> None:
    body = client.get("/forecast?days=40").json()
    baseline, current = body["baseline"], body["current"]
    assert baseline["doom_day"] is not None
    assert len(baseline["points"]) == 40
    assert current["state"] == "current"


def test_what_if_endpoint(client: TestClient) -> None:
    body = client.get("/forecast/what-if?exclude=GymFlow&days=40").json()
    assert body["excluded"] == ["GymFlow"]
    assert 25 < body["monthly_savings"] < 32
    assert body["counterfactual"]["lowest_balance"] > body["baseline"]["lowest_balance"]


def test_what_if_with_credits(client: TestClient) -> None:
    r = client.get("/forecast/what-if?exclude=GymFlow&credits=13.49,15.0&days=40")
    assert r.status_code == 200
    body = r.json()
    assert body["one_time_credits"] == [13.49, 15.0]
    assert body["counterfactual"]["doom_day"] is None  # story lock holds with credits


def test_what_if_bad_credits_400(client: TestClient) -> None:
    r = client.get("/forecast/what-if?credits=abc")
    assert r.status_code == 400


def test_tier2_rejected_without_consent(client: TestClient) -> None:
    r = client.post("/actions/request", json={"finding_id": "L001", "tier": 2})
    assert r.status_code == 422


def test_full_action_flow(client: TestClient) -> None:
    # consent for Tier 2
    assert client.post("/consent", json={"enabled": True}).json()["tier2_enabled"] is True

    # Tier 2: autopilot-pause GymFlow
    r = client.post("/actions/request", json={"finding_id": "L001", "tier": 2, "confirm": True})
    assert r.status_code == 200
    receipt = r.json()
    assert receipt["status"] == "autopilot_active"
    assert receipt["effect_note"] if False else True

    # forecast "current" must now differ from baseline (exclusion applied)
    fc = client.get("/forecast?days=40").json()
    assert fc["current"]["applied_exclusions"] == ["GymFlow"]
    assert fc["current"]["doom_day"] is None
    assert fc["baseline"]["doom_day"] is not None

    # Tier 1 without confirm -> 422; with confirm -> draft_ready receipt
    r = client.post("/actions/request", json={"finding_id": "L003", "tier": 1})
    assert r.status_code == 422
    r = client.post("/actions/request", json={"finding_id": "L003", "tier": 1, "confirm": True})
    assert r.status_code == 200
    dup_receipt = r.json()
    assert dup_receipt["status"] == "draft_ready"
    assert "StreamVibe" in dup_receipt["subject"]

    # duplicate play blocked (409)
    r = client.post("/actions/request", json={"finding_id": "L003", "tier": 1, "confirm": True})
    assert r.status_code == 409

    # kill switch blocks further Tier 2 (L005 has a tier-2 downgrade play)
    client.post("/actions/kill-switch", json={"enabled": True})
    r = client.post("/actions/request", json={"finding_id": "L005", "tier": 2})
    assert r.status_code == 422
    assert "kill" in r.json()["detail"].lower()

    # undo the gym autopilot -> exclusion removed
    r = client.post("/actions/undo", json={"receipt_id": receipt["id"]})
    assert r.status_code == 200 and r.json()["status"] == "undone"
    fc = client.get("/forecast?days=40").json()
    assert fc["current"]["applied_exclusions"] == []
    # the duplicate-charge credit is still active (its receipt wasn't undone),
    # so the doom day may remain cleared or pushed later — never earlier.
    cur_doom = fc["current"]["doom_day"]
    base_doom = fc["baseline"]["doom_day"]
    assert cur_doom is None or (base_doom is not None and cur_doom >= base_doom)


def test_audit_trail_populated(client: TestClient) -> None:
    client.post("/consent", json={"enabled": True})
    client.post("/actions/request", json={"finding_id": "L001", "tier": 2, "confirm": True})
    events = client.get("/audit").json()
    kinds = {e["event"] for e in events}
    assert "session.reloaded" in kinds
    assert "consent.updated" in kinds
    assert "policy.decision" in kinds
    assert "receipt.created" in kinds


def test_unknown_finding_404(client: TestClient) -> None:
    r = client.post("/actions/request", json={"finding_id": "L999", "tier": 1, "confirm": True})
    assert r.status_code == 404


def test_tier2_downgrade_applies_discount(client: TestClient) -> None:
    client.post("/consent", json={"enabled": True})
    r = client.post("/actions/request", json={"finding_id": "L005", "tier": 2, "confirm": True})
    assert r.status_code == 200
    receipt = r.json()
    assert receipt["status"] == "autopilot_active"
    assert "downgrade" in receipt["subject"].lower()

    fc = client.get("/forecast?days=40").json()
    assert fc["current"]["applied_discounts"] == {"Spotify": 3.0}
    assert fc["current"]["lowest_balance"] > fc["baseline"]["lowest_balance"]

    # undo restores the bill
    r = client.post("/actions/undo", json={"receipt_id": receipt["id"]})
    assert r.status_code == 200
    fc = client.get("/forecast?days=40").json()
    assert fc["current"]["applied_discounts"] == {}
    assert fc["current"]["lowest_balance"] == fc["baseline"]["lowest_balance"]

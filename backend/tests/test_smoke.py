"""Smoke tests: the Day-1 scaffold must import and serve."""


def test_app_imports() -> None:
    from app.main import app

    assert app.title == "Celengan API"


def test_health_payload() -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["app"] == "celengan"


def test_settings_deterministic_defaults() -> None:
    from app.config import settings

    assert settings.llm_enabled is False or settings.llm_api_key != ""
    assert settings.tier2_monthly_cap > 0
    assert settings.tier2_max_single_action > 0

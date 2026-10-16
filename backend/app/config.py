"""Environment-driven configuration for the Celengan backend.

All settings are read from environment variables (or a .env file) so the demo
and the tests can run without any secrets. Nothing here is required.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:  # optional .env support
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover - dotenv is optional
    pass


def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


BASE_DIR = Path(__file__).resolve().parent.parent  # backend/


@dataclass
class Settings:
    """Runtime settings. Deterministic-by-default; LLM strictly opt-in."""

    app_name: str = "Celengan API"

    # Persistence
    database_url: str = field(
        default_factory=lambda: _env("CELENGAN_DATABASE_URL", f"sqlite:///{BASE_DIR / 'celengan.db'}")
    )

    # Audit trail (append-only JSONL) — feeds the competition "execution evidence"
    audit_path: Path = field(
        default_factory=lambda: Path(_env("CELENGAN_AUDIT_PATH", str(BASE_DIR / "audit" / "audit.jsonl")))
    )

    # Permission ladder defaults (amount caps in user currency units)
    tier2_monthly_cap: float = field(default_factory=lambda: float(_env("CELENGAN_TIER2_MONTHLY_CAP", "400")))
    tier2_max_single_action: float = field(
        default_factory=lambda: float(_env("CELENGAN_TIER2_MAX_SINGLE_ACTION", "50"))
    )

    # LLM feature flag — the deterministic core never requires any of these.
    llm_enabled: bool = field(default_factory=lambda: _env_bool("CELENGAN_LLM_ENABLED", False))
    llm_api_key: str = field(default_factory=lambda: _env("CELENGAN_LLM_API_KEY", ""))
    llm_base_url: str = field(default_factory=lambda: _env("CELENGAN_LLM_BASE_URL", "https://api.openai.com/v1"))
    llm_model: str = field(default_factory=lambda: _env("CELENGAN_LLM_MODEL", "gpt-4o-mini"))

    # Sandbox
    seed: int = field(default_factory=lambda: int(_env("CELENGAN_SEED", "42")))


settings = Settings()

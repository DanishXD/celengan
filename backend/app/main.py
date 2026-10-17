"""Celengan FastAPI application entry point.

Status (Day 1): deterministic core modules are being wired in; the API layer
(currently /health) will expose engines, leaks, forecast, actions and audit.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import api_router
from app.config import settings

app = FastAPI(
    title="Celengan API",
    description=(
        "Agentic personal CFO - Detect. Simulate. Execute. "
        "Topic A, 2026 Shenzhen International FinTech Competition."
    ),
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev-mode; tightened in the deployment phase
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
def health() -> dict:
    """Liveness probe used by docker-compose, the settings UI and the test suite."""
    return {
        "status": "ok",
        "app": "celengan",
        "version": __version__,
        "sandbox": "synthetic",
        "sandbox_seed": settings.seed,
        "llm_enabled": bool(settings.llm_enabled and settings.llm_api_key),
    }

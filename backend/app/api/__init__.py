"""API package — aggregates all routers into `api_router`."""

from __future__ import annotations

from fastapi import APIRouter

from .routers import router as _root_router

api_router = APIRouter()
api_router.include_router(_root_router)

"""Health check endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend.models.schemas import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    ollama = request.app.state.ollama
    settings = request.app.state.settings
    reachable = await ollama.check_health()
    return HealthResponse(
        status="ok",
        ollama_reachable=reachable,
        model=settings.model_name,
    )

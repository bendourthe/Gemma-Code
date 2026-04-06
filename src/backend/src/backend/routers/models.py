"""Models listing endpoint."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from backend.models.schemas import ModelsResponse
from backend.services.ollama import OllamaUnavailableError

router = APIRouter()


@router.get("/models", response_model=ModelsResponse)
async def list_models(request: Request) -> ModelsResponse:
    ollama = request.app.state.ollama
    try:
        models = await ollama.list_models()
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ModelsResponse(models=models)

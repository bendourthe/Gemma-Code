"""FastAPI application entry point."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from backend.config import Settings, get_settings
from backend.routers import chat, health, models
from backend.services.ollama import OllamaService


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings: Settings = get_settings()
    app.state.settings = settings
    app.state.ollama = OllamaService(
        base_url=settings.ollama_url,
        timeout=settings.request_timeout,
    )
    yield
    # No resources need explicit teardown.


def create_app() -> FastAPI:
    app = FastAPI(
        title="Gemma Code Backend",
        version="0.1.0",
        description="Inference preprocessing backend for the Gemma Code VS Code extension",
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(chat.router)
    return app


app = create_app()


def run() -> None:
    """Entry point for the `gemma-backend` CLI command."""
    settings = get_settings()
    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=settings.backend_port,
        log_level="warning",
    )


if __name__ == "__main__":
    run()

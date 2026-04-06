"""Integration tests for the /health endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from backend.config import Settings
from backend.main import create_app
from backend.services.ollama import OllamaService


def _make_app():
    """Create a test app instance with state pre-initialised.

    httpx's ASGITransport does not trigger the ASGI lifespan, so we
    manually populate app.state to mirror what the lifespan would do.
    """
    app = create_app()
    settings = Settings()
    app.state.settings = settings
    app.state.ollama = OllamaService(base_url=settings.ollama_url)
    return app


@pytest.mark.asyncio
async def test_health_returns_ok_when_ollama_reachable() -> None:
    app = _make_app()
    with patch.object(
        app.state.ollama, "check_health", new_callable=AsyncMock, return_value=True
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["ollama_reachable"] is True
    assert "model" in data


@pytest.mark.asyncio
async def test_health_reports_ollama_unreachable() -> None:
    app = _make_app()
    with patch.object(
        app.state.ollama, "check_health", new_callable=AsyncMock, return_value=False
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["ollama_reachable"] is False

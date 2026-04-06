"""Integration tests for the /chat/stream SSE endpoint."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from backend.config import Settings
from backend.main import create_app
from backend.services.ollama import OllamaService, OllamaUnavailableError


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


async def _fake_stream_ok(
    self: object, **kwargs: object
) -> AsyncGenerator[str, None]:
    yield "Hello"
    yield " world"


async def _fake_stream_error(
    self: object, **kwargs: object
) -> AsyncGenerator[str, None]:
    raise OllamaUnavailableError("Ollama not running")
    yield  # noqa: unreachable — makes this function an async generator


@pytest.mark.asyncio
async def test_chat_stream_returns_sse_events() -> None:
    app = _make_app()
    with patch.object(OllamaService, "stream_chat", _fake_stream_ok):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/chat/stream",
                json={"messages": [{"role": "user", "content": "Hi"}]},
            )

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]

    raw = response.text
    events = [
        json.loads(line[len("data: "):])
        for line in raw.splitlines()
        if line.startswith("data: ")
    ]

    tokens = [e["token"] for e in events if "token" in e]
    done_events = [e for e in events if e.get("done") is True]

    assert tokens == ["Hello", " world"]
    assert len(done_events) == 1


@pytest.mark.asyncio
async def test_chat_stream_empty_messages_returns_422() -> None:
    app = _make_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/chat/stream",
            json={"messages": []},
        )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_chat_stream_ollama_error_returns_error_event() -> None:
    app = _make_app()
    with patch.object(OllamaService, "stream_chat", _fake_stream_error):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                "/chat/stream",
                json={"messages": [{"role": "user", "content": "Hi"}]},
            )

    assert response.status_code == 200
    raw = response.text
    events = [
        json.loads(line[len("data: "):])
        for line in raw.splitlines()
        if line.startswith("data: ")
    ]
    error_events = [e for e in events if "error" in e]
    assert len(error_events) >= 1

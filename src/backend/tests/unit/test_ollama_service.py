"""Unit tests for the async Ollama service (mocked httpx)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from backend.models.schemas import Message
from backend.services.ollama import (
    OllamaResponseError,
    OllamaService,
    OllamaUnavailableError,
)


def _make_service() -> OllamaService:
    return OllamaService(base_url="http://localhost:11434", timeout=5.0)


# ---------------------------------------------------------------------------
# check_health
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_health_returns_true_when_ok() -> None:
    service = _make_service()
    mock_response = MagicMock(status_code=200)
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch.object(service, "_client", return_value=mock_client):
        result = await service.check_health()

    assert result is True


@pytest.mark.asyncio
async def test_check_health_returns_false_on_connect_error() -> None:
    import httpx

    service = _make_service()
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with patch.object(service, "_client", return_value=mock_client):
        result = await service.check_health()

    assert result is False


# ---------------------------------------------------------------------------
# list_models
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_models_parses_response() -> None:
    service = _make_service()
    mock_response = MagicMock(
        status_code=200,
        json=MagicMock(
            return_value={
                "models": [
                    {"name": "gemma3:27b", "size": 1024, "modified_at": "2026-01-01"},
                    {"name": "llama3", "size": 2048, "modified_at": "2026-01-02"},
                ]
            }
        ),
    )
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with patch.object(service, "_client", return_value=mock_client):
        models = await service.list_models()

    assert len(models) == 2
    assert models[0].name == "gemma3:27b"
    assert models[1].name == "llama3"


@pytest.mark.asyncio
async def test_list_models_raises_on_connect_error() -> None:
    import httpx

    service = _make_service()
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.ConnectError("refused"))

    with (
        patch.object(service, "_client", return_value=mock_client),
        pytest.raises(OllamaUnavailableError),
    ):
        await service.list_models()


@pytest.mark.asyncio
async def test_list_models_raises_on_non_200() -> None:
    service = _make_service()
    mock_response = MagicMock(status_code=500, text="Internal Server Error")
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=mock_response)

    with (
        patch.object(service, "_client", return_value=mock_client),
        pytest.raises(OllamaResponseError) as exc_info,
    ):
        await service.list_models()

    assert exc_info.value.status_code == 500


# ---------------------------------------------------------------------------
# stream_chat
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stream_chat_yields_tokens() -> None:
    import json

    service = _make_service()
    hello = {"message": {"role": "assistant", "content": "Hello"}}
    world = {"message": {"role": "assistant", "content": " world"}}
    done = {"message": {"role": "assistant", "content": ""}, "done": True}
    lines = [
        json.dumps({**hello, "done": False}),
        json.dumps({**world, "done": False}),
        json.dumps(done),
    ]

    async def fake_aiter_lines():  # type: ignore[return]
        for line in lines:
            yield line

    mock_stream_response = MagicMock(status_code=200)
    mock_stream_response.aiter_lines = fake_aiter_lines
    mock_stream_response.__aenter__ = AsyncMock(return_value=mock_stream_response)
    mock_stream_response.__aexit__ = AsyncMock(return_value=False)
    mock_stream_response.aread = AsyncMock(return_value=b"")

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.stream = MagicMock(return_value=mock_stream_response)

    with patch.object(service, "_client", return_value=mock_client):
        tokens: list[str] = []
        async for token in service.stream_chat(
            model="gemma3:27b",
            messages=[Message(role="user", content="Hi")],
        ):
            tokens.append(token)

    assert tokens == ["Hello", " world"]


@pytest.mark.asyncio
async def test_stream_chat_raises_on_connect_error() -> None:
    import httpx

    service = _make_service()

    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(side_effect=httpx.ConnectError("refused"))
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.stream = MagicMock(return_value=mock_stream_ctx)

    with (
        patch.object(service, "_client", return_value=mock_client),
        pytest.raises(OllamaUnavailableError),
    ):
        async for _ in service.stream_chat(
            model="gemma3:27b",
            messages=[Message(role="user", content="Hi")],
        ):
            pass

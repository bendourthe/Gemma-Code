"""Async Ollama client using httpx."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any

import httpx

from backend.models.schemas import Message, ModelInfo


class OllamaUnavailableError(RuntimeError):
    """Raised when the Ollama server cannot be reached."""


class OllamaResponseError(RuntimeError):
    """Raised when Ollama returns a non-2xx response."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(f"Ollama returned {status_code}: {detail}")
        self.status_code = status_code


class OllamaService:
    """Thin async wrapper around the Ollama REST API."""

    def __init__(self, base_url: str, timeout: float = 60.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self._base_url, timeout=self._timeout)

    async def check_health(self) -> bool:
        """Return True if Ollama is reachable."""
        try:
            async with self._client() as client:
                response = await client.get("/api/tags")
                return response.status_code == 200
        except httpx.ConnectError:
            return False

    async def list_models(self) -> list[ModelInfo]:
        """Return the list of locally available models."""
        try:
            async with self._client() as client:
                response = await client.get("/api/tags")
        except httpx.ConnectError as exc:
            raise OllamaUnavailableError("Cannot connect to Ollama") from exc

        if response.status_code != 200:
            raise OllamaResponseError(response.status_code, response.text)

        data: dict[str, Any] = response.json()
        raw_models: list[dict[str, Any]] = data.get("models", [])
        return [
            ModelInfo(
                name=m["name"],
                size=m.get("size", 0),
                modified_at=m.get("modified_at", ""),
            )
            for m in raw_models
        ]

    async def stream_chat(
        self,
        model: str,
        messages: list[Message],
        options: dict[str, Any] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Yield token strings from a streaming Ollama /api/chat response."""
        payload: dict[str, Any] = {
            "model": model,
            "messages": [m.model_dump() for m in messages],
            "stream": True,
        }
        if options:
            payload["options"] = options

        try:
            async with (
                self._client() as client,
                client.stream("POST", "/api/chat", json=payload) as response,
            ):
                if response.status_code != 200:
                    body = await response.aread()
                    raise OllamaResponseError(
                        response.status_code, body.decode(errors="replace")
                    )
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk: dict[str, Any] = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    token: str = chunk.get("message", {}).get("content", "")
                    if token:
                        yield token
                    if chunk.get("done"):
                        return
        except httpx.ConnectError as exc:
            raise OllamaUnavailableError("Cannot connect to Ollama") from exc

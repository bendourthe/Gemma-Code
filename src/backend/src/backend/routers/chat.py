"""Streaming chat endpoint using SSE."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend.models.schemas import ChatRequest
from backend.services.ollama import OllamaUnavailableError
from backend.services.prompt import assemble_prompt

router = APIRouter()


async def _event_stream(
    request: Request, body: ChatRequest
) -> AsyncGenerator[str, None]:
    ollama = request.app.state.ollama
    settings = request.app.state.settings

    model = body.model or settings.model_name
    prepared = assemble_prompt(
        body.messages,
        model,
        tool_results_keep=settings.compaction_tool_results_keep,
        keep_recent=settings.compaction_keep_recent,
    )

    try:
        async for token in ollama.stream_chat(
            model=model,
            messages=prepared,
            options=body.options,
        ):
            yield f"data: {json.dumps({'token': token})}\n\n"
    except OllamaUnavailableError as exc:
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        return

    yield f"data: {json.dumps({'done': True})}\n\n"


@router.post("/chat/stream")
async def chat_stream(body: ChatRequest, request: Request) -> StreamingResponse:
    if not body.messages:
        raise HTTPException(status_code=422, detail="messages must not be empty")
    return StreamingResponse(
        _event_stream(request, body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

"""Pydantic request/response models for the Gemma Code backend."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Message(BaseModel):
    role: str = Field(..., pattern="^(system|user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    model: str | None = None
    options: dict[str, Any] | None = None


class TokenEvent(BaseModel):
    token: str


class DoneEvent(BaseModel):
    done: bool = True


class ModelInfo(BaseModel):
    name: str
    size: int
    modified_at: str


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


class HealthResponse(BaseModel):
    status: str
    ollama_reachable: bool
    model: str

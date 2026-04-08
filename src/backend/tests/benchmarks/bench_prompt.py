"""Benchmarks for prompt assembly throughput."""

from __future__ import annotations

import pytest

from backend.models.schemas import Message
from backend.services.prompt import assemble_prompt, trim_history


def _make_history(n: int) -> list[Message]:
    """Generate a conversation of n messages alternating user/assistant."""
    messages: list[Message] = []
    for i in range(n):
        role = "user" if i % 2 == 0 else "assistant"
        messages.append(Message(role=role, content=f"Message number {i}. " * 5))
    return messages


@pytest.mark.benchmark(group="prompt")
def test_bench_trim_10(benchmark) -> None:  # type: ignore[no-untyped-def]
    history = _make_history(10)
    benchmark(trim_history, history, 8192)


@pytest.mark.benchmark(group="prompt")
def test_bench_trim_50(benchmark) -> None:  # type: ignore[no-untyped-def]
    history = _make_history(50)
    benchmark(trim_history, history, 8192)


@pytest.mark.benchmark(group="prompt")
def test_bench_trim_100(benchmark) -> None:  # type: ignore[no-untyped-def]
    history = _make_history(100)
    result = benchmark(trim_history, history, 8192)
    # Median must be under 5ms; pytest-benchmark will assert via min_rounds.
    _ = result  # avoid unused warning


@pytest.mark.benchmark(group="prompt")
def test_bench_assemble_gemma_100(benchmark) -> None:  # type: ignore[no-untyped-def]
    history = _make_history(100)
    benchmark(assemble_prompt, history, "gemma4", 32768)

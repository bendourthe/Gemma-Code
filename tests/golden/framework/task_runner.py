"""Execute golden tasks against the Gemma Code agent loop.

The runner intentionally supports two modes:

- ``live``: talk to a running Ollama backend. Requires ``OLLAMA_URL`` in the
  environment. Invokes the backend's ``/chat`` endpoint with the task prompt
  and collects the full tool trace.
- ``dry``: skip the agent loop entirely. Just exercise snapshot setup and
  evaluation against the snapshot's untouched initial state. Useful for
  CI smoke tests of the framework itself.

Both modes return a :class:`TaskResult`.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from .evaluator import all_passed, evaluate
from .snapshot import cleanup_worktree, prepare_worktree
from .types import GoldenTask, TaskResult


def run_task(
    task: GoldenTask,
    snapshot_root: str | Path,
    *,
    mode: str = "dry",
    worktree_root: str | Path | None = None,
    ollama_url: str | None = None,
    model: str | None = None,
) -> TaskResult:
    """Run a single golden task and return its result.

    ``mode="dry"`` bypasses the agent loop; ``mode="live"`` requires that a
    live Ollama + Gemma Code backend is reachable. In live mode this runner
    does NOT currently spawn the backend -- the caller must ensure one is
    running (this is checked and reported as an error if missing).
    """
    snapshot_root = Path(snapshot_root)
    workdir = prepare_worktree(snapshot_root, task.id, worktree_root)
    start = time.perf_counter()
    error: str | None = None
    iterations = 0
    tokens = 0
    trace: list[dict] = []
    model_used = model or ""

    try:
        if mode == "live":
            iterations, tokens, trace, model_used, error = _run_live(
                task, workdir, ollama_url=ollama_url, model=model
            )
        elif mode == "dry":
            # No-op: we just evaluate the unmodified snapshot.
            pass
        else:
            raise ValueError(f"Unknown runner mode: {mode}")

        criteria_results = evaluate(workdir, task.success_criteria)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        return TaskResult(
            task_id=task.id,
            success=error is None and all_passed(criteria_results),
            criteria_results=criteria_results,
            iterations_used=iterations,
            time_elapsed_ms=elapsed_ms,
            tokens_consumed=tokens,
            model_used=model_used,
            error=error,
            agent_trace=trace,
        )
    finally:
        cleanup_worktree(workdir)


def _run_live(
    task: GoldenTask,
    workdir: Path,
    *,
    ollama_url: str | None,
    model: str | None,
) -> tuple[int, int, list[dict], str, str | None]:
    """Drive the agent loop via the Gemma Code Python backend.

    Returns (iterations, tokens, trace, model_used, error).

    Best-effort implementation: if the backend isn't running, we report an
    error but still return empty metrics so evaluation can proceed against
    the untouched snapshot (which will almost certainly fail -- that's the
    point: it signals the task was never executed).
    """
    url = ollama_url or os.environ.get("OLLAMA_URL")
    if not url:
        return 0, 0, [], model or "", "OLLAMA_URL not set"
    try:
        import httpx
    except ImportError:
        return 0, 0, [], model or "", "httpx not installed"

    backend_url = os.environ.get("GEMMA_BACKEND_URL", "http://localhost:11435")
    payload = {
        "message": task.description,
        "workdir": str(workdir),
        "max_iterations": task.max_iterations,
        "model": model,
    }
    try:
        with httpx.Client(timeout=task.timeout_seconds) as client:
            resp = client.post(f"{backend_url}/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:  # noqa: BLE001 - top-level; report cleanly
        return 0, 0, [], model or "", f"backend call failed: {exc}"

    iterations = int(data.get("iterations", 0))
    tokens = int(data.get("tokens_consumed", 0))
    trace = list(data.get("trace", []))
    model_used = str(data.get("model", model or ""))
    return iterations, tokens, trace, model_used, None

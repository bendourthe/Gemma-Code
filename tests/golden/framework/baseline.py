"""Save and load per-version, per-tier regression baselines."""

from __future__ import annotations

import json
import subprocess
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from .models import TaskResult


def _detect_gpu() -> dict[str, object]:
    """Best-effort GPU detection; returns {} if nvidia-smi isn't available."""
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return {}
    if out.returncode != 0 or not out.stdout.strip():
        return {}
    first = out.stdout.strip().splitlines()[0]
    name, _, vram = first.partition(",")
    return {"gpu": name.strip(), "vram_mb": int(vram.strip() or 0)}


def _aggregate(results: list[TaskResult]) -> dict[str, object]:
    total = len(results)
    passed = sum(1 for r in results if r.success)
    by_category: dict[str, list[TaskResult]] = defaultdict(list)
    for r in results:
        prefix = r.task_id.split("-")[0]
        by_category[prefix].append(r)

    category_stats = {
        cat: {
            "count": len(rs),
            "passed": sum(1 for r in rs if r.success),
            "pass_rate": (sum(1 for r in rs if r.success) / len(rs)) if rs else 0.0,
            "mean_iterations": (
                sum(r.iterations_used for r in rs) / len(rs) if rs else 0.0
            ),
            "mean_time_ms": (
                sum(r.time_elapsed_ms for r in rs) / len(rs) if rs else 0.0
            ),
        }
        for cat, rs in by_category.items()
    }

    return {
        "pass_rate": passed / total if total else 0.0,
        "passed": passed,
        "total": total,
        "mean_iterations": (
            sum(r.iterations_used for r in results) / total if total else 0.0
        ),
        "mean_time_ms": (
            sum(r.time_elapsed_ms for r in results) / total if total else 0.0
        ),
        "total_tokens": sum(r.tokens_consumed for r in results),
        "by_category": category_stats,
    }


def save_baseline(
    results: list[TaskResult],
    model: str,
    version: str,
    output_dir: str | Path,
) -> Path:
    """Save a baseline JSON for later regression detection.

    Filename convention: ``{version}-{model_tier}.json`` where the tier is the
    portion of the model name after ``:`` (e.g. "gemma4:e2b" -> "e2b"),
    falling back to the full model name.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    tier = model.split(":", 1)[1] if ":" in model else model
    path = out / f"{version}-{tier}.json"

    payload = {
        "version": version,
        "model": model,
        "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
        "hardware": _detect_gpu(),
        "tasks": {
            r.task_id: {
                "passed": r.success,
                "iterations": r.iterations_used,
                "time_ms": r.time_elapsed_ms,
                "tokens": r.tokens_consumed,
            }
            for r in results
        },
        "aggregates": _aggregate(results),
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def load_baseline(path: str | Path) -> dict:
    """Load a baseline file and return the parsed payload."""
    return json.loads(Path(path).read_text(encoding="utf-8"))

"""Tests for baseline save/load."""

from __future__ import annotations

import json
from pathlib import Path

from .baseline import load_baseline, save_baseline
from .types import TaskResult


def _mk_result(task_id: str, success: bool = True) -> TaskResult:
    return TaskResult(
        task_id=task_id,
        success=success,
        iterations_used=5,
        time_elapsed_ms=1000.0,
        tokens_consumed=500,
        model_used="gemma4:e4b",
    )


def test_save_baseline_writes_expected_file(tmp_path: Path) -> None:
    results = [
        _mk_result("multi-file-rename-01", True),
        _mk_result("bugfix-null-02", False),
    ]
    path = save_baseline(results, "gemma4:e4b", "0.3.0", tmp_path)
    assert path.name == "0.3.0-e4b.json"
    assert path.exists()


def test_save_baseline_falls_back_for_untagged_model(tmp_path: Path) -> None:
    results = [_mk_result("t-1")]
    path = save_baseline(results, "some-model", "0.3.0", tmp_path)
    assert path.name == "0.3.0-some-model.json"


def test_baseline_payload_roundtrip(tmp_path: Path) -> None:
    results = [
        _mk_result("multi-file-rename-01", True),
        _mk_result("multi-file-rename-02", True),
        _mk_result("bugfix-null-02", False),
    ]
    path = save_baseline(results, "gemma4:e2b", "0.3.0", tmp_path)
    payload = load_baseline(path)
    assert payload["version"] == "0.3.0"
    assert payload["model"] == "gemma4:e2b"
    assert set(payload["tasks"]) == {
        "multi-file-rename-01",
        "multi-file-rename-02",
        "bugfix-null-02",
    }
    assert payload["aggregates"]["pass_rate"] == 2 / 3
    assert payload["aggregates"]["passed"] == 2
    assert payload["aggregates"]["total"] == 3
    # Category stats grouped by task_id prefix
    assert "multi" in payload["aggregates"]["by_category"]
    assert payload["aggregates"]["by_category"]["multi"]["count"] == 2


def test_baseline_empty_results(tmp_path: Path) -> None:
    path = save_baseline([], "gemma4:e4b", "0.3.0", tmp_path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["aggregates"]["total"] == 0
    assert payload["aggregates"]["pass_rate"] == 0.0

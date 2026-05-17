"""Tests for the results reporter."""

from __future__ import annotations

import json
from pathlib import Path

from .reporter import to_json, to_markdown, write_reports
from .models import SuccessCriteria, TaskResult


def _sample_results() -> list[TaskResult]:
    c_ok = SuccessCriteria(type="file_exists", target="a.ts")
    c_bad = SuccessCriteria(type="file_exists", target="b.ts")
    return [
        TaskResult(
            task_id="multi-file-rename-01",
            success=True,
            criteria_results=[(c_ok, True, "ok")],
            iterations_used=5,
            time_elapsed_ms=100.0,
            tokens_consumed=1000,
            model_used="gemma4:e4b",
        ),
        TaskResult(
            task_id="bugfix-null-02",
            success=False,
            criteria_results=[(c_ok, True, "ok"), (c_bad, False, "missing")],
            iterations_used=20,
            time_elapsed_ms=5000.0,
            tokens_consumed=8000,
            model_used="gemma4:e4b",
            error="timeout",
        ),
    ]


def test_to_json_roundtrip() -> None:
    results = _sample_results()
    payload = to_json(results)
    parsed = json.loads(payload)
    assert len(parsed) == 2
    assert parsed[0]["task_id"] == "multi-file-rename-01"
    assert parsed[0]["criteria_results"][0]["passed"] is True
    assert parsed[1]["error"] == "timeout"


def test_to_markdown_structure() -> None:
    md = to_markdown(_sample_results())
    assert "# Golden Task Report" in md
    assert "1/2" in md  # 50% pass rate
    assert "PASS multi-file-rename-01" in md
    assert "FAIL bugfix-null-02" in md
    assert "error: timeout" in md


def test_to_markdown_empty() -> None:
    md = to_markdown([])
    assert "No results" in md


def test_write_reports(tmp_path: Path) -> None:
    results = _sample_results()
    json_path, md_path = write_reports(results, tmp_path, basename="run")
    assert json_path.exists() and md_path.exists()
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    assert len(payload) == 2

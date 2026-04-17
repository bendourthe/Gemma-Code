"""Tests for success-criteria evaluation."""

from __future__ import annotations

from pathlib import Path

from .evaluator import all_passed, evaluate, result_from
from .types import SuccessCriteria


def test_file_exists_pass(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("x", encoding="utf-8")
    c = SuccessCriteria(type="file_exists", target="a.ts")
    results = evaluate(tmp_path, [c])
    assert all_passed(results)


def test_file_exists_fail(tmp_path: Path) -> None:
    c = SuccessCriteria(type="file_exists", target="missing.ts")
    results = evaluate(tmp_path, [c])
    assert not all_passed(results)


def test_file_deleted(tmp_path: Path) -> None:
    c = SuccessCriteria(type="file_deleted", target="gone.ts")
    assert all_passed(evaluate(tmp_path, [c]))
    (tmp_path / "gone.ts").write_text("x", encoding="utf-8")
    assert not all_passed(evaluate(tmp_path, [c]))


def test_file_contains_regex(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("function transformPayload() {}", encoding="utf-8")
    c = SuccessCriteria(type="file_contains", target="a.ts", pattern=r"transform\w+")
    assert all_passed(evaluate(tmp_path, [c]))


def test_file_contains_literal_fallback(tmp_path: Path) -> None:
    (tmp_path / "a.ts").write_text("hello [world]", encoding="utf-8")
    # '[' is an invalid regex character; fallback to substring match
    c = SuccessCriteria(type="file_contains", target="a.ts", pattern="[world]")
    assert all_passed(evaluate(tmp_path, [c]))


def test_file_contains_missing_file(tmp_path: Path) -> None:
    c = SuccessCriteria(type="file_contains", target="none.ts", pattern="x")
    assert not all_passed(evaluate(tmp_path, [c]))


def test_output_contains_passes(tmp_path: Path) -> None:
    # Use a shell-portable echo: Windows cmd + POSIX both support simple echo text.
    c = SuccessCriteria(type="output_contains", target="echo hello", pattern="hello")
    assert all_passed(evaluate(tmp_path, [c]))


def test_unknown_criteria_fails(tmp_path: Path) -> None:
    c = SuccessCriteria(type="invented", target="x")
    results = evaluate(tmp_path, [c])
    assert not all_passed(results)
    assert "unknown" in results[0][2]


def test_result_from_aggregates(tmp_path: Path) -> None:
    (tmp_path / "ok.ts").write_text("x", encoding="utf-8")
    r = result_from(
        "t-1",
        tmp_path,
        [
            SuccessCriteria(type="file_exists", target="ok.ts"),
            SuccessCriteria(type="file_exists", target="nope.ts"),
        ],
        iterations_used=5,
        tokens_consumed=100,
        model_used="gemma4:e4b",
    )
    assert r.task_id == "t-1"
    assert r.success is False
    assert r.iterations_used == 5
    assert r.tokens_consumed == 100
    assert r.model_used == "gemma4:e4b"

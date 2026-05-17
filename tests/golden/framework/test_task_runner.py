"""Tests for the task runner (dry mode; live mode requires Ollama)."""

from __future__ import annotations

from pathlib import Path

from .task_runner import run_task
from .models import GoldenTask, SuccessCriteria


def _snapshot(root: Path, task_id: str, files: dict[str, str]) -> None:
    d = root / task_id
    d.mkdir(parents=True)
    for rel, body in files.items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_text(body, encoding="utf-8")


def test_dry_run_evaluates_initial_state(tmp_path: Path) -> None:
    snapshots = tmp_path / "snapshots"
    _snapshot(snapshots, "t-1", {"a.ts": "export const x = 1;\n"})

    task = GoldenTask(
        id="t-1",
        name="t",
        category="bug-fix",
        description="noop",
        initial_state="snapshots/t-1",
        expected_files_changed=[],
        success_criteria=[
            SuccessCriteria(type="file_exists", target="a.ts"),
            SuccessCriteria(type="file_contains", target="a.ts", pattern="export"),
        ],
    )
    result = run_task(task, snapshots, mode="dry", worktree_root=tmp_path / "_w")
    assert result.task_id == "t-1"
    assert result.success is True
    assert result.iterations_used == 0
    assert result.error is None


def test_dry_run_fails_when_criteria_fail(tmp_path: Path) -> None:
    snapshots = tmp_path / "snapshots"
    _snapshot(snapshots, "t-2", {"a.ts": "x"})
    task = GoldenTask(
        id="t-2",
        name="t",
        category="bug-fix",
        description="noop",
        initial_state="snapshots/t-2",
        expected_files_changed=[],
        success_criteria=[SuccessCriteria(type="file_exists", target="b.ts")],
    )
    result = run_task(task, snapshots, mode="dry", worktree_root=tmp_path / "_w")
    assert result.success is False


def test_live_run_without_ollama_reports_error(
    tmp_path: Path, monkeypatch: object
) -> None:
    # Ensure OLLAMA_URL is unset so the live path bails cleanly
    import os

    monkeypatch.delenv("OLLAMA_URL", raising=False)  # type: ignore[attr-defined]
    snapshots = tmp_path / "snapshots"
    _snapshot(snapshots, "t-3", {"a.ts": "x"})
    task = GoldenTask(
        id="t-3",
        name="t",
        category="bug-fix",
        description="noop",
        initial_state="snapshots/t-3",
        expected_files_changed=[],
        success_criteria=[SuccessCriteria(type="file_exists", target="a.ts")],
    )
    result = run_task(
        task,
        snapshots,
        mode="live",
        worktree_root=tmp_path / "_w",
        ollama_url=None,
    )
    assert result.error is not None
    assert "OLLAMA_URL" in result.error or "backend" in result.error
    # Keep os reference used (avoids unused-import warning in test file)
    assert os.environ.get("OLLAMA_URL") is None

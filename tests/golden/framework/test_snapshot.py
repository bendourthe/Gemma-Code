"""Tests for snapshot copy / teardown."""

from __future__ import annotations

from pathlib import Path

import pytest

from .snapshot import cleanup_worktree, prepare_worktree, snapshot_exists


def _make_snapshot(root: Path, task_id: str) -> Path:
    d = root / task_id
    d.mkdir(parents=True)
    (d / "a.ts").write_text("export const x = 1;\n", encoding="utf-8")
    (d / "README.md").write_text("snapshot", encoding="utf-8")
    return d


def test_snapshot_exists(tmp_path: Path) -> None:
    assert not snapshot_exists(tmp_path, "no-such-task")
    _make_snapshot(tmp_path, "t-1")
    assert snapshot_exists(tmp_path, "t-1")


def test_prepare_worktree_copies(tmp_path: Path) -> None:
    _make_snapshot(tmp_path, "t-1")
    worktree_root = tmp_path / "_worktrees"
    wt = prepare_worktree(tmp_path, "t-1", worktree_root=worktree_root)
    try:
        assert wt.is_dir()
        assert (wt / "a.ts").read_text(encoding="utf-8") == "export const x = 1;\n"
        # Mutate worktree; original snapshot must remain untouched.
        (wt / "a.ts").write_text("mutated", encoding="utf-8")
        assert (tmp_path / "t-1" / "a.ts").read_text(
            encoding="utf-8"
        ) == "export const x = 1;\n"
    finally:
        cleanup_worktree(wt)
    assert not wt.exists()


def test_prepare_worktree_missing_snapshot(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        prepare_worktree(tmp_path, "missing")


def test_prepare_worktree_skips_node_modules(tmp_path: Path) -> None:
    snap = _make_snapshot(tmp_path, "t-2")
    (snap / "node_modules").mkdir()
    (snap / "node_modules" / "x").write_text("BIG", encoding="utf-8")
    wt = prepare_worktree(tmp_path, "t-2", worktree_root=tmp_path / "_w")
    try:
        assert not (wt / "node_modules").exists()
    finally:
        cleanup_worktree(wt)


def test_cleanup_missing_path(tmp_path: Path) -> None:
    # Should not raise for a missing directory
    cleanup_worktree(tmp_path / "never-existed")

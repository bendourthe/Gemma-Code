"""Git snapshot setup / teardown for golden task runs.

Each task's initial state lives in tests/golden/snapshots/<task-id>/ as a
self-contained mini git repo. For a run, we copy that snapshot into a
dedicated worktree directory under tests/golden/.worktrees/<run-id>/ so
the original is never mutated.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


def snapshot_exists(snapshot_root: str | Path, task_id: str) -> bool:
    return (Path(snapshot_root) / task_id).is_dir()


def prepare_worktree(
    snapshot_root: str | Path,
    task_id: str,
    worktree_root: str | Path | None = None,
) -> Path:
    """Copy the snapshot into a fresh worktree and return its path.

    The returned directory is a full copy (not a git worktree link), so the
    agent can freely mutate it. Callers must invoke ``cleanup_worktree``
    after the run.
    """
    source = Path(snapshot_root) / task_id
    if not source.is_dir():
        raise FileNotFoundError(f"Snapshot not found: {source}")

    if worktree_root is None:
        destination = Path(tempfile.mkdtemp(prefix=f"golden-{task_id}-"))
    else:
        Path(worktree_root).mkdir(parents=True, exist_ok=True)
        destination = Path(tempfile.mkdtemp(prefix=f"{task_id}-", dir=worktree_root))

    # Copy snapshot, skipping node_modules and .worktrees from any prior runs
    def ignore(_dir: str, names: list[str]) -> list[str]:
        return [n for n in names if n in {"node_modules", ".worktrees", "__pycache__"}]

    shutil.copytree(source, destination, ignore=ignore, dirs_exist_ok=True)
    return destination


def cleanup_worktree(path: str | Path) -> None:
    """Remove a worktree directory. Safe to call on a missing path."""
    target = Path(path)
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def init_git_repo(path: str | Path, commit_message: str = "initial state") -> None:
    """Initialize a git repo at ``path`` with a single initial commit.

    Used by the snapshot scaffold script, not by runtime.
    """
    p = Path(path)
    subprocess.run(["git", "init", "-q"], cwd=p, check=True)
    # Local identity so commits work in CI without global config
    subprocess.run(
        ["git", "config", "user.email", "golden-tasks@gemma-code.local"],
        cwd=p,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Golden Tasks"],
        cwd=p,
        check=True,
    )
    subprocess.run(["git", "add", "-A"], cwd=p, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", commit_message],
        cwd=p,
        check=True,
    )

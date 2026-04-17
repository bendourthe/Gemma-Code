"""Scaffold helper: initialize git repos inside each snapshot directory.

Run from the repository root or from ``tests/golden/snapshots/``::

    python tests/golden/snapshots/_scaffold.py

For every subdirectory (excluding ones starting with ``_``) this will:

  1. Run ``git init`` if no ``.git`` exists yet.
  2. Configure a local identity so commits succeed in sandboxed CI.
  3. Stage all files and commit with message "initial state".

Subsequent invocations are idempotent: if the snapshot already has commits,
it is left untouched.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def _has_commits(repo: Path) -> bool:
    r = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True,
        text=True,
    )
    return r.returncode == 0


def _init_repo(repo: Path) -> None:
    git_dir = repo / ".git"
    if not git_dir.is_dir():
        subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True)
    # Local identity; safe to set on every run.
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.email", "golden@gemma-code.local"],
        check=True,
    )
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.name", "Golden Tasks"],
        check=True,
    )
    if not _has_commits(repo):
        subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "commit", "-q", "-m", "initial state"],
            check=True,
        )


def main() -> int:
    root = Path(__file__).resolve().parent
    count = 0
    for child in sorted(root.iterdir()):
        if not child.is_dir() or child.name.startswith((".", "_")):
            continue
        _init_repo(child)
        count += 1
    print(f"scaffolded {count} snapshot git repos")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

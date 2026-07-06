"""v1.1.0 Phase 14.12 -- First-launch storage migration shim.

The canonical migration logic lives in `core/storage/StorageMigration.ts`
(v1.0.0 Phase 2.2). The cross-OS installer's launch shim calls it via the
Node sidecar; this Python module is a small detector + idempotent fallback
that re-implements the basics so the migration runs even when the sidecar
hasn't been launched yet (e.g. headless installs and CI smoke tests).

Behavior matches the TS reference:
  - `~/.nexus/` exists -> no-op, returns `"already-migrated"`.
  - Neither directory exists -> create empty `~/.nexus/`, return
    `"fresh-install"`.
  - `~/.gemma-code/` exists, `~/.nexus/` does not -> copy contents, write
    `migrated-from-gemma-code.txt`; on POSIX make the legacy directory a
    symlink to `~/.nexus/`; on Windows leave the legacy directory in place
    with a `MOVED-TO-NEXUS.txt` README. Returns `"migrated"`.
"""

from __future__ import annotations

import contextlib
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from nexus_installer.engine.platform_utils import is_windows

MigrationStatus = Literal["already-migrated", "fresh-install", "migrated"]

SKIP_FILES = {".DS_Store"}
SKIP_SUFFIXES = (".lock",)
MARKER_FILE = "migrated-from-gemma-code.txt"
LEGACY_README = "MOVED-TO-NEXUS.txt"


@dataclass(frozen=True)
class MigrationResult:
    """Result returned by `run_storage_migration`."""

    status: MigrationStatus
    nexus_path: Path
    files_copied: int
    legacy_preserved: bool
    legacy_symlinked: bool


def nexus_home(home: Path | None = None) -> Path:
    return (home or Path.home()) / ".nexus"


def legacy_gemma_home(home: Path | None = None) -> Path:
    return (home or Path.home()) / ".gemma-code"


def _should_skip(name: str) -> bool:
    return name in SKIP_FILES or any(name.endswith(suffix) for suffix in SKIP_SUFFIXES)


def _copy_tree(src: Path, dst: Path) -> int:
    """Recursively copy `src` -> `dst`, skipping noise files. Returns file count."""
    copied = 0
    for entry in src.iterdir():
        if _should_skip(entry.name):
            continue
        target = dst / entry.name
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            copied += _copy_tree(entry, target)
        else:
            shutil.copy2(entry, target)
            copied += 1
    return copied


def run_storage_migration(
    *,
    home: Path | None = None,
    platform_label: str | None = None,
) -> MigrationResult:
    """Migrate `~/.gemma-code/` -> `~/.nexus/`. Idempotent."""
    new_root = nexus_home(home)
    old_root = legacy_gemma_home(home)
    is_win = platform_label == "win32" if platform_label is not None else is_windows()

    if new_root.exists():
        return MigrationResult(
            status="already-migrated",
            nexus_path=new_root,
            files_copied=0,
            legacy_preserved=old_root.exists(),
            legacy_symlinked=False,
        )

    if not old_root.exists():
        new_root.mkdir(parents=True, exist_ok=True)
        return MigrationResult(
            status="fresh-install",
            nexus_path=new_root,
            files_copied=0,
            legacy_preserved=False,
            legacy_symlinked=False,
        )

    # Real migration path.
    new_root.mkdir(parents=True, exist_ok=True)
    files_copied = _copy_tree(old_root, new_root)
    (new_root / MARKER_FILE).write_text(
        "This directory was migrated from ~/.gemma-code/ by the Nexus v1.1.0 "
        "cross-OS installer.\n",
        encoding="utf-8",
    )

    legacy_symlinked = False
    if not is_win:
        try:
            shutil.rmtree(old_root)
            os.symlink(new_root, old_root, target_is_directory=True)
            legacy_symlinked = True
        except OSError:
            # Fall back to "preserve legacy" if symlink creation fails.
            pass
    else:
        with contextlib.suppress(OSError):
            (old_root / LEGACY_README).write_text(
                "Nexus data moved to ~/.nexus/. Delete this directory once "
                "you've verified the new install is working.\n",
                encoding="utf-8",
            )

    return MigrationResult(
        status="migrated",
        nexus_path=new_root,
        files_copied=files_copied,
        legacy_preserved=not legacy_symlinked,
        legacy_symlinked=legacy_symlinked,
    )


__all__ = [
    "MigrationResult",
    "legacy_gemma_home",
    "nexus_home",
    "run_storage_migration",
]

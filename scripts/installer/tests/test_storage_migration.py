"""v1.1.0 Phase 14.12 -- tests for the cross-OS storage migration shim."""

from __future__ import annotations

import sys
from pathlib import Path

from nexus_installer.engine.storage_migration import (
    legacy_gemma_home,
    nexus_home,
    run_storage_migration,
)


class TestRunStorageMigration:
    def test_fresh_install(self, tmp_path: Path) -> None:
        result = run_storage_migration(home=tmp_path, platform_label="linux")
        assert result.status == "fresh-install"
        assert (tmp_path / ".nexus").is_dir()

    def test_already_migrated(self, tmp_path: Path) -> None:
        (tmp_path / ".nexus").mkdir()
        result = run_storage_migration(home=tmp_path, platform_label="linux")
        assert result.status == "already-migrated"

    def test_migrate_with_legacy_dir_posix(self, tmp_path: Path) -> None:
        legacy = tmp_path / ".gemma-code"
        legacy.mkdir()
        (legacy / "settings.json").write_text("{}")
        (legacy / ".DS_Store").write_text("noise")  # should be skipped
        nested = legacy / "memory"
        nested.mkdir()
        (nested / "default.json").write_text("[]")

        result = run_storage_migration(home=tmp_path, platform_label="linux")
        assert result.status == "migrated"
        assert (tmp_path / ".nexus" / "settings.json").exists()
        assert (tmp_path / ".nexus" / "memory" / "default.json").exists()
        assert result.files_copied >= 2
        # POSIX should have symlinked the legacy directory.
        if sys.platform != "win32":
            assert result.legacy_symlinked is True
            assert legacy.is_symlink()

    def test_migrate_with_legacy_dir_windows(self, tmp_path: Path) -> None:
        legacy = tmp_path / ".gemma-code"
        legacy.mkdir()
        (legacy / "settings.json").write_text("{}")
        result = run_storage_migration(home=tmp_path, platform_label="win32")
        assert result.status == "migrated"
        if sys.platform == "win32":
            # On real Windows the legacy README is written.
            assert (legacy / "MOVED-TO-NEXUS.txt").exists() or result.legacy_preserved

    def test_helpers(self, tmp_path: Path) -> None:
        assert nexus_home(tmp_path) == tmp_path / ".nexus"
        assert legacy_gemma_home(tmp_path) == tmp_path / ".gemma-code"

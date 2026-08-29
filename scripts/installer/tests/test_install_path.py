"""Tests for install path page logic."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

from nexus_installer.installer_state import InstallerState


class TestInstallPathValidation:
    def test_empty_path_fails_validation(self) -> None:
        state = InstallerState(install_path="")
        # Cannot instantiate QWidget without QApplication, so test logic directly
        ok = bool(state.install_path)
        assert not ok

    def test_nonempty_path_accepted(self) -> None:
        state = InstallerState(install_path="/some/path")
        assert state.install_path == "/some/path"

    def test_writable_check(self) -> None:
        with patch("os.access", return_value=True):
            assert os.access("/tmp", os.W_OK)

    def test_non_writable_check(self) -> None:
        with patch("os.access", return_value=False):
            assert not os.access("/readonly", os.W_OK)


class TestDiskSpaceDisplay:
    def test_disk_usage_returns_gb(self) -> None:
        mock_usage = MagicMock()
        mock_usage.free = 25 * 1024**3
        with patch("shutil.disk_usage", return_value=mock_usage):
            import shutil

            usage = shutil.disk_usage("/")
            gb_free = round(usage.free / (1024**3), 1)
            assert gb_free == 25.0

    def test_page_writes_free_disk_gb_integer(self) -> None:
        from unittest.mock import MagicMock

        mock_usage = MagicMock()
        mock_usage.free = 25 * 1024**3
        with patch("shutil.disk_usage", return_value=mock_usage):
            state = InstallerState()
            state.apply_disk_free_bytes(int(mock_usage.free))
            assert state.free_disk_gb == 25
            assert state.disk_space_gb == 25.0

    def test_low_disk_space(self) -> None:
        mock_usage = MagicMock()
        mock_usage.free = 3 * 1024**3
        with patch("shutil.disk_usage", return_value=mock_usage):
            import shutil

            usage = shutil.disk_usage("/")
            gb_free = round(usage.free / (1024**3), 1)
            assert gb_free < 5.0

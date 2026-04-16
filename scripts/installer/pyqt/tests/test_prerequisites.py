"""Tests for prerequisite detection functions."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from gemma_installer.pages.prerequisites import (
    check_disk_space,
    find_ollama,
    find_python,
    find_vscode,
)


class TestFindVscode:
    def test_found_via_which(self) -> None:
        with patch(
            "gemma_installer.pages.prerequisites.shutil.which",
            return_value="/usr/bin/code",
        ):
            with patch("gemma_installer.pages.prerequisites.sys") as mock_sys:
                mock_sys.platform = "linux"
                path = find_vscode()
                assert path == "/usr/bin/code"

    def test_not_found_returns_empty(self) -> None:
        with patch(
            "gemma_installer.pages.prerequisites.shutil.which", return_value=None
        ):
            with patch("gemma_installer.pages.prerequisites.sys") as mock_sys:
                mock_sys.platform = "linux"
                with patch(
                    "gemma_installer.pages.prerequisites.os.path.isfile",
                    return_value=False,
                ):
                    path = find_vscode()
                    assert path == ""


class TestFindPython:
    def test_python312_found(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = "3.12.3"
        mock_result.returncode = 0
        with (
            patch(
                "gemma_installer.pages.prerequisites.shutil.which",
                return_value="/usr/bin/python3",
            ),
            patch(
                "gemma_installer.pages.prerequisites.subprocess.run",
                return_value=mock_result,
            ),
        ):
            path, version = find_python()
            assert path == "/usr/bin/python3"
            assert "3.12" in version

    def test_python310_rejected(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = "3.10.12"
        mock_result.returncode = 0
        with (
            patch(
                "gemma_installer.pages.prerequisites.shutil.which",
                side_effect=lambda cmd: (
                    "/usr/bin/python3" if cmd == "python3" else None
                ),
            ),
            patch(
                "gemma_installer.pages.prerequisites.subprocess.run",
                return_value=mock_result,
            ),
        ):
            path, version = find_python()
            assert path == ""

    def test_not_found(self) -> None:
        with patch(
            "gemma_installer.pages.prerequisites.shutil.which", return_value=None
        ):
            path, version = find_python()
            assert path == ""
            assert version == ""

    def test_windows_apps_excluded(self) -> None:
        with patch(
            "gemma_installer.pages.prerequisites.shutil.which",
            side_effect=lambda cmd: (
                r"C:\Users\test\AppData\Local\Microsoft\WindowsApps\python.exe"
                if cmd == "python"
                else None
            ),
        ):
            path, version = find_python()
            assert path == ""


class TestFindOllama:
    def test_found_on_path(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = "ollama version is 0.1.44"
        with (
            patch(
                "gemma_installer.pages.prerequisites.shutil.which",
                return_value="/usr/bin/ollama",
            ),
            patch(
                "gemma_installer.pages.prerequisites.subprocess.run",
                return_value=mock_result,
            ),
        ):
            installed, version = find_ollama()
            assert installed is True
            assert "0.1.44" in version

    def test_not_found(self) -> None:
        with (
            patch(
                "gemma_installer.pages.prerequisites.shutil.which", return_value=None
            ),
            patch(
                "gemma_installer.pages.prerequisites.os.path.isfile", return_value=False
            ),
            patch("gemma_installer.pages.prerequisites.sys") as mock_sys,
        ):
            mock_sys.platform = "linux"
            installed, _ = find_ollama()
            assert installed is False


class TestCheckDiskSpace:
    def test_returns_gb(self) -> None:
        mock_usage = MagicMock()
        mock_usage.free = 50 * 1024**3  # 50 GB
        with patch(
            "gemma_installer.pages.prerequisites.shutil.disk_usage",
            return_value=mock_usage,
        ):
            gb = check_disk_space("/")
            assert gb == 50.0

    def test_handles_os_error(self) -> None:
        with patch(
            "gemma_installer.pages.prerequisites.shutil.disk_usage", side_effect=OSError
        ):
            gb = check_disk_space("/nonexistent")
            assert gb == 0.0

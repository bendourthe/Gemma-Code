"""Tests for packaging infrastructure."""

from __future__ import annotations

from pathlib import Path

PYQT_ROOT = Path(__file__).parent.parent
BUILD_DIR = PYQT_ROOT / "build"


class TestSpecFile:
    def test_spec_file_exists(self) -> None:
        assert (BUILD_DIR / "nexus-installer.spec").is_file()

    def test_spec_contains_required_entries(self) -> None:
        content = (BUILD_DIR / "nexus-installer.spec").read_text()
        assert "PyQt5.QtWidgets" in content
        assert "PyQt5.QtCore" in content
        assert "PyQt5.QtGui" in content
        assert "onefile" not in content or "console=False" in content

    def test_hook_file_exists(self) -> None:
        assert (BUILD_DIR / "hooks" / "hook-PyQt5.py").is_file()


class TestBuildScripts:
    def test_windows_script_exists(self) -> None:
        assert (BUILD_DIR / "build-windows.ps1").is_file()

    def test_macos_script_exists(self) -> None:
        assert (BUILD_DIR / "build-macos.sh").is_file()

    def test_linux_script_exists(self) -> None:
        assert (BUILD_DIR / "build-linux.sh").is_file()

    def test_scripts_contain_pyinstaller(self) -> None:
        for script in ("build-windows.ps1", "build-macos.sh", "build-linux.sh"):
            content = (BUILD_DIR / script).read_text()
            assert "pyinstaller" in content.lower() or "PyInstaller" in content

"""Shared fixtures for the installer test suite."""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

from gemma_installer.installer_state import InstallerState


@pytest.fixture
def mock_state() -> InstallerState:
    """Return a fully populated InstallerState for testing."""
    return InstallerState(
        install_path=r"C:\Program Files\GemmaCode"
        if sys.platform == "win32"
        else "/opt/gemma-code",
        vscode_path="code.cmd" if sys.platform == "win32" else "/usr/bin/code",
        python_path=sys.executable,
        ollama_installed=True,
        gpu_vendor="nvidia",
        gpu_name="NVIDIA GeForce RTX 4090",
        vram_mb=24576,
        recommended_model="gemma4:31b",
        selected_model="gemma4:31b",
        disk_space_gb=100.0,
        components_to_install=["extension", "ollama", "venv", "model"],
    )


@pytest.fixture
def mock_subprocess():
    """Patch subprocess.run and subprocess.Popen with configurable returns."""
    mock_run = MagicMock()
    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = ""
    mock_run.return_value.stderr = ""

    mock_popen = MagicMock()
    mock_popen.return_value.returncode = 0
    mock_popen.return_value.stdout = MagicMock()
    mock_popen.return_value.stdout.__iter__ = MagicMock(return_value=iter([]))

    with (
        patch("subprocess.run", mock_run),
        patch("subprocess.Popen", mock_popen),
    ):
        yield mock_run, mock_popen


@pytest.fixture
def mock_platform_linux(monkeypatch: pytest.MonkeyPatch):
    """Mock the platform to appear as Linux."""
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(os, "name", "posix")


@pytest.fixture
def mock_platform_windows(monkeypatch: pytest.MonkeyPatch):
    """Mock the platform to appear as Windows."""
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(os, "name", "nt")


@pytest.fixture
def mock_platform_macos(monkeypatch: pytest.MonkeyPatch):
    """Mock the platform to appear as macOS."""
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(os, "name", "posix")


@pytest.fixture(scope="session")
def qt_app():
    """Create a QApplication instance for widget tests (session-scoped)."""
    qapp_env = os.environ.get("QT_QPA_PLATFORM")
    if qapp_env is None and sys.platform != "win32":
        os.environ["QT_QPA_PLATFORM"] = "offscreen"
    from PyQt5.QtWidgets import QApplication

    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    yield app

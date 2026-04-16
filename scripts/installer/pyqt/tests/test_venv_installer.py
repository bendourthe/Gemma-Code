"""Tests for VenvInstaller."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from gemma_installer.engine.venv_installer import VenvInstaller
from gemma_installer.installer_state import InstallerState


class TestVenvInstaller:
    def test_fails_without_python(self) -> None:
        state = InstallerState(python_path="")
        log = MagicMock()
        result = VenvInstaller().install(state, log)
        assert result is False

    def test_venv_creation_failure(self) -> None:
        state = InstallerState(python_path="/usr/bin/python3", install_path="/tmp/test")
        log = MagicMock()
        with (
            patch("gemma_installer.engine.venv_installer.os.makedirs"),
            patch(
                "gemma_installer.engine.venv_installer.run_command",
                return_value=(1, "", "venv failed"),
            ),
        ):
            result = VenvInstaller().install(state, log)
            assert result is False

    def test_successful_venv_with_deps(self) -> None:
        state = InstallerState(python_path="/usr/bin/python3", install_path="/tmp/test")
        log = MagicMock()
        with (
            patch("gemma_installer.engine.venv_installer.os.makedirs"),
            patch(
                "gemma_installer.engine.venv_installer.run_command",
                side_effect=[
                    (0, "", ""),  # venv creation
                    (0, "", ""),  # pip install
                    (0, "ok", ""),  # verify
                ],
            ),
            patch(
                "gemma_installer.engine.venv_installer.os.path.isfile",
                return_value=True,
            ),
            patch(
                "gemma_installer.engine.venv_installer.is_windows", return_value=False
            ),
            patch.object(
                VenvInstaller, "_find_requirements", return_value="/path/req.txt"
            ),
        ):
            result = VenvInstaller().install(state, log)
            assert result is True

    def test_no_requirements_file(self) -> None:
        state = InstallerState(python_path="/usr/bin/python3", install_path="/tmp/test")
        log = MagicMock()
        with (
            patch("gemma_installer.engine.venv_installer.os.makedirs"),
            patch(
                "gemma_installer.engine.venv_installer.run_command",
                side_effect=[
                    (0, "", ""),  # venv creation
                    (0, "ok", ""),  # verify
                ],
            ),
            patch(
                "gemma_installer.engine.venv_installer.os.path.isfile",
                return_value=True,
            ),
            patch(
                "gemma_installer.engine.venv_installer.is_windows", return_value=False
            ),
            patch.object(VenvInstaller, "_find_requirements", return_value=None),
        ):
            result = VenvInstaller().install(state, log)
            assert result is True

    def test_venv_python_not_found(self) -> None:
        state = InstallerState(python_path="/usr/bin/python3", install_path="/tmp/test")
        log = MagicMock()
        with (
            patch("gemma_installer.engine.venv_installer.os.makedirs"),
            patch(
                "gemma_installer.engine.venv_installer.run_command",
                return_value=(0, "", ""),
            ),
            patch(
                "gemma_installer.engine.venv_installer.os.path.isfile",
                return_value=False,
            ),
            patch(
                "gemma_installer.engine.venv_installer.is_windows", return_value=False
            ),
        ):
            result = VenvInstaller().install(state, log)
            assert result is False

    def test_find_requirements_not_found(self) -> None:
        with patch(
            "gemma_installer.engine.venv_installer.os.path.isfile", return_value=False
        ):
            result = VenvInstaller._find_requirements()
            assert result is None

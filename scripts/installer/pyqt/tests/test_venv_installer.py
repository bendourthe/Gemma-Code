"""Tests for VenvInstaller.

The venv step was reduced to a no-op stub in v0.4.0 (ADR-0001) because the
Python backend was removed. These tests lock in the stub's contract: it
accepts any InstallerState, logs a deprecation message, and succeeds.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from gemma_installer.engine.venv_installer import VenvInstaller
from gemma_installer.installer_state import InstallerState


class TestVenvInstaller:
    def test_install_returns_true_for_valid_state(self) -> None:
        state = InstallerState(
            python_path="/usr/bin/python3", install_path="/tmp/test"
        )
        log = MagicMock()
        result = VenvInstaller().install(state, log)
        assert result is True

    def test_install_returns_true_without_python_path(self) -> None:
        # The stub does not require a python_path because no venv is created.
        state = InstallerState(python_path="")
        log = MagicMock()
        result = VenvInstaller().install(state, log)
        assert result is True

    def test_install_logs_deprecation_notice(self) -> None:
        state = InstallerState(install_path="/tmp/test")
        log = MagicMock()
        VenvInstaller().install(state, log)

        # At least one log call should explain the v0.4.0 removal so installer
        # users see why the venv step is silent.
        assert log.called
        combined_messages = " ".join(call.args[0] for call in log.call_args_list)
        assert "v0.4.0" in combined_messages or "no longer bundled" in combined_messages.lower()

    def test_install_accepts_default_installer_state(self) -> None:
        # Smoke test: even the bare default state must not raise.
        state = InstallerState()
        log = MagicMock()
        result = VenvInstaller().install(state, log)
        assert result is True

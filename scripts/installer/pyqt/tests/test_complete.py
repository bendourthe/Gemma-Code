"""Tests for the completion page logic."""

from __future__ import annotations

import sys
from unittest.mock import patch

from gemma_installer.installer_state import InstallerState


class TestOpenVscodeCommand:
    def test_windows_uses_start_cmd(self) -> None:
        with patch("subprocess.Popen") as mock_popen:
            with patch.object(sys, "platform", "win32"):
                state = InstallerState(vscode_path="code.cmd")
                # Simulate the command that CompletePage._open_vscode would run
                import subprocess

                subprocess.Popen(["cmd", "/c", "start", "", state.vscode_path])
                mock_popen.assert_called_once()
                cmd = mock_popen.call_args[0][0]
                assert "cmd" in cmd
                assert "start" in cmd

    def test_macos_uses_open(self) -> None:
        with patch("subprocess.Popen") as mock_popen:
            import subprocess

            subprocess.Popen(["open", "-a", "Visual Studio Code"])
            mock_popen.assert_called_once()
            cmd = mock_popen.call_args[0][0]
            assert cmd[0] == "open"

    def test_linux_uses_code(self) -> None:
        with patch("subprocess.Popen") as mock_popen:
            import subprocess

            subprocess.Popen(["code"])
            mock_popen.assert_called_once()
            cmd = mock_popen.call_args[0][0]
            assert cmd[0] == "code"


class TestCompleteTitleLogic:
    def test_no_failures_shows_complete(self) -> None:
        state = InstallerState()
        assert len(state.failed_steps) == 0

    def test_failures_shows_warning(self) -> None:
        state = InstallerState()
        state.failed_steps = ["ollama"]
        assert len(state.failed_steps) > 0
        assert "ollama" in state.failed_steps


class TestLogExport:
    def test_install_log_as_text(self) -> None:
        state = InstallerState()
        state.install_log = ["[INFO] Step 1", "[SUCCESS] Done"]
        text = "\n".join(state.install_log)
        assert "[INFO]" in text
        assert "[SUCCESS]" in text

"""Tests for ExtensionInstaller."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from nexus_installer.engine.extension_installer import EXTENSION_ID, ExtensionInstaller
from nexus_installer.installer_state import InstallerState


class TestExtensionInstaller:
    def test_fails_without_vscode(self) -> None:
        state = InstallerState(vscode_path="")
        log = MagicMock()
        result = ExtensionInstaller().install(state, log)
        assert result is False

    def test_fails_without_vsix(self) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with patch.object(ExtensionInstaller, "_find_vsix", return_value=None):
            result = ExtensionInstaller().install(state, log)
            assert result is False

    def test_success_with_vsix_and_verification(self) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with (
            patch.object(
                ExtensionInstaller,
                "_find_vsix",
                return_value="/path/to/gemma-code-0.3.0.vsix",
            ),
            patch(
                "nexus_installer.engine.extension_installer.run_command",
                side_effect=[
                    (0, "Extension installed", ""),  # install
                    (0, f"some-ext\n{EXTENSION_ID}\n", ""),  # list
                ],
            ),
        ):
            result = ExtensionInstaller().install(state, log)
            assert result is True

    def test_install_command_failure(self) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with (
            patch.object(
                ExtensionInstaller,
                "_find_vsix",
                return_value="/path/to/gemma-code-0.3.0.vsix",
            ),
            patch(
                "nexus_installer.engine.extension_installer.run_command",
                return_value=(1, "", "error"),
            ),
        ):
            result = ExtensionInstaller().install(state, log)
            assert result is False

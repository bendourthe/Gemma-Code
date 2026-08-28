"""Tests for ExtensionInstaller."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.engine.extension_installer import (
    EXTENSION_ID,
    SUPPORTED_VSCODE_VERSION,
    ExtensionInstaller,
)
from nexus_installer.installer_state import InstallerState


class TestExtensionInstaller:
    def test_skips_without_vscode(self) -> None:
        """v1.11.0 Phase 3 (T302): a machine without VS Code is a normal user
        machine -- the step SKIPS with guidance instead of failing."""
        state = InstallerState(vscode_path="")
        log = MagicMock()
        result = ExtensionInstaller().install(state, log)
        assert result is True
        assert state.skipped_steps == ["extension"]
        assert state.step_failures == []
        assert any("skipped" in call.args[0].lower() for call in log.call_args_list)

    def test_fails_without_vsix(self) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with patch.object(ExtensionInstaller, "_find_vsix", return_value=None):
            result = ExtensionInstaller().install(state, log)
            assert result is False
        # T303: a structured, plain-language failure is recorded.
        assert state.step_failures and state.step_failures[0]["step"] == "extension"
        assert state.step_failures[0]["suggestion"]

    def test_success_with_vsix_and_verification(self) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with (
            patch.object(
                ExtensionInstaller,
                "_find_vsix",
                return_value="/path/to/nexus-coding-0.3.0.vsix",
            ),
            patch(
                "nexus_installer.engine.extension_installer.run_command",
                side_effect=[
                    (
                        0,
                        f"{SUPPORTED_VSCODE_VERSION}\ncommit\nx64\n",
                        "",
                    ),  # compatibility recheck
                    (0, "Extension installed", ""),  # install
                    (0, f"some-ext\n{EXTENSION_ID}\n", ""),  # list
                ],
            ) as run_mock,
        ):
            result = ExtensionInstaller().install(state, log)
            assert result is True
        assert run_mock.call_args_list[0].args[0] == [
            "/usr/bin/code",
            "--version",
        ]
        install_command = run_mock.call_args_list[1].args[0]
        assert install_command == [
            "/usr/bin/code",
            "--install-extension",
            "/path/to/nexus-coding-0.3.0.vsix",
        ]
        assert "--force" not in install_command

    def test_install_command_failure(self) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with (
            patch.object(
                ExtensionInstaller,
                "_find_vsix",
                return_value="/path/to/nexus-coding-0.3.0.vsix",
            ),
            patch(
                "nexus_installer.engine.extension_installer.run_command",
                side_effect=[
                    (0, f"{SUPPORTED_VSCODE_VERSION}\ncommit\nx64\n", ""),
                    (1, "", "error"),
                ],
            ),
        ):
            result = ExtensionInstaller().install(state, log)
            assert result is False
        assert state.step_failures and state.step_failures[0]["step"] == "extension"

    @pytest.mark.parametrize("version", ["1.133.9", "1.134.1"])
    def test_recheck_skips_when_stable_version_changed(self, version: str) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with (
            patch.object(
                ExtensionInstaller,
                "_find_vsix",
                return_value="/path/to/nexus-coding-2.2.9-linux-x64.vsix",
            ),
            patch(
                "nexus_installer.engine.extension_installer.run_command",
                return_value=(0, f"{version}\ncommit\nx64\n", ""),
            ) as run_mock,
        ):
            result = ExtensionInstaller().install(state, log)

        assert result is True
        assert state.skipped_steps == ["extension"]
        assert state.step_failures == []
        run_mock.assert_called_once_with(["/usr/bin/code", "--version"], timeout=30)
        assert any(version in call.args[0] for call in log.call_args_list)

    @pytest.mark.parametrize(
        "vscode_path",
        ["/usr/bin/code-insiders", "/opt/cursor", "/opt/windsurf"],
    )
    def test_recheck_skips_unsupported_editor_cli(self, vscode_path: str) -> None:
        state = InstallerState(vscode_path=vscode_path)
        log = MagicMock()
        with (
            patch.object(
                ExtensionInstaller,
                "_find_vsix",
                return_value="/path/to/nexus-coding-2.2.9-linux-x64.vsix",
            ),
            patch("nexus_installer.engine.extension_installer.run_command") as run_mock,
        ):
            result = ExtensionInstaller().install(state, log)

        assert result is True
        assert state.skipped_steps == ["extension"]
        assert state.step_failures == []
        run_mock.assert_not_called()

    @pytest.mark.parametrize(
        ("command_result", "expected_log"),
        [
            ((1, "", "failed"), "could not be verified"),
            ((0, "not-a-version\ncommit\nx64\n", ""), "could not be verified"),
        ],
    )
    def test_recheck_skips_failed_or_malformed_version_command(
        self, command_result: tuple[int, str, str], expected_log: str
    ) -> None:
        state = InstallerState(vscode_path="/usr/bin/code")
        log = MagicMock()
        with (
            patch.object(
                ExtensionInstaller,
                "_find_vsix",
                return_value="/path/to/nexus-coding-2.2.9-linux-x64.vsix",
            ),
            patch(
                "nexus_installer.engine.extension_installer.run_command",
                return_value=command_result,
            ) as run_mock,
        ):
            result = ExtensionInstaller().install(state, log)

        assert result is True
        assert state.skipped_steps == ["extension"]
        assert state.step_failures == []
        run_mock.assert_called_once_with(["/usr/bin/code", "--version"], timeout=30)
        assert any(expected_log in call.args[0] for call in log.call_args_list)

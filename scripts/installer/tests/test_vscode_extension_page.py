"""v1.1.0 Phase 14.7 -- tests for the VS Code extension add-on page."""

from __future__ import annotations

import pytest

from nexus_installer.engine.extension_installer import (
    SUPPORTED_VSCODE_VERSION,
    VsCodeCliStatus,
    parse_vscode_version,
)
from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.vscode_extension import (
    VSCODE_CLI_CANDIDATES,
    VsCodeExtensionPage,
    detect_vscode_cli,
)


def _status(
    *,
    path: str | None = "/usr/bin/code",
    cli_name: str | None = "code",
    version: str | None = SUPPORTED_VSCODE_VERSION,
    supported: bool = True,
    reason: str = "supported",
) -> VsCodeCliStatus:
    return VsCodeCliStatus(path, cli_name, version, supported, reason)


class TestDetectVsCodeCli:
    def test_accepts_exact_stable_vscode_version(self) -> None:
        def fake_which(name: str) -> str | None:
            return "/usr/bin/code" if name == "code" else None

        result = detect_vscode_cli(
            which_fn=fake_which,
            run_fn=lambda cmd, timeout: (
                0,
                f"\ufeff{SUPPORTED_VSCODE_VERSION}\r\ncommit-hash\r\nx64\r\n",
                "",
            ),
        )
        assert result.supported is True
        assert result.path == "/usr/bin/code"
        assert result.version == SUPPORTED_VSCODE_VERSION

    @pytest.mark.parametrize("version", ["1.133.9", "1.134.1"])
    def test_rejects_earlier_and_later_stable_versions(self, version: str) -> None:
        result = detect_vscode_cli(
            which_fn=lambda name: "/usr/bin/code" if name == "code" else None,
            run_fn=lambda cmd, timeout: (0, f"{version}\ncommit\nx64\n", ""),
        )
        assert result.supported is False
        assert result.reason == "version-mismatch"
        assert result.version == version

    @pytest.mark.parametrize("cli", ["code-insiders", "cursor", "windsurf"])
    def test_rejects_non_stable_or_fork_editor_clis(self, cli: str) -> None:
        def fake_which(name: str) -> str | None:
            return f"/opt/{cli}" if name == cli else None

        result = detect_vscode_cli(which_fn=fake_which)
        assert result.supported is False
        assert result.reason == "unsupported-cli"
        assert result.cli_name == cli

    @pytest.mark.parametrize(
        ("exit_code", "stdout", "expected_reason"),
        [
            (1, "", "version-check-failed"),
            (0, "not-a-version\ncommit\nx64\n", "version-unreadable"),
        ],
    )
    def test_rejects_failed_or_malformed_version_command(
        self, exit_code: int, stdout: str, expected_reason: str
    ) -> None:
        result = detect_vscode_cli(
            which_fn=lambda name: "/usr/bin/code" if name == "code" else None,
            run_fn=lambda cmd, timeout: (exit_code, stdout, "failure"),
        )
        assert result.supported is False
        assert result.reason == expected_reason

    def test_none_when_no_cli(self) -> None:
        result = detect_vscode_cli(which_fn=lambda _n: None)
        assert result.supported is False
        assert result.reason == "not-found"

    def test_parser_ignores_non_version_lines(self) -> None:
        assert parse_vscode_version("warning\n1.134.0\ncommit\nx64\n") == "1.134.0"


class TestVsCodeExtensionPage:
    def test_auto_ticks_when_detected(self, qt_app) -> None:
        state = InstallerState(components_to_install=["ollama", "venv"])
        page = VsCodeExtensionPage(state, detect_fn=_status)
        assert state.install_vscode_extension is True
        assert state.vscode_path == "/usr/bin/code"
        assert state.components_to_install == ["extension", "ollama", "venv"]
        assert page._checkbox.isChecked() is True
        assert page._checkbox.isEnabled() is True

    def test_unticked_when_no_cli(self, qt_app) -> None:
        state = InstallerState(vscode_path="")
        page = VsCodeExtensionPage(
            state,
            detect_fn=lambda: _status(
                path=None,
                cli_name=None,
                version=None,
                supported=False,
                reason="not-found",
            ),
        )
        assert state.install_vscode_extension is False
        assert state.vscode_path == ""
        assert "extension" not in state.components_to_install
        assert page._checkbox.isChecked() is False
        assert page._checkbox.isEnabled() is False
        assert "not found" in page._detection_label.text().lower()

    def test_uses_supported_prerequisite_path_when_code_is_not_on_path(
        self, qt_app
    ) -> None:
        saved_path = (
            "C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code"
            "\\bin\\code.cmd"
        )
        state = InstallerState(vscode_path=saved_path)
        page = VsCodeExtensionPage(
            state,
            detect_fn=lambda: _status(
                path=None,
                cli_name=None,
                version=None,
                supported=False,
                reason="not-found",
            ),
            inspect_fn=lambda path: _status(path=path),
        )
        assert state.install_vscode_extension is True
        assert state.vscode_path == saved_path
        assert "extension" in state.components_to_install
        assert page._checkbox.isChecked() is True
        assert page._checkbox.isEnabled() is True

    def test_refresh_uses_prerequisite_path_discovered_after_construction(
        self, qt_app
    ) -> None:
        saved_path = "/Applications/Visual Studio Code.app/Contents/app/bin/code"
        state = InstallerState(vscode_path="")
        page = VsCodeExtensionPage(
            state,
            detect_fn=lambda: _status(
                path=None,
                cli_name=None,
                version=None,
                supported=False,
                reason="not-found",
            ),
            inspect_fn=lambda path: _status(path=path),
        )
        assert "extension" not in state.components_to_install

        state.vscode_path = saved_path
        page._refresh_compatibility()

        assert state.vscode_path == saved_path
        assert state.install_vscode_extension is True
        assert "extension" in state.components_to_install
        assert page._checkbox.isChecked() is True
        assert page._checkbox.isEnabled() is True

    def test_mismatched_version_is_disabled_with_truthful_copy(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(
            state,
            detect_fn=lambda: _status(
                version="1.135.0",
                supported=False,
                reason="version-mismatch",
            ),
        )
        assert state.install_vscode_extension is False
        assert "extension" not in state.components_to_install
        assert page._checkbox.isChecked() is False
        assert page._checkbox.isEnabled() is False
        assert "1.135.0" in page._detection_label.text()
        assert "1.134.0 exactly" in page._detection_label.text()

    def test_unsupported_editor_is_disabled_with_truthful_copy(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(
            state,
            detect_fn=lambda: _status(
                path="/opt/cursor",
                cli_name="cursor",
                version=None,
                supported=False,
                reason="unsupported-cli",
            ),
        )
        assert state.install_vscode_extension is False
        assert "extension" not in state.components_to_install
        assert page._checkbox.isEnabled() is False
        assert "does not support" in page._detection_label.text()
        assert "cursor" in page._detection_label.text()

    def test_toggle_updates_state(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(state, detect_fn=_status)
        page._checkbox.setChecked(False)
        assert state.install_vscode_extension is False
        assert "extension" not in state.components_to_install
        page._checkbox.setChecked(True)
        assert state.install_vscode_extension is True
        assert state.components_to_install[0] == "extension"

    def test_refresh_preserves_explicit_opt_out(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(state, detect_fn=_status)
        page._checkbox.setChecked(False)

        page._refresh_compatibility()

        assert page._checkbox.isChecked() is False
        assert state.install_vscode_extension is False
        assert "extension" not in state.components_to_install

    def test_active_install_lock_prevents_refresh_mutating_queue(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(state, detect_fn=_status)
        page.set_interactive(False)
        page._detect_fn = lambda: _status(
            version="1.135.0",
            supported=False,
            reason="version-mismatch",
        )

        page._refresh_compatibility()

        assert page._checkbox.isEnabled() is False
        assert state.install_vscode_extension is True
        assert "extension" in state.components_to_install

    def test_unsloth_checkbox_is_off_and_sets_state(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(
            state,
            detect_fn=lambda: _status(
                path=None,
                cli_name=None,
                version=None,
                supported=False,
                reason="not-found",
            ),
        )
        assert page._unsloth.isChecked() is False
        assert state.install_unsloth is False
        page._unsloth.setChecked(True)
        assert state.install_unsloth is True
        assert "LGPL" in page._unsloth.text()

    def test_candidates_include_known_clis(self) -> None:
        assert "code" in VSCODE_CLI_CANDIDATES
        assert "code-insiders" in VSCODE_CLI_CANDIDATES
        assert "cursor" in VSCODE_CLI_CANDIDATES
        assert "windsurf" in VSCODE_CLI_CANDIDATES

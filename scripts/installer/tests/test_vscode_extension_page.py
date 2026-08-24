"""v1.1.0 Phase 14.7 -- tests for the VS Code extension add-on page."""

from __future__ import annotations

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.vscode_extension import (
    VSCODE_CLI_CANDIDATES,
    VsCodeExtensionPage,
    detect_vscode_cli,
)


class TestDetectVsCodeCli:
    def test_detects_code(self) -> None:
        def fake_which(name: str) -> str | None:
            return "/usr/bin/code" if name == "code" else None

        assert detect_vscode_cli(which_fn=fake_which) == "code"

    def test_detects_cursor(self) -> None:
        def fake_which(name: str) -> str | None:
            return "/opt/cursor" if name == "cursor" else None

        assert detect_vscode_cli(which_fn=fake_which) == "cursor"

    def test_none_when_no_cli(self) -> None:
        assert detect_vscode_cli(which_fn=lambda _n: None) is None


class TestVsCodeExtensionPage:
    def test_auto_ticks_when_detected(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(state, detect_fn=lambda: "code")
        assert state.install_vscode_extension is True
        assert page._checkbox.isChecked() is True

    def test_unticked_when_no_cli(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(state, detect_fn=lambda: None)
        assert state.install_vscode_extension is False
        assert page._checkbox.isChecked() is False

    def test_toggle_updates_state(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(state, detect_fn=lambda: "code")
        page._checkbox.setChecked(False)
        assert state.install_vscode_extension is False

    def test_unsloth_checkbox_is_off_and_sets_state(self, qt_app) -> None:
        state = InstallerState()
        page = VsCodeExtensionPage(state, detect_fn=lambda: None)
        assert page._unsloth.isChecked() is False
        assert state.install_unsloth is False
        page._unsloth.setChecked(True)
        assert state.install_unsloth is True
        assert "LGPL" in page._unsloth.text()

    def test_candidates_include_known_clis(self) -> None:
        assert "code" in VSCODE_CLI_CANDIDATES
        assert "cursor" in VSCODE_CLI_CANDIDATES

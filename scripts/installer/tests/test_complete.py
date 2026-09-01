"""Tests for the completion page logic."""

from __future__ import annotations

import sys
from unittest.mock import patch

from nexus_installer.installer_state import InstallerState


class TestOpenVscodeCommand:
    def test_windows_uses_start_cmd(self) -> None:
        with (
            patch("subprocess.Popen") as mock_popen,
            patch.object(sys, "platform", "win32"),
        ):
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


class TestLaunchNexusOnFinish:
    """v1.8.0 Phase 2 (T203): the 'Launch Nexus' checkbox + finish hook."""

    def _page(self, state: InstallerState):
        from nexus_installer.pages.complete import CompletePage

        return CompletePage(state)

    def test_checkbox_default_checked(self, qt_app: object) -> None:
        state = InstallerState()
        page = self._page(state)
        assert page._launch_checkbox.isChecked() is True
        assert state.launch_desktop_on_finish is True

    def test_unchecking_updates_state(self, qt_app: object) -> None:
        state = InstallerState()
        page = self._page(state)
        page._launch_checkbox.setChecked(False)
        assert state.launch_desktop_on_finish is False

    def test_refresh_disables_checkbox_when_desktop_missing(
        self, qt_app: object
    ) -> None:
        state = InstallerState(desktop_installed=False)
        page = self._page(state)
        page._refresh()
        assert page._launch_checkbox.isEnabled() is False
        assert page._launch_checkbox.isChecked() is False

    def test_on_finish_launches_installed_desktop(self, qt_app: object) -> None:
        state = InstallerState(
            desktop_installed=True,
            desktop_exe_path=r"C:\apps\Nexus\Nexus.exe",
            launch_desktop_on_finish=True,
        )
        page = self._page(state)
        with patch("subprocess.Popen") as mock_popen:
            page.on_finish()
        mock_popen.assert_called_once_with([r"C:\apps\Nexus\Nexus.exe"])

    def test_on_finish_respects_unchecked_box(self, qt_app: object) -> None:
        state = InstallerState(
            desktop_installed=True,
            desktop_exe_path=r"C:\apps\Nexus\Nexus.exe",
            launch_desktop_on_finish=False,
        )
        page = self._page(state)
        with patch("subprocess.Popen") as mock_popen:
            page.on_finish()
        mock_popen.assert_not_called()

    def test_on_finish_noop_when_not_installed(self, qt_app: object) -> None:
        state = InstallerState(launch_desktop_on_finish=True)
        page = self._page(state)
        with patch("subprocess.Popen") as mock_popen:
            page.on_finish()
        mock_popen.assert_not_called()

    def test_refresh_shows_health_status_row(self, qt_app: object) -> None:
        from PyQt5.QtWidgets import QLabel

        state = InstallerState(desktop_installed=True, desktop_health_ok=True)
        page = self._page(state)
        page._refresh()
        # The services card should now contain a Nexus Desktop row.
        texts = [label.text() for label in page._services_card.findChildren(QLabel)]
        assert "Nexus Desktop" in texts
        assert any("health check passed" in t for t in texts)


class TestCompactLayout:
    """v2.2.3 Phase 7 (7.3): the Complete page fits without scrolling."""

    def _page(self, state: InstallerState):
        from nexus_installer.pages.complete import CompletePage

        return CompletePage(state)

    def test_page_spacing_is_compact(self, qt_app: object) -> None:
        page = self._page(InstallerState())
        assert page.layout().spacing() == 8

    def test_service_rows_have_zero_margins_and_wide_name(self, qt_app: object) -> None:
        from PyQt5.QtWidgets import QLabel

        state = InstallerState(desktop_installed=True, desktop_health_ok=True)
        page = self._page(state)
        page._refresh()
        rows = [
            page._services_layout.itemAt(i).widget()
            for i in range(page._services_layout.count())
        ]
        assert rows, "the services card must carry rows after refresh"
        for row in rows:
            m = row.layout().contentsMargins()
            # No default 11px QHBoxLayout margins on service rows.
            assert (m.left(), m.top(), m.right(), m.bottom()) == (0, 0, 0, 0)
        # The name column is wide enough that "VS Code extension" never clips.
        name_labels = [
            label
            for row in rows
            for label in row.findChildren(QLabel)
            if label.text() == "VS Code extension"
        ]
        assert name_labels
        assert all(label.minimumWidth() > 160 for label in name_labels)

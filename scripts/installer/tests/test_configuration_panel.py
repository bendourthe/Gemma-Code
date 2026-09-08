"""The configuration panel hosted on Welcome: install path + Ollama URL card,
ordered features, state wiring, install lock, and the Browse button style."""

from __future__ import annotations

import pytest

from nexus_installer.installer_state import InstallerState


def _label_texts(widget) -> str:
    from PyQt5.QtWidgets import QLabel

    return " ".join(lbl.text() for lbl in widget.findChildren(QLabel))


class TestConfigurationPanel:
    @pytest.fixture(autouse=True)
    def _stub_vscode_detect(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from nexus_installer.engine.extension_installer import VsCodeCliStatus

        monkeypatch.setattr(
            "nexus_installer.pages.vscode_extension.detect_vscode_cli",
            lambda: VsCodeCliStatus(None, None, None, False, "not-found"),
        )

    def test_install_path_and_ollama_url_share_the_setup_card(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage
        from nexus_installer.pages.install_path import InstallPathPage

        page = ConfigurationPage(InstallerState())
        assert isinstance(page._path, InstallPathPage)
        assert page._path.parentWidget() is page._setup_col
        assert page._ollama_url.parentWidget() is page._setup_col
        assert page._ollama_url.isVisibleTo(page)
        assert page._setup_col.parentWidget() is page._setup_card
        assert page._setup_card.objectName() == "surfaceCard"
        assert page._features_card.objectName() == "surfaceCard"
        # No derived component list here: Review resolves it before install.
        assert not hasattr(page, "_required_list")

    def test_no_bullet_note_under_the_disk_line(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        texts = _label_texts(ConfigurationPage(InstallerState()))
        assert "Nexus models: downloaded" not in texts
        assert "installed system-wide" not in texts

    def test_features_order(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        page = ConfigurationPage(InstallerState())
        layout = page._features_col.layout()
        order = [
            layout.indexOf(page._shortcut_toggle),
            layout.indexOf(page._desktop_shortcut_toggle),
            layout.indexOf(page._vscode),
            layout.indexOf(page._unsloth.parentWidget()),
        ]
        assert -1 not in order
        assert order == sorted(order)
        assert page._shortcut_toggle.text() == "Add Start Menu / Applications shortcut"
        assert page._desktop_shortcut_toggle.text() == "Add a Desktop shortcut"
        assert page._vscode._checkbox.text().endswith("using the latest release")
        assert page._unsloth.text().startswith("(optional) Install Unsloth Core")
        assert "QLoRA" in page._unsloth.text()

    def test_shortcut_toggles_write_state(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        assert state.add_start_menu_shortcut is True
        assert state.add_desktop_shortcut is True
        page._shortcut_toggle.setChecked(False)
        page._desktop_shortcut_toggle.setChecked(False)
        assert state.add_start_menu_shortcut is False
        assert state.add_desktop_shortcut is False

    def test_validate_delegates_to_the_install_path(self, qt_app, tmp_path) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        ok, msg = ConfigurationPage(InstallerState(install_path="")).validate()
        assert ok is False
        assert "empty" in msg.lower()
        # A writable path: the assertion is about delegation, not about
        # whether this host may write to the default install directory.
        state = InstallerState(install_path=str(tmp_path / "NexusAI"))
        ok, msg = ConfigurationPage(state).validate()
        assert ok is True, msg

    def test_path_edits_flow_into_state(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        page._path._path_input.setText(r"D:\NexusAI")
        assert state.install_path == r"D:\NexusAI"

    def test_install_lock_freezes_every_choice(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        page = ConfigurationPage(InstallerState(gpu_vendor="nvidia", vram_mb=16384))
        page.set_interactive(False)
        for widget in (
            page._path._path_input,
            page._path._browse_btn,
            page._ollama_url,
            page._shortcut_toggle,
            page._desktop_shortcut_toggle,
            page._unsloth,
        ):
            assert widget.isEnabled() is False
        page.set_interactive(True)
        assert page._path._path_input.isEnabled() is True
        assert page._unsloth.isEnabled() is True

    def test_unsloth_lock_follows_the_host(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage

        state = InstallerState()
        page = ConfigurationPage(state)
        assert page._unsloth_badge.text() == "Incompatible"
        assert page._unsloth.isEnabled() is False
        state.gpu_vendor, state.vram_mb = "nvidia", 16384
        page.refresh_host()
        assert page._unsloth_badge.text() == "Compatible"
        assert page._unsloth.isChecked() is True
        assert state.install_unsloth is True
        page._unsloth.setChecked(False)
        page.refresh_host()
        assert page._unsloth.isChecked() is False
        assert state.install_unsloth is False

    def test_narrow_width_stacks_the_cards(self, qt_app) -> None:
        from PyQt5.QtCore import QSize
        from PyQt5.QtGui import QResizeEvent

        from nexus_installer.pages.configuration import ConfigurationPage

        page = ConfigurationPage(InstallerState())
        page.resizeEvent(QResizeEvent(QSize(400, 700), QSize(900, 700)))
        assert page._narrow_columns is True
        page.resizeEvent(QResizeEvent(QSize(900, 700), QSize(400, 700)))
        assert page._narrow_columns is False

    def test_browse_button_is_a_filled_rounded_button(self, qt_app) -> None:
        from nexus_installer.pages.configuration import ConfigurationPage
        from nexus_installer.theme import generate_stylesheet

        page = ConfigurationPage(InstallerState())
        assert page._path._browse_btn.objectName() == "install-path-browse"
        rule = generate_stylesheet().split("QPushButton#install-path-browse {")[1]
        rule = rule.split("}")[0]
        assert "border-radius" in rule
        assert "background-color" in rule

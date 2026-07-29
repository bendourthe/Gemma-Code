"""v1.14.0 Phase 2 -- guided HF-auth dialog (requires QApplication)."""

from __future__ import annotations

from PyQt5.QtWidgets import QDialog, QPushButton

from nexus_installer.widgets.gated_auth_dialog import GatedAuthDialog

_ENTRY = {
    "displayName": "Stable Video Diffusion 1.1",
    "source": {"repo": "stabilityai/stable-video-diffusion-img2vid-xt-1-1"},
    "licenseUrl": "https://huggingface.co/stabilityai/stable-video-diffusion-img2vid-xt-1-1",
}


def _dialog(qt_app: object, valid: bool) -> GatedAuthDialog:
    return GatedAuthDialog(dict(_ENTRY), validate=lambda repo, tok: valid)


class TestGatedAuthDialog:
    def test_valid_token_accepts(self, qt_app: object) -> None:
        dlg = _dialog(qt_app, valid=True)
        dlg._token_input.setText("hf_valid")
        dlg._on_unlock()
        assert dlg.token == "hf_valid"
        assert dlg.result() == QDialog.Accepted

    def test_invalid_token_shows_error_and_stays_open(self, qt_app: object) -> None:
        dlg = _dialog(qt_app, valid=False)
        dlg._token_input.setText("hf_bad")
        dlg._on_unlock()
        assert dlg.token == ""
        assert dlg._status.text()
        assert not dlg._status.isHidden()
        assert dlg.result() != QDialog.Accepted

    def test_empty_token_shows_error(self, qt_app: object) -> None:
        dlg = _dialog(qt_app, valid=True)
        dlg._token_input.setText("   ")
        dlg._on_unlock()
        assert dlg.token == ""
        assert dlg._status.text()
        assert not dlg._status.isHidden()

    def test_repo_and_license_parsed(self, qt_app: object) -> None:
        dlg = _dialog(qt_app, valid=True)
        assert dlg._repo == "stabilityai/stable-video-diffusion-img2vid-xt-1-1"
        open_btn = dlg.findChild(QPushButton, "openLicenseButton")
        assert open_btn is not None and open_btn.isEnabled()

    def test_open_button_disabled_without_license(self, qt_app: object) -> None:
        dlg = GatedAuthDialog(
            {"displayName": "X", "source": {"repo": "org/x"}},
            validate=lambda repo, tok: True,
        )
        open_btn = dlg.findChild(QPushButton, "openLicenseButton")
        assert open_btn is not None and not open_btn.isEnabled()

    def test_token_settings_button_always_available(self, qt_app: object) -> None:
        # v1.15.0 Phase 3 (Issue 2): a direct "where to get a token" link,
        # enabled even for a model that carries no license URL.
        dlg = GatedAuthDialog(
            {"displayName": "X", "source": {"repo": "org/x"}},
            validate=lambda repo, tok: True,
        )
        tokens_btn = dlg.findChild(QPushButton, "openTokensButton")
        assert tokens_btn is not None and tokens_btn.isEnabled()

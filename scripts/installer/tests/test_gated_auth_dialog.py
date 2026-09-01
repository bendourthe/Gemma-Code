"""v1.14.0 Phase 2 -- guided HF-auth dialog (requires QApplication)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from PyQt5.QtTest import QTest
from PyQt5.QtWidgets import QApplication, QDialog, QPushButton

from nexus_installer.widgets.gated_auth_dialog import (
    HF_SIGNUP_URL,
    HF_TOKENS_URL,
    GatedAuthDialog,
)

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

    def test_license_button_opens_external_url(self, qt_app: object) -> None:
        opened: list[str] = []
        dlg = GatedAuthDialog(
            dict(_ENTRY),
            validate=lambda repo, tok: True,
            open_url=lambda url: opened.append(url) or True,
        )
        dlg._open_license()
        assert opened == [_ENTRY["licenseUrl"]]

        dlg._open_tokens()
        assert opened == [_ENTRY["licenseUrl"], HF_TOKENS_URL]
        dlg._open_signup()
        assert opened[-1] == HF_SIGNUP_URL

    def test_device_code_is_prominent_and_copyable(
        self, qt_app: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        clip = MagicMock()
        monkeypatch.setattr(QApplication, "clipboard", staticmethod(lambda: clip))
        dlg = _dialog(qt_app, valid=True)
        dlg._on_authorization_required("https://example.test/device", "PCVG-D8GM")
        assert dlg._device_code.text() == "PCVG-D8GM"
        assert not dlg._code_row.isHidden()
        dlg._copy_device_code()
        assert dlg._copy_code_btn.text() == "Copied"
        clip.setText.assert_called_once_with("PCVG-D8GM")

    def test_failed_browser_launch_shows_copyable_url(self, qt_app: object) -> None:
        dlg = GatedAuthDialog(
            dict(_ENTRY),
            validate=lambda repo, tok: True,
            open_url=lambda url: False,
        )
        dlg._on_authorization_required("https://example.test/device", "ABCD")
        assert "https://example.test/device" in dlg._status.text()
        assert not dlg._status.isHidden()

    def test_manual_and_skip_controls_stay_enabled_during_browser_login(
        self, qt_app: object
    ) -> None:
        dlg = _dialog(qt_app, valid=True)
        dlg._login_thread = type(
            "RunningThread",
            (),
            {"isRunning": lambda self: True},
        )()
        dlg._sign_in_btn.setEnabled(False)
        assert dlg._unlock_btn.isEnabled()
        assert dlg._skip_btn.isEnabled()

    def test_browser_login_success_accepts_without_manual_token(
        self, qt_app: object
    ) -> None:
        dlg = GatedAuthDialog(
            dict(_ENTRY),
            validate=lambda repo, tok: True,
            browser_login=lambda repo, **kw: "oauth-token",
        )
        dlg._on_browser_login_finished("oauth-token", "")
        assert dlg.token == "oauth-token"
        assert dlg.result() == QDialog.Accepted

    def test_sign_in_worker_opens_device_url_and_accepts(self, qt_app: object) -> None:
        opened: list[str] = []

        def fake_browser_login(repo: str, **kwargs: object) -> str:
            assert repo == _ENTRY["source"]["repo"]
            authorize = kwargs["authorize"]
            assert callable(authorize)
            authorize("https://example.test/device?code=ABCD", "ABCD")
            return "oauth-token"

        dlg = GatedAuthDialog(
            dict(_ENTRY),
            validate=lambda repo, tok: True,
            browser_login=fake_browser_login,
            open_url=lambda url: opened.append(url) or True,
        )
        dlg.show()
        dlg._start_browser_login()
        for _ in range(100):
            qt_app.processEvents()
            if dlg.result() == QDialog.Accepted:
                break
            QTest.qWait(5)

        assert opened == ["https://example.test/device?code=ABCD"]
        assert dlg.token == "oauth-token"
        assert dlg.result() == QDialog.Accepted

    def test_browser_login_access_failure_stays_open(self, qt_app: object) -> None:
        dlg = _dialog(qt_app, valid=True)
        dlg._on_browser_login_finished("", "Accept the publisher terms.")
        assert dlg.token == ""
        assert "publisher" in dlg._status.text()
        assert dlg.result() != QDialog.Accepted

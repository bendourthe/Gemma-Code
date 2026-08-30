"""v1.14.0 Phase 2 -- guided Hugging Face auth step for a gated opt-in model.

Shown (as a last resort) when a user selected a gated open-weight model and no
Hugging Face token was found automatically. It is honest about the constraint:
the installer cannot accept the model license on the user's behalf, so it walks
them through the one-time free steps -- open the model's license page, accept
it, sign in and create a read token, paste it -- validates the token against
the repo, and returns it to the coordinator. Declining removes the model from
the install queue rather than letting it fail mid-download.

The dialog holds no business logic beyond validate/accept/reject so it is thin;
``engine.gated_auth`` drives the queue changes and is unit-tested without Qt.
"""

from __future__ import annotations

from collections.abc import Callable

from PyQt5.QtCore import QUrl
from PyQt5.QtGui import QDesktopServices
from PyQt5.QtWidgets import (
    QDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BORDER,
    ERROR,
    FS_BODY,
    FS_CAPTION,
    FS_H3,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
)
from nexus_installer.engine.hf_auth import validate_token_for_repo

# validate(repo, token) -> True when the token can reach the repo.
ValidateFn = Callable[[str, str], bool]

#: Where a user creates a free Hugging Face read token (v1.15.0 Phase 3).
HF_TOKENS_URL = "https://huggingface.co/settings/tokens"


class GatedAuthDialog(QDialog):
    """Collect + validate a Hugging Face token for one gated model."""

    def __init__(
        self,
        entry: dict,
        parent: QWidget | None = None,
        validate: ValidateFn | None = None,
    ) -> None:
        super().__init__(parent)
        self._entry = entry or {}
        self._repo = str((self._entry.get("source") or {}).get("repo") or "")
        self._license_url = str(self._entry.get("licenseUrl") or "")
        self._validate = validate or validate_token_for_repo
        self._token = ""

        name = str(self._entry.get("displayName") or self._entry.get("id") or "model")
        self.setWindowTitle(f"Unlock {name}")
        self.setModal(True)
        self.setStyleSheet(f"QDialog {{ background: {BG_CARD}; }}")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 24, 24, 24)
        layout.setSpacing(12)

        heading = QLabel(f"{name} needs a free Hugging Face account")
        heading.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-size: {FS_H3}px; font-weight: 600;"
        )
        heading.setWordWrap(True)
        layout.addWidget(heading)

        body = QLabel(
            'A few high-end models are "gated": they are free and open-weight, '
            "but the publisher asks you to accept their license on Hugging Face "
            "first, so the download needs a free account and a personal access "
            "token. The installer cannot accept the license for you.\n\n"
            "One-time steps (about a minute):\n"
            "  1. Open the license page and click 'Agree and access repository'.\n"
            "  2. Open your Hugging Face token settings and create a free 'read' "
            "token.\n"
            "  3. Paste the token below and click Unlock.\n\n"
            "Prefer to skip? Click 'Skip this model' - the rest of the install "
            "continues normally and only this one model is left out. You can add "
            "it later from the app's Models settings."
        )
        body.setStyleSheet(f"color: {TEXT_SECONDARY}; font-size: {FS_BODY}px;")
        body.setWordWrap(True)
        layout.addWidget(body)

        open_btn = QPushButton("Open the license page")
        open_btn.setObjectName("openLicenseButton")
        open_btn.clicked.connect(self._open_license)
        open_btn.setEnabled(bool(self._license_url))
        layout.addWidget(open_btn)

        tokens_btn = QPushButton("Open Hugging Face token settings")
        tokens_btn.setObjectName("openTokensButton")
        tokens_btn.clicked.connect(self._open_tokens)
        layout.addWidget(tokens_btn)

        self._token_input = QLineEdit()
        self._token_input.setEchoMode(QLineEdit.Password)
        self._token_input.setPlaceholderText("hf_...")
        self._token_input.setStyleSheet(
            f"color: {TEXT_PRIMARY}; background: #10131c; border: 1px solid "
            f"{BORDER}; border-radius: 6px; padding: 8px; font-size: {FS_BODY}px;"
        )
        layout.addWidget(self._token_input)

        self._status = QLabel("")
        self._status.setStyleSheet(f"color: {ERROR}; font-size: {FS_CAPTION}px;")
        self._status.setWordWrap(True)
        self._status.setVisible(False)
        layout.addWidget(self._status)

        buttons = QHBoxLayout()
        buttons.addStretch(1)
        skip_btn = QPushButton("Skip this model")
        skip_btn.setObjectName("skipButton")
        skip_btn.clicked.connect(self.reject)
        buttons.addWidget(skip_btn)
        unlock_btn = QPushButton("Unlock")
        unlock_btn.setObjectName("unlockButton")
        unlock_btn.setStyleSheet(
            f"background: {ACCENT}; color: #0a0e17; font-weight: 600; "
            "border-radius: 6px; padding: 8px 16px;"
        )
        unlock_btn.clicked.connect(self._on_unlock)
        buttons.addWidget(unlock_btn)
        layout.addLayout(buttons)

    @property
    def token(self) -> str:
        """The validated token (empty until Unlock succeeds)."""
        return self._token

    def _open_license(self) -> None:
        if self._license_url:
            QDesktopServices.openUrl(QUrl(self._license_url))

    def _open_tokens(self) -> None:
        QDesktopServices.openUrl(QUrl(HF_TOKENS_URL))

    def _show_error(self, message: str) -> None:
        self._status.setText(message)
        self._status.setVisible(True)

    def _on_unlock(self) -> None:
        token = self._token_input.text().strip()
        if not token:
            self._show_error("Enter your Hugging Face read token to continue.")
            return
        if not self._validate(self._repo, token):
            self._show_error(
                "That token could not access the repository. Make sure you "
                "clicked 'Agree and access repository' on the license page, "
                "then paste a valid read token."
            )
            return
        self._token = token
        self.accept()


def run_gated_prompt(entry: dict, parent: QWidget | None = None) -> str | None:
    """Show the guided dialog for one gated model; return the token or None.

    This is the concrete ``prompt`` for ``engine.gated_auth.ensure_gated_auth``.
    """
    dialog = GatedAuthDialog(entry, parent)
    if dialog.exec_() == QDialog.Accepted:
        return dialog.token
    return None

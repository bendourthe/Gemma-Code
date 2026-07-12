"""v1.1.0 Phase 14.7 -- Nexus VS Code extension add-on page.

After the model picker the wizard offers to install the Nexus Coding VS Code
extension from the bundled VSIX. The checkbox is auto-ticked when the `code`
CLI (or `code-insiders` / `cursor`) is on PATH, and skipping the page leaves
`state.install_vscode_extension = False` so the engine does not run the
extension installer.
"""

from __future__ import annotations

import shutil
from typing import TYPE_CHECKING

from PyQt5.QtWidgets import QCheckBox, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BORDER,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


VSCODE_CLI_CANDIDATES: tuple[str, ...] = (
    "code",
    "code-insiders",
    "cursor",
    "windsurf",
)


def detect_vscode_cli(which_fn=shutil.which) -> str | None:
    """Return the first VS Code-like CLI found on PATH, else None."""
    for cli in VSCODE_CLI_CANDIDATES:
        path = which_fn(cli)
        if path:
            return cli
    return None


class VsCodeExtensionPage(QWidget):
    """Single-question page offering the Nexus VS Code extension."""

    def __init__(
        self,
        state: InstallerState,
        detect_fn=detect_vscode_cli,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._state = state
        detected = detect_fn()
        state.vscode_path = detected or state.vscode_path
        state.install_vscode_extension = bool(detected)

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        title = QLabel("Nexus VS Code Extension")
        title.setStyleSheet(
            "font-size: 28px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        intro = QLabel(
            "Install the Nexus VS Code extension to use your local models for "
            "agentic coding directly inside VS Code (or Cursor / Insiders)."
        )
        intro.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 15px; background: transparent;"
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)

        card = QWidget()
        card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 16px;"
        )
        card_layout = QVBoxLayout(card)

        self._checkbox = QCheckBox(
            "Install the Nexus VS Code extension "
            "(uses local models for agentic coding inside VS Code)"
        )
        self._checkbox.setChecked(bool(detected))
        self._checkbox.setStyleSheet(f"color: {TEXT_PRIMARY}; background: transparent;")
        self._checkbox.stateChanged.connect(self._on_toggled)
        card_layout.addWidget(self._checkbox)

        detection_text = (
            f"Detected: {detected} CLI on PATH"
            if detected
            else "VS Code CLI not found on PATH -- box left unchecked"
        )
        detected_label = QLabel(detection_text)
        detected_label.setStyleSheet(
            f"color: {ACCENT if detected else TEXT_SECONDARY}; "
            "font-size: 14px; background: transparent;"
        )
        card_layout.addWidget(detected_label)

        note = QLabel(
            "You can also install the extension later via `code "
            "--install-extension nexus-coding-1.1.0.vsix`."
        )
        note.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 14px; background: transparent;"
        )
        note.setWordWrap(True)
        card_layout.addWidget(note)

        layout.addWidget(card)
        layout.addStretch()

    def _on_toggled(self, state_value: int) -> None:
        self._state.install_vscode_extension = self._checkbox.isChecked()


__all__ = ["VsCodeExtensionPage", "detect_vscode_cli", "VSCODE_CLI_CANDIDATES"]

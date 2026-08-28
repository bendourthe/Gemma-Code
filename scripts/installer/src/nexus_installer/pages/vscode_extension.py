"""v1.1.0 Phase 14.7 -- Nexus VS Code extension add-on page.

After the model picker the wizard offers to install the Nexus Coding VS Code
extension from the bundled VSIX. The checkbox is auto-ticked only when the
Microsoft stable `code` CLI reports the one VS Code version whose Electron ABI
matches the bundled native module.
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
from nexus_installer.engine.extension_installer import (
    SUPPORTED_VSCODE_VERSION,
    VsCodeCliStatus,
    inspect_vscode_cli,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


VSCODE_CLI_CANDIDATES: tuple[str, ...] = (
    "code",
    "code-insiders",
    "cursor",
    "windsurf",
)


def detect_vscode_cli(which_fn=shutil.which, run_fn=None) -> VsCodeCliStatus:
    """Find a VS Code-like CLI and report whether it is safe for this VSIX."""
    for cli in VSCODE_CLI_CANDIDATES:
        path = which_fn(cli)
        if not path:
            continue
        if cli == "code":
            if run_fn is None:
                return inspect_vscode_cli(path, cli_name=cli)
            return inspect_vscode_cli(path, cli_name=cli, run_fn=run_fn)
        return VsCodeCliStatus(
            path=path,
            cli_name=cli,
            version=None,
            supported=False,
            reason="unsupported-cli",
        )
    return VsCodeCliStatus(
        path=None,
        cli_name=None,
        version=None,
        supported=False,
        reason="not-found",
    )


def _detection_text(status: VsCodeCliStatus) -> str:
    if status.supported:
        return (
            f"Detected Microsoft VS Code {status.version} at {status.path}. "
            "Extension installation is available."
        )
    if status.reason == "not-found":
        return (
            "Microsoft stable VS Code CLI not found on PATH. Extension option "
            "left unchecked and unavailable."
        )
    if status.reason == "unsupported-cli":
        return (
            f"Detected {status.cli_name} at {status.path}, but this release does "
            f"not support that editor. Microsoft VS Code {SUPPORTED_VSCODE_VERSION} "
            "is required."
        )
    if status.reason == "version-mismatch":
        return (
            f"Detected Microsoft VS Code {status.version}, but this extension "
            f"requires version {SUPPORTED_VSCODE_VERSION} exactly. Extension "
            "option left unchecked and unavailable."
        )
    return (
        "Microsoft stable VS Code was found, but its version could not be "
        f"verified as {SUPPORTED_VSCODE_VERSION}. Extension option left "
        "unchecked and unavailable."
    )


class VsCodeExtensionPage(QWidget):
    """Single-question page offering the Nexus VS Code extension."""

    def __init__(
        self,
        state: InstallerState,
        detect_fn=None,
        parent: QWidget | None = None,
        *,
        inspect_fn=None,
    ) -> None:
        super().__init__(parent)
        self._state = state
        self._detect_fn = detect_fn or detect_vscode_cli
        self._inspect_fn = inspect_fn or inspect_vscode_cli
        self._interactive = True
        self._user_selection: bool | None = None
        detected = self._detect_current_host()
        self._compatible = detected.supported
        self._remember_stable_path(detected)
        self._sync_extension_selection(detected.supported)

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        title = QLabel("Nexus VS Code Extension")
        title.setStyleSheet(
            "font-size: 28px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        intro = QLabel(
            "Install the Nexus VS Code extension to use your local models for "
            "agentic coding inside Microsoft Visual Studio Code "
            f"{SUPPORTED_VSCODE_VERSION}. This release does not support VS Code "
            "Insiders, Cursor, Windsurf, or other VS Code versions."
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
        self._checkbox.setChecked(detected.supported)
        self._checkbox.setEnabled(detected.supported)
        self._checkbox.setStyleSheet(f"color: {TEXT_PRIMARY}; background: transparent;")
        self._checkbox.stateChanged.connect(self._on_toggled)
        card_layout.addWidget(self._checkbox)

        self._unsloth = QCheckBox(
            "Install Fine-tuning (Unsloth Core). NVIDIA 16 GB+ only. "
            "unsloth-zoo is LGPL-3.0-or-later, dynamically linked."
        )
        self._unsloth.setChecked(False)
        self._unsloth.setStyleSheet(f"color: {TEXT_PRIMARY}; background: transparent;")
        self._unsloth.stateChanged.connect(self._on_unsloth)
        card_layout.addWidget(self._unsloth)

        self._detection_label = QLabel(_detection_text(detected))
        self._detection_label.setStyleSheet(
            f"color: {ACCENT if detected.supported else TEXT_SECONDARY}; "
            "font-size: 14px; background: transparent;"
        )
        self._detection_label.setWordWrap(True)
        card_layout.addWidget(self._detection_label)

        note = QLabel(
            "The option becomes available only when the Microsoft stable "
            f"`code` CLI reports version {SUPPORTED_VSCODE_VERSION} exactly."
        )
        note.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 14px; background: transparent;"
        )
        note.setWordWrap(True)
        card_layout.addWidget(note)

        layout.addWidget(card)
        layout.addStretch()

    def showEvent(self, event: object) -> None:  # noqa: N802
        """Refresh after asynchronous prerequisite discovery has completed."""
        super().showEvent(event)  # type: ignore[arg-type]
        self._refresh_compatibility()

    def _detect_current_host(self) -> VsCodeCliStatus:
        """Prefer a supported PATH CLI, then inspect the latest saved path."""
        saved_vscode_path = self._state.vscode_path
        detected = self._detect_fn()
        if not detected.supported and saved_vscode_path:
            return self._inspect_fn(saved_vscode_path)
        return detected

    def _remember_stable_path(self, detected: VsCodeCliStatus) -> None:
        """Retain Microsoft stable paths for later checks, never editor forks."""
        if detected.cli_name == "code" and detected.path:
            self._state.vscode_path = detected.path
        elif not detected.supported:
            self._state.vscode_path = ""

    def _refresh_compatibility(self) -> None:
        """Re-project current host compatibility without overriding user intent."""
        if not self._interactive:
            return

        detected = self._detect_current_host()
        self._compatible = detected.supported
        self._remember_stable_path(detected)
        selected = detected.supported and (
            self._user_selection if self._user_selection is not None else True
        )

        previous_block = self._checkbox.blockSignals(True)
        self._checkbox.setChecked(selected)
        self._checkbox.setEnabled(detected.supported)
        self._checkbox.blockSignals(previous_block)
        self._detection_label.setText(_detection_text(detected))
        self._detection_label.setStyleSheet(
            f"color: {ACCENT if detected.supported else TEXT_SECONDARY}; "
            "font-size: 14px; background: transparent;"
        )
        self._sync_extension_selection(selected)

    def _on_toggled(self, state_value: int) -> None:
        selected = (
            self._compatible
            and self._checkbox.isEnabled()
            and self._checkbox.isChecked()
        )
        self._user_selection = selected
        self._sync_extension_selection(selected)

    def _sync_extension_selection(self, selected: bool) -> None:
        """Keep the checkbox projection and the engine component queue aligned."""
        without_extension = [
            component
            for component in self._state.components_to_install
            if component != "extension"
        ]
        self._state.install_vscode_extension = selected
        self._state.components_to_install = (
            ["extension", *without_extension] if selected else without_extension
        )

    def set_interactive(self, enabled: bool) -> None:
        """Lock both choices once installation has started."""
        self._interactive = enabled
        self._checkbox.setEnabled(enabled and self._compatible)
        self._unsloth.setEnabled(enabled)

    def _on_unsloth(self, state_value: int) -> None:
        self._state.install_unsloth = self._unsloth.isChecked()


__all__ = [
    "VSCODE_CLI_CANDIDATES",
    "VsCodeExtensionPage",
    "detect_vscode_cli",
]

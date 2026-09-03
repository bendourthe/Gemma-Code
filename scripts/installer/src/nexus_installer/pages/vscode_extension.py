"""v1.1.0 Phase 14.7 -- Nexus VS Code extension add-on page.

After the model picker the wizard offers to install the Nexus Coding VS Code
extension from the bundled VSIX. The checkbox stays visible. It is enabled
when Microsoft stable `code` reports 1.134, 1.135, or 1.136 (Electron 42.8.1).
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
    SUPPORTED_ELECTRON_VERSION,
    SUPPORTED_VSCODE_RANGE_COPY,
    VsCodeCliStatus,
    inspect_vscode_cli,
    installed_nexus_extension_id,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


VSCODE_CLI_CANDIDATES: tuple[str, ...] = (
    "code",
    "code-insiders",
    "cursor",
    "windsurf",
)


_INSTALL_LABEL = (
    "Install the Nexus VS Code extension "
    "(uses local models for agentic coding inside VS Code)"
)
_REPLACE_LABEL = (
    "Replace the installed Nexus VS Code extension with this installer's copy"
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
            "Microsoft stable VS Code CLI not found on PATH. Install VS Code "
            "to enable the extension option. The box stays visible and unchecked."
        )
    if status.reason == "unsupported-cli":
        return (
            f"Detected {status.cli_name} at {status.path}, but this release does "
            "not support that editor. Microsoft VS Code "
            f"{SUPPORTED_VSCODE_RANGE_COPY} "
            f"(Electron {SUPPORTED_ELECTRON_VERSION}) is required."
        )
    if status.reason == "version-mismatch":
        return (
            f"Detected Microsoft VS Code {status.version}, but this extension "
            f"supports version {SUPPORTED_VSCODE_RANGE_COPY} "
            f"(Electron {SUPPORTED_ELECTRON_VERSION}). The option stays visible "
            "and unchecked."
        )
    return (
        "Microsoft stable VS Code was found, but its version could not be "
        f"verified as {SUPPORTED_VSCODE_RANGE_COPY}. The option stays visible "
        "and unchecked."
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
        list_fn=None,
        compact: bool = False,
    ) -> None:
        super().__init__(parent)
        self._state = state
        self._detect_fn = detect_fn or detect_vscode_cli
        self._inspect_fn = inspect_fn or inspect_vscode_cli
        self._list_fn = list_fn or installed_nexus_extension_id
        self._interactive = True
        self._user_selection: bool | None = None
        self._compact = compact
        detected = self._detect_current_host()
        self._compatible = detected.supported
        self._remember_stable_path(detected)
        self._sync_extension_selection(detected.supported)

        layout = QVBoxLayout(self)
        layout.setSpacing(12 if compact else 16)
        if compact:
            layout.setContentsMargins(0, 0, 0, 0)

        if not compact:
            title = QLabel("Nexus VS Code Extension")
            title.setStyleSheet(
                "font-size: 28px; font-weight: bold; background: transparent;"
            )
            layout.addWidget(title)

            intro = QLabel(
                "Install the Nexus VS Code extension to use your local models for "
                "agentic coding inside Microsoft Visual Studio Code "
                f"{SUPPORTED_VSCODE_RANGE_COPY} "
                f"(Electron {SUPPORTED_ELECTRON_VERSION}). This release does not "
                "support VS Code Insiders, Cursor, Windsurf, or other VS Code versions."
            )
            intro.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 15px; background: transparent;"
            )
            intro.setWordWrap(True)
            layout.addWidget(intro)

        self._checkbox = QCheckBox(_INSTALL_LABEL)
        self._checkbox.setChecked(detected.supported)
        self._checkbox.setEnabled(detected.supported)
        self._checkbox.setVisible(True)
        self._checkbox.setStyleSheet(f"color: {TEXT_PRIMARY}; background: transparent;")
        self._checkbox.stateChanged.connect(self._on_toggled)
        self._apply_replace_label(detected.path)

        self._detection_label = QLabel(_detection_text(detected))
        self._detection_label.setStyleSheet(
            f"color: {ACCENT if detected.supported else TEXT_SECONDARY}; "
            "font-size: 14px; background: transparent;"
        )
        self._detection_label.setWordWrap(True)

        if compact:
            layout.addWidget(self._checkbox)
            layout.addWidget(self._detection_label)
        else:
            card = QWidget()
            card.setStyleSheet(
                f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
                f"border-radius: 8px; padding: 16px;"
            )
            card_layout = QVBoxLayout(card)
            card_layout.addWidget(self._checkbox)
            card_layout.addWidget(self._detection_label)
            note = QLabel(
                "The option is available when the Microsoft stable `code` CLI "
                f"reports version {SUPPORTED_VSCODE_RANGE_COPY}. If Nexus is "
                "already installed, the control offers a replace with this "
                "installer's copy."
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
        self._apply_replace_label(detected.path)

    def _apply_replace_label(self, cli_path: str | None) -> None:
        if not cli_path:
            self._checkbox.setText(_INSTALL_LABEL)
            return
        try:
            ext_id, _warning = self._list_fn(cli_path)
        except Exception:
            ext_id = None
        self._checkbox.setText(_REPLACE_LABEL if ext_id else _INSTALL_LABEL)

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
        self._checkbox.setVisible(True)


__all__ = [
    "VSCODE_CLI_CANDIDATES",
    "VsCodeExtensionPage",
    "detect_vscode_cli",
]

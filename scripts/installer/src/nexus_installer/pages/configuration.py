"""Configuration page: toggles for components and optional settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    BG_CARD,
    BORDER,
    FS_CAPTION,
    SUCCESS,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.pages.vscode_extension import VsCodeExtensionPage
from nexus_installer.video_enhancement_support import INSTALLER_NOTE

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


class ConfigurationPage(QWidget):
    """Page for configuring installation components and options."""

    def __init__(
        self,
        state: InstallerState,
        parent: QWidget | None = None,
        *,
        detect_fn=None,
        inspect_fn=None,
        list_fn=None,
    ) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        title = QLabel("Configuration")
        title.setObjectName("pageTitle")
        layout.addWidget(title)

        # Component toggles
        components_label = QLabel("Components")
        components_label.setObjectName("sectionHead")
        layout.addWidget(components_label)

        self._ollama_toggle = QCheckBox("Install Ollama")
        self._ollama_toggle.setChecked("ollama" in state.components_to_install)
        if state.ollama_installed:
            self._ollama_toggle.setChecked(True)
            self._ollama_toggle.setEnabled(False)
        self._ollama_toggle.stateChanged.connect(
            lambda s: self._toggle_component("ollama", s)
        )
        layout.addWidget(self._ollama_toggle)

        self._venv_toggle = QCheckBox("Create Python virtual environment")
        self._venv_toggle.setChecked("venv" in state.components_to_install)
        self._venv_toggle.stateChanged.connect(
            lambda s: self._toggle_component("venv", s)
        )
        layout.addWidget(self._venv_toggle)

        # v1.8.0 Phase 2 -- the desktop app ships default-checked, like the
        # extension choice.
        self._desktop_toggle = QCheckBox("Install the Nexus desktop app (recommended)")
        self._desktop_toggle.setChecked("desktop" in state.components_to_install)
        self._desktop_toggle.stateChanged.connect(
            lambda s: self._toggle_component("desktop", s)
        )
        layout.addWidget(self._desktop_toggle)

        self._shortcut_toggle = QCheckBox("Add Start Menu / Applications shortcut")
        self._shortcut_toggle.setChecked(True)
        layout.addWidget(self._shortcut_toggle)

        # Feature toggles
        features_label = QLabel("Features")
        features_label.setObjectName("sectionHead")
        layout.addWidget(features_label)

        self._thinking_toggle = QCheckBox(
            "Enable thinking mode (show the model's step-by-step reasoning)"
        )
        self._thinking_toggle.setChecked(state.enable_thinking)
        self._thinking_toggle.stateChanged.connect(
            lambda s: setattr(state, "enable_thinking", bool(s))
        )
        layout.addWidget(self._thinking_toggle)

        self._memory_toggle = QCheckBox(
            "Enable persistent memory (remember context across sessions)"
        )
        self._memory_toggle.setChecked(state.enable_memory)
        self._memory_toggle.stateChanged.connect(
            lambda s: setattr(state, "enable_memory", bool(s))
        )
        layout.addWidget(self._memory_toggle)

        unsloth_row = QWidget()
        unsloth_row.setStyleSheet("background: transparent;")
        unsloth_layout = QHBoxLayout(unsloth_row)
        unsloth_layout.setContentsMargins(0, 0, 0, 0)
        unsloth_layout.setSpacing(8)

        self._unsloth = QCheckBox(
            "Install Unsloth Core (optional local QLoRA fine-tuning runtime "
            "for Nexus, not the VS Code extension)"
        )
        self._unsloth.setChecked(bool(state.install_unsloth))
        self._unsloth.setStyleSheet("background: transparent;")
        self._unsloth.stateChanged.connect(self._on_unsloth)
        unsloth_layout.addWidget(self._unsloth, 1)

        self._unsloth_badge = QLabel("")
        self._unsloth_badge.setObjectName("unsloth-compat-badge")
        unsloth_layout.addWidget(self._unsloth_badge)
        layout.addWidget(unsloth_row)

        self._unsloth_help = QLabel(
            "For NVIDIA GPUs with 16 GB or more VRAM. unsloth is Apache-2.0; "
            "unsloth-zoo is LGPL-3.0-or-later and is dynamically linked. "
            "Off by default."
        )
        self._unsloth_help.setWordWrap(True)
        self._unsloth_help.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            "background: transparent;"
        )
        layout.addWidget(self._unsloth_help)

        self._unsloth_warning = QLabel("")
        self._unsloth_warning.setWordWrap(True)
        self._unsloth_warning.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            "background: transparent;"
        )
        self._unsloth_warning.setVisible(False)
        layout.addWidget(self._unsloth_warning)
        self._refresh_unsloth_badge()
        self._refresh_unsloth_warning()

        # Ollama URL
        url_label = QLabel("Ollama URL")
        url_label.setObjectName("sectionHead")
        layout.addWidget(url_label)

        self._url_input = QLineEdit(state.ollama_url)
        self._url_input.textChanged.connect(lambda t: setattr(state, "ollama_url", t))
        layout.addWidget(self._url_input)

        # Extension settings preview
        settings_label = QLabel("VS Code Extension Settings")
        settings_label.setObjectName("sectionHead")
        layout.addWidget(settings_label)

        self._vscode = VsCodeExtensionPage(
            state,
            detect_fn=detect_fn,
            inspect_fn=inspect_fn,
            list_fn=list_fn,
            compact=True,
        )
        layout.addWidget(self._vscode)

        model_name = state.selected_model or state.recommended_model or "gemma4:e4b"
        settings_preview = QLabel(
            f"\u2022 Model: {model_name}<br>"
            f"\u2022 Temperature: 1.0<br>"
            f"\u2022 Top-P: 0.95<br>"
            f"\u2022 Top-K: 64"
        )
        settings_preview.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 12px;"
        )
        layout.addWidget(settings_preview)

        video_label = QLabel("Optional video enhancement")
        video_label.setObjectName("sectionHead")
        layout.addWidget(video_label)

        self._video2x_note = QLabel(INSTALLER_NOTE)
        self._video2x_note.setWordWrap(True)
        self._video2x_note.setObjectName("video2xOptionalNote")
        self._video2x_note.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 12px;"
        )
        layout.addWidget(self._video2x_note)

        layout.addStretch()

    def set_interactive(self, enabled: bool) -> None:
        self._vscode.set_interactive(enabled)

    def _unsloth_host_ok(self) -> bool:
        vendor = (self._state.gpu_vendor or "").lower()
        vram_gb = max(0, int(self._state.vram_mb or 0) // 1024)
        return vendor == "nvidia" and vram_gb >= 16

    def _refresh_unsloth_badge(self) -> None:
        if self._unsloth_host_ok():
            self._unsloth_badge.setText("Compatible")
            self._unsloth_badge.setStyleSheet(
                f"color: {SUCCESS}; font-size: {FS_CAPTION}px; font-weight: 600; "
                "background: transparent;"
            )
            return
        self._unsloth_badge.setText("Incompatible")
        self._unsloth_badge.setStyleSheet(
            f"color: {WARNING}; font-size: {FS_CAPTION}px; font-weight: 600; "
            "background: transparent;"
        )

    def _on_unsloth(self, state_value: int) -> None:
        self._state.install_unsloth = self._unsloth.isChecked()
        self._refresh_unsloth_warning()

    def _refresh_unsloth_warning(self) -> None:
        if not self._unsloth.isChecked():
            self._unsloth_warning.clear()
            self._unsloth_warning.setVisible(False)
            return
        if not self._unsloth_host_ok():
            self._unsloth_warning.setText(
                "This host does not look like NVIDIA with 16 GB or more VRAM. "
                "You can still tick this; the provisioner will record a skip "
                "instead of rolling back the rest of the install."
            )
            self._unsloth_warning.setVisible(True)
            return
        self._unsloth_warning.clear()
        self._unsloth_warning.setVisible(False)

    def _toggle_component(self, component: str, state_value: int) -> None:
        if state_value:
            if component not in self._state.components_to_install:
                self._state.components_to_install.append(component)
        else:
            if component in self._state.components_to_install:
                self._state.components_to_install.remove(component)

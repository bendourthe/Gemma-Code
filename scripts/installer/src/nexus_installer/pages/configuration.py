"""Configuration page: toggles for components and optional settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtWidgets import (
    QCheckBox,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    BG_CARD,
    BORDER,
    FS_CAPTION,
    TEXT_SECONDARY,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


class ConfigurationPage(QWidget):
    """Page for configuring installation components and options."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
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

        layout.addStretch()

    def _toggle_component(self, component: str, state_value: int) -> None:
        if state_value:
            if component not in self._state.components_to_install:
                self._state.components_to_install.append(component)
        else:
            if component in self._state.components_to_install:
                self._state.components_to_install.remove(component)

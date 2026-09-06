"""Configuration page: toggles for components and optional settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QCheckBox,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    FS_CAPTION,
    SUCCESS,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.engine.model_router import (
    default_catalog_path,
    load_catalog_index,
)
from nexus_installer.engine.required_components import apply_required_components
from nexus_installer.pages.vscode_extension import VsCodeExtensionPage
from nexus_installer.vram_display import display_vram_gb

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

_NARROW_COLUMNS_PX = 560


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
        self._catalog_entry_cache: dict | None = None
        self._narrow_columns = False
        self._user_touched_unsloth = False

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        title = QLabel("Configuration")
        title.setObjectName("pageTitle")
        layout.addWidget(title)

        self._components_col = QWidget()
        self._components_col.setObjectName("config-components-column")
        self._components_col.setStyleSheet("background: transparent;")
        components_layout = QVBoxLayout(self._components_col)
        components_layout.setContentsMargins(0, 0, 0, 0)
        components_layout.setSpacing(8)

        components_label = QLabel("Components")
        components_label.setObjectName("sectionHead")
        components_layout.addWidget(components_label)

        # v2.4.7 Phase 2.2 (T007): Ollama, the Python environment, and the
        # desktop app are DERIVED from the model selection, not asked. Making
        # them checkboxes let a user silently break a model they had chosen
        # two steps earlier, with no warning anywhere in the wizard.
        self._required_list = QLabel()
        self._required_list.setObjectName("config-required-components")
        self._required_list.setWordWrap(True)
        self._required_list.setTextFormat(Qt.TextFormat.RichText)
        components_layout.addWidget(self._required_list)

        self._shortcut_toggle = QCheckBox("Add Start Menu / Applications shortcut")
        self._shortcut_toggle.setChecked(True)
        components_layout.addWidget(self._shortcut_toggle)

        # v2.4.7 Phase 3.2 (T012): the Ollama URL belongs with the thing it
        # configures, at column width, with no separate heading.
        self._ollama_url = QLineEdit(state.ollama_url)
        self._ollama_url.setObjectName("config-ollama-url")
        self._ollama_url.setAccessibleName("Ollama URL")
        self._ollama_url.setPlaceholderText("Ollama URL (http://localhost:11434)")
        self._ollama_url.textChanged.connect(
            lambda text: setattr(state, "ollama_url", text.strip())
        )
        components_layout.addWidget(self._ollama_url)

        components_layout.addStretch()

        self._features_col = QWidget()
        self._features_col.setObjectName("config-features-column")
        self._features_col.setStyleSheet("background: transparent;")
        features_layout = QVBoxLayout(self._features_col)
        features_layout.setContentsMargins(0, 0, 0, 0)
        features_layout.setSpacing(8)

        features_label = QLabel("Features")
        features_label.setObjectName("sectionHead")
        features_layout.addWidget(features_label)

        self._vscode = VsCodeExtensionPage(
            state,
            detect_fn=detect_fn,
            inspect_fn=inspect_fn,
            list_fn=list_fn,
            compact=True,
        )
        features_layout.addWidget(self._vscode)

        # v2.4.7 Phase 2.3 (T008): "Enable thinking mode" and "Enable
        # persistent memory" were removed. They set `state.enable_thinking` and
        # `state.enable_memory`, gate no install step, and are changeable in
        # Settings afterwards -- runtime preferences asked at the worst
        # possible moment. Their state fields, defaults, and config writer are
        # untouched, so first-run behavior is unchanged.
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
        features_layout.addWidget(unsloth_row)

        self._unsloth_help = QLabel("")
        self._unsloth_help.setWordWrap(True)
        self._unsloth_help.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            "background: transparent;"
        )
        features_layout.addWidget(self._unsloth_help)

        self._unsloth_warning = QLabel("")
        self._unsloth_warning.setWordWrap(True)
        self._unsloth_warning.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            "background: transparent;"
        )
        self._unsloth_warning.setVisible(False)
        features_layout.addWidget(self._unsloth_warning)
        features_layout.addStretch()
        self._apply_unsloth_host_lock()

        self._split = QGridLayout()
        self._split.setContentsMargins(0, 0, 0, 0)
        self._split.setHorizontalSpacing(24)
        self._split.setVerticalSpacing(12)
        self._split.addWidget(self._components_col, 0, 0)
        self._split.addWidget(self._features_col, 0, 1)
        self._split.setColumnStretch(0, 1)
        self._split.setColumnStretch(1, 1)

        split_host = QWidget()
        split_host.setObjectName("config-split-host")
        split_host.setStyleSheet("background: transparent;")
        split_host.setLayout(self._split)
        layout.addWidget(split_host)

        # v2.4.7 Phase 3.2 (T012): the page-width Ollama URL row is gone. The
        # field now lives in the components column directly under Ollama, at
        # column width. `_url_input` stays as an alias so any caller that
        # reaches for it by name keeps working.
        self._url_input = self._ollama_url

        layout.addStretch()

    def refresh_required_components(self) -> None:
        """Render the components this selection requires, with their reasons."""
        resolved = apply_required_components(self._state, self._catalog_entries())
        rows = "".join(
            f'<div style="margin-bottom:6px;">'
            f'<span style="color:{SUCCESS};">✓</span> {item.label}'
            f'<br><span style="color:{TEXT_SECONDARY};font-size:{FS_CAPTION}px;">'
            f"{item.reason}</span></div>"
            for item in resolved.items
        )
        self._required_list.setText(rows)
        # Ollama's URL only matters when Ollama is part of the install.
        self._ollama_url.setVisible(resolved.requires("ollama"))

    def _catalog_entries(self) -> dict:
        if self._catalog_entry_cache is None:
            self._catalog_entry_cache = load_catalog_index(default_catalog_path())
        return self._catalog_entry_cache

    def set_interactive(self, enabled: bool) -> None:
        self._vscode.set_interactive(enabled)

    def showEvent(self, event: object) -> None:  # noqa: N802
        """Refresh Unsloth and the derived component list on show.

        The model picker precedes this page, so the selection is only known by
        the time the page is shown -- computing the required list in __init__
        would render it against an empty selection.
        """
        super().showEvent(event)  # type: ignore[arg-type]
        self._apply_unsloth_host_lock()
        self.refresh_required_components()

    def resizeEvent(self, event: object) -> None:  # noqa: N802
        super().resizeEvent(event)  # type: ignore[arg-type]
        width = event.size().width() if hasattr(event, "size") else self.width()
        self._restack_columns(width < _NARROW_COLUMNS_PX)

    def _restack_columns(self, narrow: bool) -> None:
        if narrow == self._narrow_columns:
            return
        self._narrow_columns = narrow
        self._split.removeWidget(self._features_col)
        if narrow:
            self._split.addWidget(self._features_col, 1, 0)
            self._split.setColumnStretch(1, 0)
            return
        self._split.addWidget(self._features_col, 0, 1)
        self._split.setColumnStretch(1, 1)

    def _unsloth_host_ok(self) -> bool:
        vendor = (self._state.gpu_vendor or "").lower()
        shown_gb = display_vram_gb(int(self._state.vram_mb or 0))
        return vendor == "nvidia" and shown_gb >= 16

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

    def _unsloth_help_text(self, *, compatible: bool) -> str:
        base = (
            "For NVIDIA GPUs with 16 GB or more VRAM. unsloth is Apache-2.0; "
            "unsloth-zoo is LGPL-3.0-or-later and is dynamically linked."
        )
        if compatible:
            return base
        return f"{base} Off by default."

    def _apply_unsloth_host_lock(self) -> None:
        self._refresh_unsloth_badge()
        ok = self._unsloth_host_ok()
        self._unsloth.setEnabled(ok)
        self._unsloth_help.setText(self._unsloth_help_text(compatible=ok))
        if not ok:
            self._unsloth.blockSignals(True)
            self._unsloth.setChecked(False)
            self._unsloth.blockSignals(False)
            self._state.install_unsloth = False
            self._unsloth_warning.clear()
            self._unsloth_warning.setVisible(False)
            return
        if not self._user_touched_unsloth:
            self._unsloth.blockSignals(True)
            self._unsloth.setChecked(True)
            self._unsloth.blockSignals(False)
            self._state.install_unsloth = True
        self._refresh_unsloth_warning()

    def _on_unsloth(self, state_value: int) -> None:
        if not self._unsloth_host_ok():
            self._unsloth.blockSignals(True)
            self._unsloth.setChecked(False)
            self._unsloth.blockSignals(False)
            self._state.install_unsloth = False
            self._unsloth_warning.clear()
            self._unsloth_warning.setVisible(False)
            return
        self._user_touched_unsloth = True
        self._state.install_unsloth = self._unsloth.isChecked()
        self._refresh_unsloth_warning()

    def _refresh_unsloth_warning(self) -> None:
        self._unsloth_warning.clear()
        self._unsloth_warning.setVisible(False)

    def _toggle_component(self, component: str, state_value: int) -> None:
        if state_value:
            if component not in self._state.components_to_install:
                self._state.components_to_install.append(component)
        else:
            if component in self._state.components_to_install:
                self._state.components_to_install.remove(component)

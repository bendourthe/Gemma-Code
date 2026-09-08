"""Configuration panel: install path, Ollama URL, and optional features.

Hosted on the Welcome page under the prerequisites (it used to be a step of
its own). Two surface cards side by side, stacked when narrow: "Install path"
(the path field with Browse, the disk line, and the Ollama URL) and
"Features" (Start Menu shortcut, Desktop shortcut, the VS Code extension, and
the optional Unsloth Core runtime).

The components a selection requires (Ollama, Python environment, desktop app)
are resolved on the Review page, right before the engine reads them, because
the model selection is made after this panel is shown.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QCheckBox,
    QFrame,
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
from nexus_installer.pages.install_path import InstallPathPage
from nexus_installer.pages.vscode_extension import VsCodeExtensionPage
from nexus_installer.vram_display import display_vram_gb

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

_NARROW_COLUMNS_PX = 560
_CARD_MARGINS = (16, 14, 16, 16)


def _surface_card(column: QWidget) -> QFrame:
    """Wrap a column in the shared rounded surface-card frame."""
    card = QFrame()
    card.setObjectName("surfaceCard")
    card_layout = QVBoxLayout(card)
    card_layout.setContentsMargins(*_CARD_MARGINS)
    card_layout.setSpacing(0)
    card_layout.addWidget(column)
    return card


class ConfigurationPage(QWidget):
    """Panel for the install path, Ollama URL, and optional features."""

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
        self._narrow_columns = False
        self._user_touched_unsloth = False

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        # -- Install path card ------------------------------------------------
        self._setup_col = QWidget()
        self._setup_col.setObjectName("config-setup-column")
        self._setup_col.setStyleSheet("background: transparent;")
        setup_layout = QVBoxLayout(self._setup_col)
        setup_layout.setContentsMargins(0, 0, 0, 0)
        setup_layout.setSpacing(10)

        self._path = InstallPathPage(state)
        setup_layout.addWidget(self._path)

        ollama_caption = QLabel("Ollama URL")
        ollama_caption.setObjectName("cardCaption")
        setup_layout.addWidget(ollama_caption)
        self._ollama_url = QLineEdit(state.ollama_url)
        self._ollama_url.setObjectName("config-ollama-url")
        self._ollama_url.setAccessibleName("Ollama URL")
        self._ollama_url.setPlaceholderText("http://localhost:11434")
        self._ollama_url.textChanged.connect(
            lambda text: setattr(state, "ollama_url", text.strip())
        )
        setup_layout.addWidget(self._ollama_url)

        setup_layout.addStretch()
        self._setup_card = _surface_card(self._setup_col)

        # -- Features card ----------------------------------------------------
        self._features_col = QWidget()
        self._features_col.setObjectName("config-features-column")
        self._features_col.setStyleSheet("background: transparent;")
        features_layout = QVBoxLayout(self._features_col)
        features_layout.setContentsMargins(0, 0, 0, 0)
        features_layout.setSpacing(10)

        features_label = QLabel("Features")
        features_label.setObjectName("cardHead")
        features_layout.addWidget(features_label)

        self._shortcut_toggle = QCheckBox("Add Start Menu / Applications shortcut")
        self._shortcut_toggle.setChecked(bool(state.add_start_menu_shortcut))
        self._shortcut_toggle.toggled.connect(
            lambda checked: setattr(state, "add_start_menu_shortcut", bool(checked))
        )
        features_layout.addWidget(self._shortcut_toggle)

        self._desktop_shortcut_toggle = QCheckBox("Add a Desktop shortcut")
        self._desktop_shortcut_toggle.setChecked(bool(state.add_desktop_shortcut))
        self._desktop_shortcut_toggle.toggled.connect(
            lambda checked: setattr(state, "add_desktop_shortcut", bool(checked))
        )
        features_layout.addWidget(self._desktop_shortcut_toggle)

        self._vscode = VsCodeExtensionPage(
            state,
            detect_fn=detect_fn,
            inspect_fn=inspect_fn,
            list_fn=list_fn,
            compact=True,
        )
        features_layout.addWidget(self._vscode)

        unsloth_row = QWidget()
        unsloth_row.setStyleSheet("background: transparent;")
        unsloth_layout = QHBoxLayout(unsloth_row)
        unsloth_layout.setContentsMargins(0, 0, 0, 0)
        unsloth_layout.setSpacing(8)

        self._unsloth = QCheckBox(
            "(optional) Install Unsloth Core "
            "(local QLoRA fine-tuning runtime for Nexus)"
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
        self._features_card = _surface_card(self._features_col)
        self._apply_unsloth_host_lock()

        # -- Two cards, stacked when narrow -----------------------------------
        self._split = QGridLayout()
        self._split.setContentsMargins(0, 0, 0, 0)
        self._split.setHorizontalSpacing(16)
        self._split.setVerticalSpacing(12)
        self._split.addWidget(
            self._setup_card, 0, 0, alignment=Qt.AlignmentFlag.AlignTop
        )
        self._split.addWidget(
            self._features_card, 0, 1, alignment=Qt.AlignmentFlag.AlignTop
        )
        self._split.setColumnStretch(0, 1)
        self._split.setColumnStretch(1, 1)

        split_host = QWidget()
        split_host.setObjectName("config-split-host")
        split_host.setStyleSheet("background: transparent;")
        split_host.setLayout(self._split)
        layout.addWidget(split_host)

        # `_url_input` stays as an alias so any caller that reaches for it by
        # name keeps working.
        self._url_input = self._ollama_url

    def refresh_host(self) -> None:
        """Re-evaluate host-dependent locks (called after GPU detection)."""
        self._apply_unsloth_host_lock()

    def set_interactive(self, enabled: bool) -> None:
        """Lock the choices once installation has started."""
        self._vscode.set_interactive(enabled)
        self._path.set_interactive(enabled)
        self._ollama_url.setEnabled(enabled)
        self._shortcut_toggle.setEnabled(enabled)
        self._desktop_shortcut_toggle.setEnabled(enabled)
        self._unsloth.setEnabled(enabled and self._unsloth_host_ok())

    def validate(self) -> tuple[bool, str]:
        """Next requires a usable install path."""
        return self._path.validate()

    def showEvent(self, event: object) -> None:  # noqa: N802
        super().showEvent(event)  # type: ignore[arg-type]
        self._apply_unsloth_host_lock()

    def resizeEvent(self, event: object) -> None:  # noqa: N802
        super().resizeEvent(event)  # type: ignore[arg-type]
        width = event.size().width() if hasattr(event, "size") else self.width()
        self._restack_columns(width < _NARROW_COLUMNS_PX)

    def _restack_columns(self, narrow: bool) -> None:
        if narrow == self._narrow_columns:
            return
        self._narrow_columns = narrow
        self._split.removeWidget(self._features_card)
        if narrow:
            self._split.addWidget(
                self._features_card, 1, 0, alignment=Qt.AlignmentFlag.AlignTop
            )
            self._split.setColumnStretch(1, 0)
            return
        self._split.addWidget(
            self._features_card, 0, 1, alignment=Qt.AlignmentFlag.AlignTop
        )
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

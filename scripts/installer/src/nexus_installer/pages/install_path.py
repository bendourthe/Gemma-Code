"""Install path page: choose install directory with disk space display."""

from __future__ import annotations

import os
import shutil
from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QFileDialog,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ERROR,
    FS_CAPTION,
    FS_H3,
    SUCCESS,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.widgets.callout_box import CalloutBox
from nexus_installer.widgets.secondary_button import SecondaryButton

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


#: Gap between the typed text and the overlaid Browse button.
_BROWSE_GAP_PX = 8


class InstallPathPage(QWidget):
    """Page for choosing the installation directory."""

    def __init__(
        self,
        state: InstallerState,
        parent: QWidget | None = None,
        *,
        compact: bool = False,
    ) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8 if compact else 16)

        title = QLabel("Install Path" if compact else "Install Location")
        if compact:
            title.setStyleSheet(
                f"font-size: {FS_H3}px; font-weight: 600; background: transparent;"
            )
        else:
            title.setObjectName("pageTitle")
        layout.addWidget(title)

        # v2.4.7 Phase 3.1 (T011): one full-width control that reads as a path
        # field with an action, rather than a narrowed field beside a button.
        # Browse is an overlaid child so the field keeps the whole row and the
        # button still takes focus and clicks.
        self._path_input = QLineEdit(state.install_path)
        self._path_input.setObjectName("install-path-input")
        self._path_input.textChanged.connect(self._on_path_changed)

        self._browse_btn = SecondaryButton("Browse...")
        self._browse_btn.setObjectName("install-path-browse")
        self._browse_btn.setParent(self._path_input)
        self._browse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._browse_btn.clicked.connect(self._browse)
        # Keep typed text clear of the button.
        self._path_input.setTextMargins(
            0, 0, self._browse_btn.sizeHint().width() + _BROWSE_GAP_PX, 0
        )
        layout.addWidget(self._path_input)

        # Disk space display
        self._disk_label = QLabel("")
        self._disk_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        layout.addWidget(self._disk_label)

        # Error label
        self._error_label = QLabel("")
        self._error_label.setObjectName("errorLabel")
        self._error_label.setVisible(False)
        layout.addWidget(self._error_label)

        # Info callout
        callout = CalloutBox(
            title="What gets installed where",
            body=(
                "\u2022 VS Code extension: added to your VS Code<br>"
                "\u2022 Ollama: installed system-wide (the local model runtime)<br>"
                "\u2022 Python tools: in a self-contained folder inside "
                "your install path<br>"
                "\u2022 Nexus models: downloaded to Ollama's model folder"
            ),
        )
        layout.addWidget(callout)

        if not compact:
            layout.addStretch()

        self._update_disk_display()

    def _browse(self) -> None:
        path = QFileDialog.getExistingDirectory(
            self, "Select Install Directory", self._path_input.text()
        )
        if path:
            self._path_input.setText(path)

    def resizeEvent(self, event: object) -> None:  # noqa: N802
        """Keep the overlaid Browse button pinned to the field's right edge."""
        super().resizeEvent(event)  # type: ignore[arg-type]
        self._position_browse()

    def showEvent(self, event: object) -> None:  # noqa: N802
        super().showEvent(event)  # type: ignore[arg-type]
        self._position_browse()

    def _position_browse(self) -> None:
        field = self._path_input
        button = self._browse_btn
        width = button.sizeHint().width()
        height = max(1, field.height() - 8)
        button.setFixedHeight(height)
        button.move(max(0, field.width() - width - 4), 4)

    def _on_path_changed(self, text: str) -> None:
        self._state.install_path = text
        self._update_disk_display()

    def _update_disk_display(self) -> None:
        path = self._state.install_path
        try:
            target = (
                path if os.path.exists(path) else os.path.splitdrive(path)[0] or "/"
            )
            usage = shutil.disk_usage(target)
            gb_free = round(usage.free / (1024**3), 1)
        except OSError:
            gb_free = 0.0
            self._state.apply_disk_free_bytes(0)
        else:
            self._state.apply_disk_free_bytes(int(usage.free))

        if gb_free >= 10.0:
            color = SUCCESS
        elif gb_free >= 5.0:
            color = WARNING
        else:
            color = ERROR
        self._disk_label.setStyleSheet(
            f"color: {color}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        self._disk_label.setText(f"{gb_free} GB available on selected drive")

    def validate(self) -> tuple[bool, str]:
        path = self._state.install_path
        if not path:
            return False, "Install path cannot be empty."
        # Check if parent directory is writable
        parent = os.path.dirname(path) if not os.path.exists(path) else path
        if parent and os.path.exists(parent) and not os.access(parent, os.W_OK):
            self._error_label.setText("Selected path is not writable.")
            self._error_label.setVisible(True)
            return False, "Selected path is not writable."
        self._error_label.setVisible(False)
        return True, ""

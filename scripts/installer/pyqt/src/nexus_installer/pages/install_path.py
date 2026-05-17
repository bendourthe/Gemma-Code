"""Install path page: choose install directory with disk space display."""

from __future__ import annotations

import os
import shutil
from typing import TYPE_CHECKING

from PyQt5.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import ERROR, SUCCESS, TEXT_SECONDARY, WARNING
from nexus_installer.widgets.callout_box import CalloutBox
from nexus_installer.widgets.secondary_button import SecondaryButton

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


class InstallPathPage(QWidget):
    """Page for choosing the installation directory."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        title = QLabel("Install Location")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        # Path input row
        path_row = QHBoxLayout()
        self._path_input = QLineEdit(state.install_path)
        self._path_input.textChanged.connect(self._on_path_changed)
        path_row.addWidget(self._path_input, stretch=1)

        browse_btn = SecondaryButton("Browse...")
        browse_btn.clicked.connect(self._browse)
        path_row.addWidget(browse_btn)
        layout.addLayout(path_row)

        # Disk space display
        self._disk_label = QLabel("")
        self._disk_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
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
                "\u2022 VS Code extension: installed via <code>code --install-extension</code><br>"
                "\u2022 Ollama: system-wide (platform package manager)<br>"
                "\u2022 Python venv: <code>&lt;install_path&gt;/venv/</code><br>"
                "\u2022 Gemma model: stored by Ollama in its default model directory"
            ),
        )
        layout.addWidget(callout)

        layout.addStretch()

        self._update_disk_display()

    def _browse(self) -> None:
        path = QFileDialog.getExistingDirectory(
            self, "Select Install Directory", self._path_input.text()
        )
        if path:
            self._path_input.setText(path)

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

        self._state.disk_space_gb = gb_free

        if gb_free >= 10.0:
            color = SUCCESS
        elif gb_free >= 5.0:
            color = WARNING
        else:
            color = ERROR
        self._disk_label.setStyleSheet(
            f"color: {color}; font-size: 12px; background: transparent;"
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

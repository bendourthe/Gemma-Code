"""Installing page: progress bar, real-time log, and cancel button."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QProgressBar,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.engine.installer import InstallEngine, start_install
from nexus_installer.widgets.log_panel import LogPanel
from nexus_installer.widgets.secondary_button import SecondaryButton

if TYPE_CHECKING:
    from nexus_installer.engine.installer import _InstallThread
    from nexus_installer.installer_state import InstallerState


class InstallingPage(QWidget):
    """Page showing installation progress with log panel."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state
        self._thread: _InstallThread | None = None
        self._engine: InstallEngine | None = None
        self._is_running = False

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        self._title = QLabel("Installing...")
        self._title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._title)

        # Progress bar
        self._progress = QProgressBar()
        self._progress.setMinimum(0)
        self._progress.setMaximum(0)  # Indeterminate
        self._progress.setTextVisible(False)
        layout.addWidget(self._progress)

        # Log panel
        self._log = LogPanel()
        self._log.setMinimumHeight(300)
        layout.addWidget(self._log, stretch=1)

        # Cancel button
        btn_row = QHBoxLayout()
        btn_row.addStretch()
        self._cancel_btn = SecondaryButton("Cancel")
        self._cancel_btn.clicked.connect(self._on_cancel)
        btn_row.addWidget(self._cancel_btn)
        layout.addLayout(btn_row)

    @property
    def is_running(self) -> bool:
        return self._is_running

    def start_installation(self) -> None:
        """Begin the installation process. Called when this page becomes active."""
        if self._is_running:
            return

        self._is_running = True
        self._title.setText("Installing...")
        self._progress.setMaximum(0)  # Indeterminate
        self._cancel_btn.setEnabled(True)

        self._engine = InstallEngine()
        self._engine.log_message.connect(self._on_log)
        self._engine.progress_update.connect(self._on_progress)
        self._engine.install_finished.connect(self._on_finished)

        self._thread = start_install(self._engine, self._state)

    def _on_log(self, message: str, level: str) -> None:
        self._log.append_log(message, level)

    def _on_progress(self, value: float) -> None:
        if self._progress.maximum() == 0:
            self._progress.setMaximum(1000)
        self._progress.setValue(int(value * 1000))

    def _on_finished(self, success: bool, error_message: str) -> None:
        self._is_running = False
        self._cancel_btn.setEnabled(False)
        self._progress.setMaximum(1000)
        self._progress.setValue(1000)

        if success:
            self._title.setText("Installation Complete")
        else:
            self._title.setText("Installation Completed with Warnings")

    def _on_cancel(self) -> None:
        reply = QMessageBox.question(
            self,
            "Cancel Installation",
            "Cancel installation? Components already installed will remain.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes and self._engine:
            self._engine.cancel()
            self._is_running = False
            self._title.setText("Installation Cancelled")
            self._cancel_btn.setEnabled(False)

    def validate(self) -> tuple[bool, str]:
        """Block navigation forward until installation is complete."""
        if self._is_running:
            return False, "Installation is still in progress."
        return True, ""

    def get_log_text(self) -> str:
        """Return the full installation log."""
        return self._log.get_full_log()

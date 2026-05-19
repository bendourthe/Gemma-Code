"""Complete page: services status, management commands, and launch buttons."""

from __future__ import annotations

import subprocess
import sys
from typing import TYPE_CHECKING

from PyQt5.QtGui import QGuiApplication
from PyQt5.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BG_INPUT,
    BORDER,
    FONT_MONO,
    SUCCESS,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.widgets.callout_box import CalloutBox
from nexus_installer.widgets.primary_button import PrimaryButton
from nexus_installer.widgets.secondary_button import SecondaryButton

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


class _CommandRow(QWidget):
    """Monospace command with a copy-to-clipboard button."""

    def __init__(self, label: str, command: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._command = command

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 4, 0, 4)
        layout.setSpacing(8)

        desc = QLabel(label)
        desc.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
        )
        desc.setFixedWidth(180)
        layout.addWidget(desc)

        code_label = QLabel(command)
        code_label.setStyleSheet(
            f"font-family: '{FONT_MONO}'; font-size: 10pt; "
            f"color: {ACCENT}; background-color: {BG_INPUT}; "
            f"padding: 4px 8px; border-radius: 4px;"
        )
        layout.addWidget(code_label, stretch=1)

        copy_btn = SecondaryButton("Copy")
        copy_btn.setFixedWidth(60)
        copy_btn.clicked.connect(self._copy)
        layout.addWidget(copy_btn)

    def _copy(self) -> None:
        clipboard = QGuiApplication.clipboard()
        if clipboard:
            clipboard.setText(self._command)


class CompletePage(QWidget):
    """Final wizard page showing results and next steps."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        # Title (updated dynamically on show)
        self._title = QLabel("Installation Complete")
        self._title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._title)

        self._subtitle = QLabel("Gemma Code is installed and ready to use.")
        self._subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 13px; background: transparent;"
        )
        layout.addWidget(self._subtitle)

        # Failure warning (hidden by default)
        self._warning_callout = CalloutBox(title="Some steps encountered issues")
        self._warning_callout.setVisible(False)
        layout.addWidget(self._warning_callout)

        # Running Services card
        services_label = QLabel("Running Services")
        services_label.setStyleSheet(
            "font-size: 14px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(services_label)

        self._services_card = QWidget()
        self._services_card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 12px;"
        )
        self._services_layout = QVBoxLayout(self._services_card)
        layout.addWidget(self._services_card)

        # Managing Gemma Code card
        manage_label = QLabel("Managing Gemma Code")
        manage_label.setStyleSheet(
            "font-size: 14px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(manage_label)

        manage_card = QWidget()
        manage_card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 12px;"
        )
        manage_layout = QVBoxLayout(manage_card)
        manage_layout.addWidget(_CommandRow("Start Ollama", "ollama serve"))
        manage_layout.addWidget(
            _CommandRow("Pull a different model", "ollama pull gemma4:26b")
        )
        manage_layout.addWidget(_CommandRow("Check model status", "ollama list"))
        manage_layout.addWidget(
            _CommandRow(
                "Uninstall extension",
                "code --uninstall-extension nexus-coding.nexus-coding",
            )
        )
        layout.addWidget(manage_card)

        # Action buttons
        btn_row = QHBoxLayout()
        self._open_vscode_btn = PrimaryButton("Open VS Code")
        self._open_vscode_btn.clicked.connect(self._open_vscode)
        btn_row.addWidget(self._open_vscode_btn)

        self._save_log_btn = SecondaryButton("View Installation Log")
        self._save_log_btn.clicked.connect(self._save_log)
        btn_row.addWidget(self._save_log_btn)

        btn_row.addStretch()
        layout.addLayout(btn_row)

        layout.addStretch()

    def showEvent(self, event: object) -> None:  # noqa: N802
        super().showEvent(event)  # type: ignore[arg-type]
        self._refresh()

    def _refresh(self) -> None:
        state = self._state

        # Update title based on failures
        if state.failed_steps:
            self._title.setText("Installation Completed with Warnings")
            self._subtitle.setStyleSheet(
                f"color: {WARNING}; font-size: 13px; background: transparent;"
            )
            self._subtitle.setText(
                "Some components could not be installed. See details below."
            )
            failure_text = "<br>".join(f"\u2022 {step}" for step in state.failed_steps)
            self._warning_callout.set_body(failure_text)
            self._warning_callout.setVisible(True)
        else:
            self._title.setText("Installation Complete")
            self._warning_callout.setVisible(False)

        # Rebuild services list
        while self._services_layout.count():
            item = self._services_layout.takeAt(0)
            if item and item.widget():
                item.widget().deleteLater()

        self._add_service("Ollama", state.ollama_url, state.ollama_installed)
        self._add_service(
            "Python backend", "http://localhost:11435", bool(state.python_path)
        )
        ext_installed = "extension" not in state.failed_steps
        self._add_service(
            "VS Code extension",
            "nexus-coding.nexus-coding (installed)" if ext_installed else "Not installed",
            ext_installed,
        )

    def _add_service(self, name: str, detail: str, ok: bool) -> None:
        row = QHBoxLayout()
        name_label = QLabel(name)
        name_label.setStyleSheet(
            "font-size: 13px; font-weight: bold; background: transparent;"
        )
        name_label.setFixedWidth(160)
        row.addWidget(name_label)

        detail_label = QLabel(detail)
        color = SUCCESS if ok else WARNING
        detail_label.setStyleSheet(
            f"color: {color}; font-size: 12px; background: transparent;"
        )
        row.addWidget(detail_label, stretch=1)

        container = QWidget()
        container.setLayout(row)
        self._services_layout.addWidget(container)

    def _open_vscode(self) -> None:
        try:
            if sys.platform == "win32":
                vscode = self._state.vscode_path or "code"
                subprocess.Popen(["cmd", "/c", "start", "", vscode])
            elif sys.platform == "darwin":
                subprocess.Popen(["open", "-a", "Visual Studio Code"])
            else:
                subprocess.Popen(["code"])
        except OSError:
            pass

    def _save_log(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Save Installation Log",
            "gemma-code-install.log",
            "Text Files (*.log *.txt)",
        )
        if path:
            log_text = "\n".join(self._state.install_log)
            with open(path, "w", encoding="utf-8") as f:
                f.write(log_text)

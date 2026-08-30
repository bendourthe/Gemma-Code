"""Complete page: services status, management commands, and launch buttons."""

from __future__ import annotations

import contextlib
import subprocess
import sys
from typing import TYPE_CHECKING

from PyQt5.QtCore import pyqtSignal
from PyQt5.QtGui import QGuiApplication
from PyQt5.QtWidgets import (
    QCheckBox,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.background import paths as bg_paths
from nexus_installer.background import state_store
from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BG_INPUT,
    BORDER,
    FONT_MONO,
    FS_BODY,
    FS_CAPTION,
    SUCCESS,
    TEXT_BODY,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.engine.install_summary import summarize_install
from nexus_installer.engine.model_router import (
    default_catalog_path,
    load_catalog_index,
)
from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.video_enhancement_support import INSTALLER_NOTE
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
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        desc.setFixedWidth(180)
        layout.addWidget(desc)

        code_label = QLabel(command)
        code_label.setStyleSheet(
            f"font-family: '{FONT_MONO}'; font-size: {FS_BODY}px; "
            f"color: {ACCENT}; background-color: {BG_INPUT}; "
            f"padding: 4px 8px; border-radius: 4px;"
        )
        layout.addWidget(code_label, stretch=1)

        copy_btn = SecondaryButton("Copy")
        copy_btn.setFixedWidth(60)
        # v2.2.3 Phase 7 (7.3): shrink the Copy rows via a LOCAL override on
        # this page's own buttons only -- the 38px min-height comes from the
        # global QPushButton#secondaryButton rule (theme.py, fed by
        # BUTTON_HEIGHT), which must stay untouched so Open VS Code / Finish
        # keep their full height.
        copy_btn.setStyleSheet(
            "QPushButton#secondaryButton { min-height: 24px; padding: 0 8px; }"
        )
        copy_btn.clicked.connect(self._copy)
        layout.addWidget(copy_btn)

    def _copy(self) -> None:
        clipboard = QGuiApplication.clipboard()
        if clipboard:
            clipboard.setText(self._command)


class CompletePage(QWidget):
    """Final wizard page showing results and next steps."""

    #: Emitted when the user clicks "Retry failed downloads" (v1.15.0 Phase 3).
    retry_requested = pyqtSignal()

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        # v2.2.3 Phase 7 (7.3): compact layout so the page fits without
        # scrolling (spacing 16 -> 8, card padding 12 -> 6).
        layout = QVBoxLayout(self)
        layout.setSpacing(8)

        # Title (updated dynamically on show)
        self._title = QLabel("Installation Complete")
        self._title.setObjectName("pageTitle")
        layout.addWidget(self._title)

        self._subtitle = QLabel("Nexus is installed and ready to use.")
        self._subtitle.setStyleSheet(
            f"color: {TEXT_BODY}; font-size: {FS_BODY}px; background: transparent;"
        )
        layout.addWidget(self._subtitle)

        self._video2x_note = QLabel(INSTALLER_NOTE)
        self._video2x_note.setWordWrap(True)
        self._video2x_note.setObjectName("video2xOptionalNote")
        self._video2x_note.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        layout.addWidget(self._video2x_note)

        # Failure warning (hidden by default)
        self._warning_callout = CalloutBox(title="Some steps encountered issues")
        self._warning_callout.setStyleSheet(
            "QFrame#calloutBox { background: #2a2112; "
            f"border-left: 3px solid {WARNING}; "
            "border-radius: 6px; }}"
        )
        self._warning_callout.setVisible(False)
        layout.addWidget(self._warning_callout)

        # Running Services card
        services_label = QLabel("Running Services")
        services_label.setObjectName("sectionHead")
        layout.addWidget(services_label)

        self._services_card = QWidget()
        self._services_card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 6px;"
        )
        self._services_layout = QVBoxLayout(self._services_card)
        layout.addWidget(self._services_card)

        # Managing Nexus card
        manage_label = QLabel("Managing Nexus")
        manage_label.setObjectName("sectionHead")
        layout.addWidget(manage_label)

        manage_card = QWidget()
        manage_card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 6px;"
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

        # v1.8.0 Phase 2 -- launch the desktop app when the wizard finishes.
        self._launch_checkbox = QCheckBox("Launch Nexus when I click Finish")
        self._launch_checkbox.setChecked(state.launch_desktop_on_finish)
        self._launch_checkbox.stateChanged.connect(
            lambda _s: setattr(
                state, "launch_desktop_on_finish", self._launch_checkbox.isChecked()
            )
        )
        layout.addWidget(self._launch_checkbox)

        # Action buttons
        btn_row = QHBoxLayout()
        self._open_vscode_btn = PrimaryButton("Open VS Code")
        self._open_vscode_btn.clicked.connect(self._open_vscode)
        btn_row.addWidget(self._open_vscode_btn)

        self._save_log_btn = SecondaryButton("View Installation Log")
        self._save_log_btn.clicked.connect(self._save_log)
        btn_row.addWidget(self._save_log_btn)

        # v1.15.0 Phase 3 (Issue 2): retry just the failed downloads. Hidden
        # unless the summary reports retryable failures (a gated skip is not
        # retryable -- it needs a token, not another attempt).
        self._retry_btn = SecondaryButton("Retry failed downloads")
        self._retry_btn.setObjectName("retryFailedButton")
        self._retry_btn.clicked.connect(self.retry_requested.emit)
        self._retry_btn.setVisible(False)
        btn_row.addWidget(self._retry_btn)

        btn_row.addStretch()
        layout.addLayout(btn_row)

        layout.addStretch()

    def showEvent(self, event: object) -> None:  # noqa: N802
        super().showEvent(event)  # type: ignore[arg-type]
        self._refresh()

    def _refresh(self) -> None:
        state = self._state

        # v1.15.0 Phase 3 (Issue 2): plain-language per-model outcome summary.
        # Failed downloads get a human reason (not a raw "Error: 400"); gated
        # declines read as "skipped - needs token", distinct from a failure.
        catalog = load_catalog_index(default_catalog_path())
        summary = summarize_install(state, catalog)
        engine_failure = next(
            (f for f in state.step_failures if f.get("step") == "engine"),
            None,
        )
        non_model_failures = [
            s for s in state.failed_steps if s not in ("model", "engine")
        ]
        optional_failures = [
            failure
            for failure in state.step_failures
            if failure.get("step") in state.optional_failed_steps
        ]

        callout_lines = [
            f"\u2022 {outcome.display_name}: {outcome.reason}"
            for outcome in summary.failed
        ]
        callout_lines += [
            f"\u2022 Optional model skipped - {outcome.display_name}: {outcome.reason}"
            for outcome in summary.skipped
        ]
        if engine_failure:
            callout_lines.append(
                f"\u2022 {engine_failure.get('summary', 'The installer stopped.')}"
            )
            suggestion = str(engine_failure.get("suggestion") or "")
            if suggestion:
                callout_lines.append(f"\u2022 {suggestion}")
        elif "engine" in state.failed_steps:
            callout_lines.append(
                "\u2022 The installer hit an unexpected error and stopped."
            )
        callout_lines += [
            f"\u2022 The {step} step did not complete." for step in non_model_failures
        ]
        callout_lines += [
            f"\u2022 {failure.get('summary', 'An optional component is not ready.')}"
            for failure in optional_failures
        ]

        has_failure = bool(
            summary.failed
            or non_model_failures
            or optional_failures
            or engine_failure
            or "engine" in state.failed_steps
        )
        if engine_failure or "engine" in state.failed_steps:
            self._title.setText("Installation Stopped")
            self._subtitle.setStyleSheet(
                f"color: {WARNING}; font-size: {FS_BODY}px; background: transparent;"
            )
            self._subtitle.setText(
                "The installer hit an unexpected error. See details below."
            )
        elif has_failure:
            self._title.setText("Installation Completed with Warnings")
            self._subtitle.setStyleSheet(
                f"color: {WARNING}; font-size: {FS_BODY}px; background: transparent;"
            )
            self._subtitle.setText(
                "Some components could not be installed. See details below."
            )
        else:
            self._title.setText("Installation Complete")

        self._warning_callout.setVisible(bool(callout_lines))
        if callout_lines:
            self._warning_callout.set_body("<br>".join(callout_lines))

        # Only failed downloads are retryable; a gated skip needs a token.
        self._retry_btn.setVisible(bool(summary.retryable_ids))

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
            "nexus-coding.nexus-coding (installed)"
            if ext_installed
            else "Not installed",
            ext_installed,
        )
        if state.desktop_installed:
            # v2.2.0 Phase 1 (1.4): surface the sidecar verdict, not just a
            # binary pass/fail -- "health check passed" used to mean only
            # "the window opened".
            detail_suffix = (
                f" -- {state.desktop_health_detail}"
                if getattr(state, "desktop_health_detail", "")
                else ""
            )
            desktop_detail = (
                f"Installed (health check passed{detail_suffix})"
                if state.desktop_health_ok
                else (
                    "Installed (health check FAILED"
                    f"{detail_suffix}) -- the app backend cannot start"
                )
            )
        else:
            desktop_detail = "Not installed"
        self._add_service(
            "Nexus Desktop",
            desktop_detail,
            state.desktop_installed and state.desktop_health_ok,
        )

        # Launching only makes sense when the desktop app actually landed.
        self._launch_checkbox.setEnabled(state.desktop_installed)
        if not state.desktop_installed:
            self._launch_checkbox.setChecked(False)

    def _add_service(self, name: str, detail: str, ok: bool) -> None:
        row = QHBoxLayout()
        # v2.2.3 Phase 7 (7.3): drop the default 11px QHBoxLayout margins so
        # the service rows pack tightly inside the compact card.
        row.setContentsMargins(0, 0, 0, 0)
        name_label = QLabel(name)
        name_label.setStyleSheet(
            f"font-size: {FS_BODY}px; font-weight: bold; background: transparent;"
        )
        # 160px clipped "VS Code extension"; 200px fits every service name.
        name_label.setFixedWidth(200)
        row.addWidget(name_label)

        detail_label = QLabel(detail)
        color = SUCCESS if ok else WARNING
        detail_label.setStyleSheet(
            f"color: {color}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        row.addWidget(detail_label, stretch=1)

        container = QWidget()
        container.setLayout(row)
        self._services_layout.addWidget(container)

    def on_finish(self) -> None:
        """Called by the window when Finish is clicked on this page."""
        # Acknowledge the run: drop the persisted install-state so a later cold
        # launch starts at Welcome instead of reopening this outcome view
        # (v1.15.0 Phase 2 / Issue 1).
        state_store.clear_state(bg_paths.state_file())
        state = self._state
        if not (
            state.launch_desktop_on_finish
            and state.desktop_installed
            and state.desktop_exe_path
        ):
            return
        with contextlib.suppress(OSError):
            subprocess.Popen([state.desktop_exe_path])

    def _open_vscode(self) -> None:
        try:
            if sys.platform == "win32":
                vscode = self._state.vscode_path or "code"
                # no_window_kwargs hides the transient cmd console that
                # otherwise flashes while `start` hands off to the GUI app.
                subprocess.Popen(
                    ["cmd", "/c", "start", "", vscode], **no_window_kwargs()
                )
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
            "nexus-install.log",
            "Text Files (*.log *.txt)",
        )
        if path:
            log_text = "\n".join(self._state.install_log)
            with open(path, "w", encoding="utf-8") as f:
                f.write(log_text)

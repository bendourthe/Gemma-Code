"""Installing page: overall progress, per-phase groups, and cancel button.

v1.8.0 Phase 5 (T502): the single progress bar + one big log becomes a
grouped view -- an overall bar on top, then one labeled `PhaseGroup` per
install phase (Dependencies -> VS Code Extension -> Models -> Nexus
Desktop), each with its own progress bar and collapsible log. Engine steps
map onto groups via `PHASE_GROUPS`; log lines route to whichever group's
step is active.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QProgressBar,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    FS_CAPTION,
    TEXT_SECONDARY,
)
from nexus_installer.engine.gated_auth import ensure_gated_auth
from nexus_installer.engine.installer import InstallEngine, start_install
from nexus_installer.engine.model_router import (
    default_catalog_path,
    load_catalog_index,
    resolve_selected_models,
)
from nexus_installer.widgets.gated_auth_dialog import run_gated_prompt
from nexus_installer.widgets.phase_group import PhaseGroup
from nexus_installer.widgets.secondary_button import SecondaryButton

if TYPE_CHECKING:
    from nexus_installer.engine.installer import _InstallThread
    from nexus_installer.engine.model_router import ModelProgress
    from nexus_installer.installer_state import InstallerState

# Phase title -> (engine step names it covers, in engine order; section icon
# glyph for the mockup's iconed header tile). v1.13.0 Phase 5 adds the icon.
PHASE_GROUPS: tuple[tuple[str, tuple[str, ...], str], ...] = (
    ("Dependencies", ("ollama", "venv"), "⚙"),  # gear
    ("VS Code Extension", ("extension",), "</>"),  # code brackets
    ("Models", ("model",), "◆"),  # diamond
    ("Nexus Desktop", ("desktop",), "▭"),  # screen / monitor
)


class InstallingPage(QWidget):
    """Page showing per-phase installation progress with grouped logs."""

    # v1.11.0 Phase 6 (T602): the shell listens for these to lock the choice
    # pages and free the sidebar for review without disturbing the install.
    started = pyqtSignal()
    finished = pyqtSignal(bool)

    def __init__(
        self,
        state: InstallerState,
        parent: QWidget | None = None,
        *,
        on_engine_created: Callable[[InstallEngine], None] | None = None,
    ) -> None:
        super().__init__(parent)
        self._state = state
        # v1.11.0 Phase 7 (T701/T702): the GUI entry point passes a hook here to
        # attach the state recorder + tray to the engine the instant it is
        # created, so background continuation observes the same signal surface.
        self._on_engine_created = on_engine_created
        self._thread: _InstallThread | None = None
        self._engine: InstallEngine | None = None
        self._is_running = False
        # Guards against a re-run: revisiting the page via the sidebar after the
        # install has started (or finished) must not restart the engine.
        self._has_started = False
        self._groups: list[PhaseGroup] = []
        self._active_group: PhaseGroup | None = None
        self._log_lines: list[str] = []

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        self._title = QLabel("Installing...")
        self._title.setObjectName("pageTitle")
        layout.addWidget(self._title)

        # Overall progress bar on top
        overall_label = QLabel("Overall progress")
        overall_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        layout.addWidget(overall_label)

        self._progress = QProgressBar()
        self._progress.setMinimum(0)
        self._progress.setMaximum(0)  # Indeterminate
        self._progress.setTextVisible(False)
        layout.addWidget(self._progress)

        # Per-phase groups
        self._groups_layout = QVBoxLayout()
        self._groups_layout.setSpacing(8)
        layout.addLayout(self._groups_layout)
        self._build_groups()

        layout.addStretch(1)

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

    @property
    def phase_groups(self) -> list[PhaseGroup]:
        return list(self._groups)

    def _build_groups(self) -> None:
        """(Re)create one PhaseGroup per phase with selected components."""
        while self._groups_layout.count():
            item = self._groups_layout.takeAt(0)
            widget = item.widget() if item else None
            if widget is not None:
                widget.deleteLater()
        self._groups = []
        self._active_group = None

        components = self._state.components_to_install
        for title, steps, icon in PHASE_GROUPS:
            covered = [s for s in steps if s in components]
            if not covered:
                continue
            group = PhaseGroup(title, covered, icon=icon)
            self._groups_layout.addWidget(group)
            self._groups.append(group)

    def _group_for(self, step: str) -> PhaseGroup | None:
        for group in self._groups:
            if group.covers(step):
                return group
        return None

    def start_installation(self) -> None:
        """Begin the installation process. Called when this page becomes active."""
        # Idempotent: a re-entry while running -- or any re-entry after the
        # install has already started (e.g. sidebar review, T602) -- is a no-op.
        if self._is_running or self._has_started:
            return

        self._has_started = True
        self._is_running = True
        self._title.setText("Installing...")
        self._progress.setMaximum(0)  # Indeterminate
        self._cancel_btn.setEnabled(True)
        self._log_lines = []
        # v1.14.0 Phase 2: resolve auth for any gated model BEFORE the engine
        # reads the selection, so a declined one leaves the queue (never fails
        # mid-download) and a discovered token covers the rest with no prompt.
        self._resolve_gated_auth()
        # The configuration page may have toggled components since __init__.
        self._build_groups()

        self._engine = InstallEngine()
        self._engine.log_message.connect(self._on_log)
        self._engine.progress_update.connect(self._on_progress)
        self._engine.step_started.connect(self._on_step_started)
        self._engine.step_progress.connect(self._on_step_progress)
        self._engine.step_completed.connect(self._on_step_completed)
        self._engine.step_failed.connect(self._on_step_failed)
        self._engine.install_finished.connect(self._on_finished)
        # v1.11.0 Phase 5 (T502): per-model telemetry rows.
        self._engine.model_started.connect(self._on_model_started)
        self._engine.model_progress.connect(self._on_model_progress)
        self._engine.model_completed.connect(self._on_model_completed)
        self._engine.model_failed.connect(self._on_model_failed)

        # v1.11.0 Phase 7: let the entry point attach persistence + tray to the
        # live engine before the thread starts (so no early events are missed).
        if self._on_engine_created is not None:
            self._on_engine_created(self._engine)

        # Pre-create one 'Waiting to start' row per selected model so the
        # user sees the whole download plan up front (the mockup's layout).
        models_group = self._group_for("model")
        if models_group is not None:
            for model_id in resolve_selected_models(self._state):
                models_group.ensure_model_row(model_id)

        self._thread = start_install(self._engine, self._state)
        self.started.emit()

    def _resolve_gated_auth(self) -> None:
        """Guided HF-auth pass for selected gated models (v1.14.0 Phase 2).

        No-op when nothing gated is selected or a token is already available;
        otherwise shows the guided dialog once per gated model, unlocking the
        queue with a valid token or removing declined models from it.
        """
        catalog = load_catalog_index(default_catalog_path())
        if not catalog:
            return
        ensure_gated_auth(
            self._state,
            catalog,
            lambda entry: run_gated_prompt(entry, self),
        )

    def _on_step_started(self, name: str) -> None:
        group = self._group_for(name)
        if group is not None:
            group.mark_started(name)
            self._active_group = group

    def _on_step_progress(self, name: str, fraction: float) -> None:
        group = self._group_for(name)
        if group is not None:
            group.set_step_progress(name, fraction)

    def _on_step_completed(self, name: str) -> None:
        group = self._group_for(name)
        if group is not None:
            group.mark_step_done(name)

    def _on_step_failed(self, name: str) -> None:
        group = self._group_for(name)
        if group is None:
            return
        group.mark_step_failed(name)
        # T505: surface the T303 plain-language reason + suggested action
        # right in the group (the installers record it before failing).
        for failure in reversed(self._state.step_failures):
            if failure.get("step") == name:
                group.show_failure_reason(
                    failure.get("summary", ""), failure.get("suggestion", "")
                )
                break

    # -- per-model telemetry (T502) ---------------------------------------

    def _models_group(self) -> PhaseGroup | None:
        return self._group_for("model")

    def _on_model_started(self, model_id: str) -> None:
        group = self._models_group()
        if group is not None:
            group.set_model_progress(model_id, 0.0)

    def _on_model_progress(self, sample: ModelProgress) -> None:
        group = self._models_group()
        if group is not None:
            group.set_model_progress(
                sample.model_id,
                sample.fraction,
                sample.bytes_done,
                sample.bytes_total,
                sample.speed_bps,
                sample.eta_s,
            )

    def _on_model_completed(self, model_id: str) -> None:
        group = self._models_group()
        if group is not None:
            group.set_model_done(model_id)

    def _on_model_failed(self, model_id: str, reason: str) -> None:
        group = self._models_group()
        if group is not None:
            group.set_model_failed(model_id, reason)

    def _on_log(self, message: str, level: str) -> None:
        self._log_lines.append(message)
        target = self._active_group
        if target is None and self._groups:
            target = self._groups[0]
        if target is not None:
            target.append_log(message, level)

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

        self.finished.emit(success)

    def _on_cancel(self) -> None:
        reply = QMessageBox.question(
            self,
            "Cancel Installation",
            "Cancel installation? Components already installed will remain.",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply == QMessageBox.StandardButton.Yes:
            self.cancel_install()

    def cancel_install(self) -> None:
        """Cancel the running install without prompting (T702).

        The Cancel button confirms first via :meth:`_on_cancel`; the window's
        close-during-install "Cancel install" choice is itself the confirmation,
        so it calls this directly.
        """
        if not self._is_running:
            return
        if self._engine:
            self._engine.cancel()
        self._is_running = False
        self._title.setText("Installation Cancelled")
        self._cancel_btn.setEnabled(False)
        # Release the shell lock so navigation is usable again (T602).
        self.finished.emit(False)

    def validate(self) -> tuple[bool, str]:
        """Block navigation forward until installation is complete."""
        if self._is_running:
            return False, "Installation is still in progress."
        return True, ""

    def get_log_text(self) -> str:
        """Return the full installation log."""
        return "\n".join(self._log_lines)

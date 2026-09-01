"""Live install-state persistence (v1.11.0 Phase 7, T701).

:class:`StateRecorder` is the bridge between the engine's Qt signal surface and
the on-disk :class:`~nexus_installer.background.state_store.InstallState`. It is
a plain (non-QObject) class: Qt happily connects signals to any callable, and
keeping it Qt-free means the whole persistence path is unit-testable by calling
the handlers directly and reading the state file back -- no event loop needed.

Writes are throttled for the high-frequency progress ticks (at most every
:data:`_MIN_WRITE_INTERVAL_S`) but forced on every discrete transition
(step / model start / done / fail, and finish), so a crash at any moment leaves
a state file that is at most one throttle-window stale.
"""

from __future__ import annotations

import contextlib
import os
import time
from typing import TYPE_CHECKING, Any

from nexus_installer.background import state_store
from nexus_installer.background.state_store import (
    STATUS_CANCELLED,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    STEP_DONE,
    STEP_FAILED,
    STEP_PENDING,
    STEP_RUNNING,
    InstallState,
    ModelState,
)
from nexus_installer.engine.crash import redact_crash_text

if TYPE_CHECKING:
    from nexus_installer.background.resume import ResumePlan
    from nexus_installer.engine.installer import InstallEngine
    from nexus_installer.engine.model_router import ModelProgress
    from nexus_installer.installer_state import InstallerState

#: Minimum seconds between throttled (progress-tick) writes.
_MIN_WRITE_INTERVAL_S = 0.5

#: InstallerState attributes snapshotted so a cross-process Complete view can be
#: rebuilt after a background-completed install (the process that ran it exited).
_RESULT_FIELDS = (
    "ollama_installed",
    "ollama_url",
    "python_path",
    "vscode_path",
    "desktop_installed",
    "desktop_health_ok",
    "desktop_exe_path",
    "launch_desktop_on_finish",
)


def snapshot_results(installer_state: InstallerState) -> dict[str, Any]:
    """Capture the InstallerState result flags the Complete page reads."""
    return {name: getattr(installer_state, name) for name in _RESULT_FIELDS}


def apply_state_to_installer_state(
    install_state: InstallState, installer_state: InstallerState
) -> None:
    """Restore a persisted run onto a fresh InstallerState (cross-process
    Complete / reattach view, T703). Only the fields the Complete page renders
    are restored; the wizard choices are irrelevant once installing is done."""
    for name, value in install_state.results.items():
        if hasattr(installer_state, name):
            setattr(installer_state, name, value)
    installer_state.failed_steps = list(install_state.failed_steps)
    installer_state.failed_models = list(install_state.failed_models)
    installer_state.optional_failed_steps = list(install_state.optional_failed_steps)
    installer_state.step_failures = list(install_state.step_failures)
    installer_state.step_results = list(install_state.step_results)
    if install_state.log_path:
        installer_state.install_log = state_store.read_log_lines(install_state.log_path)


def apply_resume_to_installer_state(
    install_state: InstallState,
    plan: ResumePlan,
    installer_state: InstallerState,
) -> None:
    """Prime a fresh InstallerState so a resumed run re-runs only what is left.

    Restores the run's component list + model selection from the persisted
    state and marks the already-satisfied steps as completed, which the engine
    reads (via ``completed_steps``) to skip them without re-execution (T704).
    """
    installer_state.components_to_install = list(install_state.components)
    installer_state.selected_model_ids = list(install_state.models.keys())
    installer_state.completed_steps = list(plan.completed_steps)


class StateRecorder:
    """Subscribe to an :class:`InstallEngine` and persist its progress."""

    def __init__(self, state_path: str, log_path: str) -> None:
        self._state_path = state_path
        self._log_path = log_path
        self._installer_state: InstallerState | None = None
        self.state = InstallState(log_path=log_path)
        self._last_write = 0.0
        self._cancel_requested = False

    # -- lifecycle --------------------------------------------------------

    def begin(self, installer_state: InstallerState, model_ids: list[str]) -> None:
        """Initialize a fresh 'running' state from the wizard's choices."""
        self._installer_state = installer_state
        self.state = InstallState(
            status=STATUS_RUNNING,
            pid=os.getpid(),
            components=list(installer_state.components_to_install),
            steps={
                step: STEP_PENDING for step in installer_state.components_to_install
            },
            models={mid: ModelState(model_id=mid) for mid in model_ids},
            log_path=self._log_path,
            started_at=state_store.utc_now(),
        )
        self._write(force=True)

    def attach(self, engine: InstallEngine) -> None:
        """Wire every engine signal to the matching recorder handler."""
        engine.log_message.connect(self.on_log)
        engine.progress_update.connect(self.on_progress)
        engine.step_started.connect(self.on_step_started)
        engine.step_completed.connect(self.on_step_completed)
        engine.step_failed.connect(self.on_step_failed)
        engine.install_finished.connect(self.on_finished)
        engine.model_started.connect(self.on_model_started)
        engine.model_progress.connect(self.on_model_progress)
        engine.model_completed.connect(self.on_model_completed)
        engine.model_failed.connect(self.on_model_failed)

    # -- signal handlers --------------------------------------------------

    def on_log(self, message: str, level: str) -> None:
        state_store.append_log(self._log_path, f"[{level.upper()}] {message}")

    def on_progress(self, value: float) -> None:
        self.state.overall_progress = max(0.0, min(1.0, value))
        self._write()

    def on_step_started(self, name: str) -> None:
        self.state.steps[name] = STEP_RUNNING
        self._write(force=True)

    def on_step_completed(self, name: str) -> None:
        self.state.steps[name] = STEP_DONE
        self._sync_failures()
        self._write(force=True)

    def on_step_failed(self, name: str) -> None:
        self.state.steps[name] = STEP_FAILED
        is_optional = bool(
            self._installer_state
            and name in self._installer_state.optional_failed_steps
        )
        if is_optional and name not in self.state.optional_failed_steps:
            self.state.optional_failed_steps.append(name)
        elif not is_optional and name not in self.state.failed_steps:
            self.state.failed_steps.append(name)
        self._sync_failures()
        self._write(force=True)

    def on_model_started(self, model_id: str) -> None:
        model = self.state.models.setdefault(model_id, ModelState(model_id=model_id))
        model.status = STEP_RUNNING
        self._write(force=True)

    def on_model_progress(self, sample: ModelProgress) -> None:
        model = self.state.models.setdefault(
            sample.model_id, ModelState(model_id=sample.model_id)
        )
        model.status = STEP_RUNNING
        model.fraction = float(sample.fraction)
        model.bytes_done = int(sample.bytes_done)
        model.bytes_total = int(sample.bytes_total)
        self._write()

    def on_model_completed(self, model_id: str) -> None:
        model = self.state.models.setdefault(model_id, ModelState(model_id=model_id))
        model.status = STEP_DONE
        model.fraction = 1.0
        self._write(force=True)

    def on_model_failed(self, model_id: str, reason: str) -> None:
        model = self.state.models.setdefault(model_id, ModelState(model_id=model_id))
        model.status = STEP_FAILED
        model.reason = reason
        if model_id not in self.state.failed_models:
            self.state.failed_models.append(model_id)
        self._write(force=True)

    def on_finished(self, success: bool, error_message: str) -> None:
        secret = ""
        if self._installer_state is not None:
            secret = self._installer_state.hf_token or ""
        safe_error = redact_crash_text(error_message, secret)
        if self._cancel_requested:
            self.state.status = STATUS_CANCELLED
        else:
            self.state.status = STATUS_COMPLETED if success else STATUS_FAILED
        self.state.overall_progress = 1.0
        self.state.error_message = safe_error
        self._sync_failures()
        if self._installer_state is not None:
            self.state.results = snapshot_results(self._installer_state)
        self._write(force=True)
        if safe_error:
            with contextlib.suppress(Exception):
                state_store.append_log(self._log_path, f"[ERROR] {safe_error}")

    def mark_cancelled(self) -> None:
        """Record a user-initiated cancel (T702).

        Set before/around the engine cancel so a later ``install_finished``
        (which reports ``success=False``) is recorded as cancelled, not failed,
        regardless of thread ordering.
        """
        self._cancel_requested = True
        self.state.status = STATUS_CANCELLED
        self._write(force=True)

    # -- internals --------------------------------------------------------

    def _sync_failures(self) -> None:
        """Mirror the InstallerState failure surfaces the Complete page reads."""
        if self._installer_state is None:
            return
        self.state.failed_models = list(self._installer_state.failed_models)
        self.state.step_failures = list(self._installer_state.step_failures)
        self.state.step_results = list(self._installer_state.step_results)
        self.state.optional_failed_steps = list(
            self._installer_state.optional_failed_steps
        )
        for step in self._installer_state.failed_steps:
            if step not in self.state.failed_steps:
                self.state.failed_steps.append(step)

    def _write(self, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and (now - self._last_write) < _MIN_WRITE_INTERVAL_S:
            return
        self._last_write = now
        state_store.save_state(self._state_path, self.state)

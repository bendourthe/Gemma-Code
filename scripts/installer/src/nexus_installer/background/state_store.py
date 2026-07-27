"""Persistent install-progress state (v1.11.0 Phase 7, T701).

The install engine's whole observable state -- overall progress, per-step
status, per-model telemetry, failures, and a snapshot of the result flags the
Complete page needs -- is serialized to a small JSON file so any of the Phase 7
consumers can read it back:

* the tray tooltip / reattach view (same process, T702/T703),
* a fresh relaunch after the install completed in the background (cross-process
  Complete view, T703),
* a fresh relaunch after a crash (resume-or-restart, T704).

This module is intentionally Qt-free and pure-data: :class:`InstallState` is a
dataclass with a lossless round-trip, and file IO is a couple of module
functions doing an atomic replace. The live wiring that feeds it lives in
:mod:`nexus_installer.background.recorder`.
"""

from __future__ import annotations

import contextlib
import json
import os
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

#: Result-file schema tag (mirrors the smoke-result convention).
SCHEMA = "nexus-install-state/v1"

# -- run status --------------------------------------------------------------
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"
STATUS_INTERRUPTED = "interrupted"

#: Statuses where the engine reached an end state (no live work in flight).
TERMINAL_STATUSES = frozenset(
    {STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED}
)

# -- per-step status ---------------------------------------------------------
STEP_PENDING = "pending"
STEP_RUNNING = "running"
STEP_DONE = "done"
STEP_FAILED = "failed"
STEP_SKIPPED = "skipped"

#: Step statuses that a resume can safely treat as already satisfied (T704).
DONE_STEP_STATUSES = frozenset({STEP_DONE, STEP_SKIPPED})

#: Rolling-log size cap; on overflow the head is dropped and the tail kept.
_MAX_LOG_BYTES = 2 * 1024 * 1024


def utc_now() -> str:
    """ISO-8601 UTC timestamp (module-level so tests can monkeypatch it)."""
    return datetime.now(UTC).isoformat()


@dataclass
class ModelState:
    """Per-model download telemetry, mirrored from the engine's model_* events."""

    model_id: str
    status: str = STEP_PENDING
    fraction: float = 0.0
    bytes_done: int = 0
    bytes_total: int = 0
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ModelState:
        return cls(
            model_id=str(data.get("model_id", "")),
            status=str(data.get("status", STEP_PENDING)),
            fraction=float(data.get("fraction", 0.0)),
            bytes_done=int(data.get("bytes_done", 0)),
            bytes_total=int(data.get("bytes_total", 0)),
            reason=str(data.get("reason", "")),
        )


@dataclass
class InstallState:
    """Serializable snapshot of an install run's progress and outcome."""

    schema: str = SCHEMA
    status: str = STATUS_RUNNING
    pid: int = 0
    overall_progress: float = 0.0
    components: list[str] = field(default_factory=list)
    steps: dict[str, str] = field(default_factory=dict)
    models: dict[str, ModelState] = field(default_factory=dict)
    failed_steps: list[str] = field(default_factory=list)
    failed_models: list[str] = field(default_factory=list)
    step_failures: list[dict[str, str]] = field(default_factory=list)
    #: Snapshot of the InstallerState result flags the Complete page reads back
    #: when a background-completed install is reopened in a fresh process.
    results: dict[str, Any] = field(default_factory=dict)
    log_path: str = ""
    error_message: str = ""
    started_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["models"] = {mid: ms.to_dict() for mid, ms in self.models.items()}
        return data

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> InstallState:
        models_raw = data.get("models", {}) or {}
        models = {
            str(mid): ModelState.from_dict(ms) for mid, ms in models_raw.items()
        }
        return cls(
            schema=str(data.get("schema", SCHEMA)),
            status=str(data.get("status", STATUS_RUNNING)),
            pid=int(data.get("pid", 0)),
            overall_progress=float(data.get("overall_progress", 0.0)),
            components=list(data.get("components", [])),
            steps=dict(data.get("steps", {})),
            models=models,
            failed_steps=list(data.get("failed_steps", [])),
            failed_models=list(data.get("failed_models", [])),
            step_failures=list(data.get("step_failures", [])),
            results=dict(data.get("results", {})),
            log_path=str(data.get("log_path", "")),
            error_message=str(data.get("error_message", "")),
            started_at=str(data.get("started_at", "")),
            updated_at=str(data.get("updated_at", "")),
        )

    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STATUSES


def save_state(path: str | Path, state: InstallState) -> None:
    """Write `state` atomically (temp file + os.replace) so a reader never
    observes a half-written file even if the writer is killed mid-write."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    state.updated_at = utc_now()
    payload = json.dumps(state.to_dict(), indent=2)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=".state-", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.replace(tmp_name, target)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp_name)
        raise


def load_state(path: str | Path) -> InstallState | None:
    """Load a persisted state, or None when absent / unreadable / malformed."""
    target = Path(path)
    if not target.is_file():
        return None
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    return InstallState.from_dict(data)


def clear_state(path: str | Path) -> None:
    """Delete the persisted state file if present (best-effort, never raises).

    Acknowledging a terminal run: once the user has seen the Complete (outcome)
    view, the state file must not survive to redirect future *cold* launches
    back to it. Leaving a ``completed`` file on disk is exactly what made every
    later launch reopen the Complete page (v1.11.0 Phase 7 defect fixed in
    v1.15.0 Phase 2 / Issue 1).
    """
    with contextlib.suppress(OSError):
        Path(path).unlink(missing_ok=True)


def append_log(path: str | Path, line: str) -> None:
    """Append one leveled log line to the rolling log file (size-capped)."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "a", encoding="utf-8") as handle:
        handle.write(line.rstrip("\n") + "\n")
    _roll_if_needed(target)


def read_log_lines(path: str | Path) -> list[str]:
    """Return the rolling log's lines (empty when the file is absent)."""
    target = Path(path)
    if not target.is_file():
        return []
    try:
        return target.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []


def _roll_if_needed(target: Path) -> None:
    """Keep the log bounded: on overflow, drop the head and keep the tail."""
    try:
        if target.stat().st_size <= _MAX_LOG_BYTES:
            return
        data = target.read_bytes()[-(_MAX_LOG_BYTES // 2):]
        # Start at the first full line so we never keep a truncated head line.
        newline = data.find(b"\n")
        if newline != -1:
            data = data[newline + 1:]
        target.write_bytes(data)
    except OSError:
        pass

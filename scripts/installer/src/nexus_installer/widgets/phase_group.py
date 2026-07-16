"""One labeled phase group on the installing page.

v1.11.0 Phase 5 (T501-T505) -- the progress UX v2, per operator feedback on
the v1.10 interim design:

* The phase keeps ONE main accent bar. Per-step overview rows (name + a
  visually distinct thin translucent sub-bar + status) render ONLY when the
  phase covers more than one engine step -- a single-step phase shows no
  redundant sub-bar (T501).
* The Models phase gets dynamic PER-MODEL rows driven by the engine's
  `model_*` telemetry: name, sub-bar, "X GB / Y GB (Z%) - S MB/s - ETA" and a
  state text (Waiting to start / Downloading... / Done / Failed: reason)
  (T502). The header shows a live percent indicator.
* The log area is user-resizable via a visible drag grip on its bottom edge
  (T503); rendering is monospace via the app QSS.
* The Copy button flips to a checkmark + "Copied" for ~1.5s (T504).
* A failed step auto-expands its details and shows the T303 plain-language
  summary + suggested action right above the log actions (T505).

The widget holds no engine knowledge beyond ordered step names and plain
telemetry values; the installing page routes engine signals into it.
"""

from __future__ import annotations

from collections.abc import Callable

from PyQt5.QtCore import Qt, QTimer
from PyQt5.QtGui import QMouseEvent
from PyQt5.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    BORDER,
    ERROR,
    FS_BODY,
    FS_CAPTION,
    SUCCESS,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
)
from nexus_installer.widgets.log_panel import LogPanel

# Group lifecycle states.
STATE_PENDING = "pending"
STATE_ACTIVE = "active"
STATE_DONE = "done"
STATE_FAILED = "failed"

_STATE_ICONS: dict[str, tuple[str, str]] = {
    # state -> (glyph, color); escapes keep the source ASCII-safe
    STATE_PENDING: ("\u25cb", TEXT_MUTED),  # open circle
    STATE_ACTIVE: ("\u25cf", ACCENT),  # filled circle
    STATE_DONE: ("\u2713", SUCCESS),  # checkmark
    STATE_FAILED: ("\u26a0", ERROR),  # warning sign
}

# Friendly, user-facing names for the internal engine step ids.
_STEP_LABELS: dict[str, str] = {
    "ollama": "Ollama runtime",
    "venv": "Python environment",
    "extension": "VS Code extension",
    "model": "AI models",
    "desktop": "Nexus Desktop app",
}

_ROW_STATUS: dict[str, tuple[str, str]] = {
    STATE_PENDING: ("Waiting to start", TEXT_MUTED),
    STATE_ACTIVE: ("Downloading...", ACCENT),
    STATE_DONE: ("Done", SUCCESS),
    STATE_FAILED: ("Failed", ERROR),
}

_CHEVRON_DOWN = "\u25be"
_CHEVRON_UP = "\u25b4"
_ICON_COPY = "\u29c9"
_ICON_CHECK = "\u2713"
_ICON_SAVE = "\u2913"

COPY_FEEDBACK_MS = 1500
LOG_MIN_HEIGHT = 80
LOG_MAX_HEIGHT = 480
LOG_DEFAULT_HEIGHT = 150

# Sub-bars are deliberately distinct from the phase's main accent bar:
# thinner (4px vs 8px) with a translucent accent chunk (#AARRGGBB alpha).
_SUB_BAR_STYLE = (
    "QProgressBar { background-color: rgba(255, 255, 255, 18); border: none; "
    "border-radius: 2px; min-height: 4px; max-height: 4px; }"
    f"QProgressBar::chunk {{ background-color: #7f{ACCENT.lstrip('#')}; "
    "border-radius: 2px; }"
)


def format_size_progress(bytes_done: int, bytes_total: int, fraction: float) -> str:
    """`5.0 GB / 6.9 GB (72%)` -- or a bare percent when sizes are unknown."""
    pct = int(round(min(max(fraction, 0.0), 1.0) * 100))
    if bytes_total <= 0:
        return f"{pct}%"
    return f"{_fmt_bytes(bytes_done)} / {_fmt_bytes(bytes_total)} ({pct}%)"


def _fmt_bytes(n: int) -> str:
    if n >= 2**30:
        return f"{n / 2**30:.1f} GB"
    return f"{max(n, 0) / 2**20:.0f} MB"


def format_speed(bps: float) -> str:
    """`18.4 MB/s`, or '' when the speed is not yet measurable."""
    if bps <= 0:
        return ""
    return f"{bps / 2**20:.1f} MB/s"


def format_eta(seconds: float) -> str:
    """`00:12 remaining` (h:mm:ss over an hour), or '' when unknown."""
    if seconds <= 0:
        return ""
    total = int(seconds)
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d} remaining"
    return f"{minutes:02d}:{secs:02d} remaining"


class _ProgressRow:
    """One overview row: name + thin sub-bar + detail + status text."""

    def __init__(self, label: str) -> None:
        self.widget = QWidget()
        layout = QHBoxLayout(self.widget)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(8)

        self.name = QLabel(label)
        self.name.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        self.name.setMinimumWidth(150)

        self.bar = QProgressBar()
        self.bar.setMinimum(0)
        self.bar.setMaximum(1000)
        self.bar.setValue(0)
        self.bar.setTextVisible(False)
        self.bar.setStyleSheet(_SUB_BAR_STYLE)

        self.detail = QLabel("")
        self.detail.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: {FS_CAPTION}px; background: transparent;"
        )

        self.status = QLabel("")
        self.status.setMinimumWidth(110)
        # AlignRight alone: vertical centering is the QLabel default, and the
        # PyQt5 stubs type flag unions as int, tripping strict mypy.
        self.status.setAlignment(Qt.AlignmentFlag.AlignRight)

        layout.addWidget(self.name)
        layout.addWidget(self.bar, stretch=1)
        layout.addWidget(self.detail)
        layout.addWidget(self.status)
        self.set_state(STATE_PENDING)

    def set_state(self, state: str, status_text: str | None = None) -> None:
        text, color = _ROW_STATUS[state]
        self.status.setText(status_text if status_text is not None else text)
        self.status.setStyleSheet(
            f"color: {color}; font-size: {FS_CAPTION}px; background: transparent;"
        )

    def set_fraction(self, fraction: float) -> None:
        self.bar.setValue(int(min(max(fraction, 0.0), 1.0) * 1000))


class _LogResizeGrip(QFrame):
    """Visible drag handle on the log panel's bottom edge (T503)."""

    def __init__(
        self, on_delta: Callable[[int], None], parent: QWidget | None = None
    ) -> None:
        super().__init__(parent)
        self._on_delta = on_delta
        self._drag_start_y: int | None = None
        self.setFixedHeight(10)
        self.setCursor(Qt.CursorShape.SizeVerCursor)
        self.setToolTip("Drag to resize the log area")
        grip_layout = QHBoxLayout(self)
        grip_layout.setContentsMargins(0, 2, 0, 2)
        line = QFrame()
        line.setFixedSize(48, 4)
        line.setStyleSheet(
            f"background: {BORDER}; border-radius: 2px;"
        )
        grip_layout.addStretch(1)
        grip_layout.addWidget(line)
        grip_layout.addStretch(1)

    def mousePressEvent(self, a0: QMouseEvent | None) -> None:  # noqa: N802
        if a0 is not None:
            self._drag_start_y = a0.globalY()

    def mouseMoveEvent(self, a0: QMouseEvent | None) -> None:  # noqa: N802
        if a0 is not None and self._drag_start_y is not None:
            delta = a0.globalY() - self._drag_start_y
            self._drag_start_y = a0.globalY()
            self._on_delta(delta)

    def mouseReleaseEvent(self, a0: QMouseEvent | None) -> None:  # noqa: N802
        self._drag_start_y = None


class PhaseGroup(QFrame):
    """Card: status header + main bar + collapsible details (rows, logs)."""

    def __init__(
        self,
        title: str,
        steps: list[str],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._title_text = title
        self._steps: list[str] = list(steps)
        self._fractions: dict[str, float] = {s: 0.0 for s in self._steps}
        self._failed: set[str] = set()
        self._started = False
        self._settled = False
        self._step_rows: dict[str, _ProgressRow] = {}
        self._model_rows: dict[str, _ProgressRow] = {}

        self.setObjectName("phaseGroup")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(6)

        # -- Header: icon, title, percent, status, "View Details" toggle -----
        header = QHBoxLayout()
        header.setSpacing(8)

        self._icon = QLabel()
        self._icon.setFixedWidth(16)
        header.addWidget(self._icon)

        self._title = QLabel(title)
        self._title.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-size: {FS_BODY}px; font-weight: bold; "
            f"background: transparent;"
        )
        header.addWidget(self._title, stretch=1)

        self._pct = QLabel("")
        self._pct.setStyleSheet(
            f"color: {ACCENT}; font-size: {FS_BODY}px; font-weight: bold; "
            f"background: transparent;"
        )
        header.addWidget(self._pct)

        self._status = QLabel("Waiting")
        self._status.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        header.addWidget(self._status)

        self._toggle = QPushButton(f"View Details {_CHEVRON_DOWN}")
        self._toggle.setCheckable(True)
        self._toggle.setStyleSheet(self._toggle_style())
        self._toggle.toggled.connect(self._on_toggle)
        header.addWidget(self._toggle)
        layout.addLayout(header)

        # -- Main accent bar (always visible; the phase's ONE main bar) ------
        self._bar = QProgressBar()
        self._bar.setMinimum(0)
        self._bar.setMaximum(1000)
        self._bar.setValue(0)
        self._bar.setTextVisible(False)
        layout.addWidget(self._bar)

        # -- Collapsible details ---------------------------------------------
        self._details = QWidget()
        self._details.setVisible(False)
        details_layout = QVBoxLayout(self._details)
        details_layout.setContentsMargins(0, 4, 0, 0)
        details_layout.setSpacing(6)

        # T505: plain-language failure block (hidden until a failure).
        self._failure_box = QFrame()
        self._failure_box.setVisible(False)
        self._failure_box.setStyleSheet(
            f"QFrame {{ border: 1px solid {ERROR}; border-radius: 6px; "
            "background: rgba(239, 68, 68, 16); }"
        )
        failure_layout = QVBoxLayout(self._failure_box)
        failure_layout.setContentsMargins(10, 8, 10, 8)
        failure_layout.setSpacing(2)
        self._failure_summary = QLabel("")
        self._failure_summary.setWordWrap(True)
        self._failure_summary.setStyleSheet(
            f"color: {ERROR}; font-size: {FS_CAPTION}px; font-weight: bold; "
            "border: none; background: transparent;"
        )
        self._failure_suggestion = QLabel("")
        self._failure_suggestion.setWordWrap(True)
        self._failure_suggestion.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            "border: none; background: transparent;"
        )
        failure_layout.addWidget(self._failure_summary)
        failure_layout.addWidget(self._failure_suggestion)
        details_layout.addWidget(self._failure_box)

        # T501: per-step overview rows ONLY when this phase has >1 sub-step.
        self._rows_layout = QVBoxLayout()
        self._rows_layout.setSpacing(4)
        if len(self._steps) > 1:
            for step in self._steps:
                row = _ProgressRow(_STEP_LABELS.get(step, step))
                row.set_state(STATE_PENDING, "Waiting")
                self._step_rows[step] = row
                self._rows_layout.addWidget(row.widget)
        details_layout.addLayout(self._rows_layout)

        # T502: dynamic per-model rows land here (installing page drives them).
        self._model_rows_layout = QVBoxLayout()
        self._model_rows_layout.setSpacing(4)
        details_layout.addLayout(self._model_rows_layout)

        self._logs_toggle = QPushButton(f"View Logs {_CHEVRON_DOWN}")
        self._logs_toggle.setCheckable(True)
        self._logs_toggle.setStyleSheet(self._toggle_style())
        self._logs_toggle.toggled.connect(self._on_logs_toggle)
        details_layout.addWidget(
            self._logs_toggle, alignment=Qt.AlignmentFlag.AlignLeft
        )

        # Logs pane: Copy / Save toolbar + the raw technical log + grip.
        self._logs_area = QWidget()
        self._logs_area.setVisible(False)
        logs_layout = QVBoxLayout(self._logs_area)
        logs_layout.setContentsMargins(0, 0, 0, 0)
        logs_layout.setSpacing(4)

        toolbar = QHBoxLayout()
        toolbar.addStretch(1)
        self._copy_btn = self._icon_button(_ICON_COPY, "Copy logs to clipboard")
        self._copy_btn.clicked.connect(self._on_copy_logs)
        toolbar.addWidget(self._copy_btn)
        self._save_btn = self._icon_button(_ICON_SAVE, "Save logs to a .txt file")
        self._save_btn.clicked.connect(self._on_save_logs)
        toolbar.addWidget(self._save_btn)
        logs_layout.addLayout(toolbar)

        self._log = LogPanel()
        self._log_height = LOG_DEFAULT_HEIGHT
        self._log.setFixedHeight(self._log_height)
        logs_layout.addWidget(self._log)
        logs_layout.addWidget(_LogResizeGrip(self._resize_log))
        details_layout.addWidget(self._logs_area)

        layout.addWidget(self._details)

        # T504: transient "Copied" feedback timer.
        self._copy_timer = QTimer(self)
        self._copy_timer.setSingleShot(True)
        self._copy_timer.setInterval(COPY_FEEDBACK_MS)
        self._copy_timer.timeout.connect(self._reset_copy_button)

        self._apply_state(STATE_PENDING)

    # -----------------------------------------------------------------
    # Construction helpers
    # -----------------------------------------------------------------

    @staticmethod
    def _toggle_style() -> str:
        return (
            f"QPushButton {{ background: transparent; color: {TEXT_SECONDARY}; "
            f"border: 1px solid {BORDER}; border-radius: 4px; "
            f"font-size: {FS_CAPTION}px; padding: 2px 8px; }}"
            f"QPushButton:checked {{ color: {TEXT_PRIMARY}; "
            f"border-color: {ACCENT}; }}"
        )

    def _icon_button(self, glyph: str, tooltip: str) -> QPushButton:
        btn = QPushButton(glyph)
        btn.setToolTip(tooltip)
        btn.setFixedHeight(24)
        btn.setMinimumWidth(28)
        btn.setStyleSheet(
            f"QPushButton {{ background: transparent; color: {TEXT_SECONDARY}; "
            f"border: 1px solid {BORDER}; border-radius: 4px; font-size: 13px; "
            "padding: 0 6px; }"
            f"QPushButton:hover {{ color: {TEXT_PRIMARY}; border-color: {ACCENT}; }}"
        )
        return btn

    # -----------------------------------------------------------------
    # State transitions (driven by the installing page)
    # -----------------------------------------------------------------

    @property
    def steps(self) -> list[str]:
        return list(self._steps)

    @property
    def state(self) -> str:
        return self._state

    @property
    def progress(self) -> float:
        """Aggregate 0.0-1.0 progress across this group's steps."""
        if not self._steps:
            return 0.0
        return sum(self._fractions.values()) / len(self._steps)

    def covers(self, step: str) -> bool:
        return step in self._fractions

    def mark_started(self, step: str) -> None:
        if not self.covers(step):
            return
        self._started = True
        if step in self._step_rows:
            self._step_rows[step].set_state(STATE_ACTIVE, "Installing...")
        if not self._settled:
            self._apply_state(STATE_ACTIVE)

    def set_step_progress(self, step: str, fraction: float) -> None:
        if not self.covers(step):
            return
        clamped = max(0.0, min(1.0, fraction))
        self._fractions[step] = clamped
        if step in self._step_rows:
            self._step_rows[step].set_fraction(clamped)
        self._refresh_bar()

    def mark_step_done(self, step: str) -> None:
        if not self.covers(step):
            return
        self._fractions[step] = 1.0
        if step in self._step_rows:
            self._step_rows[step].set_fraction(1.0)
            self._step_rows[step].set_state(STATE_DONE)
        self._refresh_bar()
        self._maybe_settle()

    def mark_step_failed(self, step: str) -> None:
        if not self.covers(step):
            return
        self._fractions[step] = 1.0
        self._failed.add(step)
        if step in self._step_rows:
            self._step_rows[step].set_fraction(1.0)
            self._step_rows[step].set_state(STATE_FAILED)
        self._refresh_bar()
        self._maybe_settle()

    # -----------------------------------------------------------------
    # Per-model rows (T502; the installing page drives these)
    # -----------------------------------------------------------------

    def ensure_model_row(self, model_id: str) -> None:
        """Create the row for `model_id` in the 'Waiting to start' state."""
        if model_id in self._model_rows:
            return
        row = _ProgressRow(model_id)
        self._model_rows[model_id] = row
        self._model_rows_layout.addWidget(row.widget)

    def set_model_progress(
        self,
        model_id: str,
        fraction: float,
        bytes_done: int = 0,
        bytes_total: int = 0,
        speed_bps: float = 0.0,
        eta_s: float = 0.0,
    ) -> None:
        self.ensure_model_row(model_id)
        row = self._model_rows[model_id]
        row.set_fraction(fraction)
        row.set_state(STATE_ACTIVE, "Downloading...")
        parts = [format_size_progress(bytes_done, bytes_total, fraction)]
        speed = format_speed(speed_bps)
        if speed:
            parts.append(speed)
        eta = format_eta(eta_s)
        if eta:
            parts.append(eta)
        row.detail.setText(" \u2022 ".join(parts))

    def set_model_done(self, model_id: str) -> None:
        self.ensure_model_row(model_id)
        row = self._model_rows[model_id]
        row.set_fraction(1.0)
        row.set_state(STATE_DONE)

    def set_model_failed(self, model_id: str, reason: str) -> None:
        self.ensure_model_row(model_id)
        row = self._model_rows[model_id]
        row.set_fraction(1.0)
        row.set_state(STATE_FAILED, f"Failed: {reason}"[:80])
        # A failing model must be visible without digging (T505).
        if not self._toggle.isChecked():
            self._toggle.setChecked(True)

    def model_row_ids(self) -> list[str]:
        return list(self._model_rows)

    # -----------------------------------------------------------------
    # Failure surfacing (T505)
    # -----------------------------------------------------------------

    def show_failure_reason(self, summary: str, suggestion: str) -> None:
        """Show the plain-language failure block and expand the details."""
        self._failure_summary.setText(summary)
        self._failure_suggestion.setText(suggestion)
        self._failure_box.setVisible(True)
        if not self._toggle.isChecked():
            self._toggle.setChecked(True)

    @property
    def failure_visible(self) -> bool:
        return not self._failure_box.isHidden()

    # -----------------------------------------------------------------
    # Logs
    # -----------------------------------------------------------------

    def append_log(self, text: str, level: str = "info") -> None:
        self._log.append_log(text, level)

    def log_text(self) -> str:
        return self._log.get_full_log()

    @property
    def details_visible(self) -> bool:
        """Whether the collapsible detail pane is expanded."""
        return not self._details.isHidden()

    @property
    def log_visible(self) -> bool:
        # isHidden() (not isVisible()) so the answer holds before the page
        # itself is shown: isVisible() is False for any child of an unshown
        # window regardless of the toggle state.
        return not self._logs_area.isHidden()

    @property
    def log_height(self) -> int:
        return self._log_height

    # -----------------------------------------------------------------
    # Internals
    # -----------------------------------------------------------------

    def _on_toggle(self, checked: bool) -> None:
        self._details.setVisible(checked)
        self._toggle.setText(
            f"{'Hide' if checked else 'View'} Details "
            f"{_CHEVRON_UP if checked else _CHEVRON_DOWN}"
        )

    def _on_logs_toggle(self, checked: bool) -> None:
        self._logs_area.setVisible(checked)
        self._logs_toggle.setText(
            f"{'Hide' if checked else 'View'} Logs "
            f"{_CHEVRON_UP if checked else _CHEVRON_DOWN}"
        )

    def _resize_log(self, delta: int) -> None:
        """Grow/shrink the log panel, clamped to sane bounds (T503)."""
        self._log_height = max(
            LOG_MIN_HEIGHT, min(LOG_MAX_HEIGHT, self._log_height + delta)
        )
        self._log.setFixedHeight(self._log_height)

    def _on_copy_logs(self) -> None:
        clipboard = QApplication.clipboard()
        if clipboard is not None:
            clipboard.setText(self._log.get_full_log())
        # T504: standard clipboard UX -- checkmark + "Copied", then revert.
        self._copy_btn.setText(f"{_ICON_CHECK} Copied")
        self._copy_timer.start()

    def _reset_copy_button(self) -> None:
        self._copy_btn.setText(_ICON_COPY)

    def _on_save_logs(self) -> None:
        slug = self._title_text.lower().replace(" ", "-")
        default_name = f"nexus-install-{slug}-log.txt"
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Log", default_name, "Text Files (*.txt);;All Files (*)"
        )
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(self._log.get_full_log())
        except OSError as exc:  # surface the failure into the log itself
            self._log.append_log(f"Could not save log to {path}: {exc}", "error")

    def _refresh_bar(self) -> None:
        value = self.progress
        self._bar.setValue(int(value * 1000))
        if self._state == STATE_ACTIVE and 0.0 < value < 1.0:
            self._pct.setText(f"{int(value * 100)}%")
        else:
            self._pct.setText("")

    def _maybe_settle(self) -> None:
        """Settle to done/failed once every covered step has finished."""
        if any(f < 1.0 for f in self._fractions.values()):
            return
        self._settled = True
        self._apply_state(STATE_FAILED if self._failed else STATE_DONE)

    def _apply_state(self, state: str) -> None:
        self._state = state
        glyph, color = _STATE_ICONS[state]
        self._icon.setText(glyph)
        self._icon.setStyleSheet(
            f"color: {color}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        status_text = {
            STATE_PENDING: "Waiting",
            STATE_ACTIVE: "Installing...",
            STATE_DONE: "Done",
            STATE_FAILED: "Completed with issues",
        }[state]
        status_color = {
            STATE_PENDING: TEXT_MUTED,
            STATE_ACTIVE: ACCENT,
            STATE_DONE: SUCCESS,
            STATE_FAILED: ERROR,
        }[state]
        self._status.setText(status_text)
        self._status.setStyleSheet(
            f"color: {status_color}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        self._refresh_bar()
        # A failed phase auto-expands its details so the user immediately sees
        # which step failed and can reach its log.
        if state == STATE_FAILED and not self._toggle.isChecked():
            self._toggle.setChecked(True)


__all__ = [
    "STATE_ACTIVE",
    "STATE_DONE",
    "STATE_FAILED",
    "STATE_PENDING",
    "PhaseGroup",
    "format_eta",
    "format_size_progress",
    "format_speed",
]

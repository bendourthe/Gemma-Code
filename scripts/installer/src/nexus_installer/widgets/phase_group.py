"""v1.8.0 Phase 5 -- one labeled phase group on the installing page.

A group covers one or more engine steps (e.g. "Dependencies" = ollama + venv)
and renders a status header, an aggregate progress bar, and a collapsible
"View Details" pane. The detail pane shows a per-step overview (one small
progress bar + status per covered step) and a "View Logs" section holding that
group's raw technical log with Copy / Save-to-file actions -- so a failed step
tells the user what happened and hands them a log for troubleshooting instead
of dumping raw output inline. The detail pane is a vertical splitter, so the
overview / log split is user-resizable.

v2.x redesign: the old inline raw-log-behind-"Details" is replaced by the
overview + on-demand "View Logs"; the public API (covers / mark_* /
set_step_progress / append_log / log_text / state / progress) is unchanged so
the installing page and engine routing are untouched.
"""

from __future__ import annotations

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QApplication,
    QFileDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QProgressBar,
    QPushButton,
    QSplitter,
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

# Per-step overview status text + color by lifecycle.
_STEP_STATUS: dict[str, tuple[str, str]] = {
    STATE_PENDING: ("Waiting", TEXT_MUTED),
    STATE_ACTIVE: ("Downloading...", ACCENT),
    STATE_DONE: ("Done", SUCCESS),
    STATE_FAILED: ("Failed", ERROR),
}

_CHEVRON_DOWN = "\u25be"  # small down triangle (collapsed)
_CHEVRON_UP = "\u25b4"  # small up triangle (expanded)


class PhaseGroup(QFrame):
    """Card: status header, aggregate bar, collapsible per-step details + logs."""

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
        self._step_states: dict[str, str] = {s: STATE_PENDING for s in self._steps}
        self._step_bars: dict[str, QProgressBar] = {}
        self._step_status: dict[str, QLabel] = {}
        self._failed: set[str] = set()
        self._started = False
        self._settled = False

        self.setObjectName("phaseGroup")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(6)

        # -- Header: icon, title, status text, "View Details" toggle ----------
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

        # -- Aggregate progress bar (always visible) --------------------------
        self._bar = QProgressBar()
        self._bar.setMinimum(0)
        self._bar.setMaximum(1000)
        self._bar.setValue(0)
        self._bar.setTextVisible(False)
        layout.addWidget(self._bar)

        # -- Collapsible detail pane (resizable splitter: overview | logs) ----
        self._details = QWidget()
        self._details.setVisible(False)
        details_layout = QVBoxLayout(self._details)
        details_layout.setContentsMargins(0, 4, 0, 0)
        details_layout.setSpacing(6)

        self._split = QSplitter(Qt.Orientation.Vertical)
        self._split.setChildrenCollapsible(False)

        # Overview: one row (name + bar + status) per covered step.
        overview = QWidget()
        overview_layout = QVBoxLayout(overview)
        overview_layout.setContentsMargins(0, 0, 0, 0)
        overview_layout.setSpacing(4)
        for step in self._steps:
            overview_layout.addLayout(self._build_step_row(step))

        self._logs_toggle = QPushButton(f"View Logs {_CHEVRON_DOWN}")
        self._logs_toggle.setCheckable(True)
        self._logs_toggle.setStyleSheet(self._toggle_style())
        self._logs_toggle.toggled.connect(self._on_logs_toggle)
        overview_layout.addWidget(
            self._logs_toggle, alignment=Qt.AlignmentFlag.AlignLeft
        )
        overview_layout.addStretch(1)
        self._split.addWidget(overview)

        # Logs pane: Copy / Save toolbar + the raw technical log.
        self._logs_area = QWidget()
        self._logs_area.setVisible(False)
        logs_layout = QVBoxLayout(self._logs_area)
        logs_layout.setContentsMargins(0, 0, 0, 0)
        logs_layout.setSpacing(4)

        toolbar = QHBoxLayout()
        toolbar.addStretch(1)
        self._copy_btn = self._icon_button("\u29c9", "Copy logs to clipboard")
        self._copy_btn.clicked.connect(self._on_copy_logs)
        toolbar.addWidget(self._copy_btn)
        self._save_btn = self._icon_button("\u2913", "Save logs to a .txt file")
        self._save_btn.clicked.connect(self._on_save_logs)
        toolbar.addWidget(self._save_btn)
        logs_layout.addLayout(toolbar)

        self._log = LogPanel()
        self._log.setMinimumHeight(120)
        logs_layout.addWidget(self._log)
        self._split.addWidget(self._logs_area)

        details_layout.addWidget(self._split)
        layout.addWidget(self._details)

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
        btn.setFixedSize(28, 24)
        btn.setStyleSheet(
            f"QPushButton {{ background: transparent; color: {TEXT_SECONDARY}; "
            f"border: 1px solid {BORDER}; border-radius: 4px; font-size: 14px; }}"
            f"QPushButton:hover {{ color: {TEXT_PRIMARY}; border-color: {ACCENT}; }}"
        )
        return btn

    def _build_step_row(self, step: str) -> QHBoxLayout:
        row = QHBoxLayout()
        row.setSpacing(8)
        name = QLabel(_STEP_LABELS.get(step, step))
        name.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        name.setMinimumWidth(140)
        bar = QProgressBar()
        bar.setMinimum(0)
        bar.setMaximum(1000)
        bar.setValue(0)
        bar.setTextVisible(False)
        bar.setFixedHeight(6)
        status = QLabel("Waiting")
        status.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        status.setMinimumWidth(90)
        self._step_bars[step] = bar
        self._step_status[step] = status
        row.addWidget(name)
        row.addWidget(bar, stretch=1)
        row.addWidget(status)
        return row

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
        self._set_step_state(step, STATE_ACTIVE)
        if not self._settled:
            self._apply_state(STATE_ACTIVE)

    def set_step_progress(self, step: str, fraction: float) -> None:
        if not self.covers(step):
            return
        clamped = max(0.0, min(1.0, fraction))
        self._fractions[step] = clamped
        self._step_bars[step].setValue(int(clamped * 1000))
        self._refresh_bar()

    def mark_step_done(self, step: str) -> None:
        if not self.covers(step):
            return
        self._fractions[step] = 1.0
        self._step_bars[step].setValue(1000)
        self._set_step_state(step, STATE_DONE)
        self._refresh_bar()
        self._maybe_settle()

    def mark_step_failed(self, step: str) -> None:
        if not self.covers(step):
            return
        self._fractions[step] = 1.0
        self._failed.add(step)
        self._step_bars[step].setValue(1000)
        self._set_step_state(step, STATE_FAILED)
        self._refresh_bar()
        self._maybe_settle()

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

    def _on_copy_logs(self) -> None:
        clipboard = QApplication.clipboard()
        if clipboard is not None:
            clipboard.setText(self._log.get_full_log())

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
        self._bar.setValue(int(self.progress * 1000))

    def _set_step_state(self, step: str, state: str) -> None:
        self._step_states[step] = state
        text, color = _STEP_STATUS[state]
        label = self._step_status[step]
        label.setText(text)
        label.setStyleSheet(
            f"color: {color}; font-size: {FS_CAPTION}px; background: transparent;"
        )

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
]

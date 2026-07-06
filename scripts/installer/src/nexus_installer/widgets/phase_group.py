"""v1.8.0 Phase 5 -- one labeled phase group on the installing page.

A group covers one or more engine steps (e.g. "Dependencies" = ollama + venv)
and renders a status icon, a title, its own progress bar, and a collapsible
log panel fed with only that group's log lines. The installing page routes
engine signals into these groups; this widget holds no engine knowledge
beyond its ordered step names.
"""

from __future__ import annotations

from PyQt5.QtWidgets import (
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


class PhaseGroup(QFrame):
    """Card with a status header, per-group progress bar, and collapsible log."""

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

        # Styled by the app stylesheet's `QFrame#phaseGroup` rule (the same
        # object-name pattern as `QFrame#card`; a bare class selector on a
        # QFrame subclass does not reliably paint the background).
        self.setObjectName("phaseGroup")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(6)

        header = QHBoxLayout()
        header.setSpacing(8)

        self._icon = QLabel()
        self._icon.setFixedWidth(16)
        header.addWidget(self._icon)

        self._title = QLabel(title)
        self._title.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-size: 13px; font-weight: bold; "
            f"background: transparent;"
        )
        header.addWidget(self._title, stretch=1)

        self._status = QLabel("Waiting")
        self._status.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
        )
        header.addWidget(self._status)

        self._toggle = QPushButton("Details")
        self._toggle.setCheckable(True)
        self._toggle.setStyleSheet(
            f"QPushButton {{ background: transparent; color: {TEXT_SECONDARY}; "
            f"border: 1px solid {BORDER}; border-radius: 4px; "
            f"font-size: 10px; padding: 2px 8px; }}"
            f"QPushButton:checked {{ color: {TEXT_PRIMARY}; "
            f"border-color: {ACCENT}; }}"
        )
        self._toggle.toggled.connect(self._on_toggle)
        header.addWidget(self._toggle)
        layout.addLayout(header)

        self._bar = QProgressBar()
        self._bar.setMinimum(0)
        self._bar.setMaximum(1000)
        self._bar.setValue(0)
        self._bar.setTextVisible(False)
        layout.addWidget(self._bar)

        self._log = LogPanel()
        self._log.setFixedHeight(140)
        self._log.setVisible(False)
        layout.addWidget(self._log)

        self._apply_state(STATE_PENDING)

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
        if not self._settled:
            self._apply_state(STATE_ACTIVE)

    def set_step_progress(self, step: str, fraction: float) -> None:
        if not self.covers(step):
            return
        self._fractions[step] = max(0.0, min(1.0, fraction))
        self._refresh_bar()

    def mark_step_done(self, step: str) -> None:
        if not self.covers(step):
            return
        self._fractions[step] = 1.0
        self._refresh_bar()
        self._maybe_settle()

    def mark_step_failed(self, step: str) -> None:
        if not self.covers(step):
            return
        self._fractions[step] = 1.0
        self._failed.add(step)
        self._refresh_bar()
        self._maybe_settle()

    def append_log(self, text: str, level: str = "info") -> None:
        self._log.append_log(text, level)

    def log_text(self) -> str:
        return self._log.get_full_log()

    @property
    def log_visible(self) -> bool:
        # isHidden() (not isVisible()) so the answer holds before the page
        # itself is shown: isVisible() is False for any child of an
        # unshown window regardless of the toggle state.
        return not self._log.isHidden()

    # -----------------------------------------------------------------
    # Internals
    # -----------------------------------------------------------------

    def _on_toggle(self, checked: bool) -> None:
        self._log.setVisible(checked)

    def _refresh_bar(self) -> None:
        self._bar.setValue(int(self.progress * 1000))

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
            f"color: {color}; font-size: 12px; background: transparent;"
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
            f"color: {status_color}; font-size: 11px; background: transparent;"
        )


__all__ = [
    "STATE_ACTIVE",
    "STATE_DONE",
    "STATE_FAILED",
    "STATE_PENDING",
    "PhaseGroup",
]

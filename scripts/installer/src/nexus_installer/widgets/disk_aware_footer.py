"""v1.1.0 Phase 14.5 -- live disk-aware footer widget.

Shows `Free / Selected / Remaining after install` and recolors the remaining
value based on the configured OS reserve. Pages that change the selection
call `update_selection(state)` to refresh the values.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QHBoxLayout, QLabel, QWidget

from nexus_installer.constants import (
    BG_CARD,
    BORDER,
    ERROR,
    SUCCESS,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.engine.installed_models import pending_download_gb

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


def format_disk_footer_text(
    free_gb: float,
    selected_gb: float,
    reserve_gb: float,
) -> tuple[str, str, str, str]:
    """Return `(free_text, selected_text, remaining_text, color)` for the footer."""
    free_int = max(0, int(free_gb))
    selected_int = max(0.0, float(selected_gb))
    remaining = float(free_gb) - selected_int
    free_text = f"Free: {free_int} GB"
    selected_text = f"Selected: {selected_int:.1f} GB"
    remaining_text = f"Remaining after install: {remaining:.1f} GB"
    if free_gb <= 0:
        color = TEXT_SECONDARY
    elif remaining < reserve_gb:
        color = ERROR
    elif remaining < 2 * reserve_gb:
        color = WARNING
    else:
        color = SUCCESS
    return free_text, selected_text, remaining_text, color


class DiskAwareFooter(QWidget):
    """One-row footer band showing free / selected / remaining disk space."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state
        self.setStyleSheet(
            f"background-color: {BG_CARD}; border-top: 1px solid {BORDER};"
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(16, 6, 16, 6)
        layout.setSpacing(24)

        self._free_label = QLabel("Free: -- GB")
        self._selected_label = QLabel("Selected: -- GB")
        self._remaining_label = QLabel("Remaining after install: -- GB")

        for lbl in (self._free_label, self._selected_label):
            lbl.setStyleSheet(
                f"color: {TEXT_PRIMARY}; font-size: 14px; background: transparent;"
            )
        self._remaining_label.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 14px; background: transparent;"
        )

        layout.addWidget(self._free_label)
        layout.addWidget(self._selected_label)
        layout.addStretch()
        layout.addWidget(self._remaining_label, alignment=Qt.AlignmentFlag.AlignRight)

        self.refresh()

    def refresh(self) -> None:
        """Recompute the labels from the current installer state."""
        # v2.4.5 Phase 4.2 (T016): the footer must agree with the install
        # guard, which now sizes the remaining download. Showing the full
        # selection here while the guard allowed the install would have made
        # the wizard contradict itself on the same screen.
        free_text, selected_text, remaining_text, color = format_disk_footer_text(
            free_gb=self._state.free_disk_gb,
            selected_gb=pending_download_gb(self._state),
            reserve_gb=self._state.disk_reserve_gb,
        )
        self._free_label.setText(free_text)
        self._selected_label.setText(selected_text)
        self._remaining_label.setText(remaining_text)
        self._remaining_label.setStyleSheet(
            f"color: {color}; font-size: 14px; background: transparent;"
        )

    def update_selection(self, selected_gb: float) -> None:
        """Update the state's selection total and refresh the footer."""
        self._state.selected_models_gb = float(selected_gb)
        self.refresh()


__all__ = ["DiskAwareFooter", "format_disk_footer_text"]

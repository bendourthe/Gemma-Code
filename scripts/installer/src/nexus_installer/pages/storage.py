"""v1.1.0 Phase 14.11 -- Storage review page.

Renders right before the final "Begin Installation" click. Surfaces every
disk-side cost: runtime libraries (CUDA / Python / Node / Ollama / ffmpeg),
selected models, the 10 GB OS reserve, and the net
remaining space. The "Net after install" color is the guard: red when below
the reserve, yellow when below 2x the reserve, green otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from PyQt5.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    BG_CARD,
    BORDER,
    ERROR,
    SUCCESS,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    WARNING,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


# Approximate per-component runtime footprint in GB. These are conservative
# upper bounds derived from the v1.1.0 payload audit. The real numbers vary
# slightly per OS (mac saves CUDA, Linux saves the embeddable Python) but
# the deltas are within the 10 GB reserve.
RUNTIME_COMPONENT_COSTS_GB: dict[str, float] = {
    "cuda": 4.0,
    "python_venv": 3.5,
    "node": 0.3,
    "ollama": 0.5,
    "ffmpeg": 0.1,
}


@dataclass(frozen=True)
class StorageBreakdown:
    """Per-row figures used by the Storage page."""

    free_gb: float
    runtime_gb: float
    models_gb: float
    reserve_gb: float

    @property
    def total_install_gb(self) -> float:
        return self.runtime_gb + self.models_gb

    @property
    def net_remaining_gb(self) -> float:
        return self.free_gb - self.total_install_gb


def compute_runtime_cost_gb(os_family: str, cuda_compatible: bool) -> float:
    """Sum the runtime footprint for the components installed on this host."""
    cost = (
        RUNTIME_COMPONENT_COSTS_GB["python_venv"]
        + RUNTIME_COMPONENT_COSTS_GB["node"]
        + RUNTIME_COMPONENT_COSTS_GB["ollama"]
        + RUNTIME_COMPONENT_COSTS_GB["ffmpeg"]
    )
    if cuda_compatible and os_family in {"windows", "linux"}:
        cost += RUNTIME_COMPONENT_COSTS_GB["cuda"]
    return cost


def net_color(remaining_gb: float, reserve_gb: float) -> str:
    if remaining_gb < reserve_gb:
        return ERROR
    if remaining_gb < 2 * reserve_gb:
        return WARNING
    return SUCCESS


def build_breakdown(
    state: InstallerState,
    *,
    os_family: str | None = None,
    cuda_compatible: bool | None = None,
) -> StorageBreakdown:
    family = os_family or _os_family_from_state(state)
    cuda = cuda_compatible
    if cuda is None:
        cuda = state.gpu_vendor == "nvidia"
    runtime = compute_runtime_cost_gb(family, cuda)
    return StorageBreakdown(
        free_gb=float(state.free_disk_gb),
        runtime_gb=runtime,
        models_gb=float(state.selected_models_gb),
        reserve_gb=float(state.disk_reserve_gb),
    )


def _os_family_from_state(state: InstallerState) -> str:
    plat = (state.platform or "").lower()
    if plat == "win32":
        return "windows"
    if plat == "darwin":
        return "macos"
    return "linux"


class StoragePage(QWidget):
    """Read-only storage review page rendered before installation begins."""

    def __init__(
        self,
        state: InstallerState,
        os_family: str | None = None,
        cuda_compatible: bool | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._state = state
        self._os_family = os_family
        self._cuda = cuda_compatible

        layout = QVBoxLayout(self)
        layout.setSpacing(14)

        title = QLabel("Storage Review")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        intro = QLabel(
            "Final summary of disk usage. Net after install must stay above "
            "the 10 GB OS reserve to begin."
        )
        intro.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 13px; background: transparent;"
        )
        intro.setWordWrap(True)
        layout.addWidget(intro)

        self._card = QWidget()
        self._card.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 16px;"
        )
        self._card_layout = QVBoxLayout(self._card)
        layout.addWidget(self._card)
        layout.addStretch()

        self.refresh()

    def refresh(self) -> None:
        # Clear existing rows.
        while self._card_layout.count():
            item = self._card_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.setParent(None)

        breakdown = build_breakdown(
            self._state,
            os_family=self._os_family,
            cuda_compatible=self._cuda,
        )
        rows: list[tuple[str, str, str | None]] = [
            ("Free disk", f"{breakdown.free_gb:.1f} GB", None),
            ("Required for runtime", f"{breakdown.runtime_gb:.1f} GB", None),
            (
                "Required for selected models",
                f"{breakdown.models_gb:.1f} GB",
                None,
            ),
            ("OS reserve", f"{breakdown.reserve_gb:.0f} GB", None),
        ]
        color = net_color(breakdown.net_remaining_gb, breakdown.reserve_gb)
        rows.append(
            (
                "Net after install",
                f"{breakdown.net_remaining_gb:.1f} GB",
                color,
            )
        )

        for label_text, value_text, value_color in rows:
            row = QHBoxLayout()
            label = QLabel(label_text)
            label.setStyleSheet(
                f"color: {TEXT_PRIMARY}; font-size: 13px; background: transparent;"
            )
            value = QLabel(value_text)
            value.setStyleSheet(
                f"color: {value_color or TEXT_PRIMARY}; font-size: 13px; "
                "font-weight: bold; background: transparent;"
            )
            row.addWidget(label)
            row.addStretch()
            row.addWidget(value)
            row_widget = QWidget()
            row_widget.setLayout(row)
            self._card_layout.addWidget(row_widget)


__all__ = [
    "RUNTIME_COMPONENT_COSTS_GB",
    "StorageBreakdown",
    "StoragePage",
    "build_breakdown",
    "compute_runtime_cost_gb",
    "net_color",
]

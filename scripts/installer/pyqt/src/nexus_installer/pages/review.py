"""Review page: read-only summary of all installation choices."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtWidgets import QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import BG_CARD, BORDER, SUCCESS, TEXT_SECONDARY
from nexus_installer.widgets.callout_box import CalloutBox

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

# Approximate download sizes per model (GB)
_MODEL_SIZES: dict[str, float] = {
    "gemma4:e2b": 5.1,
    "gemma4:e4b": 8.0,
    "gemma4:26b": 18.0,
    "gemma4:31b": 20.0,
}

# Friendly names for components whose bare id reads poorly when capitalized.
_COMPONENT_LABELS: dict[str, str] = {
    "desktop": "Nexus Desktop app",
    "venv": "Python environment",
    "extension": "VS Code extension",
}


class ReviewPage(QWidget):
    """Summary page showing all selected options before installation."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state

        self._layout = QVBoxLayout(self)
        self._layout.setSpacing(16)

        title = QLabel("Review")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        self._layout.addWidget(title)

        subtitle = QLabel("Please review your installation settings before proceeding.")
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 13px; background: transparent;"
        )
        self._layout.addWidget(subtitle)

        # Summary card (built dynamically on show)
        self._summary_label = QLabel()
        self._summary_label.setWordWrap(True)
        self._summary_label.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 16px; font-size: 12px;"
        )
        self._layout.addWidget(self._summary_label)

        # Internet warning callout
        callout = CalloutBox(
            title="Note",
            body="Installation will download components from the internet. Ensure you have a stable connection.",
        )
        self._layout.addWidget(callout)

        self._layout.addStretch()

    def showEvent(self, event: object) -> None:  # noqa: N802
        """Rebuild the summary each time the page becomes visible."""
        super().showEvent(event)  # type: ignore[arg-type]
        self._rebuild_summary()

    def _rebuild_summary(self) -> None:
        s = self._state
        check = f'<span style="color:{SUCCESS};">\u2713</span>'

        components = "".join(
            f"{check} {_COMPONENT_LABELS.get(c, c.capitalize())}<br>"
            for c in s.components_to_install
        )

        model_size = _MODEL_SIZES.get(s.selected_model, 0)
        estimated_disk = model_size + 2.0  # ~2 GB overhead for venv + extension

        # Rough install time heuristic
        if model_size >= 18:
            time_est = "10-15 minutes"
        elif model_size >= 8:
            time_est = "5-10 minutes"
        else:
            time_est = "3-5 minutes"

        html = (
            f"<b>Install path:</b> {s.install_path}<br><br>"
            f"<b>Components:</b><br>{components}<br>"
            f"<b>Model:</b> {s.selected_model} ({model_size} GB download)<br><br>"
            f"<b>GPU:</b> {s.gpu_name or 'None detected'}"
            f"{f' ({s.vram_mb} MB VRAM)' if s.vram_mb else ''}<br><br>"
            f"<b>Estimated disk usage:</b> ~{estimated_disk:.0f} GB<br>"
            f"<b>Estimated time:</b> {time_est}"
        )
        self._summary_label.setText(html)

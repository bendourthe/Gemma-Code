"""Review page: read-only summary of all installation choices."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtWidgets import QGridLayout, QLabel, QVBoxLayout, QWidget

from nexus_installer.constants import (
    BG_CARD,
    BORDER,
    FS_BODY,
    FS_CAPTION,
    SUCCESS,
    TEXT_SECONDARY,
)
from nexus_installer.vram_display import display_vram_gb
from nexus_installer.widgets.callout_box import CalloutBox

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

# Friendly names for components whose bare id reads poorly when capitalized.
_COMPONENT_LABELS: dict[str, str] = {
    "desktop": "Nexus Desktop app",
    "venv": "Python environment",
    "extension": "VS Code extension",
}

_NARROW_COLUMNS_PX = 560
_CARD_STYLE = (
    f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
    f"border-radius: 8px; padding: 16px; font-size: {FS_CAPTION}px;"
)


class ReviewPage(QWidget):
    """Summary page showing all selected options before installation."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state
        self._narrow_columns = False

        self._layout = QVBoxLayout(self)
        self._layout.setSpacing(16)

        title = QLabel("Review")
        title.setObjectName("pageTitle")
        self._layout.addWidget(title)

        subtitle = QLabel("Please review your installation settings before proceeding.")
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_BODY}px; background: transparent;"
        )
        self._layout.addWidget(subtitle)

        self._facts_label = QLabel()
        self._facts_label.setObjectName("review-facts-column")
        self._facts_label.setWordWrap(True)
        self._facts_label.setStyleSheet(_CARD_STYLE)

        self._models_label = QLabel()
        self._models_label.setObjectName("review-models-column")
        self._models_label.setWordWrap(True)
        self._models_label.setStyleSheet(_CARD_STYLE)

        self._split = QGridLayout()
        self._split.setContentsMargins(0, 0, 0, 0)
        self._split.setHorizontalSpacing(16)
        self._split.setVerticalSpacing(12)
        self._split.addWidget(self._facts_label, 0, 0)
        self._split.addWidget(self._models_label, 0, 1)
        self._split.setColumnStretch(0, 1)
        self._split.setColumnStretch(1, 1)

        split_host = QWidget()
        split_host.setObjectName("review-split-host")
        split_host.setStyleSheet("background: transparent;")
        split_host.setLayout(self._split)
        self._layout.addWidget(split_host)

        # Backward-compatible alias: older tests read one HTML blob.
        self._summary_label = self._facts_label

        # Internet warning callout
        callout = CalloutBox(
            title="Note",
            body=(
                "Installation will download components from the internet. "
                "Ensure you have a stable connection."
            ),
        )
        self._layout.addWidget(callout)

        self._layout.addStretch()

    def showEvent(self, event: object) -> None:  # noqa: N802
        """Rebuild the summary each time the page becomes visible."""
        super().showEvent(event)  # type: ignore[arg-type]
        self._rebuild_summary()

    def resizeEvent(self, event: object) -> None:  # noqa: N802
        super().resizeEvent(event)  # type: ignore[arg-type]
        width = event.size().width() if hasattr(event, "size") else self.width()
        self._restack_columns(width < _NARROW_COLUMNS_PX)

    def _restack_columns(self, narrow: bool) -> None:
        if narrow == self._narrow_columns:
            return
        self._narrow_columns = narrow
        self._split.removeWidget(self._models_label)
        if narrow:
            self._split.addWidget(self._models_label, 1, 0)
            self._split.setColumnStretch(1, 0)
            return
        self._split.addWidget(self._models_label, 0, 1)
        self._split.setColumnStretch(1, 1)

    def _summary_text(self) -> str:
        return f"{self._facts_label.text()}\n{self._models_label.text()}"

    def _rebuild_summary(self) -> None:
        s = self._state
        check = f'<span style="color:{SUCCESS};">\u2713</span>'

        components = "".join(
            f"{check} {_COMPONENT_LABELS.get(c, c.capitalize())}<br>"
            for c in s.components_to_install
        )

        # v1.9.0 Phase 4 (T406): the typed catalog is the wired producer of
        # `selected_model_ids` with an authoritative size total, so the legacy
        # per-model size table is gone. A single `selected_model` (a headless
        # `--model` override that never runs the review page) still renders by
        # name; an empty selection reads as "none selected".
        if s.selected_model_ids:
            model_size = s.selected_models_gb
            models_html = (
                f"<b>Models:</b> {len(s.selected_model_ids)} selected "
                f"(~{model_size:.1f} GB download)<br>"
                + "".join(f"{mid}<br>" for mid in s.selected_model_ids)
            )
        elif s.selected_model:
            model_size = s.selected_models_gb
            models_html = f"<b>Model:</b> {s.selected_model}"
        else:
            model_size = 0.0
            models_html = "<b>Models:</b> none selected"
        estimated_disk = model_size + 2.0  # ~2 GB overhead for venv + extension

        # Rough install time heuristic
        if model_size >= 18:
            time_est = "10-15 minutes"
        elif model_size >= 8:
            time_est = "5-10 minutes"
        else:
            time_est = "3-5 minutes"

        vram_part = f" ({display_vram_gb(s.vram_mb)} GB VRAM)" if s.vram_mb else ""

        facts_html = (
            f"<b>Install path:</b> {s.install_path}<br><br>"
            f"<b>Components:</b><br>{components}<br>"
            f"<b>GPU:</b> {s.gpu_name or 'None detected'}{vram_part}<br><br>"
            f"<b>Estimated disk usage:</b> ~{estimated_disk:.0f} GB<br>"
            f"<b>Estimated installation time:</b> {time_est}"
        )
        self._facts_label.setText(facts_html)
        self._models_label.setText(models_html)

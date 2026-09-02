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

#: venv + extension overhead, unchanged from the pre-v2.4.5 estimate.
_OVERHEAD_GB = 2.0

#: One line so the two marks are self-explaining rather than decorative.
_LEGEND_HTML = (
    f'<span style="color:{SUCCESS};">✓</span> already downloaded'
    f'&nbsp;&nbsp;<span style="color:{TEXT_SECONDARY};">↓</span> to download<br>'
)
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

    @staticmethod
    def _counts_suffix(done: int, pending: int) -> str:
        if not done:
            return ""
        return f" ({done} already downloaded, {pending} to download)"

    @staticmethod
    def _model_columns(model_ids: list[str], report) -> str:
        """Two balanced columns of marked model rows.

        Split down the middle rather than alternating, so each column reads
        top-to-bottom in the order the engine will install them.
        """
        rows = [
            (
                f'<span style="color:{SUCCESS};">✓</span> {mid}'
                if report.is_downloaded(mid)
                else f'<span style="color:{TEXT_SECONDARY};">↓</span> {mid}'
            )
            for mid in model_ids
        ]
        half = (len(rows) + 1) // 2
        left, right = rows[:half], rows[half:]
        cells = []
        for index in range(half):
            left_cell = left[index] if index < len(left) else ""
            right_cell = right[index] if index < len(right) else ""
            cells.append(
                f"<tr><td width='50%'>{left_cell}</td>"
                f"<td width='50%'>{right_cell}</td></tr>"
            )
        return f"<table width='100%'>{''.join(cells)}</table>"

    @staticmethod
    def _estimate_html(pending_gb: float, already_gb: float) -> str:
        """Disk + time estimate, keyed off what still has to be downloaded."""
        estimated = pending_gb + _OVERHEAD_GB
        if pending_gb >= 18:
            time_est = "10-15 minutes"
        elif pending_gb >= 8:
            time_est = "5-10 minutes"
        elif pending_gb > 0:
            time_est = "3-5 minutes"
        else:
            # Nothing to fetch: the run verifies what is already there.
            time_est = "under 5 minutes"
        already = (
            f'<br><span style="color:{TEXT_SECONDARY};">'
            f"{already_gb:.1f} GB already downloaded</span>"
            if already_gb > 0
            else ""
        )
        return (
            f"<br><b>Estimated disk usage:</b> ~{estimated:.0f} GB to download"
            f"{already}"
            f"<br><b>Estimated installation time:</b> {time_est}"
        )

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
        # v2.4.5 Phase 3 (T011/T012): size the REMAINING download, not the
        # whole selection. A host that already holds its models was being told
        # it needed 200+ GB free for an install that would fetch almost
        # nothing, which is the field defect this cycle exists to fix.
        report = s.installed_report
        if s.selected_model_ids:
            pending_ids = [
                mid for mid in s.selected_model_ids if not report.is_downloaded(mid)
            ]
            done_ids = [
                mid for mid in s.selected_model_ids if report.is_downloaded(mid)
            ]
            if report.downloaded or report.pending:
                pending_size = report.pending_gb
                already_size = report.downloaded_gb
            else:
                # The probe never ran (headless `--model` override, or a page
                # order that skips the picker). An unpopulated report means
                # "unknown", and the safe reading of unknown is "nothing is
                # downloaded" -- the pre-v2.4.5 behavior -- not "nothing to
                # download", which would understate the disk requirement.
                pending_size = s.selected_models_gb
                already_size = 0.0
            models_html = (
                f"<b>Models:</b> {len(s.selected_model_ids)} selected"
                f"{self._counts_suffix(len(done_ids), len(pending_ids))}<br>"
                f"{_LEGEND_HTML}"
                f"{self._model_columns(s.selected_model_ids, report)}"
                f"{self._estimate_html(pending_size, already_size)}"
            )
        elif s.selected_model:
            pending_size = s.selected_models_gb
            already_size = 0.0
            models_html = (
                f"<b>Model:</b> {s.selected_model}"
                f"{self._estimate_html(pending_size, already_size)}"
            )
        else:
            pending_size = 0.0
            already_size = 0.0
            models_html = (
                "<b>Models:</b> none selected"
                f"{self._estimate_html(pending_size, already_size)}"
            )

        vram_part = f" ({display_vram_gb(s.vram_mb)} GB VRAM)" if s.vram_mb else ""

        # Estimated disk usage moved under the model list, where the operator
        # asked for it: it is a statement about the models, not about the
        # install path and components beside it.
        facts_html = (
            f"<b>Install path:</b> {s.install_path}<br><br>"
            f"<b>Components:</b><br>{components}<br>"
            f"<b>GPU:</b> {s.gpu_name or 'None detected'}{vram_part}"
        )
        self._facts_label.setText(facts_html)
        self._models_label.setText(models_html)

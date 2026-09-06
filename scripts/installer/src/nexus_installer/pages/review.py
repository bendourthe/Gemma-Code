"""Review page: read-only summary of all installation choices."""

from __future__ import annotations

from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import QGridLayout, QLabel, QSizePolicy, QVBoxLayout, QWidget

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BORDER,
    FS_BODY,
    FS_CAPTION,
    FS_H2,
    SUCCESS,
    TEXT_SECONDARY,
)
from nexus_installer.engine.installed_models import pending_download_gb
from nexus_installer.pages.typed_catalog import TYPE_TABS, load_catalog_models
from nexus_installer.registry_paths import default_catalog_path
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

_SECTION_HEADINGS = {key: label for key, label, _icon in TYPE_TABS}
_SECTION_HEADINGS["other"] = "Other"
_SECTION_ORDER = [key for key, _label, _icon in TYPE_TABS] + ["other"]

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
        self._facts_label.setAlignment(Qt.AlignmentFlag.AlignTop)
        self._facts_label.setSizePolicy(
            QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Maximum
        )

        self._models_label = QLabel()
        self._models_label.setObjectName("review-models-column")
        self._models_label.setWordWrap(True)
        self._models_label.setStyleSheet(_CARD_STYLE)
        self._models_label.setAlignment(Qt.AlignmentFlag.AlignTop)

        self._split = QGridLayout()
        self._split.setContentsMargins(0, 0, 0, 0)
        self._split.setHorizontalSpacing(16)
        self._split.setVerticalSpacing(12)
        self._split.addWidget(
            self._facts_label, 0, 0, alignment=Qt.AlignmentFlag.AlignTop
        )
        self._split.addWidget(
            self._models_label, 0, 1, alignment=Qt.AlignmentFlag.AlignTop
        )
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
            self._split.addWidget(
                self._models_label, 1, 0, alignment=Qt.AlignmentFlag.AlignTop
            )
            self._split.setColumnStretch(1, 0)
            return
        self._split.addWidget(
            self._models_label, 0, 1, alignment=Qt.AlignmentFlag.AlignTop
        )
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

    def _catalog_by_id(self) -> dict[str, object]:
        cached = getattr(self, "_catalog_index", None)
        if cached is None:
            cached = {
                model.id: model for model in load_catalog_models(default_catalog_path())
            }
            self._catalog_index = cached
        return cached

    def _section_for(self, model_id: str) -> str:
        model = self._catalog_by_id().get(model_id)
        tab = getattr(model, "type", None) if model is not None else None
        if tab in _SECTION_HEADINGS and tab != "other":
            return str(tab)
        return "other"

    def _grouped_model_html(self, model_ids: list[str], report) -> str:
        buckets: dict[str, list[str]] = {key: [] for key in _SECTION_ORDER}
        for mid in model_ids:
            buckets[self._section_for(mid)].append(mid)
        parts: list[str] = []
        for key in _SECTION_ORDER:
            ids = buckets[key]
            if not ids:
                continue
            heading = _SECTION_HEADINGS[key]
            parts.append(f"<b>{heading}</b>")
            parts.append(self._model_columns(ids, report))
        return "".join(parts)

    @staticmethod
    def _estimate_html(pending_gb: float, already_gb: float) -> str:
        """Disk + time estimate, keyed off what still has to be downloaded.

        v2.4.7 Phase 4.1 (T016): rendered into the FACTS column, and storage
        on a single line. The already-downloaded total trails the figure as
        muted text rather than taking a row of its own -- showing only the
        small number after a large selection invites the opposite worry, that
        the selection was silently dropped.
        """
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
            f' <span style="color:{TEXT_SECONDARY};">'
            f"({already_gb:.1f} GB already downloaded)</span>"
            if already_gb > 0
            else ""
        )
        return (
            f"<br><br><b>Estimated disk usage:</b> ~{estimated:.0f} GB to download"
            f"{already}"
            f"<br><b>Estimated installation time:</b> {time_est}"
        )

    @staticmethod
    def _summary_counters_html(selected: int, ready: int, pending: int) -> str:
        """A counter row that reads as a summary, not as another category.

        Screenshot 4's mockup: the totals sit above the per-category lists at
        their own visual level, so a reader sees the shape of the install
        before its contents.
        """
        cells = (
            ("SELECTED", selected, TEXT_SECONDARY),
            ("READY", ready, SUCCESS),
            ("TO DOWNLOAD", pending, ACCENT if pending else TEXT_SECONDARY),
        )
        tds = "".join(
            f'<td align="center" width="33%">'
            f'<span style="color:{color};font-size:{FS_H2}px;'
            f'font-weight:bold;">{value}</span><br>'
            f'<span style="color:{TEXT_SECONDARY};font-size:{FS_CAPTION}px;">'
            f"{label}</span></td>"
            for label, value, color in cells
        )
        return (
            f'<table width="100%" data-testid="models-counters"><tr>{tds}</tr></table>'
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
            # v2.4.7 Phase 1.3 (T003): size the SELECTION, via the same helper
            # the install guard uses, so the two can never disagree. Reading
            # `report.pending_gb` here was catalog-wide, which is how this card
            # came to claim `0 to download` beside `~157 GB to download`.
            # `pending_download_gb` keeps the unknown-report fallback: a probe
            # that never ran still reports the whole selection as pending.
            pending_size = pending_download_gb(s)
            already_size = max(0.0, s.selected_models_gb - pending_size)
            counters = self._summary_counters_html(
                len(s.selected_model_ids), len(done_ids), len(pending_ids)
            )
            models_html = (
                f"{counters}"
                f"{_LEGEND_HTML}"
                f"{self._grouped_model_html(s.selected_model_ids, report)}"
            )
        elif s.selected_model:
            pending_size = s.selected_models_gb
            already_size = 0.0
            models_html = f"<b>Model:</b> {s.selected_model}"
        else:
            pending_size = 0.0
            already_size = 0.0
            models_html = "<b>Models:</b> none selected"

        vram_part = f" ({display_vram_gb(s.vram_mb)} GB VRAM)" if s.vram_mb else ""

        # Estimated disk usage moved under the model list, where the operator
        # asked for it: it is a statement about the models, not about the
        # install path and components beside it.
        # v2.4.7 Phase 4.1 (T016): the estimates are install facts, so they
        # belong beside path, components and GPU rather than under the model
        # list they used to trail.
        facts_html = (
            f"<b>Install path:</b> {s.install_path}<br><br>"
            f"<b>Components:</b><br>{components}<br>"
            f"<b>GPU:</b> {s.gpu_name or 'None detected'}{vram_part}"
            f"{self._estimate_html(pending_size, already_size)}"
        )
        self._facts_label.setText(facts_html)
        self._models_label.setText(models_html)

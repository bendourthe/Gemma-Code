"""Review page: read-only summary of all installation choices.

Follows the Review mockup: a narrow facts column (install path box with a copy
action, component checklist, GPU pill, and the connection note beneath) beside
a wide Model Summary card (three ring gauges, two aligned columns of category
pills with the chosen models by display name, and three stat tiles). The two
columns stack when the page is narrow.
"""

from __future__ import annotations

import html
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QApplication,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLayout,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    FS_BODY,
    FS_CAPTION,
    FS_H2,
    SECTION_ACCENTS,
    SUCCESS,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    WARNING,
    rgba_css,
)
from nexus_installer.engine.installed_models import (
    InstalledReport,
    pending_download_gb,
)
from nexus_installer.engine.model_router import (
    CatalogEntry,
    load_catalog_index,
)
from nexus_installer.engine.model_router import (
    default_catalog_path as _catalog_index_path,
)
from nexus_installer.engine.required_components import apply_required_components
from nexus_installer.pages.typed_catalog import (
    TYPE_TABS,
    CatalogModel,
    load_catalog_models,
)
from nexus_installer.registry_paths import default_catalog_path
from nexus_installer.vram_display import display_vram_gb
from nexus_installer.widgets.callout_box import CalloutBox
from nexus_installer.widgets.ring_gauge import RingGauge
from nexus_installer.widgets.selectable_text import make_labels_selectable

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState

# Friendly names for components whose bare id reads poorly when capitalized.
_COMPONENT_LABELS: dict[str, str] = {
    "desktop": "Nexus Desktop app",
    "venv": "Python environment",
    "extension": "VS Code extension",
}

_NARROW_COLUMNS_PX = 560
#: Floor for the facts column beside the wider model summary.
_FACTS_MIN_WIDTH_PX = 320

_SECTION_HEADINGS = {key: label for key, label, _icon in TYPE_TABS}
_SECTION_HEADINGS["other"] = "Other"

#: The two category columns of the model summary, top to bottom.
CATEGORY_COLUMNS: tuple[tuple[str, ...], tuple[str, ...]] = (
    ("embeddings", "chat", "agentic"),
    ("document", "image", "video", "audio", "other"),
)
#: Model names per row inside a category (aligned across categories).
_MODELS_PER_ROW = 2
#: Every category pill shares one width so the model columns line up.
_PILL_WIDTH_PX = 104

#: venv + extension overhead, unchanged from the pre-v2.4.5 estimate.
_OVERHEAD_GB = 2.0

#: Per-model marks: distinguishable without relying on color alone.
MARK_DOWNLOADED = "✓"
MARK_PENDING = "↓"

_CARD_MARGINS = (16, 14, 16, 16)


def _clear_layout(layout: QLayout) -> None:
    while layout.count():
        item = layout.takeAt(0)
        if item is None:
            break
        widget = item.widget()
        if widget is not None:
            widget.setParent(None)
            widget.deleteLater()
        sub = item.layout()
        if sub is not None:
            _clear_layout(sub)


def _estimate_time(pending_gb: float) -> str:
    if pending_gb >= 18:
        return "10-15 minutes"
    if pending_gb >= 8:
        return "5-10 minutes"
    if pending_gb > 0:
        return "3-5 minutes"
    # Nothing to fetch: the run verifies what is already there.
    return "under 5 minutes"


def _category_pill(section_key: str, heading: str) -> QLabel:
    accent = SECTION_ACCENTS.get(section_key, TEXT_SECONDARY)
    pill = QLabel(heading)
    pill.setObjectName("categoryPill")
    pill.setFixedWidth(_PILL_WIDTH_PX)
    pill.setAlignment(Qt.AlignmentFlag.AlignCenter)
    pill.setStyleSheet(
        f"color: {accent}; background-color: {rgba_css(accent, 0.16)}; "
        f"border: 1px solid {rgba_css(accent, 0.45)}; border-radius: 8px; "
        f"padding: 3px 8px; font-size: {FS_CAPTION}px; font-weight: 600;"
    )
    return pill


class _GaugeStat(QWidget):
    """A ring gauge beside its uppercase caption and bold value."""

    def __init__(self, caption: str, color: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.caption = caption
        self._color = color
        self.value = 0
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(10)
        self.gauge = RingGauge(color=color)
        row.addWidget(self.gauge)
        col = QVBoxLayout()
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(0)
        cap = QLabel(f"{caption}:")
        cap.setObjectName("statCaption")
        col.addWidget(cap)
        self._value_label = QLabel("0")
        self._value_label.setObjectName("gaugeValue")
        col.addWidget(self._value_label)
        row.addLayout(col, stretch=1)
        self.set_value(0, 0)

    def set_value(self, value: int, total: int, *, color: str | None = None) -> None:
        self.value = value
        shown = color or self._color
        self.gauge.set_color(shown)
        self.gauge.set_value(value, total)
        self._value_label.setText(str(value))
        self._value_label.setStyleSheet(
            f"color: {shown}; font-size: {FS_H2}px; font-weight: 700; "
            "background: transparent;"
        )

    def text(self) -> str:
        return f"{self.caption} {self.value}"


class _StatTile(QFrame):
    """Inset tile: uppercase caption, bold value, optional muted note."""

    def __init__(self, caption: str, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setObjectName("statTile")
        self.caption = caption
        self.value = ""
        self.note = ""
        col = QVBoxLayout(self)
        col.setContentsMargins(12, 10, 12, 10)
        col.setSpacing(2)
        cap = QLabel(caption)
        cap.setObjectName("statCaption")
        cap.setWordWrap(True)
        col.addWidget(cap)
        self._value_label = QLabel("")
        self._value_label.setObjectName("statValue")
        col.addWidget(self._value_label)
        self._note_label = QLabel("")
        self._note_label.setObjectName("cardCaption")
        self._note_label.setWordWrap(True)
        self._note_label.setVisible(False)
        col.addWidget(self._note_label)

    def set_value(self, value: str, note: str = "") -> None:
        self.value = value
        self.note = note
        self._value_label.setText(value)
        self._note_label.setText(note)
        self._note_label.setVisible(bool(note))

    def text(self) -> str:
        return f"{self.caption}: {self.value}" + (f" {self.note}" if self.note else "")


@dataclass
class _CategoryRow:
    """One category in the summary: its pill and the model labels beside it."""

    section_key: str
    heading: str
    column: int
    pill: QLabel
    model_labels: list[QLabel] = field(default_factory=list)

    def names_text(self) -> str:
        return "  ".join(label.text() for label in self.model_labels)


class ReviewPage(QWidget):
    """Summary page showing all selected options before installation."""

    def __init__(self, state: InstallerState, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = state
        self._narrow_columns = False
        self._catalog_index: dict[str, CatalogModel] | None = None
        self._catalog_entry_cache: dict[str, CatalogEntry] | None = None
        self._component_rows: list[QLabel] = []
        self._category_cells: list[_CategoryRow] = []

        self._layout = QVBoxLayout(self)
        self._layout.setSpacing(12)

        title = QLabel("Review")
        title.setObjectName("pageTitle")
        self._layout.addWidget(title)

        subtitle = QLabel("Please review your installation settings before proceeding.")
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_BODY}px; background: transparent;"
        )
        self._layout.addWidget(subtitle)

        # Left column: the facts card with the connection note directly under
        # it, at the same width.
        self._facts_card = self._build_facts_card()
        self._callout = CalloutBox(
            title="Note",
            body=(
                "Installation will download components from the internet. "
                "Ensure you have a stable connection."
            ),
        )
        self._facts_column = QWidget()
        self._facts_column.setObjectName("review-facts-column")
        self._facts_column.setStyleSheet("background: transparent;")
        # Narrow, but never so narrow that the path or the note wraps per word.
        self._facts_column.setMinimumWidth(_FACTS_MIN_WIDTH_PX)
        facts_col = QVBoxLayout(self._facts_column)
        facts_col.setContentsMargins(0, 0, 0, 0)
        facts_col.setSpacing(12)
        facts_col.addWidget(self._facts_card)
        facts_col.addWidget(self._callout)
        facts_col.addStretch()

        self._models_card = self._build_models_card()

        self._split = QGridLayout()
        self._split.setContentsMargins(0, 0, 0, 0)
        self._split.setHorizontalSpacing(16)
        self._split.setVerticalSpacing(12)
        self._split.addWidget(
            self._facts_column, 0, 0, alignment=Qt.AlignmentFlag.AlignTop
        )
        self._split.addWidget(
            self._models_card, 0, 1, alignment=Qt.AlignmentFlag.AlignTop
        )
        # The model summary carries most of the content: two thirds of the row.
        self._split.setColumnStretch(0, 1)
        self._split.setColumnStretch(1, 2)

        split_host = QWidget()
        split_host.setObjectName("review-split-host")
        split_host.setStyleSheet("background: transparent;")
        split_host.setLayout(self._split)
        self._layout.addWidget(split_host)

        self._layout.addStretch()

    # -- card builders ----------------------------------------------------

    def _build_facts_card(self) -> QFrame:
        card = QFrame()
        card.setObjectName("surfaceCard")
        card.setProperty("reviewColumn", "facts")
        col = QVBoxLayout(card)
        col.setContentsMargins(*_CARD_MARGINS)
        col.setSpacing(8)

        path_caption = QLabel("Install path")
        path_caption.setObjectName("cardHead")
        col.addWidget(path_caption)

        path_box = QFrame()
        path_box.setObjectName("insetBox")
        path_row = QHBoxLayout(path_box)
        path_row.setContentsMargins(12, 8, 8, 8)
        path_row.setSpacing(8)
        self._path_label = QLabel("")
        self._path_label.setObjectName("review-install-path")
        self._path_label.setWordWrap(True)
        self._path_label.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-size: {FS_CAPTION}px; "
            "background: transparent;"
        )
        path_row.addWidget(self._path_label, stretch=1)
        self._copy_btn = QToolButton()
        self._copy_btn.setObjectName("iconButton")
        self._copy_btn.setText("⎘")
        self._copy_btn.setAccessibleName("Copy install path")
        self._copy_btn.setToolTip("Copy install path")
        self._copy_btn.setAutoRaise(True)
        self._copy_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._copy_btn.clicked.connect(self._copy_install_path)
        path_row.addWidget(self._copy_btn, alignment=Qt.AlignmentFlag.AlignTop)
        col.addWidget(path_box)

        components_caption = QLabel("Components")
        components_caption.setObjectName("cardHead")
        col.addWidget(components_caption)
        self._components_layout = QVBoxLayout()
        self._components_layout.setContentsMargins(0, 0, 0, 0)
        self._components_layout.setSpacing(4)
        col.addLayout(self._components_layout)

        self._gpu_pill = QLabel("")
        self._gpu_pill.setObjectName("successPill")
        self._gpu_pill.setWordWrap(True)
        col.addWidget(self._gpu_pill)

        col.addStretch()
        return card

    def _build_models_card(self) -> QFrame:
        card = QFrame()
        card.setObjectName("surfaceCard")
        card.setProperty("reviewColumn", "models")
        col = QVBoxLayout(card)
        col.setContentsMargins(*_CARD_MARGINS)
        col.setSpacing(12)

        head = QLabel("Model Summary")
        head.setObjectName("cardHead")
        col.addWidget(head)

        gauges = QHBoxLayout()
        gauges.setContentsMargins(0, 0, 0, 0)
        gauges.setSpacing(12)
        self._gauges: dict[str, _GaugeStat] = {
            "selected": _GaugeStat("SELECTED", SUCCESS),
            "ready": _GaugeStat("READY", SUCCESS),
            "pending": _GaugeStat("TO DOWNLOAD", ACCENT),
        }
        for gauge in self._gauges.values():
            gauges.addWidget(gauge, stretch=1)
        col.addLayout(gauges)

        # One line so the two marks are self-explaining; shown only when the
        # selection still has something to fetch.
        self._legend = QLabel(
            f'<span style="color:{SUCCESS};">{MARK_DOWNLOADED}</span> already '
            f'downloaded&nbsp;&nbsp;&nbsp;<span style="color:{ACCENT};">'
            f"{MARK_PENDING}</span> to download"
        )
        self._legend.setObjectName("review-legend")
        self._legend.setTextFormat(Qt.TextFormat.RichText)
        self._legend.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            "background: transparent;"
        )
        self._legend.setVisible(False)
        col.addWidget(self._legend)

        # Two category columns, each a grid: pill | model | model, so the model
        # names line up across categories.
        columns = QHBoxLayout()
        columns.setContentsMargins(0, 0, 0, 0)
        columns.setSpacing(20)
        self._category_grids: list[QGridLayout] = []
        for _ in CATEGORY_COLUMNS:
            host = QWidget()
            host.setStyleSheet("background: transparent;")
            grid = QGridLayout(host)
            grid.setContentsMargins(0, 0, 0, 0)
            grid.setHorizontalSpacing(10)
            grid.setVerticalSpacing(8)
            for model_col in range(1, _MODELS_PER_ROW + 1):
                grid.setColumnStretch(model_col, 1)
            self._category_grids.append(grid)
            columns.addWidget(host, stretch=1, alignment=Qt.AlignmentFlag.AlignTop)
        col.addLayout(columns)

        # Single `--model` override or an empty selection.
        self._fallback_label = QLabel("")
        self._fallback_label.setObjectName("review-models-fallback")
        self._fallback_label.setWordWrap(True)
        self._fallback_label.setVisible(False)
        col.addWidget(self._fallback_label)

        tiles = QHBoxLayout()
        tiles.setContentsMargins(0, 0, 0, 0)
        tiles.setSpacing(10)
        self._tiles: dict[str, _StatTile] = {
            "download": _StatTile("REQUIRED DOWNLOAD"),
            "cache": _StatTile("LOCAL CACHE"),
            "time": _StatTile("ESTIMATED INSTALLATION TIME"),
        }
        for tile in self._tiles.values():
            tiles.addWidget(tile, stretch=1)
        col.addLayout(tiles)
        return card

    # -- Qt events ----------------------------------------------------------

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
        self._split.removeWidget(self._models_card)
        if narrow:
            self._split.addWidget(
                self._models_card, 1, 0, alignment=Qt.AlignmentFlag.AlignTop
            )
            self._split.setColumnStretch(1, 0)
            return
        self._split.addWidget(
            self._models_card, 0, 1, alignment=Qt.AlignmentFlag.AlignTop
        )
        self._split.setColumnStretch(1, 2)

    def _copy_install_path(self) -> None:
        clipboard = QApplication.clipboard()
        if clipboard is not None:
            clipboard.setText(self._state.install_path)

    # -- catalog lookups ----------------------------------------------------

    def _catalog_by_id(self) -> dict[str, CatalogModel]:
        if self._catalog_index is None:
            self._catalog_index = {
                model.id: model for model in load_catalog_models(default_catalog_path())
            }
        return self._catalog_index

    def _catalog_entries(self) -> dict[str, CatalogEntry]:
        if self._catalog_entry_cache is None:
            self._catalog_entry_cache = load_catalog_index(_catalog_index_path())
        return self._catalog_entry_cache

    def _section_for(self, model_id: str) -> str:
        model = self._catalog_by_id().get(model_id)
        tab = getattr(model, "type", None) if model is not None else None
        if tab in _SECTION_HEADINGS and tab != "other":
            return str(tab)
        return "other"

    def display_name_for(self, model_id: str) -> str:
        """The catalog display name; the raw id only when the catalog lacks it."""
        model = self._catalog_by_id().get(model_id)
        name = getattr(model, "display_name", "") if model is not None else ""
        return str(name) if name else model_id

    def _model_label(self, model_id: str, downloaded: bool) -> QLabel:
        mark = (
            f'<span style="color:{SUCCESS};">{MARK_DOWNLOADED}</span>'
            if downloaded
            else f'<span style="color:{ACCENT};">{MARK_PENDING}</span>'
        )
        label = QLabel(f"{mark} {html.escape(self.display_name_for(model_id))}")
        label.setObjectName("categoryModel")
        label.setProperty("modelId", model_id)
        label.setToolTip(model_id)
        label.setTextFormat(Qt.TextFormat.RichText)
        # Long names wrap inside their column rather than widening the card
        # past the window edge.
        label.setWordWrap(True)
        label.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-size: {FS_CAPTION}px; "
            "background: transparent; padding-top: 3px;"
        )
        return label

    def _fill_categories(self, model_ids: list[str], report: InstalledReport) -> None:
        for grid in self._category_grids:
            _clear_layout(grid)
        self._category_cells = []
        buckets: dict[str, list[str]] = {key: [] for key in _SECTION_HEADINGS}
        for mid in model_ids:
            buckets[self._section_for(mid)].append(mid)
        for column, keys in enumerate(CATEGORY_COLUMNS):
            grid = self._category_grids[column]
            row = 0
            for key in keys:
                ids = buckets.get(key, [])
                if not ids:
                    continue
                rows_needed = max(1, -(-len(ids) // _MODELS_PER_ROW))
                pill = _category_pill(key, _SECTION_HEADINGS[key])
                grid.addWidget(pill, row, 0, rows_needed, 1, Qt.AlignmentFlag.AlignTop)
                cell = _CategoryRow(key, _SECTION_HEADINGS[key], column, pill)
                for index, mid in enumerate(ids):
                    label = self._model_label(mid, report.is_downloaded(mid))
                    grid.addWidget(
                        label,
                        row + index // _MODELS_PER_ROW,
                        1 + index % _MODELS_PER_ROW,
                        alignment=Qt.AlignmentFlag.AlignTop,
                    )
                    cell.model_labels.append(label)
                self._category_cells.append(cell)
                row += rows_needed

    # -- summary ------------------------------------------------------------

    def _summary_text(self) -> str:
        """Plain digest of everything the two cards show (for tests/logs)."""
        lines = [
            f"Install path: {self._path_label.text()}",
            "Components: " + "; ".join(row.text() for row in self._component_rows),
            self._gpu_pill.text(),
            " ".join(g.text() for g in self._gauges.values()),
        ]
        if self._legend.isVisibleTo(self):
            lines.append("already downloaded / to download")
        for cell in self._category_cells:
            lines.append(f"{cell.heading}: {cell.names_text()}")
        if self._fallback_label.isVisibleTo(self):
            lines.append(self._fallback_label.text())
        lines.extend(tile.text() for tile in self._tiles.values())
        return "\n".join(lines)

    def _rebuild_summary(self) -> None:
        s = self._state

        self._path_label.setText(s.install_path or "(not set)")

        # Ollama, the Python environment, and the desktop app are DERIVED from
        # the model selection. Resolve them here, on the last page before the
        # engine reads `components_to_install`, so the list shown is the list
        # installed.
        apply_required_components(s, self._catalog_entries())
        _clear_layout(self._components_layout)
        self._component_rows = []
        for component in s.components_to_install:
            row = QLabel(
                f'<span style="color:{SUCCESS};">{MARK_DOWNLOADED}</span>&nbsp; '
                f"{_COMPONENT_LABELS.get(component, component.capitalize())}"
            )
            row.setObjectName("review-component")
            row.setTextFormat(Qt.TextFormat.RichText)
            row.setStyleSheet(
                f"color: {TEXT_PRIMARY}; font-size: {FS_CAPTION}px; "
                "background: transparent;"
            )
            self._components_layout.addWidget(row)
            self._component_rows.append(row)

        if s.gpu_name:
            vram_part = f" ({display_vram_gb(s.vram_mb)} GB VRAM)" if s.vram_mb else ""
            self._gpu_pill.setText(f"GPU: {s.gpu_name}{vram_part}")
            self._gpu_pill.setStyleSheet("")
        else:
            self._gpu_pill.setText("GPU: None detected (CPU-only mode)")
            self._gpu_pill.setStyleSheet(
                f"color: {WARNING}; border: 1px solid {WARNING}; border-radius: 8px; "
                f"padding: 4px 10px; font-size: {FS_CAPTION}px; font-weight: 600;"
            )

        # Size the REMAINING download, via the same helper the install guard
        # uses, so the two can never disagree. A report that never ran (a
        # headless `--model` override) reads as "nothing present".
        report = s.installed_report
        if s.selected_model_ids:
            done_ids = [
                mid for mid in s.selected_model_ids if report.is_downloaded(mid)
            ]
            pending_ids = [
                mid for mid in s.selected_model_ids if not report.is_downloaded(mid)
            ]
            selected, ready, pending = (
                len(s.selected_model_ids),
                len(done_ids),
                len(pending_ids),
            )
            pending_size = pending_download_gb(s)
            already_size = max(0.0, s.selected_models_gb - pending_size)
            self._fill_categories(s.selected_model_ids, report)
            self._fallback_label.setVisible(False)
        elif s.selected_model:
            selected, ready, pending = 1, 0, 1
            pending_size = s.selected_models_gb
            already_size = 0.0
            self._fill_categories([], report)
            self._fallback_label.setText(
                f"<b>Model:</b> {html.escape(s.selected_model)}"
            )
            self._fallback_label.setVisible(True)
        else:
            selected, ready, pending = 0, 0, 0
            pending_size = 0.0
            already_size = 0.0
            self._fill_categories([], report)
            self._fallback_label.setText("<b>Models:</b> none selected")
            self._fallback_label.setVisible(True)

        self._gauges["selected"].set_value(selected, selected)
        self._gauges["ready"].set_value(ready, selected)
        self._gauges["pending"].set_value(
            pending, selected, color=ACCENT if pending else TEXT_MUTED
        )
        self._legend.setVisible(pending > 0)

        estimated = pending_size + _OVERHEAD_GB
        already_note = (
            f"({already_size:.1f} GB already downloaded)" if already_size > 0 else ""
        )
        self._tiles["download"].set_value(f"~{estimated:.0f} GB", already_note)
        self._tiles["cache"].set_value(
            f"{already_size:.1f} GB",
            "already on this machine" if already_size > 0 else "",
        )
        self._tiles["time"].set_value(_estimate_time(pending_size))
        # The rows and model names were just rebuilt: keep them selectable.
        make_labels_selectable(self)

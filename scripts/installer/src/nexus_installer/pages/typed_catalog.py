"""Chat / Agentic / Image / Video / Audio model picker.

The Text tab is split into **Chat** and **Agentic** sections driven by the
catalog's `task` field. Each card (v1.9.0 Phase 6) leads with a plain-language
description and a full-width "Best for" line (from the model's strengths),
then a compact fact-pill row (Origin, Agentic yes/no, context, Multimodal,
license, and an Uncensored flag when there is no content filter), a status
badge (Required / Recommended / Compatible), and a prominent disk-size accent.
Card colors are keyed to the model's **provider** (from `family`), so a model
shown in both Chat and Agentic has one consistent color; the tab bar itself is
neutral. The Agentic tab also lists agentic-capable chat models (the Gemma 4
family, which set the `agentic` flag) ranked Gemma-first.

Pre-ticked defaults come from the per-VRAM-tier matrix in
`core/registry/recommended.json` (schema v2) resolved against the detected
hardware by `nexus_installer.tier_defaults` -- including the uncensored
image/video defaults on tiers whose hardware fits them and the permissive
speech (audio) defaults on every tier. Defaults are recomputed on
`showEvent` (GPU detection finishes after the wizard pages are constructed)
until the user touches a checkbox; the Reset-to-recommended control resets to them.

The page is the wired producer of `InstallerState.selected_model_ids`
(closes `OSI003.P3.D`): every selection change writes the ordered id list
the protocol-routed model step consumes, keeps the legacy single
`selected_model` pointing at the chat pick, and updates
`selected_models_gb` for the disk-aware footer / install guard.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from nexus_installer import registry_paths
from nexus_installer.constants import (
    ACCENT,
    ACCENT_BRIGHT,
    BG_CARD,
    BORDER,
    BORDER_STRONG,
    ERROR,
    FS_BODY,
    FS_CAPTION,
    FS_H3,
    PROVIDER_COLORS,
    SUCCESS,
    TEXT_BODY,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    WARNING,
    provider_color,
    publisher_for_family,
)
from nexus_installer.tier_defaults import (
    default_selection,
    load_tier_matrix,
    resolve_tier,
)
from nexus_installer.widgets.model_checkbox import ModelCheckBox

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


TYPE_TABS: tuple[tuple[str, str, str], ...] = (
    # (section_key, tab_label, type_icon)
    ("chat", "Chat", "[C]"),
    # v1.9.0 Phase 4 (T404): renamed from "Agentic Coding"; the tab now lists
    # agentic-capable chat models (the Gemma 4 family) alongside the coding
    # specialists, with Gemma 4 ranked first as the recommended agentic default.
    ("agentic", "Agentic", "[>]"),
    ("image", "Image", "[I]"),
    ("video", "Video", "[V]"),
    ("audio", "Audio", "[A]"),
)

# Fallback when an entry carries no `task` field: catalog `type` -> tab.
# Embedding models render inside the Chat section (memory-layer support).
CATALOG_TYPE_TO_TAB = {
    "llm": "chat",
    "embed": "chat",
    "image": "image",
    "video": "video",
    "audio": "audio",
}

# Primary mapping: catalog `task` -> tab.
TASK_TO_TAB = {
    "chat": "chat",
    "agentic": "agentic",
    "embed": "chat",
    "image": "image",
    "video": "video",
    "audio": "audio",
}


@dataclass(frozen=True)
class CatalogModel:
    """A single catalog entry with the metadata the typed UI surfaces."""

    id: str
    display_name: str
    type: str  # tab key: chat / agentic / image / video / audio
    task: str  # catalog task: chat / agentic / image / video / audio / embed
    size_gb: float
    required_vram_gb: int
    required_ram_gb: int
    release_date: str
    license_name: str
    context_window_in: int
    context_window_out: int
    multimodal: bool
    uncensored: bool
    description: str
    strengths: tuple[str, ...] = ()
    why_recommended: str = ""
    differentiators: str = ""
    # v1.9.0 Phase 4 -- scannable metadata (T401/T402).
    origin: str = ""
    agentic: bool = False
    guardrails: str = ""
    # v1.9.0 Phase 6 (T022) -- the per-provider card color is keyed to family.
    family: str = ""

    @property
    def is_text_model(self) -> bool:
        return self.type in ("chat", "agentic")

    @property
    def is_required(self) -> bool:
        """The embedding model is required by the semantic memory layer.

        v1.9.0 Phase 4 (T403): nomic-embed is the de-facto required model, so
        its card gets a Required badge and a locked-on checkbox. Derived from
        the task rather than a schema field -- the memory layer needs *an*
        embedding model, and there is exactly one embed entry.
        """
        return self.task == "embed"

    @property
    def guardrails_label(self) -> str:
        """Coarse guardrails display label (v1.9.0 Phase 4, T401).

        One of "Uncensored" / "Safety-tuned" / "N/A", derived from the
        `uncensored` flag with an optional explicit `guardrails` override for
        nuance. Speech/embedding models carry no meaningful guardrails signal
        ("N/A").
        """
        if self.guardrails:
            return self.guardrails
        if self.uncensored:
            return "Uncensored"
        if self.task in ("embed", "audio"):
            return "N/A"
        return "Safety-tuned"


def _coerce_int(value: object, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _coerce_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def load_catalog_models(catalog_path: Path) -> list[CatalogModel]:
    """Read `catalog.json` and return one `CatalogModel` per entry (sans VAEs)."""
    if not catalog_path.exists():
        return []
    try:
        data = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    models: list[CatalogModel] = []
    for entry in data.get("models", []):
        raw_task = str(entry.get("task") or "")
        raw_type = entry.get("type") or ""
        tab = TASK_TO_TAB.get(raw_task) or CATALOG_TYPE_TO_TAB.get(raw_type)
        if tab is None:
            # VAEs, ControlNets, etc. are not user-facing top-level picks.
            continue
        strengths = entry.get("strengths")
        if not isinstance(strengths, list):
            strengths = []
        models.append(
            CatalogModel(
                id=entry.get("id", ""),
                display_name=entry.get("displayName") or entry.get("id", ""),
                type=tab,
                task=raw_task or ("chat" if tab == "chat" else tab),
                size_gb=_coerce_float(entry.get("sizeGB")),
                required_vram_gb=_coerce_int(
                    entry.get("requiredVramGB", entry.get("vramGB"))
                ),
                required_ram_gb=_coerce_int(entry.get("requiredRamGB")),
                release_date=str(entry.get("releaseDate") or ""),
                license_name=str(entry.get("license") or ""),
                context_window_in=_coerce_int(
                    entry.get("contextWindowIn", entry.get("contextWindow"))
                ),
                context_window_out=_coerce_int(entry.get("contextWindowOut")),
                multimodal=bool(entry.get("multimodal")),
                uncensored=bool(entry.get("uncensored")),
                description=str(entry.get("description") or ""),
                strengths=tuple(str(s) for s in strengths),
                why_recommended=str(entry.get("whyRecommended") or ""),
                differentiators=str(entry.get("differentiators") or ""),
                origin=str(entry.get("origin") or ""),
                agentic=bool(entry.get("agentic")),
                guardrails=str(entry.get("guardrails") or ""),
                family=str(entry.get("family") or ""),
            )
        )
    return models


def compatibility_badge(
    model: CatalogModel,
    *,
    total_vram_gb: int,
    total_ram_gb: int,
    gpu_vendor: str,
) -> tuple[str, str]:
    """Return `(text, color)` for the compatibility badge of the given model."""
    if gpu_vendor == "none" and model.required_vram_gb > 0:
        return (
            f"Requires {model.required_vram_gb} GB VRAM (no GPU detected)",
            ERROR,
        )
    if model.required_vram_gb > 0 and total_vram_gb < model.required_vram_gb:
        return (
            f"Requires {model.required_vram_gb} GB VRAM (you have {total_vram_gb})",
            WARNING,
        )
    if model.required_ram_gb > 0 and total_ram_gb < model.required_ram_gb:
        return (
            f"Requires {model.required_ram_gb} GB RAM (you have {total_ram_gb})",
            WARNING,
        )
    return "Compatible", SUCCESS


def _card_status(
    model: CatalogModel,
    *,
    recommended: bool,
    accent: str,
    host_vram_gb: int,
    host_ram_gb: int,
    gpu_vendor: str,
) -> tuple[str, str, bool]:
    """Resolve the single status badge for a card (v1.9.0 Phase 4, T403).

    Returns ``(text, color, fits)``. Priority: Required (embed) > hardware
    incompatibility warning > Recommended > Compatible. ``fits`` is False only
    for the incompatibility state, so the card can also surface the detail.
    """
    compat_text, compat_color = compatibility_badge(
        model,
        total_vram_gb=host_vram_gb,
        total_ram_gb=host_ram_gb,
        gpu_vendor=gpu_vendor,
    )
    fits = compat_color == SUCCESS
    if model.is_required:
        return "Required", accent, fits
    if not fits:
        return compat_text, compat_color, False
    if recommended:
        return "Recommended", accent, True
    return "Compatible", SUCCESS, True


def _pill(
    text: str, *, color: str = TEXT_SECONDARY, border: str = BORDER_STRONG
) -> QLabel:
    """A compact rounded metadata chip (v1.9.0 Phase 4, T403)."""
    chip = QLabel(text)
    chip.setStyleSheet(
        f"color: {color}; font-size: {FS_CAPTION}px; background: transparent; "
        f"border: 1px solid {border}; border-radius: 9px; padding: 1px 8px;"
    )
    return chip


@dataclass
class _ModelCardState:
    """Track a card's checkbox + the model it represents."""

    model: CatalogModel
    checkbox: QCheckBox
    base_label: str = ""
    disabled_for_disk: bool = False


@dataclass
class TypedSelection:
    """Mutable record of which models the user has chosen across all tabs."""

    selected: set[str] = field(default_factory=set)

    def total_gb(self, lookup: dict[str, CatalogModel]) -> float:
        return sum(lookup[mid].size_gb for mid in self.selected if mid in lookup)


class _ModelCard(QWidget):
    """One model card with metadata, Phase 4 copy, and checkbox."""

    def __init__(
        self,
        model: CatalogModel,
        *,
        recommended: bool,
        checked: bool,
        host_vram_gb: int,
        host_ram_gb: int,
        gpu_vendor: str,
        accent: str = ACCENT,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.model = model
        # Scoped selector + WA_StyledBackground: an unqualified stylesheet
        # would propagate the border to every child QLabel (each line
        # rendered as its own boxed pill -- the pre-Phase-5 look).
        self.setObjectName("modelCard")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setStyleSheet(
            f"QWidget#modelCard {{ background-color: {BG_CARD}; "
            f"border: 1px solid {BORDER}; border-radius: 8px; }}"
        )
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(6)

        # --- Title row: [checkbox] name (release)  [status badge]  [disk] ---
        title_row = QHBoxLayout()
        title_row.setSpacing(8)
        # v1.9.0 Phase 5 (T021) -- the custom-painted ModelCheckBox: a rounded
        # box with a crisp glyph and full state coverage. `accent` is the
        # per-provider color (Phase 6); the required (embed) model is locked on.
        self.checkbox = ModelCheckBox(accent=accent)
        self.checkbox.setChecked(checked)
        # The required (embed) lock is applied by the page in
        # `_update_selection_state` so a seeded / CLI-override selection is
        # never silently forced on.
        title_row.addWidget(self.checkbox)

        release_suffix = (
            f"   released {model.release_date}" if model.release_date else ""
        )
        title = QLabel(f"{model.display_name}{release_suffix}")
        title.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-weight: bold; background: transparent;"
        )
        title.setWordWrap(True)
        title_row.addWidget(title, stretch=1)

        badge_text, badge_color, fits = _card_status(
            model,
            recommended=recommended,
            accent=accent,
            host_vram_gb=host_vram_gb,
            host_ram_gb=host_ram_gb,
            gpu_vendor=gpu_vendor,
        )
        status = QLabel(badge_text)
        status.setStyleSheet(
            f"color: {badge_color}; font-size: {FS_CAPTION}px; font-weight: bold; "
            f"border: 1px solid {badge_color}; border-radius: 9px; "
            f"padding: 1px 8px; background: transparent;"
        )
        title_row.addWidget(status)

        size_label = QLabel(f"{model.size_gb:.1f} GB")
        size_label.setStyleSheet(
            f"color: {accent}; font-weight: bold; font-size: {FS_H3}px; "
            f"background: transparent;"
        )
        title_row.addWidget(size_label)
        layout.addLayout(title_row)

        # --- Incompatibility note (only when the model does not fit) ---
        if not fits:
            warn = QLabel(badge_text)
            warn.setStyleSheet(
                f"color: {badge_color}; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            warn.setWordWrap(True)
            layout.addWidget(warn)

        # --- Plain-language description leads the card (Phase 2 copy, T023) ---
        if model.description:
            desc = QLabel(model.description)
            desc.setStyleSheet(
                f"color: {TEXT_BODY}; font-size: {FS_BODY}px; background: transparent;"
            )
            desc.setWordWrap(True)
            layout.addWidget(desc)

        # --- Full-width "Best for" line from strengths (no truncation, T023) ---
        if model.strengths:
            best_for = QLabel(
                f'<span style="color: {accent}; font-weight: 600;">Best for:</span> '
                f"{', '.join(model.strengths)}"
            )
            best_for.setStyleSheet(
                f"color: {TEXT_BODY}; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            best_for.setWordWrap(True)
            layout.addWidget(best_for)

        # --- Compact fact pills: only the few key facts (T023). "Best at" moves
        #     to the Best-for line above; the always-on Guardrails pill becomes
        #     an Uncensored flag shown only when there is no content filter. ---
        chip_row = QHBoxLayout()
        chip_row.setSpacing(6)
        chip_row.setContentsMargins(28, 2, 0, 0)
        if model.origin:
            chip_row.addWidget(_pill(f"Origin: {model.origin}"))
        if model.is_text_model:
            agentic_color = accent if model.agentic else TEXT_MUTED
            chip_row.addWidget(
                _pill(
                    f"Agentic: {'Yes' if model.agentic else 'No'}",
                    color=agentic_color,
                    border=agentic_color,
                )
            )
        if model.is_text_model and (
            model.context_window_in or model.context_window_out
        ):
            ctx_bits = []
            if model.context_window_in:
                ctx_bits.append(f"{model.context_window_in // 1000}k in")
            if model.context_window_out:
                ctx_bits.append(f"{model.context_window_out // 1000}k out")
            chip_row.addWidget(_pill("Context: " + " / ".join(ctx_bits)))
        if model.multimodal:
            chip_row.addWidget(
                _pill("Multimodal", color=ACCENT_BRIGHT, border=ACCENT_BRIGHT)
            )
        if model.guardrails_label == "Uncensored":
            chip_row.addWidget(_pill("Uncensored", color=WARNING, border=WARNING))
        if model.license_name:
            chip_row.addWidget(_pill(model.license_name))
        chip_row.addStretch()
        layout.addLayout(chip_row)

        # --- Why this one (recommended picks only) ---
        if recommended and model.why_recommended:
            why = QLabel(f"Why this one: {model.why_recommended}")
            why.setStyleSheet(
                f"color: {accent}; font-size: {FS_CAPTION}px; background: transparent;"
            )
            why.setWordWrap(True)
            layout.addWidget(why)


class TypedCatalogPage(QWidget):
    """Sectioned catalog page (Chat / Agentic Coding / Image / Video / Audio)."""

    DISK_TOOLTIP = (
        "Would dip below the 10 GB OS reserve. Free up disk or untick another model."
    )

    # v1.11.0 Phase 6 (T603): emits (decided_categories, total_categories) so the
    # sidebar can show intra-page category progress on the "Models" row.
    category_progress = pyqtSignal(int, int)

    def __init__(
        self,
        state: InstallerState,
        catalog_path: Path | None = None,
        recommended_path: Path | None = None,
        on_selection_changed: Callable[[float], None] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._state = state
        self._on_selection_changed = on_selection_changed

        catalog_path = catalog_path or _default_catalog_path()
        recommended_path = recommended_path or _default_recommended_path()

        self._catalog: dict[str, CatalogModel] = {
            m.id: m for m in load_catalog_models(catalog_path)
        }
        self._matrix = load_tier_matrix(recommended_path)
        self._selection = TypedSelection()
        self._cards: list[_ModelCardState] = []
        # A pre-seeded selection (CLI --model override or back-navigation)
        # counts as user intent: defaults must not stomp it.
        self._user_touched = False
        # v1.11.0 Phase 6 (T603): a category is "decided" when it has a
        # selection OR was explicitly skipped OR has no models; the flow blocks
        # leaving the page until every category is decided.
        self._skipped_categories: set[str] = set()
        self._skip_buttons: dict[str, QPushButton] = {}
        # T602: choices lock (read-only) once the install begins.
        self._interactive = True

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        title = QLabel("Choose Your Models")
        title.setObjectName("pageTitle")
        layout.addWidget(title)

        self._subtitle = QLabel("")
        self._subtitle.setStyleSheet(
            f"color: {TEXT_BODY}; font-size: {FS_BODY}px; background: transparent;"
        )
        self._subtitle.setWordWrap(True)
        layout.addWidget(self._subtitle)

        # v1.9.0 Phase 6 (T025): a compact per-provider color legend so the
        # per-maker card colors are self-explanatory. Shown only when more than
        # one provider is present (the catalog spans several); hidden otherwise.
        self._legend = QLabel("")
        self._legend.setTextFormat(Qt.TextFormat.RichText)
        self._legend.setStyleSheet(
            f"font-size: {FS_CAPTION}px; background: transparent;"
        )
        self._legend.setWordWrap(True)
        legend_html = self._provider_legend_html()
        self._legend.setText(legend_html)
        self._legend.setVisible(bool(legend_html))
        layout.addWidget(self._legend)

        self._tabs = QTabWidget()
        layout.addWidget(self._tabs, stretch=1)

        self._totals_label = QLabel("")
        self._totals_label.setStyleSheet(
            f"color: {ACCENT}; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._totals_label)

        # v1.9.0 Phase 4 (T403) footer: a Reset-to-recommended control that resets
        # the picks to the recommended set for the detected hardware, plus a
        # reassurance note. The wizard's global Next button is the Continue.
        footer_row = QHBoxLayout()
        footer_row.setSpacing(12)
        self._refresh_button = QPushButton("Reset to recommended")
        self._refresh_button.setObjectName("secondaryButton")
        self._refresh_button.setToolTip(
            "Reset the selection to the recommended models for your hardware."
        )
        self._refresh_button.clicked.connect(self._on_refresh_clicked)
        footer_row.addWidget(self._refresh_button)
        reassurance = QLabel(
            "You can add or remove models anytime after install from the Nexus "
            "model manager."
        )
        reassurance.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        reassurance.setWordWrap(True)
        footer_row.addWidget(reassurance, stretch=1)
        layout.addLayout(footer_row)

        # Ids not in the catalog are kept: the model router sends unknown
        # ids to `ollama pull` verbatim (the --model override contract).
        seeded = list(state.selected_model_ids)
        if seeded:
            self._selection.selected = set(seeded)
            self._user_touched = True
        else:
            self._selection.selected = set(self._current_defaults())

        self._rebuild_tabs()
        self._update_selection_state()

    # -----------------------------------------------------------------
    # Hardware-tier defaults
    # -----------------------------------------------------------------

    def _current_defaults(self) -> list[str]:
        tier = resolve_tier(self._state.vram_mb, self._state.gpu_vendor)
        return default_selection(
            self._catalog,
            self._matrix,
            tier,
            vram_gb=max(0, int(self._state.vram_mb / 1024)),
            free_disk_gb=self._state.free_disk_gb,
            reserve_gb=self._state.disk_reserve_gb,
        )

    def showEvent(self, event: object) -> None:  # noqa: N802
        """Refresh defaults on show: GPU detection finishes after __init__."""
        super().showEvent(event)  # type: ignore[arg-type]
        self.refresh_from_state()

    def refresh_from_state(self) -> None:
        """Recompute tier defaults + badges from the current installer state."""
        if not self._user_touched:
            self._selection.selected = set(self._current_defaults())
        self._rebuild_tabs()
        self._update_selection_state()

    def _on_refresh_clicked(self) -> None:
        """Reset the selection to the recommended set for the detected hardware.

        v1.9.0 Phase 4 (T403): the Reset-to-recommended control clears any manual
        picks and re-applies the tier defaults, so a user who over-edited can
        get back to the recommendation in one click.
        """
        self._user_touched = False
        self._selection.selected = set(self._current_defaults())
        self._rebuild_tabs()
        self._update_selection_state()

    # -----------------------------------------------------------------
    # Tab builders
    # -----------------------------------------------------------------

    def _provider_legend_html(self) -> str:
        """Rich-text provider color legend, or '' when <= 1 provider (T025).

        One "* Publisher" swatch per distinct provider in the catalog, each dot
        in that provider's color. Skipped gracefully for a single-provider view.
        """
        publishers = sorted(
            {publisher_for_family(m.family) for m in self._catalog.values()}
        )
        if len(publishers) <= 1:
            return ""
        parts = [
            f'<span style="color: {PROVIDER_COLORS.get(pub, ACCENT)};">&#9679;</span> '
            f'<span style="color: {TEXT_SECONDARY};">{pub}</span>'
            for pub in publishers
        ]
        return "&nbsp;&nbsp;&nbsp;".join(parts)

    def _rebuild_tabs(self) -> None:
        current = max(0, self._tabs.currentIndex())
        self._cards.clear()
        self._skip_buttons.clear()
        while self._tabs.count():
            page = self._tabs.widget(0)
            self._tabs.removeTab(0)
            if page is not None:
                page.deleteLater()

        vram_gb = max(0, int(self._state.vram_mb / 1024))
        self._subtitle.setText(
            f"Detected {self._state.gpu_name or 'no GPU'} ({vram_gb} GB VRAM). "
            "We've pre-selected the best fit for your hardware -- tick more to "
            "add them, or untick any you don't want. Each card is colored by its "
            "maker."
        )

        defaults = set(self._current_defaults())
        for key, label, icon in TYPE_TABS:
            self._tabs.addTab(
                self._build_tab(key, icon, vram_gb, self._state, defaults), label
            )
        self._tabs.setCurrentIndex(min(current, self._tabs.count() - 1))

    def _models_for_section(self, section_key: str) -> list[CatalogModel]:
        """Models shown under a tab.

        v1.9.0 Phase 4 (T404): the Agentic tab lists both the coding
        specialists (``type == "agentic"``) and agentic-capable chat models
        (the Gemma 4 family, which carry the ``agentic`` flag but render under
        Chat as their primary tab). Every other tab is an exact type match.
        """
        if section_key == "agentic":
            return [
                m for m in self._catalog.values() if m.type == "agentic" or m.agentic
            ]
        return [m for m in self._catalog.values() if m.type == section_key]

    def _sorted_section_models(
        self, section_key: str, defaults: set[str]
    ) -> list[CatalogModel]:
        """Models for a tab in display order.

        v1.9.0 Phase 4 (T404): the Agentic tab ranks the recommended default
        first, then the agentic-capable Gemma 4 variants (biggest first), then
        the coding specialists -- "Gemma 4 on top, coders below". Every other
        tab keeps the tier-default-first / newest / A-Z order.
        """
        models = self._models_for_section(section_key)
        if section_key == "agentic":

            def agentic_rank(m: CatalogModel) -> tuple[int, float, str]:
                if m.id in defaults:
                    group = 0
                elif m.task != "agentic":  # agentic-capable chat model (Gemma)
                    group = 1
                else:  # coding specialist
                    group = 2
                return (group, -float(m.required_vram_gb), m.display_name)

            models.sort(key=agentic_rank)
        else:
            models.sort(
                key=lambda m: (
                    m.id not in defaults,
                    -float(m.release_date.replace("-", "") or 0),
                    m.display_name,
                )
            )
        return models

    def _build_tab(
        self,
        section_key: str,
        icon: str,
        host_vram_gb: int,
        state: InstallerState,
        defaults: set[str],
    ) -> QWidget:
        # v1.9.0 Phase 6 (T022): the tab bar + section rule are neutral (a single
        # lead accent). Each card's color is keyed to the model's provider (via
        # provider_color(family)), so a model that appears in both Chat and
        # Agentic shows one consistent color rather than two per-tab colors.
        container = QWidget()
        outer = QVBoxLayout(container)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        accent_rule = QFrame()
        accent_rule.setFixedHeight(2)
        accent_rule.setStyleSheet(f"background-color: {ACCENT}; border: none;")
        outer.addWidget(accent_rule)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        inner = QWidget()
        layout = QVBoxLayout(inner)
        layout.setSpacing(8)

        models = self._sorted_section_models(section_key, defaults)

        if not models:
            empty_text = (
                "No audio models recommended yet."
                if section_key == "audio"
                else f"No {section_key} models in catalog."
            )
            empty = QLabel(empty_text)
            empty.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            layout.addWidget(empty)
        else:
            host_ram_gb = state.free_disk_gb  # placeholder until HostProfile threaded
            gpu_vendor = state.gpu_vendor or "none"
            for model in models:
                card = _ModelCard(
                    model,
                    recommended=model.id in defaults,
                    checked=model.id in self._selection.selected,
                    host_vram_gb=host_vram_gb,
                    host_ram_gb=host_ram_gb,
                    gpu_vendor=gpu_vendor,
                    accent=provider_color(model.family),
                )
                card.setSizePolicy(
                    QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed
                )
                card.checkbox.stateChanged.connect(
                    lambda _state, mid=model.id: self._on_checkbox_toggled(mid)
                )
                base_label = f"{model.display_name} -- {model.size_gb:.1f} GB"
                card.checkbox.setText("")
                self._cards.append(
                    _ModelCardState(
                        model=model, checkbox=card.checkbox, base_label=base_label
                    )
                )
                layout.addWidget(card)

        layout.addStretch()
        scroll.setWidget(inner)
        outer.addWidget(scroll)

        # v1.11.0 Phase 6 (T603): an explicit "Skip this category" control. The
        # category flow requires every category to be decided (a selection or a
        # skip) before Next may leave the page; this is the skip half.
        skip_row = QHBoxLayout()
        skip_row.setContentsMargins(0, 8, 0, 0)
        skip_row.addStretch()
        skip_btn = QPushButton("Skip this category")
        skip_btn.setObjectName("secondaryButton")
        skip_btn.setToolTip(
            "Mark this category as intentionally skipped so you can continue."
        )
        skip_btn.clicked.connect(
            lambda _checked=False, k=section_key: self._on_skip_clicked(k)
        )
        self._skip_buttons[section_key] = skip_btn
        skip_row.addWidget(skip_btn)
        outer.addLayout(skip_row)
        return container

    # -----------------------------------------------------------------
    # Selection state
    # -----------------------------------------------------------------

    def _on_checkbox_toggled(self, model_id: str) -> None:
        model = self._catalog.get(model_id)
        if model is None:
            return
        card = self._find_card(model_id)
        if card is None:
            return
        self._user_touched = True
        if card.checkbox.isChecked():
            self._selection.selected.add(model_id)
        else:
            self._selection.selected.discard(model_id)
        self._update_selection_state()

    def _find_card(self, model_id: str) -> _ModelCardState | None:
        for card in self._cards:
            if card.model.id == model_id:
                return card
        return None

    def _ordered_selection(self) -> list[str]:
        """Selection ids in a stable section-then-id order for the engine.

        Ids without a catalog entry sort last (unknown ids route to
        `ollama pull` verbatim -- the --model override contract).
        """
        tab_rank = {key: rank for rank, (key, _, _) in enumerate(TYPE_TABS)}

        def rank(mid: str) -> tuple[int, str]:
            model = self._catalog.get(mid)
            if model is None:
                return (len(TYPE_TABS) + 1, mid)
            return (tab_rank.get(model.type, len(TYPE_TABS)), mid)

        return sorted(self._selection.selected, key=rank)

    def _update_selection_state(self) -> None:
        total = self._selection.total_gb(self._catalog)
        self._state.selected_models_gb = total

        # v1.8.0 Phase 4 (OSI003.P3.D): publish the multi-selection the
        # protocol-routed model step consumes, and keep the legacy single
        # `selected_model` pointing at the chat pick for older consumers
        # (config write, review fallback).
        ordered = self._ordered_selection()
        self._state.selected_model_ids = ordered
        chat_picks = [
            mid
            for mid in ordered
            if mid in self._catalog and self._catalog[mid].task == "chat"
        ]
        if not chat_picks:
            # Custom --model overrides are typically ollama chat tags.
            chat_picks = [mid for mid in ordered if mid not in self._catalog]
        self._state.selected_model = chat_picks[0] if chat_picks else ""

        free = self._state.free_disk_gb
        reserve = self._state.disk_reserve_gb

        for card in self._cards:
            # v1.9.0 Phase 4 (T404): a model can appear in two tabs (a Gemma 4
            # variant renders under both Chat and Agentic). Sync every card's
            # checkbox to the shared selection so both stay in lockstep.
            want = card.model.id in self._selection.selected
            if card.checkbox.isChecked() != want:
                card.checkbox.blockSignals(True)
                card.checkbox.setChecked(want)
                card.checkbox.blockSignals(False)

            # v1.11.0 Phase 6 (T602): while the page is locked (install running),
            # every checkbox is read-only regardless of the disk/required logic.
            if not self._interactive:
                card.checkbox.setEnabled(False)
                card.disabled_for_disk = False
                continue

            # Required (embed) models are locked on while selected.
            if card.model.is_required and want:
                card.checkbox.setEnabled(False)
                card.checkbox.setToolTip("Required by the semantic memory layer.")
                card.disabled_for_disk = False
                continue
            if card.checkbox.isChecked():
                card.checkbox.setEnabled(True)
                card.checkbox.setToolTip("")
                card.disabled_for_disk = False
                continue
            if free <= 0:
                # Disk size unknown: leave checkboxes alone.
                card.checkbox.setEnabled(True)
                card.disabled_for_disk = False
                continue
            remaining = free - total - card.model.size_gb
            if remaining < reserve:
                card.checkbox.setEnabled(False)
                card.checkbox.setToolTip(self.DISK_TOOLTIP)
                card.disabled_for_disk = True
            else:
                card.checkbox.setEnabled(True)
                card.checkbox.setToolTip("")
                card.disabled_for_disk = False

        count = len(self._selection.selected)
        self._totals_label.setText(
            f"{count} model{'s' if count != 1 else ''} selected  --  "
            f"{total:.1f} GB total download"
        )
        if self._on_selection_changed:
            with contextlib.suppress(Exception):
                self._on_selection_changed(total)

        self._update_category_flow()

    def selection(self) -> TypedSelection:
        return self._selection

    # -----------------------------------------------------------------
    # Category flow (v1.11.0 Phase 6, T603)
    # -----------------------------------------------------------------

    def _section_ids(self, section_key: str) -> set[str]:
        return {m.id for m in self._models_for_section(section_key)}

    def _category_has_selection(self, section_key: str) -> bool:
        return bool(self._section_ids(section_key) & self._selection.selected)

    def _category_decided(self, section_key: str) -> bool:
        """A category is decided by a selection, an explicit skip, or emptiness."""
        if section_key in self._skipped_categories:
            return True
        if not self._models_for_section(section_key):
            return True
        return self._category_has_selection(section_key)

    def _first_undecided_index(self) -> int | None:
        """Tab index of the first category still needing a decision, if any."""
        for i, (key, _label, _icon) in enumerate(TYPE_TABS):
            if not self._category_decided(key):
                return i
        return None

    def _on_skip_clicked(self, section_key: str) -> None:
        """Toggle the explicit skip for a category."""
        if not self._interactive:
            return
        self._user_touched = True
        if section_key in self._skipped_categories:
            self._skipped_categories.discard(section_key)
        else:
            self._skipped_categories.add(section_key)
        self._update_category_flow()

    def _update_category_flow(self) -> None:
        """Refresh tab decided-marks, skip-button labels, and emit progress."""
        total = len(TYPE_TABS)
        done = 0
        for i, (key, label, _icon) in enumerate(TYPE_TABS):
            decided = self._category_decided(key)
            if decided:
                done += 1
            if i < self._tabs.count():
                prefix = "\u2713 " if decided else ""
                self._tabs.setTabText(i, f"{prefix}{label}")
            btn = self._skip_buttons.get(key)
            if btn is not None:
                has_sel = self._category_has_selection(key)
                # Skip is only meaningful when nothing is picked in the category.
                btn.setVisible(not has_sel)
                skipped = key in self._skipped_categories
                btn.setText(
                    "Category skipped -- click to undo"
                    if skipped
                    else "Skip this category"
                )
        self.category_progress.emit(done, total)

    def validate(self) -> tuple[bool, str]:
        """Block leaving the page until every category is decided (T603)."""
        undecided = self._first_undecided_index()
        if undecided is None:
            return True, ""
        self._tabs.setCurrentIndex(undecided)
        label = TYPE_TABS[undecided][1]
        return (
            False,
            f"Choose at least one {label} model, or click "
            f"\"Skip this category\" to continue.",
        )

    def set_interactive(self, enabled: bool) -> None:
        """Lock (read-only) or unlock the page's controls (T602)."""
        self._interactive = enabled
        self._refresh_button.setEnabled(enabled)
        for btn in self._skip_buttons.values():
            btn.setEnabled(enabled)
        if enabled:
            self._update_selection_state()
        else:
            for card in self._cards:
                card.checkbox.setEnabled(False)


# ---------------------------------------------------------------------------
# Default registry paths
# ---------------------------------------------------------------------------


def _registry_file(name: str) -> Path:
    """Locate `core/registry/<name>` (bundle, source tree, or editable).

    Delegates to the shared `registry_paths` resolver (v1.8.0 Phase 6),
    which checks the PyInstaller bundle (`sys._MEIPASS`) before walking up
    the source tree. A missing file is handled by the tolerant loaders.
    """
    return registry_paths.registry_file(name)


def _default_catalog_path() -> Path:
    return _registry_file("catalog.json")


def _default_recommended_path() -> Path:
    return _registry_file("recommended.json")


__all__ = [
    "CATALOG_TYPE_TO_TAB",
    "TASK_TO_TAB",
    "TYPE_TABS",
    "CatalogModel",
    "TypedCatalogPage",
    "TypedSelection",
    "compatibility_badge",
    "load_catalog_models",
]

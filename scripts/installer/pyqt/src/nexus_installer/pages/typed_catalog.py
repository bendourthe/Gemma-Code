"""v1.8.0 Phase 4 -- Chat / Agentic Coding / Image / Video / Audio model picker.

Evolves the v1.1.0 Text/Image/Video/Audio tabs: the Text tab is split into
**Chat** and **Agentic Coding** sections driven by the catalog's `task`
field, and each model card renders the Phase 4 copy (`strengths`,
`whyRecommended`, `differentiators`) alongside the existing VRAM / RAM /
disk fit, context window, censored flag, license, and release date.

Pre-ticked defaults come from the per-VRAM-tier matrix in
`core/registry/recommended.json` (schema v2) resolved against the detected
hardware by `nexus_installer.tier_defaults` -- including the uncensored
image/video defaults on tiers whose hardware fits them. Defaults are
recomputed on `showEvent` (GPU detection finishes after the wizard pages
are constructed) until the user touches a checkbox.

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

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QSizePolicy,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BORDER,
    ERROR,
    SECTION_ACCENTS,
    SUCCESS,
    TEXT_BODY,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    WARNING,
)
from nexus_installer.tier_defaults import (
    default_selection,
    load_tier_matrix,
    resolve_tier,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


TYPE_TABS: tuple[tuple[str, str, str], ...] = (
    # (section_key, tab_label, type_icon)
    ("chat", "Chat", "[C]"),
    ("agentic", "Agentic Coding", "[>]"),
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

    @property
    def is_text_model(self) -> bool:
        return self.type in ("chat", "agentic")


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
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(4)

        title_row = QHBoxLayout()
        self.checkbox = QCheckBox()
        self.checkbox.setChecked(checked)
        # v1.8.0 Phase 5 -- the checked state carries the section accent.
        self.checkbox.setStyleSheet(
            f"QCheckBox::indicator:checked {{ background-color: {accent}; "
            f"border-color: {accent}; }}"
        )
        title_row.addWidget(self.checkbox)

        release_suffix = (
            f"  --  released {model.release_date}" if model.release_date else ""
        )
        title = QLabel(f"{model.display_name}{release_suffix}")
        title.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-weight: bold; background: transparent;"
        )
        title.setWordWrap(True)
        title_row.addWidget(title, stretch=1)

        if recommended:
            badge = QLabel("Recommended")
            badge.setStyleSheet(
                f"color: {accent}; font-size: 10px; font-weight: bold; "
                f"border: 1px solid {accent}; border-radius: 3px; "
                f"padding: 1px 6px; background: transparent;"
            )
            title_row.addWidget(badge)

        size_label = QLabel(f"{model.size_gb:.1f} GB on disk")
        size_label.setStyleSheet(
            f"color: {accent}; font-weight: bold; background: transparent;"
        )
        title_row.addWidget(size_label)
        layout.addLayout(title_row)

        badge_text, badge_color = compatibility_badge(
            model,
            total_vram_gb=host_vram_gb,
            total_ram_gb=host_ram_gb,
            gpu_vendor=gpu_vendor,
        )
        badge = QLabel(badge_text)
        badge.setStyleSheet(
            f"color: {badge_color}; font-size: 11px; background: transparent;"
        )
        layout.addWidget(badge)

        if recommended and model.why_recommended:
            why = QLabel(f"Why this one: {model.why_recommended}")
            why.setStyleSheet(
                f"color: {accent}; font-size: 11px; background: transparent;"
            )
            why.setWordWrap(True)
            layout.addWidget(why)

        if model.is_text_model and (
            model.context_window_in or model.context_window_out
        ):
            ctx_text = "Context: "
            parts = []
            if model.context_window_in:
                parts.append(f"{model.context_window_in // 1000}k in")
            if model.context_window_out:
                parts.append(f"{model.context_window_out // 1000}k out")
            ctx_text += " / ".join(parts) if parts else "n/a"
            ctx = QLabel(ctx_text)
            ctx.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
            )
            layout.addWidget(ctx)

        meta_bits: list[str] = []
        if model.multimodal:
            meta_bits.append("Multimodal: text + image")
        if model.uncensored:
            meta_bits.append("Uncensored")
        if model.license_name:
            meta_bits.append(model.license_name)
        if meta_bits:
            meta = QLabel("  -  ".join(meta_bits))
            meta.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
            )
            meta.setWordWrap(True)
            layout.addWidget(meta)

        if model.description:
            desc = QLabel(model.description)
            desc.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
            )
            desc.setWordWrap(True)
            layout.addWidget(desc)

        if model.strengths:
            good_at = QLabel("Good at: " + "; ".join(model.strengths))
            good_at.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
            )
            good_at.setWordWrap(True)
            layout.addWidget(good_at)

        if model.differentiators:
            diff = QLabel(model.differentiators)
            diff.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 11px; font-style: italic; "
                f"background: transparent;"
            )
            diff.setWordWrap(True)
            layout.addWidget(diff)


class TypedCatalogPage(QWidget):
    """Sectioned catalog page (Chat / Agentic Coding / Image / Video / Audio)."""

    DISK_TOOLTIP = (
        "Would dip below the 10 GB OS reserve. Free up disk or untick another model."
    )

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

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        title = QLabel("Choose Your Models")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        self._subtitle = QLabel("")
        self._subtitle.setStyleSheet(
            f"color: {TEXT_BODY}; font-size: 13px; background: transparent;"
        )
        self._subtitle.setWordWrap(True)
        layout.addWidget(self._subtitle)

        self._tabs = QTabWidget()
        layout.addWidget(self._tabs, stretch=1)

        self._totals_label = QLabel("")
        self._totals_label.setStyleSheet(
            f"color: {ACCENT}; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._totals_label)

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

    # -----------------------------------------------------------------
    # Tab builders
    # -----------------------------------------------------------------

    def _rebuild_tabs(self) -> None:
        current = max(0, self._tabs.currentIndex())
        self._cards.clear()
        while self._tabs.count():
            page = self._tabs.widget(0)
            self._tabs.removeTab(0)
            if page is not None:
                page.deleteLater()

        vram_gb = max(0, int(self._state.vram_mb / 1024))
        self._subtitle.setText(
            f"Detected: {self._state.gpu_name or 'no GPU'} ({vram_gb} GB VRAM). "
            "We pre-selected the best fit for your hardware -- one chat and one "
            "agentic coding model, plus image and video where your GPU allows. "
            "Tick more to expand the install."
        )

        defaults = set(self._current_defaults())
        for key, label, icon in TYPE_TABS:
            self._tabs.addTab(
                self._build_tab(key, icon, vram_gb, self._state, defaults), label
            )
        self._tabs.setCurrentIndex(min(current, self._tabs.count() - 1))

    def _build_tab(
        self,
        section_key: str,
        icon: str,
        host_vram_gb: int,
        state: InstallerState,
        defaults: set[str],
    ) -> QWidget:
        # v1.8.0 Phase 5 -- each section carries its desktop module accent
        # (chat cyan, agentic magenta, image orange, video green).
        accent = SECTION_ACCENTS.get(section_key, ACCENT)

        container = QWidget()
        outer = QVBoxLayout(container)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        accent_rule = QFrame()
        accent_rule.setFixedHeight(2)
        accent_rule.setStyleSheet(f"background-color: {accent}; border: none;")
        outer.addWidget(accent_rule)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        inner = QWidget()
        layout = QVBoxLayout(inner)
        layout.setSpacing(8)

        models = [m for m in self._catalog.values() if m.type == section_key]
        models.sort(
            key=lambda m: (
                m.id not in defaults,
                -float(m.release_date.replace("-", "") or 0),
                m.display_name,
            )
        )

        if not models:
            empty_text = (
                "No audio models recommended yet."
                if section_key == "audio"
                else f"No {section_key} models in catalog."
            )
            empty = QLabel(empty_text)
            empty.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
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
                    accent=accent,
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

        self._totals_label.setText(
            f"Total: {total:.1f} GB across {len(self._selection.selected)} models."
        )
        if self._on_selection_changed:
            with contextlib.suppress(Exception):
                self._on_selection_changed(total)

    def selection(self) -> TypedSelection:
        return self._selection


# ---------------------------------------------------------------------------
# Default registry paths
# ---------------------------------------------------------------------------


def _registry_file(name: str) -> Path:
    """Locate `core/registry/<name>` by walking up from this module.

    Mirrors `engine.model_router.default_catalog_path`: works from the
    source tree and an editable install (the previous fixed-depth
    `parents[5]` landed on `scripts/`, a latent bug while this page was
    unwired). A missing file is handled by the tolerant loaders.
    """
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "core" / "registry" / name
        if candidate.is_file():
            return candidate
    return Path("core") / "registry" / name


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

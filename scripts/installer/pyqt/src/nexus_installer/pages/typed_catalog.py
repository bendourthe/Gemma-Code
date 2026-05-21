"""v1.1.0 Phase 14.6 -- Text / Image / Video / Audio tabbed model picker.

Replaces the v1.0.0 single-list recommended-models page. Each tab is fed by
`core/registry/catalog.json` (filtered to the matching `type`) and the
recommended set is read from `core/registry/recommended.json`. Each model
card surfaces VRAM / RAM / disk fit, context window, multimodality, censored
flag, license, and release date so the user has all the metadata needed to
decide before downloading.

The page collaborates with `InstallerState.selected_models_gb` and the
`DiskAwareFooter`: any selection change updates the state and triggers the
footer refresh. Checkboxes that would dip the host below the 10 GB OS
reserve are disabled with a tooltip.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from PyQt5.QtWidgets import (
    QCheckBox,
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
    SUCCESS,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
    WARNING,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


TYPE_TABS: tuple[tuple[str, str, str], ...] = (
    # (registry_key, tab_label, type_icon)
    ("text", "Text", "[T]"),
    ("image", "Image", "[I]"),
    ("video", "Video", "[V]"),
    ("audio", "Audio", "[A]"),
)

CATALOG_TYPE_TO_TAB = {
    "llm": "text",
    "embed": "text",
    "image": "image",
    "video": "video",
    "audio": "audio",
}


@dataclass(frozen=True)
class CatalogModel:
    """A single catalog entry with the metadata the typed UI surfaces."""

    id: str
    display_name: str
    type: str  # one of: text / image / video / audio
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

    @property
    def is_text_model(self) -> bool:
        return self.type == "text"


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
        raw_type = entry.get("type") or ""
        tab_type = CATALOG_TYPE_TO_TAB.get(raw_type)
        if tab_type is None:
            # VAEs, ControlNets, etc. are not user-facing top-level picks.
            continue
        models.append(
            CatalogModel(
                id=entry.get("id", ""),
                display_name=entry.get("displayName") or entry.get("id", ""),
                type=tab_type,
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
            )
        )
    return models


def load_recommended_ids(recommended_path: Path) -> dict[str, list[str]]:
    """Read `recommended.json` and return `{tab: [model_id, ...]}`."""
    empty = {key: [] for key, _, _ in TYPE_TABS}
    if not recommended_path.exists():
        return empty
    try:
        data = json.loads(recommended_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return empty
    out = dict(empty)
    for key, _, _ in TYPE_TABS:
        ids = data.get(key) or []
        if isinstance(ids, list):
            out[key] = [str(i) for i in ids]
    return out


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
    """One model card with metadata + checkbox."""

    def __init__(
        self,
        model: CatalogModel,
        *,
        recommended: bool,
        host_vram_gb: int,
        host_ram_gb: int,
        gpu_vendor: str,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.model = model
        self.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 10px;"
        )
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 8, 12, 8)
        layout.setSpacing(4)

        title_row = QHBoxLayout()
        self.checkbox = QCheckBox()
        self.checkbox.setChecked(recommended)
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

        size_label = QLabel(f"{model.size_gb:.1f} GB on disk")
        size_label.setStyleSheet(
            f"color: {ACCENT}; font-weight: bold; background: transparent;"
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
            layout.addWidget(meta)

        if model.description:
            desc = QLabel(model.description)
            desc.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
            )
            desc.setWordWrap(True)
            layout.addWidget(desc)


class TypedCatalogPage(QWidget):
    """Tabbed catalog page (Text / Image / Video / Audio)."""

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
        self._recommended: dict[str, list[str]] = load_recommended_ids(recommended_path)
        self._selection = TypedSelection()
        self._cards: list[_ModelCardState] = []

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        title = QLabel("Recommended Models")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        vram_gb = max(0, int(state.vram_mb / 1024))
        subtitle = QLabel(
            f"Detected: {state.gpu_name or 'no GPU'} ({vram_gb} GB VRAM). "
            "Pick the top item per type, or tick more to expand the install."
        )
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 13px; background: transparent;"
        )
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

        self._tabs = QTabWidget()
        for key, label, icon in TYPE_TABS:
            self._tabs.addTab(self._build_tab(key, icon, vram_gb, state), label)
        layout.addWidget(self._tabs, stretch=1)

        self._totals_label = QLabel("")
        self._totals_label.setStyleSheet(
            f"color: {ACCENT}; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._totals_label)

        self._update_selection_state()

    # -----------------------------------------------------------------
    # Tab builders
    # -----------------------------------------------------------------

    def _build_tab(
        self,
        registry_key: str,
        icon: str,
        host_vram_gb: int,
        state: InstallerState,
    ) -> QWidget:
        container = QWidget()
        outer = QVBoxLayout(container)
        outer.setContentsMargins(0, 0, 0, 0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        inner = QWidget()
        layout = QVBoxLayout(inner)
        layout.setSpacing(8)

        models = [m for m in self._catalog.values() if m.type == registry_key]
        models.sort(
            key=lambda m: (
                m.id not in self._recommended.get(registry_key, []),
                -float(m.release_date.replace("-", "") or 0),
                m.display_name,
            )
        )

        if not models:
            empty = QLabel(f"No {registry_key} models in catalog.")
            empty.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
            )
            layout.addWidget(empty)
        elif registry_key == "audio" and not self._recommended.get("audio"):
            empty = QLabel("No audio models recommended yet.")
            empty.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
            )
            layout.addWidget(empty)
        else:
            recommended_ids = set(self._recommended.get(registry_key, []))
            host_ram_gb = state.free_disk_gb  # placeholder until HostProfile threaded
            host_vram = host_vram_gb
            gpu_vendor = state.gpu_vendor or "none"
            for model in models:
                is_recommended = model.id in recommended_ids
                card = _ModelCard(
                    model,
                    recommended=is_recommended,
                    host_vram_gb=host_vram,
                    host_ram_gb=host_ram_gb,
                    gpu_vendor=gpu_vendor,
                )
                card.setSizePolicy(
                    QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed
                )
                if is_recommended:
                    self._selection.selected.add(model.id)
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

    def _update_selection_state(self) -> None:
        total = self._selection.total_gb(self._catalog)
        self._state.selected_models_gb = total
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


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _default_catalog_path() -> Path:
    return _repo_root() / "core" / "registry" / "catalog.json"


def _default_recommended_path() -> Path:
    return _repo_root() / "core" / "registry" / "recommended.json"


__all__ = [
    "TYPE_TABS",
    "CatalogModel",
    "TypedCatalogPage",
    "TypedSelection",
    "compatibility_badge",
    "load_catalog_models",
    "load_recommended_ids",
]

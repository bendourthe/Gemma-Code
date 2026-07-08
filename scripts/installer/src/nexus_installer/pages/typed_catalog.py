"""Chat / Agentic / Image / Video / Audio model picker.

The Text tab is split into **Chat** and **Agentic** sections driven by the
catalog's `task` field. v1.9.0 Phase 4: each card renders a scannable chip
row (Origin, Best-at, Agentic yes/no, Guardrails, context, license) plus a
prominent disk-size accent and a single status badge (Required / Recommended
/ Compatible), and the Agentic tab also lists agentic-capable chat models
(the Gemma 4 family, which set the `agentic` flag) ranked with Gemma 4 first
as the recommended agentic default and the coding specialists below.

Pre-ticked defaults come from the per-VRAM-tier matrix in
`core/registry/recommended.json` (schema v2) resolved against the detected
hardware by `nexus_installer.tier_defaults` -- including the uncensored
image/video defaults on tiers whose hardware fits them and the permissive
speech (audio) defaults on every tier. Defaults are recomputed on
`showEvent` (GPU detection finishes after the wizard pages are constructed)
until the user touches a checkbox; the Refresh Models control resets to them.

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
    SECTION_ACCENTS,
    SUCCESS,
    TEXT_BODY,
    TEXT_MUTED,
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


# Larger cyan selection boxes (T403): a 20px rounded indicator that fills with
# the section accent when checked. Formatted per-card with the section accent.
_CHECKBOX_QSS = (
    "QCheckBox::indicator {{ width: 20px; height: 20px; border-radius: 5px; "
    "border: 2px solid {border}; background: {bg}; }}"
    "QCheckBox::indicator:hover {{ border-color: {accent}; }}"
    "QCheckBox::indicator:checked {{ background-color: {accent}; "
    "border-color: {accent}; }}"
    "QCheckBox::indicator:disabled {{ border-color: {accent}; "
    "background-color: {accent}; }}"
)


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
        self.checkbox = QCheckBox()
        self.checkbox.setChecked(checked)
        # v1.9.0 Phase 4 (T403) -- larger cyan selection box carrying the
        # section accent. The required (embed) model is locked on.
        self.checkbox.setStyleSheet(
            _CHECKBOX_QSS.format(accent=accent, border=BORDER_STRONG, bg="transparent")
        )
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

        # --- Metadata chip row (Origin, Best-at, Agentic, Guardrails, ctx, license) ---
        chip_row = QHBoxLayout()
        chip_row.setSpacing(6)
        chip_row.setContentsMargins(28, 0, 0, 0)
        if model.origin:
            chip_row.addWidget(_pill(f"Origin: {model.origin}"))
        if model.strengths:
            best = model.strengths[0]
            if len(best) > 32:
                best = best[:29].rstrip() + "..."
            chip_row.addWidget(_pill(f"Best at: {best}"))
        if model.is_text_model:
            agentic_color = accent if model.agentic else TEXT_MUTED
            chip_row.addWidget(
                _pill(
                    f"Agentic: {'Yes' if model.agentic else 'No'}",
                    color=agentic_color,
                    border=agentic_color,
                )
            )
        guard = model.guardrails_label
        guard_color = WARNING if guard == "Uncensored" else TEXT_SECONDARY
        chip_row.addWidget(_pill(f"Guardrails: {guard}", color=guard_color))
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
        if model.license_name:
            chip_row.addWidget(_pill(model.license_name))
        chip_row.addStretch()
        layout.addLayout(chip_row)

        # --- Body copy: incompatibility note (if any), description, why-this-one ---
        if not fits:
            warn = QLabel(badge_text)
            warn.setStyleSheet(
                f"color: {badge_color}; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            warn.setWordWrap(True)
            layout.addWidget(warn)

        if model.description:
            desc = QLabel(model.description)
            desc.setStyleSheet(
                f"color: {TEXT_BODY}; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            desc.setWordWrap(True)
            layout.addWidget(desc)

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
        title.setObjectName("pageTitle")
        layout.addWidget(title)

        self._subtitle = QLabel("")
        self._subtitle.setStyleSheet(
            f"color: {TEXT_BODY}; font-size: {FS_BODY}px; background: transparent;"
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

        # v1.9.0 Phase 4 (T403) footer: a Refresh Models control that resets
        # the picks to the recommended set for the detected hardware, plus a
        # reassurance note. The wizard's global Next button is the Continue.
        footer_row = QHBoxLayout()
        footer_row.setSpacing(12)
        self._refresh_button = QPushButton("Refresh Models")
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

        v1.9.0 Phase 4 (T403): the Refresh Models control clears any manual
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
            "We pre-selected the best fit for your hardware -- a chat + agentic "
            "model (Gemma 4 handles both), the memory model, and speech, plus "
            "image and video where your GPU allows. Tick more to expand the "
            "install."
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
            # v1.9.0 Phase 4 (T404): a model can appear in two tabs (a Gemma 4
            # variant renders under both Chat and Agentic). Sync every card's
            # checkbox to the shared selection so both stay in lockstep.
            want = card.model.id in self._selection.selected
            if card.checkbox.isChecked() != want:
                card.checkbox.blockSignals(True)
                card.checkbox.setChecked(want)
                card.checkbox.blockSignals(False)

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

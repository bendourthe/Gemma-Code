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
import html
import json
import logging
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from PyQt5.QtCore import QPoint, QRect, QSize, Qt, pyqtSignal
from PyQt5.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLayout,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from nexus_installer import registry_paths
from nexus_installer.catalog_invariants import REQUIRED_EMBEDDER_ID
from nexus_installer.catalog_tab_sort import (
    canonical_display_order,
    catalog_fingerprint,
    release_ordinal,
)
from nexus_installer.catalog_tab_sort import (
    is_over_budget as shared_is_over_budget,
)
from nexus_installer.constants import (
    ACCENT,
    BADGE_DOWNLOADED,
    BADGE_RECOMMENDED,
    BORDER_STRONG,
    ERROR,
    FAMILY_TO_PUBLISHER,
    FS_BODY,
    FS_CAPTION,
    PROVIDER_COLORS,
    SUCCESS,
    TEXT_BODY,
    TEXT_MUTED,
    TEXT_SECONDARY,
    WARNING,
    provider_color,
    publisher_for_family,
    rgba_css,
)
from nexus_installer.engine.hf_weights_puller import resolve_models_root
from nexus_installer.engine.installed_models import (
    InstalledReport,
    probe_installed_models,
)
from nexus_installer.engine.model_router import (
    default_catalog_path,
    load_catalog_index,
)
from nexus_installer.tier_defaults import (
    default_selection,
    load_tier_matrix,
    resolve_tier,
)
from nexus_installer.vram_display import display_vram_gb
from nexus_installer.widgets.model_checkbox import ModelCheckBox
from nexus_installer.widgets.selectable_text import make_labels_selectable

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


TYPE_TABS: tuple[tuple[str, str, str], ...] = (
    # (section_key, tab_label, type_icon)
    # v2.2.9 Phase 5 (T010): Embeddings is its own first tab; embed rows no
    # longer park on Chat. Mirrored by desktop CATALOG_TAB_DEFS.
    ("embeddings", "Embeddings", "[E]"),
    # Document OCR / parsing sits right after Embeddings (both are the
    # retrieval side of the catalog); without a tab here `load_catalog_models`
    # drops any entry whose tab resolves to None.
    ("document", "Document", "[D]"),
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
# v2.2.9 Phase 5 (T010): embedding models render on their own Embeddings tab.
CATALOG_TYPE_TO_TAB = {
    "llm": "chat",
    "embed": "embeddings",
    "image": "image",
    "video": "video",
    "audio": "audio",
    "document": "document",
}

# Primary mapping: catalog `task` -> tab.
TASK_TO_TAB = {
    "chat": "chat",
    "agentic": "agentic",
    "embed": "embeddings",
    "image": "image",
    "video": "video",
    "audio": "audio",
    "document": "document",
}

# Tab -> the catalog `task` restored when an entry carries no task of its own.
_TAB_TO_FALLBACK_TASK = {"chat": "chat", "embeddings": "embed"}


# v1.12.0 Phase 3 (Q1) -- extreme-low-bit (BitNet-class) tier gate. Mirrors the
# TS core/registry/extremeLowBit.ts policy for the installer picker: a sub-4-bit
# ternary/1-bit entry is HIDDEN unless (a) the operator opts in via
# NEXUS_EXTREME_LOW_BIT=1 (the installer cannot runtime-probe Ollama before it is
# installed, so an explicit capability opt-in is the practical gate) AND (b) the
# entry carries an independent third-party benchmark -- and the uncorroborated
# Bonsai / PrismML vendor is never surfaced. Default hidden; the tier no-ops.
_EXTREME_LOW_BIT_QUANTS = frozenset(
    {"q1_0", "q2_0", "tq1_0", "tq2_0", "i2_s", "1bit", "ternary"}
)
_BLOCKED_VENDORS = ("bonsai", "prismml", "prism-ml")
_LOGGED_CONTEXT_JUNK: set[str] = set()
_LOGGER = logging.getLogger(__name__)


def _is_extreme_low_bit_quant(quant: str) -> bool:
    return quant.strip().lower() in _EXTREME_LOW_BIT_QUANTS


def _extreme_low_bit_allowed(entry: dict) -> bool:
    """True when a sub-4-bit entry may be surfaced.

    Requires the operator opt-in + an independent benchmark + a non-blocked
    vendor.
    """
    if os.environ.get("NEXUS_EXTREME_LOW_BIT", "") != "1":
        return False
    if not str(entry.get("benchmark") or "").strip():
        return False
    hay = " ".join(
        str(entry.get(k) or "") for k in ("id", "family", "provenance", "origin")
    ).lower()
    return not any(vendor in hay for vendor in _BLOCKED_VENDORS)


# v2.2.9 Phase 5 (T011): the v1.12.0 NEXUS_PATIENT_TIER hide is removed --
# patient-tier rows (Inkling-Small) are ordinary catalog rows in the wizard,
# exactly as in Settings (same rows on both surfaces). They are still never a
# recommended.json default, so they stay opt-in without being invisible.


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
    # v2.2.9 Phase 5 (T010): tri-state -- None means the catalog carries no
    # guardrails signal, so the Guardrails pill is omitted (never invented).
    uncensored: bool | None
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
    # v1.12.0 Phase 3 (Q1) -- GGUF quant label; BitNet-class values gate the tier.
    quant: str = ""
    # v1.19.0 Phase 1 -- ungated use-restriction copy + first-party license URL.
    license_note: str = ""
    license_url: str = ""
    requires_license: bool = False
    # v2.1.0 Phase 1 -- hide-below VRAM floor (GB). 0 means no floor.
    hide_below_vram_gb: int = 0
    # v2.1.0 Phase 1 -- minimum Ollama version, empty when ungated.
    min_ollama_version: str = ""
    role: str = ""
    # v1.18 DF-6 -- optional chip; omitted JSON keeps this False (no "unverified" pill).
    tool_calling_verified: bool = False
    # v2.2.9 Phase 5 (T010) -- pill-derivation sources (WN-7 dual-asserted
    # grammar shared with desktop modelPills.ts).
    modalities: tuple[str, ...] = ()
    vision: bool | None = None

    @property
    def is_text_model(self) -> bool:
        return self.type in ("chat", "agentic")

    @property
    def is_required(self) -> bool:
        """EmbeddingGemma 300M is required by the semantic memory layer.

        v2.4.1 field correction: its card gets a Required badge and a locked-on
        checkbox. Nomic and Qwen3-Embedding stay opt-in because swapping the
        default invalidates the on-disk memory index.
        """
        return self.id == REQUIRED_EMBEDDER_ID

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


def parse_context_window(
    value: object, *, model_id: str = "", field: str = "contextWindow"
) -> int:
    """Positive token count, or 0 when absent/invalid. Never invent 128000."""
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        _warn_context_junk(model_id, field)
        return 0
    if isinstance(value, (int, float)):
        number = int(value)
        return number if number > 0 else 0
    if isinstance(value, str) and value.strip():
        try:
            number = int(float(value.strip()))
            return number if number > 0 else 0
        except (TypeError, ValueError):
            pass
    _warn_context_junk(model_id, field)
    return 0


def _warn_context_junk(model_id: str, field: str) -> None:
    key = f"{model_id}:{field}"
    if key in _LOGGED_CONTEXT_JUNK:
        return
    _LOGGED_CONTEXT_JUNK.add(key)
    _LOGGER.warning("skip context chip for %s %s: non-numeric value", model_id, field)


def format_context_window_k(tokens: int) -> str:
    if tokens < 1000:
        return str(tokens)
    return f"{tokens // 1000}k"


def format_context_chip(
    context_window_in: int,
    context_window_out: int = 0,
    context_window: int = 0,
) -> str | None:
    """Chip copy such as ``Context: 128k`` or ``Context: 32k / 8k``.

    Returns None when neither window is a positive count. Never appends ``in``.
    """
    in_tok = context_window_in or context_window
    out_tok = context_window_out
    if in_tok and out_tok and in_tok != out_tok:
        return (
            f"Context: {format_context_window_k(in_tok)} / "
            f"{format_context_window_k(out_tok)}"
        )
    shown = in_tok or out_tok
    if shown <= 0:
        return None
    return f"Context: {format_context_window_k(shown)}"


# ---------------------------------------------------------------------------
# v2.2.9 Phase 5 (T010) -- the shared card grammar. One name-row pill set,
# derivation locked and dual-asserted against desktop modelPills.ts via
# tests/fixtures/v2.2.9-model-pills.json (WN-7 discipline). A pill whose
# source value is missing is omitted -- never "Unknown", never an invented
# "Community".
# ---------------------------------------------------------------------------

_RELEASE_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def format_released_pill(release_date: str) -> str | None:
    """``Released: May 2026`` from ISO ``YYYY-MM[-DD]`` (en-US month, ASCII)."""
    parts = (release_date or "").strip().split("-")
    try:
        year = int(parts[0])
        month = int(parts[1])
    except (IndexError, ValueError):
        return None
    if year <= 0 or not 1 <= month <= 12:
        return None
    return f"Released: {_RELEASE_MONTHS[month - 1]} {year}"


def format_context_window_pill(tokens: int) -> str | None:
    """``Context window: 262k tokens`` (raw count below 1k); None when absent."""
    if tokens <= 0:
        return None
    if tokens < 1000:
        return f"Context window: {tokens} tokens"
    return f"Context window: {tokens // 1000}k tokens"


def multimodal_pill_value(
    modalities: Sequence[str], vision: bool | None
) -> bool | None:
    """Yes when modalities go beyond text or vision is true; None when unsignaled."""
    if not modalities and vision is None:
        return None
    if vision is True:
        return True
    return any(m != "text" for m in modalities)


def derive_fact_pills(
    *,
    family: str,
    origin: str,
    task: str,
    type_: str,
    agentic: bool,
    context_tokens: int,
    modalities: Sequence[str],
    vision: bool | None,
    uncensored: bool | None,
    license_name: str,
    release_date: str,
) -> list[str]:
    """The ordered name-row pills (locked v2.2.9 grammar).

    Order: Company, Country, Agentic, Context window, Multimodal, Guardrails,
    License, Released. Any pill whose source value is missing is omitted.
    """
    pills: list[str] = []
    publisher = FAMILY_TO_PUBLISHER.get(family, "")
    if publisher and publisher != "Community":
        pills.append(f"Company: {publisher}")
    if origin:
        pills.append(f"Country: {origin}")
    if task in ("chat", "agentic") or type_ in ("llm", "chat", "agentic"):
        pills.append(f"Agentic: {'Yes' if agentic else 'No'}")
    context_pill = format_context_window_pill(context_tokens)
    if context_pill:
        pills.append(context_pill)
    multimodal = multimodal_pill_value(modalities, vision)
    if multimodal is not None:
        pills.append(f"Multimodal: {'Yes' if multimodal else 'No'}")
    if uncensored is not None:
        pills.append(f"Guardrails: {'Uncensored' if uncensored else 'Censored'}")
    if license_name:
        pills.append(f"License: {license_name}")
    released = format_released_pill(release_date)
    if released:
        pills.append(released)
    return pills


def build_fact_pills(model: CatalogModel) -> list[str]:
    """The locked pill row for a loaded catalog model (name-row order)."""
    return derive_fact_pills(
        family=model.family,
        origin=model.origin,
        task=model.task,
        type_=model.type,
        agentic=model.agentic,
        context_tokens=model.context_window_in or model.context_window_out,
        modalities=model.modalities,
        vision=model.vision,
        uncensored=model.uncensored,
        license_name=model.license_name,
        release_date=model.release_date,
    )


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
        tab = TASK_TO_TAB.get(raw_task)
        if tab is None:
            # VAEs, ControlNets, etc. are not user-facing top-level picks.
            continue
        quant = str(entry.get("quant") or "")
        if _is_extreme_low_bit_quant(quant) and not _extreme_low_bit_allowed(entry):
            # Extreme-low-bit (BitNet-class) tier stays hidden until opt-in + an
            # independent benchmark (the Q1 gate); default no-op.
            continue
        strengths = entry.get("strengths")
        if not isinstance(strengths, list):
            strengths = []
        modalities = entry.get("modalities")
        if not isinstance(modalities, list):
            modalities = []
        raw_uncensored = entry.get("uncensored")
        raw_vision = entry.get("vision")
        models.append(
            CatalogModel(
                id=entry.get("id", ""),
                display_name=entry.get("displayName") or entry.get("id", ""),
                type=tab,
                task=raw_task or _TAB_TO_FALLBACK_TASK.get(tab, tab),
                size_gb=_coerce_float(entry.get("sizeGB")),
                required_vram_gb=_coerce_int(
                    entry.get("requiredVramGB", entry.get("vramGB"))
                ),
                required_ram_gb=_coerce_int(entry.get("requiredRamGB")),
                release_date=str(entry.get("releaseDate") or ""),
                license_name=str(entry.get("license") or ""),
                context_window_in=parse_context_window(
                    entry.get("contextWindowIn")
                    if entry.get("contextWindowIn") is not None
                    else entry.get("contextWindow"),
                    model_id=str(entry.get("id") or ""),
                    field="contextWindowIn",
                ),
                context_window_out=parse_context_window(
                    entry.get("contextWindowOut"),
                    model_id=str(entry.get("id") or ""),
                    field="contextWindowOut",
                ),
                multimodal=bool(entry.get("multimodal")),
                uncensored=(None if raw_uncensored is None else bool(raw_uncensored)),
                description=str(entry.get("description") or ""),
                strengths=tuple(str(s) for s in strengths),
                why_recommended=str(entry.get("whyRecommended") or ""),
                differentiators=str(entry.get("differentiators") or ""),
                origin=str(entry.get("origin") or ""),
                agentic=bool(entry.get("agentic")),
                guardrails=str(entry.get("guardrails") or ""),
                family=str(entry.get("family") or ""),
                quant=quant,
                license_note=str(entry.get("licenseNote") or ""),
                license_url=str(entry.get("licenseUrl") or ""),
                requires_license=bool(entry.get("requiresLicense")),
                hide_below_vram_gb=_coerce_int(entry.get("hideBelowVramGB")),
                min_ollama_version=str(entry.get("minOllamaVersion") or ""),
                role=str(entry.get("role") or ""),
                tool_calling_verified=bool(entry.get("toolCallingVerified")),
                modalities=tuple(str(m) for m in modalities),
                vision=None if raw_vision is None else bool(raw_vision),
            )
        )
    return models


def _release_ordinal(value: str) -> int:
    """YYYYMMDD integer for newest-first sort; missing/invalid dates sort last."""
    return release_ordinal(value)


def _catalog_model_sort_row(
    model: CatalogModel,
    *,
    defaults: set[str] | None = None,
    recommend_order: Sequence[str] | None = None,
) -> dict[str, object]:
    tags: list[str] = []
    default_ids = defaults or set()
    del recommend_order
    if model.is_required:
        tags.append("required")
    elif model.id in default_ids:
        tags.append("recommended")
    return {
        "id": model.id,
        "displayName": model.display_name,
        "family": model.family or model.id,
        "vramGB": model.required_vram_gb,
        "requiredRamGB": model.required_ram_gb,
        "hideBelowVramGB": model.hide_below_vram_gb,
        "releaseDate": model.release_date,
        "tags": tags,
    }


def _is_over_budget(model: CatalogModel, host_vram_gb: int, gpu_vendor: str) -> bool:
    """True when a model needs more VRAM than the detected GPU provides.

    Over-budget models sort to the bottom of a tab and are disabled (v1.13.0
    Phase 4). A no-GPU host is over budget for any model that needs VRAM.
    """
    return shared_is_over_budget(
        {"vramGB": model.required_vram_gb},
        host_vram_gb,
        gpu_vendor,
    )


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
            f"Incompatible - needs {model.required_vram_gb} GB VRAM",
            ERROR,
        )
    if model.required_vram_gb > 0 and total_vram_gb < model.required_vram_gb:
        return (
            f"Incompatible - needs {model.required_vram_gb} GB VRAM",
            WARNING,
        )
    if model.required_ram_gb > 0 and total_ram_gb < model.required_ram_gb:
        if total_ram_gb <= 0:
            return (
                f"Incompatible - needs {model.required_ram_gb} GB RAM "
                "(RAM not detected)",
                WARNING,
            )
        return (
            f"Incompatible - needs {model.required_ram_gb} GB RAM "
            f"(you have {total_ram_gb})",
            WARNING,
        )
    if model.min_ollama_version:
        return (
            f"Requires Ollama {model.min_ollama_version}+",
            SUCCESS,
        )
    if model.required_vram_gb > 0:
        return f"Compatible - {model.required_vram_gb} GB VRAM", SUCCESS
    return "Compatible - CPU", SUCCESS


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
    if not fits:
        return compat_text, compat_color, False
    return compat_text, SUCCESS, True


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


#: Diameter of the round icon badges (compatibility, downloaded) on a card.
_ICON_BADGE_PX = 22


def _icon_badge(glyph: str, *, color: str, tooltip: str, object_name: str) -> QLabel:
    """A round filled icon badge whose meaning lives on the tooltip."""
    badge = QLabel(glyph)
    badge.setObjectName(object_name)
    badge.setToolTip(tooltip)
    badge.setAccessibleName(tooltip)
    badge.setFixedSize(_ICON_BADGE_PX, _ICON_BADGE_PX)
    badge.setAlignment(Qt.AlignmentFlag.AlignCenter)
    badge.setStyleSheet(
        f"color: {color}; background-color: {rgba_css(color, 0.18)}; "
        f"border: 1px solid {color}; border-radius: {_ICON_BADGE_PX // 2}px; "
        f"font-size: {FS_CAPTION}px; font-weight: bold;"
    )
    return badge


@dataclass
class _ModelCardState:
    """Track a card's checkbox + the model it represents."""

    model: CatalogModel
    checkbox: QCheckBox
    base_label: str = ""
    disabled_for_disk: bool = False
    over_budget: bool = False
    # v2.4.5 Phase 2.2: mirrored from the card so callers (and tests) can ask
    # about the downloaded state without holding a widget reference. Keeping a
    # QWidget here outlived QApplication teardown and crashed the suite with a
    # COM RPC_E_DISCONNECTED at interpreter shutdown.
    downloaded: bool = False


@dataclass
class TypedSelection:
    """Mutable record of which models the user has chosen across all tabs."""

    selected: set[str] = field(default_factory=set)

    def total_gb(self, lookup: dict[str, CatalogModel]) -> float:
        return sum(lookup[mid].size_gb for mid in self.selected if mid in lookup)


class _FlowLayout(QLayout):
    """Left-to-right layout that wraps items onto new lines (Qt flow example).

    v2.2.9 Phase 5 (T010): the card name row hosts the display name plus the
    fact pills; wrapping keeps every pill on the (multi-line) name row instead
    of pushing them under the description.
    """

    def __init__(self, parent: QWidget | None = None, spacing: int = 6) -> None:
        super().__init__(parent)
        self._items: list = []
        self.setSpacing(spacing)
        self.setContentsMargins(0, 0, 0, 0)

    def addItem(self, item) -> None:  # noqa: N802
        self._items.append(item)

    def count(self) -> int:
        return len(self._items)

    def itemAt(self, index: int):  # noqa: N802
        if 0 <= index < len(self._items):
            return self._items[index]
        return None

    def takeAt(self, index: int):  # noqa: N802
        if 0 <= index < len(self._items):
            return self._items.pop(index)
        return None

    def expandingDirections(self):  # noqa: N802
        return Qt.Orientations(Qt.Orientation(0))

    def hasHeightForWidth(self) -> bool:  # noqa: N802
        return True

    def heightForWidth(self, width: int) -> int:  # noqa: N802
        return self._do_layout(QRect(0, 0, width, 0), test_only=True)

    def setGeometry(self, rect: QRect) -> None:  # noqa: N802
        super().setGeometry(rect)
        self._do_layout(rect, test_only=False)

    def sizeHint(self) -> QSize:  # noqa: N802
        return self.minimumSize()

    def minimumSize(self) -> QSize:  # noqa: N802
        size = QSize()
        for item in self._items:
            size = size.expandedTo(item.minimumSize())
        margins = self.contentsMargins()
        size += QSize(
            margins.left() + margins.right(), margins.top() + margins.bottom()
        )
        return size

    def _do_layout(self, rect: QRect, *, test_only: bool) -> int:
        x = rect.x()
        y = rect.y()
        line_height = 0
        for item in self._items:
            hint = item.sizeHint()
            next_x = x + hint.width() + self.spacing()
            if next_x - self.spacing() > rect.right() and line_height > 0:
                x = rect.x()
                y += line_height + self.spacing()
                next_x = x + hint.width() + self.spacing()
                line_height = 0
            if not test_only:
                item.setGeometry(QRect(QPoint(x, y), hint))
            x = next_x
            line_height = max(line_height, hint.height())
        return y + line_height - rect.y()


class _FillScrollArea(QScrollArea):
    """Inner card list that does not inflate the outer wizard scroll.

    QScrollArea's default sizeHint is the full inner-widget height. Nested
    inside the window content scroll, that grows the Models page until the
    tab bar (and Reset) sit below the fold. Report a compact hint so the
    category list scrolls in place.
    """

    def sizeHint(self) -> QSize:
        return QSize(400, 280)

    def minimumSizeHint(self) -> QSize:
        return QSize(200, 160)


def _section_label(text: str) -> QLabel:
    label = QLabel(text)
    label.setStyleSheet(
        f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
        f"font-weight: 600; background: transparent; padding-top: 4px;"
    )
    return label


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
        downloaded: bool = False,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.model = model
        self.downloaded = downloaded
        # Scoped selector + WA_StyledBackground: an unqualified stylesheet
        # would propagate the border to every child QLabel (each line
        # rendered as its own boxed pill -- the pre-Phase-5 look).
        self.setObjectName("modelCard")
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        # The card carries a hint of its provider's color, so a Google card
        # and an Alibaba card read differently before a single word is read.
        self.setStyleSheet(
            f"QWidget#modelCard {{ background-color: {rgba_css(accent, 0.09)}; "
            f"border: 1px solid {rgba_css(accent, 0.30)}; border-radius: 8px; }}"
        )
        layout = QVBoxLayout(self)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(6)

        # v1.14.0 Phase 3: compute compatibility up front so the whole card can
        # dim (title + description, not just the size) when the model does not
        # fit the detected GPU -- a clearer "not selectable on your hardware".
        badge_text, badge_color, fits = _card_status(
            model,
            recommended=recommended,
            accent=accent,
            host_vram_gb=host_vram_gb,
            host_ram_gb=host_ram_gb,
            gpu_vendor=gpu_vendor,
        )
        #: False when the model needs more VRAM/RAM than the host has -- the
        #: page reads this to disable + dim the card (v1.13.0 Phase 4).
        self.fits = fits
        # The name takes the provider color; incompatible cards stay muted.
        title_color = accent if fits else TEXT_MUTED

        # --- Title row: [checkbox] name  [status badge]  [disk] ---
        title_row = QHBoxLayout()
        title_row.setSpacing(8)
        # v1.9.0 Phase 5 (T021) -- the custom-painted ModelCheckBox. `accent` is
        # the per-provider color; the required embedder is locked on by the
        # page in `_update_selection_state`, never silently forced here.
        self.checkbox = ModelCheckBox(accent=accent)
        self.checkbox.setChecked(checked)
        title_row.addWidget(self.checkbox)

        # v2.2.9 Phase 5 (T010): the name row is a wrapping flow of the display
        # name followed by the locked fact pills (Company, Country, Agentic,
        # Context window, Multimodal, Guardrails, License, Released). Pills sit
        # on this row, never under the description.
        header = QWidget()
        header.setObjectName("cardHeaderRow")
        header.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        header.setAutoFillBackground(False)
        header.setStyleSheet("background: transparent;")
        header_flow = _FlowLayout(header)
        title = QLabel(model.display_name)
        title.setStyleSheet(
            f"color: {title_color}; font-weight: bold; background: transparent;"
        )
        header_flow.addWidget(title)
        for pill_text in build_fact_pills(model):
            header_flow.addWidget(_pill(pill_text))
        if model.is_required:
            header_flow.addWidget(_pill("Required", color=accent, border=accent))
        elif recommended:
            header_flow.addWidget(
                _pill("Recommended", color=BADGE_RECOMMENDED, border=BADGE_RECOMMENDED)
            )
        if model.tool_calling_verified:
            header_flow.addWidget(
                _pill("Tool calling verified", color=accent, border=accent)
            )
        title_row.addWidget(header, stretch=1)

        # Right-hand badges, in order: storage required, compatibility icon,
        # downloaded icon. The two states are icons with the full wording on
        # the tooltip, so the row stays short on every card.
        size_label = _pill(f"{model.size_gb:.1f} GB", color=accent, border=accent)
        title_row.addWidget(size_label)

        status = _icon_badge(
            "✓" if fits else "!",
            color=badge_color,
            tooltip="Compatible" if fits else badge_text,
            object_name="compatBadge",
        )
        title_row.addWidget(status)

        # An ADDITIONAL badge, never a replacement for the compatibility one.
        # Overloading `_card_status` would drop a hardware incompatibility
        # warning on a model that happens to be downloaded -- the one case
        # where that warning matters most.
        if downloaded:
            downloaded_pill = _icon_badge(
                "⤓",
                color=BADGE_DOWNLOADED,
                tooltip="Downloaded",
                object_name="downloadedPill",
            )
            title_row.addWidget(downloaded_pill)
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
            # Over budget: dim the card with a dashed muted border so it reads
            # as unavailable, while the requirement note above stays readable.
            self.setStyleSheet(
                f"QWidget#modelCard {{ background-color: {rgba_css(accent, 0.04)}; "
                f"border: 1px dashed {BORDER_STRONG}; border-radius: 8px; }}"
            )
            size_label.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
                "background: transparent; "
                f"border: 1px solid {BORDER_STRONG}; border-radius: 9px; "
                "padding: 1px 8px;"
            )

        # --- Plain-language description leads the card (Phase 2 copy, T023) ---
        if model.description:
            desc = QLabel(model.description)
            desc_color = TEXT_BODY if fits else TEXT_MUTED
            desc.setStyleSheet(
                f"color: {desc_color}; font-size: {FS_BODY}px; background: transparent;"
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

        # v2.2.9 Phase 5 (T010): the old under-description chip row is gone --
        # every fact pill lives on the name row above (shared card grammar).

        # v1.19.0 Phase 1: ungated commercial-use restriction (not a download
        # gate). Rendered on the card so the cap cannot be silently dropped.
        if model.license_note:
            escaped = html.escape(model.license_note)
            if model.license_url:
                href = html.escape(model.license_url, quote=True)
                escaped = (
                    f'{escaped} <a href="{href}" style="color: {accent};">'
                    "License text</a>"
                )
            note = QLabel(
                f'<span style="color: {accent}; font-weight: 600;">'
                f"Use restriction:</span> {escaped}"
            )
            note.setObjectName("licenseNote")
            note.setTextFormat(Qt.TextFormat.RichText)
            note.setOpenExternalLinks(True)
            note.setWordWrap(True)
            note.setStyleSheet(
                f"color: {TEXT_BODY}; font-size: {FS_CAPTION}px; "
                f"background: transparent;"
            )
            layout.addWidget(note)

        # --- Why this one (recommended picks only) ---
        if recommended and model.why_recommended:
            why = QLabel(f"Why this one: {model.why_recommended}")
            why.setStyleSheet(
                f"color: {accent}; font-size: {FS_CAPTION}px; background: transparent;"
            )
            why.setWordWrap(True)
            layout.addWidget(why)

        # The badges keep their mouse events so their tooltips show on hover;
        # every other label stays selectable (the app-wide text filter) and
        # the card toggles from its checkbox or any non-text area.
        if fits:
            self.setCursor(Qt.CursorShape.PointingHandCursor)

    def mouseReleaseEvent(self, event: object) -> None:  # noqa: N802
        """Toggle from anywhere on a compatible card, not just the 20px box."""
        button = getattr(event, "button", None)
        pos = getattr(event, "pos", None)
        child = self.childAt(pos()) if callable(pos) else None
        if child is self.checkbox:
            super().mouseReleaseEvent(event)  # type: ignore[arg-type]
            return
        if (
            callable(button)
            and button() == Qt.MouseButton.LeftButton
            and self.checkbox.isEnabled()
        ):
            self.checkbox.toggle()
        super().mouseReleaseEvent(event)  # type: ignore[arg-type]


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
        # v2.4.5 Phase 2.1: injectable so tests are deterministic. The default
        # reads the real model stores under the user's home; a test that used
        # it would pass or fail based on what the developer had downloaded.
        installed_probe: Callable[[], InstalledReport] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._state = state
        self._on_selection_changed = on_selection_changed
        self._installed_probe = installed_probe
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        catalog_path = catalog_path or _default_catalog_path()
        recommended_path = recommended_path or _default_recommended_path()

        self._catalog: dict[str, CatalogModel] = {
            m.id: m for m in load_catalog_models(catalog_path)
        }
        catalog_data = json.loads(catalog_path.read_text(encoding="utf-8"))
        self.catalog_hash = catalog_fingerprint(catalog_data)
        self._matrix = load_tier_matrix(recommended_path)
        self._selection = TypedSelection()
        self._cards: list[_ModelCardState] = []
        # A pre-seeded selection (CLI --model override or back-navigation)
        # counts as user intent: defaults must not stomp it.
        self._user_touched = False
        # v2.4.5 Phase 2: probe bookkeeping. `_probed_models_root` avoids
        # re-walking the filesystem on every showEvent; `_downloaded_autoselected`
        # keeps auto-selection a first-load action so it never re-checks a model
        # the user deliberately deselected.
        self._probed_models_root: str | None = None
        self._downloaded_autoselected = False
        self._catalog_entry_cache: dict[str, dict] | None = None
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

        catalog_label = QLabel(f"Catalog {self.catalog_hash[:12]}")
        catalog_label.setStyleSheet(
            f"color: {TEXT_MUTED}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        layout.addWidget(catalog_label)

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
        self._tabs.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding
        )
        self._tabs.tabBar().setExpanding(False)
        self._refresh_button = QPushButton("Reset to recommended")
        self._refresh_button.setObjectName("secondaryButton")
        self._refresh_button.setToolTip(
            "Reset the selection to the recommended models for your hardware."
        )
        self._refresh_button.clicked.connect(self._on_refresh_clicked)
        self._tabs.setCornerWidget(self._refresh_button, Qt.Corner.TopRightCorner)
        layout.addWidget(self._tabs, stretch=1)

        self._totals_label = QLabel("")
        self._totals_label.setStyleSheet(
            f"color: {ACCENT}; font-weight: bold; background: transparent;"
        )
        self._totals_label.setWordWrap(True)
        layout.addWidget(self._totals_label)

        # v1.9.0 Phase 4 (T403): Reset lives on the category tab row so it stays
        # on screen. The note below is the only footer chrome on this page.
        reassurance = QLabel(
            "You can add or remove models anytime after install from the Nexus "
            "model manager."
        )
        reassurance.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: {FS_CAPTION}px; "
            f"background: transparent;"
        )
        reassurance.setWordWrap(True)
        layout.addWidget(reassurance)

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

    def sizeHint(self) -> QSize:
        """Stay viewport-sized so the window scroll does not hide the tab row."""
        return QSize(720, 560)

    def minimumSizeHint(self) -> QSize:
        return QSize(480, 400)

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
            # Rebuild from the tier defaults, but keep every already-downloaded
            # model that is currently selected. Auto-selection runs once per
            # session, so a second showEvent (Back from Configuration) used to
            # reset to the bare defaults and silently drop the downloaded
            # models it had pre-selected on the first visit.
            downloaded = {
                mid
                for mid in self._state.installed_report.downloaded
                if mid in self._catalog
            }
            kept = self._selection.selected & downloaded
            self._selection.selected = set(self._current_defaults()) | kept
        self._refresh_installed_report()
        self._apply_downloaded_autoselect()
        self._rebuild_tabs()
        self._update_selection_state()

    def _refresh_installed_report(self) -> None:
        """Probe both model stores for what is already on disk.

        Re-probed when `models_root` changes, because the install path moves
        the weights destination with it. Never raises: `probe_installed_models`
        fails open, and this wraps it once more so a page that cannot probe
        still shows its cards.
        """
        root = str(getattr(self._state, "models_root", "") or "")
        if root == self._probed_models_root and self._state.installed_report.downloaded:
            return
        try:
            if self._installed_probe is not None:
                report = self._installed_probe()
            else:
                report = probe_installed_models(
                    selection=list(self._catalog),
                    catalog=self._catalog_entries(),
                    sizes_gb={mid: m.size_gb for mid, m in self._catalog.items()},
                    models_root=resolve_models_root(self._state),
                    ollama_url=getattr(self._state, "ollama_url", None),
                )
        except Exception:  # noqa: BLE001 - a probe must never break the picker
            return
        self._state.installed_report = report
        self._probed_models_root = root

    def _catalog_entries(self) -> dict[str, dict]:
        """Raw catalog entries keyed by id, for protocol + pull-target routing."""
        if self._catalog_entry_cache is None:
            self._catalog_entry_cache = load_catalog_index(default_catalog_path())
        return self._catalog_entry_cache

    def _apply_downloaded_autoselect(self) -> None:
        """Select already-downloaded models, once per wizard session.

        Applied on the first population only. Re-applying on every rebuild
        would silently re-check a model the user had just deselected to skip
        its verification pass, which is a legitimate thing to want on a
        reinstall.
        """
        # A user who has touched the selection owns it. Without this guard,
        # deselecting an already-downloaded model to skip its verification pass
        # would be silently undone by the next refresh.
        if self._downloaded_autoselected or self._user_touched:
            return
        downloaded = self._state.installed_report.downloaded
        if not downloaded:
            return
        self._selection.selected |= {mid for mid in downloaded if mid in self._catalog}
        self._downloaded_autoselected = True

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
        shown_gb = display_vram_gb(self._state.vram_mb)
        self._subtitle.setText(
            f"Detected {self._state.gpu_name or 'no GPU'} ({shown_gb} GB VRAM). "
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
        # Removing tabs can drop the corner widget on some Qt builds; pin it
        # back onto the category row after every rebuild.
        self._tabs.setCornerWidget(self._refresh_button, Qt.Corner.TopRightCorner)
        # Cards were just rebuilt: every label on them is selectable.
        make_labels_selectable(self._tabs)

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
        self,
        section_key: str,
        host_vram_gb: int,
        gpu_vendor: str,
        defaults: set[str] | None = None,
        recommend_order: Sequence[str] | None = None,
    ) -> list[CatalogModel]:
        """Order a tab: required, then pre-selected defaults, then the rest.

        v2.4.1 field correction: pre-ticked hardware defaults lead the tab so
        the operator sees the required set first. Compatible opt-in rows
        follow (newest first). Over-budget rows stay at the bottom.

        v2.2.8 Phase 4: the comparison and order live in
        ``nexus_installer.catalog_tab_sort`` so Settings can dual-assert the
        same id list.
        """
        section = list(self._models_for_section(section_key))
        by_id = {m.id: m for m in section}
        ordered = canonical_display_order(
            [
                _catalog_model_sort_row(
                    model,
                    defaults=defaults,
                    recommend_order=recommend_order,
                )
                | {"task": model.task}
                for model in section
            ],
            host_vram_gb=host_vram_gb,
            host_ram_gb=self._state.total_ram_gb,
            gpu_vendor=gpu_vendor,
        )
        return [by_id[i] for i in ordered if i in by_id]

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

        scroll = _FillScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        inner = QWidget()
        layout = QVBoxLayout(inner)
        layout.setSpacing(8)

        gpu_vendor = state.gpu_vendor or "none"
        tier = resolve_tier(state.vram_mb, gpu_vendor)
        # recommended.json keeps its "embed" section key; the tab key differs.
        matrix_key = "embed" if section_key == "embeddings" else section_key
        recommend_order = list(self._matrix.get(tier, {}).get(matrix_key, []))
        models = self._sorted_section_models(
            section_key,
            host_vram_gb,
            gpu_vendor,
            defaults,
            recommend_order,
        )

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
            host_ram_gb = state.total_ram_gb
            required_header_added = False
            optional_header_added = False
            vram_divider_added = False
            for model in models:
                is_required_pick = model.is_required or model.id in defaults
                card = _ModelCard(
                    model,
                    recommended=model.id in defaults,
                    checked=model.id in self._selection.selected,
                    host_vram_gb=host_vram_gb,
                    host_ram_gb=host_ram_gb,
                    gpu_vendor=gpu_vendor,
                    accent=provider_color(model.family),
                    downloaded=self._state.installed_report.is_downloaded(model.id),
                )
                if card.fits and is_required_pick and not required_header_added:
                    layout.addWidget(_section_label("Required for this GPU"))
                    required_header_added = True
                elif card.fits and not is_required_pick and not optional_header_added:
                    layout.addWidget(_section_label("More compatible models"))
                    optional_header_added = True
                elif not card.fits and not vram_divider_added:
                    divider = QLabel("Needs more VRAM than this GPU")
                    divider.setStyleSheet(
                        f"color: {TEXT_MUTED}; font-size: {FS_CAPTION}px; "
                        f"background: transparent; padding-top: 6px;"
                    )
                    layout.addWidget(divider)
                    vram_divider_added = True
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
                        model=model,
                        checkbox=card.checkbox,
                        base_label=base_label,
                        over_budget=not card.fits,
                        downloaded=card.downloaded,
                    )
                )
                layout.addWidget(card)

        layout.addStretch()
        scroll.setWidget(inner)
        outer.addWidget(scroll, stretch=1)

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
        # v2.4.7 Phase 1.1 (T001): the SELECTION-scoped pending size.
        #
        # `installed_report` is deliberately probed over the whole catalog, so
        # every card can show its Downloaded pill -- which means the report's
        # own `pending_gb` is "every un-downloaded model in the catalog", not
        # "what this selection still needs". Reading that as a selection size
        # is what made Review claim `0 to download` beside `~157 GB to
        # download`, and it fed the install guard the same wrong number.
        #
        # Written in the same place as `selected_models_gb` so the two cannot
        # drift apart.
        downloaded = self._state.installed_report.downloaded
        self._state.pending_models_gb = sum(
            self._catalog[mid].size_gb
            for mid in self._selection.selected
            if mid in self._catalog and mid not in downloaded
        )
        # Disk arithmetic below charges only what still has to be fetched:
        # models already on disk consume no new space, so warning about the
        # whole selection told a host holding 220 GB of weights that it was
        # about to run out of room for a 9 GB download.
        pending_total = self._state.pending_models_gb
        already_total = max(0.0, total - pending_total)

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

            # v1.13.0 Phase 4: a model needing more VRAM than this GPU has is
            # not selectable (it is also sorted to the bottom and dimmed).
            if card.over_budget:
                card.checkbox.setEnabled(False)
                card.checkbox.setToolTip("Needs more VRAM than this GPU has.")
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
            remaining = free - pending_total - card.model.size_gb
            # Compatible cards stay selectable even when the current basket
            # would dip below the OS reserve. The totals line warns, and the
            # Review install guard still blocks a too-large download. Operators
            # can tick SANA (or any other fit) and untick a heavier default.
            card.checkbox.setEnabled(True)
            if remaining < reserve:
                card.checkbox.setToolTip(self.DISK_TOOLTIP)
                card.disabled_for_disk = True
            else:
                card.checkbox.setToolTip("")
                card.disabled_for_disk = False

        count = len(self._selection.selected)
        remaining_after = (free - pending_total) if free > 0 else None
        disk_short = remaining_after is not None and remaining_after < reserve
        suffix = (
            f"  --  leaves less than {int(reserve)} GB free; "
            "untick models to keep the OS reserve"
            if disk_short
            else ""
        )
        already = (
            f" ({already_total:.1f} GB already downloaded)" if already_total > 0 else ""
        )
        self._totals_label.setText(
            f"{count} model{'s' if count != 1 else ''} selected  --  "
            f"{pending_total:.1f} GB to download{already}{suffix}"
        )
        self._totals_label.setStyleSheet(
            f"color: {ERROR if disk_short else ACCENT}; font-weight: bold; "
            "background: transparent;"
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

    def try_advance_tab(self) -> bool:
        """Advance to the next category tab; return True if it consumed Next.

        v1.13.0 Phase 4: on the Models page, Next walks the tabs left-to-right
        (Chat -> Agentic -> Image -> Video -> Audio). Returns False when already
        on the last tab, so the wizard's Next then validates + leaves the page.
        """
        if not self._interactive:
            return False
        index = self._tabs.currentIndex()
        if index < self._tabs.count() - 1:
            self._tabs.setCurrentIndex(index + 1)
            return True
        return False

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
            f'"Skip this category" to continue.',
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
    "build_fact_pills",
    "compatibility_badge",
    "derive_fact_pills",
    "format_context_chip",
    "format_context_window_k",
    "format_context_window_pill",
    "format_released_pill",
    "load_catalog_models",
    "multimodal_pill_value",
    "parse_context_window",
]

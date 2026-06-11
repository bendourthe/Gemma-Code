"""Recommended-models picker page (Phase 9.5).

Presents the three preset bundles (Light / Recommended / Full) based on the
GPU class detected by the previous GPU-detection step. Each preset has a
checkbox per model so the user can deselect individual entries. An Advanced
tab lets the user browse the full catalog and pick arbitrary models.

The page is intentionally pure-Python with PyQt5; the underlying download
work is delegated to the model registry's resumable downloader (Phase 5.2),
which the installer accesses via the engine's `ModelPuller`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from PyQt5.QtCore import Qt
from PyQt5.QtWidgets import (
    QCheckBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QRadioButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    BG_CARD,
    BORDER,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
)

if TYPE_CHECKING:
    from nexus_installer.installer_state import InstallerState


@dataclass(frozen=True)
class ModelEntry:
    """A model row in a preset bundle or in the advanced catalog.

    `default_checked` lets a preset surface a model row that is visible
    but unticked by default -- the v1.1.0 Phase 13.3 opt-in pattern for
    SANA-Video 2B in the Light + Recommended presets (the row appears so
    the user can opt in for the extra 4 GB without having to swap presets
    or hunt through the Advanced tab).
    """

    model_id: str
    label: str
    size_gb: float
    description: str
    default_checked: bool = True


@dataclass(frozen=True)
class PresetBundle:
    """A preset bundle (Light / Recommended / Full)."""

    name: str
    summary: str
    min_vram_gb: int
    models: tuple[ModelEntry, ...]

    @property
    def total_gb(self) -> float:
        return sum(m.size_gb for m in self.models)


# v1.5.0 Phase 1 (adoption-ecosystem-2026-06 T001) -- Gemma 4 12B-IT GGUF
# quant ladder (Unsloth Dynamic-2.0). Mirrors
# modules/coding/config/Gemma4GgufQuants.ts so the installer can offer a
# quant matched to the detected VRAM. Pulled via
# `ollama run hf.co/unsloth/gemma-4-12b-it-GGUF:<QUANT>`.
GEMMA4_GGUF_OLLAMA_BASE = "hf.co/unsloth/gemma-4-12b-it-GGUF"


@dataclass(frozen=True)
class GgufQuant:
    """One GGUF quant of Gemma 4 12B-IT with its tier mapping."""

    quant: str
    disk_gb: float
    min_vram_gb: int
    ollama_ref: str
    hardware_tier: int


def _gguf_tier(min_vram_gb: int) -> int:
    """Classify VRAM (GB) into a Nexus hardware tier (matches classifyTier)."""
    if min_vram_gb < 10:
        return 1
    if min_vram_gb < 20:
        return 2
    return 3


def _gguf(quant: str, disk_gb: float, min_vram_gb: int) -> GgufQuant:
    return GgufQuant(
        quant=quant,
        disk_gb=disk_gb,
        min_vram_gb=min_vram_gb,
        ollama_ref=f"{GEMMA4_GGUF_OLLAMA_BASE}:{quant}",
        hardware_tier=_gguf_tier(min_vram_gb),
    )


GEMMA4_GGUF_QUANTS: tuple[GgufQuant, ...] = (
    _gguf("IQ2_M", 4.21, 6),
    _gguf("Q3_K", 6.0, 8),
    _gguf("Q4_K_XL", 7.37, 10),
    _gguf("Q5_K", 8.8, 12),
    _gguf("Q6_K", 10.7, 14),
    _gguf("BF16", 23.8, 26),
)

GEMMA4_GGUF_DEFAULT_QUANT = "Q4_K_XL"


LIGHT_PRESET = PresetBundle(
    name="Light",
    summary="8 GB VRAM, ~10 GB on disk -- fits most laptops with a discrete GPU.",
    min_vram_gb=8,
    models=(
        ModelEntry("gemma4:e2b", "Gemma 4 E2B", 2.3, "fast chat + tool use"),
        # v1.1.0 Phase 12.8 -- SANA-1.6B replaces SDXL Turbo as the default
        # image model. Sana-Sprint provides the Fast Preview tier.
        ModelEntry(
            "sana-1.6b-1024",
            "SANA 1.5 1.6B 1024px",
            3.2,
            "default text-to-image (Apache-2.0)",
        ),
        ModelEntry(
            "sana-sprint-1024",
            "SANA Sprint 1024px",
            3.5,
            "1-step Fast Preview tier",
        ),
        ModelEntry("ltx-video", "LTX-Video", 3.5, "short video clips"),
        # v1.1.0 Phase 13.3 -- SANA-Video appears as an opt-in row so the
        # user can add the Fast 720p tier without leaving the preset; the
        # row stays unchecked by default in Light + Recommended so the
        # extra 4 GB is explicit.
        ModelEntry(
            "sana-video-2b-720p",
            "SANA-Video 2B 720p",
            4.0,
            "Fast 720p video tier (opt-in)",
            default_checked=False,
        ),
    ),
)

RECOMMENDED_PRESET = PresetBundle(
    name="Recommended",
    summary="12 GB+ VRAM, ~25 GB on disk -- the default for new installs.",
    min_vram_gb=12,
    models=(
        ModelEntry("gemma4:e4b", "Gemma 4 E4B", 4.5, "balanced chat + coding"),
        ModelEntry("llama3.1:8b", "Llama 3.1 8B", 5.0, "general-purpose assistant"),
        # v1.5.0 Phase 1 (T001) -- Gemma 4 12B-IT GGUF (Q4_K_XL): multimodal,
        # 256K context. Opt-in so the extra ~7.4 GB is explicit.
        ModelEntry(
            "hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL",
            "Gemma 4 12B-IT GGUF (Q4_K_XL)",
            7.37,
            "multimodal 12B, 256K context (opt-in)",
            default_checked=False,
        ),
        # v1.1.0 Phase 12.8 -- SANA family replaces SDXL Turbo as the default.
        ModelEntry(
            "sana-1.6b-1024",
            "SANA 1.5 1.6B 1024px",
            3.2,
            "default text-to-image (Apache-2.0)",
        ),
        ModelEntry(
            "sana-sprint-1024",
            "SANA Sprint 1024px",
            3.5,
            "1-step Fast Preview tier",
        ),
        ModelEntry("ltx-video", "LTX-Video", 3.5, "short video clips"),
        ModelEntry("svd", "Stable Video Diffusion", 5.5, "image-to-video"),
        # v1.1.0 Phase 13.3 -- SANA-Video as opt-in (unchecked) in
        # Recommended too; ticked by default in Full only.
        ModelEntry(
            "sana-video-2b-720p",
            "SANA-Video 2B 720p",
            4.0,
            "Fast 720p video tier (opt-in)",
            default_checked=False,
        ),
    ),
)

FULL_PRESET = PresetBundle(
    name="Full",
    summary="24 GB+ VRAM, ~75 GB on disk -- the high-end creator preset.",
    min_vram_gb=24,
    models=(
        ModelEntry("gemma4:26b", "Gemma 4 26B MoE", 18.0, "long-context reasoning"),
        ModelEntry("llama3.1:8b", "Llama 3.1 8B", 5.0, "general-purpose assistant"),
        # v1.5.0 Phase 1 (T001) -- Gemma 4 12B-IT GGUF (Q6_K): the high-quality
        # quant for creator-tier hosts. Ticked by default in Full.
        ModelEntry(
            "hf.co/unsloth/gemma-4-12b-it-GGUF:Q6_K",
            "Gemma 4 12B-IT GGUF (Q6_K)",
            10.7,
            "multimodal 12B, 256K context, high-quality quant",
        ),
        ModelEntry(
            "qwen2.5-coder:7b",
            "Qwen 2.5 Coder 7B",
            4.5,
            "coding-focused assistant",
        ),
        # v1.1.0 Phase 12.8 -- SANA-1.6B + Sana-Sprint + SANA 2K / 4K.
        ModelEntry(
            "sana-1.6b-1024",
            "SANA 1.5 1.6B 1024px",
            3.2,
            "default text-to-image (Apache-2.0)",
        ),
        ModelEntry(
            "sana-sprint-1024",
            "SANA Sprint 1024px",
            3.5,
            "1-step Fast Preview tier",
        ),
        ModelEntry("sana-1.6b-2k", "SANA 1.6B 2K", 3.2, "2K text-to-image"),
        ModelEntry("sana-1.6b-4k", "SANA 1.6B 4K", 3.2, "4K text-to-image"),
        ModelEntry("sdxl-1.0", "SDXL 1.0", 7.0, "alternate text-to-image"),
        ModelEntry("flux-schnell", "Flux Schnell", 11.0, "premium text-to-image"),
        ModelEntry("ltx-video", "LTX-Video", 3.5, "short video clips"),
        ModelEntry("svd", "Stable Video Diffusion", 5.5, "image-to-video"),
        # v1.1.0 Phase 13.3 -- Full preset ticks SANA-Video by default
        # since the creator-tier user opted into the heaviest payload.
        ModelEntry(
            "sana-video-2b-720p",
            "SANA-Video 2B 720p",
            4.0,
            "Fast 720p video tier",
        ),
        ModelEntry("cogvideox-2b", "CogVideoX 2B", 14.0, "longer video generation"),
    ),
)

PRESETS: tuple[PresetBundle, ...] = (LIGHT_PRESET, RECOMMENDED_PRESET, FULL_PRESET)


def pick_default_preset(vram_gb: int) -> PresetBundle:
    """Return the largest preset that fits the detected VRAM."""
    for preset in (FULL_PRESET, RECOMMENDED_PRESET, LIGHT_PRESET):
        if vram_gb >= preset.min_vram_gb:
            return preset
    return LIGHT_PRESET


def estimate_download_minutes(total_gb: float, mbps: float = 200.0) -> int:
    """Rough estimate: minutes at the given throughput. Defaults to 200 Mbps."""
    if total_gb <= 0 or mbps <= 0:
        return 0
    bits = total_gb * 8 * 1024  # gigabits
    minutes = bits / max(mbps, 1.0) / 60.0
    return max(1, int(round(minutes)))


@dataclass
class ModelSelection:
    """Mutable record of which models the user has chosen."""

    preset: PresetBundle = field(default=RECOMMENDED_PRESET)
    selected_models: set[str] = field(default_factory=set)
    skipped: bool = False

    def total_gb(self) -> float:
        catalog = {m.model_id: m for preset in PRESETS for m in preset.models}
        return sum(catalog[m].size_gb for m in self.selected_models if m in catalog)


class _PresetCard(QWidget):
    """One preset card row with a radio toggle and the model checklist."""

    def __init__(
        self,
        preset: PresetBundle,
        is_default: bool,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.preset = preset
        self.setStyleSheet(
            f"background-color: {BG_CARD}; border: 1px solid {BORDER}; "
            f"border-radius: 8px; padding: 12px;"
        )
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 10)
        layout.setSpacing(8)

        title_row = QHBoxLayout()
        self.radio = QRadioButton(preset.name)
        self.radio.setChecked(is_default)
        title_row.addWidget(self.radio)
        size_label = QLabel(f"~{preset.total_gb:.1f} GB total")
        size_label.setStyleSheet(
            f"color: {ACCENT}; font-weight: bold; background: transparent;"
        )
        title_row.addStretch()
        title_row.addWidget(size_label)
        layout.addLayout(title_row)

        summary = QLabel(preset.summary)
        summary.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 11px; background: transparent;"
        )
        summary.setWordWrap(True)
        layout.addWidget(summary)

        self.model_boxes: list[QCheckBox] = []
        for model in preset.models:
            box = QCheckBox(
                f"{model.label}  --  {model.size_gb:.1f} GB  --  {model.description}"
            )
            box.setChecked(model.default_checked)
            box.setStyleSheet(
                f"color: {TEXT_PRIMARY}; background: transparent;"
            )
            self.model_boxes.append(box)
            layout.addWidget(box)

    def selected_model_ids(self) -> list[str]:
        return [
            model.model_id
            for model, box in zip(self.preset.models, self.model_boxes)
            if box.isChecked()
        ]


class RecommendedModelsPage(QWidget):
    """Picker page combining preset bundles + an Advanced catalog tab."""

    def __init__(
        self,
        state: "InstallerState",
        full_catalog: list[ModelEntry] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._state = state
        self._selection = ModelSelection()

        layout = QVBoxLayout(self)
        layout.setSpacing(12)

        title = QLabel("Recommended Models")
        title.setStyleSheet(
            "font-size: 24px; font-weight: bold; background: transparent;"
        )
        layout.addWidget(title)

        vram_gb = max(0, int(state.vram_mb / 1024))
        default = pick_default_preset(vram_gb)
        self._selection.preset = default
        # v1.1.0 Phase 13.3 -- only ticked-by-default rows seed the
        # initial selection. Opt-in rows (SANA-Video on Light /
        # Recommended) appear visible-but-unchecked until the user
        # explicitly opts in.
        self._selection.selected_models = {
            m.model_id for m in default.models if m.default_checked
        }

        subtitle = QLabel(
            f"Detected: {state.gpu_name or 'no GPU'} ({vram_gb} GB VRAM). "
            f"Default preset: {default.name}."
        )
        subtitle.setStyleSheet(
            f"color: {TEXT_SECONDARY}; font-size: 13px; background: transparent;"
        )
        layout.addWidget(subtitle)

        tabs = QTabWidget()
        tabs.addTab(self._build_presets_tab(default), "Presets")
        tabs.addTab(self._build_advanced_tab(full_catalog or []), "Advanced")
        layout.addWidget(tabs, stretch=1)

        self._totals_label = QLabel("")
        self._totals_label.setStyleSheet(
            f"color: {ACCENT}; font-weight: bold; background: transparent;"
        )
        layout.addWidget(self._totals_label)

        self._skip_box = QCheckBox(
            "Skip download for now (I'll run `nexus models install ...` later)"
        )
        self._skip_box.stateChanged.connect(self._on_skip)
        layout.addWidget(self._skip_box)

        self._refresh_totals()

    def _build_presets_tab(self, default: PresetBundle) -> QWidget:
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setSpacing(10)
        self._preset_cards: list[_PresetCard] = []
        for preset in PRESETS:
            card = _PresetCard(preset, preset is default)
            card.radio.toggled.connect(self._on_preset_changed)
            for box in card.model_boxes:
                box.stateChanged.connect(self._refresh_totals)
            self._preset_cards.append(card)
            layout.addWidget(card)
        layout.addStretch()
        return container

    def _build_advanced_tab(self, catalog: list[ModelEntry]) -> QWidget:
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setSpacing(6)
        if not catalog:
            empty = QLabel(
                "Advanced catalog is populated by the registry at first launch. "
                "Use `nexus models install <id>` after install to add more models."
            )
            empty.setStyleSheet(
                f"color: {TEXT_SECONDARY}; font-size: 12px; background: transparent;"
            )
            empty.setWordWrap(True)
            layout.addWidget(empty)
        else:
            self._advanced_boxes: list[tuple[ModelEntry, QCheckBox]] = []
            for entry in catalog:
                box = QCheckBox(
                    f"{entry.label}  --  {entry.size_gb:.1f} GB  --  {entry.description}"
                )
                box.stateChanged.connect(self._refresh_totals)
                self._advanced_boxes.append((entry, box))
                layout.addWidget(box)
        layout.addStretch()
        return container

    def _on_preset_changed(self) -> None:
        for card in self._preset_cards:
            if card.radio.isChecked():
                self._selection.preset = card.preset
                self._selection.selected_models = set(card.selected_model_ids())
                break
        self._refresh_totals()

    def _refresh_totals(self) -> None:
        selected: set[str] = set()
        for card in self._preset_cards:
            if card.radio.isChecked():
                selected.update(card.selected_model_ids())
        if hasattr(self, "_advanced_boxes"):
            for entry, box in self._advanced_boxes:
                if box.isChecked():
                    selected.add(entry.model_id)
        self._selection.selected_models = selected
        total_gb = self._selection.total_gb()
        minutes = estimate_download_minutes(total_gb)
        self._totals_label.setText(
            f"Total: {total_gb:.1f} GB across {len(selected)} models. "
            f"Estimated download: ~{minutes} min at 200 Mbps."
        )

    def _on_skip(self, state_value: int) -> None:
        checked = state_value == Qt.CheckState.Checked.value
        self._selection.skipped = checked

    def selection(self) -> ModelSelection:
        return self._selection

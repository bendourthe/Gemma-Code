"""v1.8.0 Phase 4 -- hardware-tier default model selection (T403/T404).

Pure logic, no Qt: resolves the hardware tier from the detected GPU and
returns the fit-gated default selection for that tier from
`core/registry/recommended.json`'s `tiers` matrix (schema version 2).

Rules encoded here (the T404 contract):

- Tier resolution: no GPU (or unknown VRAM) -> ``cpu``; otherwise the
  largest VRAM budget in :data:`GPU_TIERS` the card meets, with sub-8 GB
  GPUs using the ``8`` matrix (per-model fit-gating then drops entries
  the card cannot hold).
- Every selection includes at least one ``chat`` and one ``agentic``
  model: when the matrix pick does not fit the detected hardware, the
  best-fitting catalog model of that task is substituted (largest
  VRAM requirement that fits; smallest download on a tie), falling back
  to the smallest model of the task when nothing fits VRAM.
- ``image`` / ``video`` defaults are fit-gated with no substitution --
  the uncensored defaults are selected only where hardware fits (the
  v1.8.0 product decision); censored alternatives stay listed un-ticked.
- The ``cpu`` tier never selects image/video (diffusion requires a GPU)
  and ignores VRAM fit for chat/agentic/embed (Ollama offloads to RAM).
- Disk fit: cumulative selection must keep ``reserve_gb`` free; when the
  free-disk probe failed (``free_disk_gb <= 0``) selection is allowed and
  the Install-click guard re-checks.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Protocol

TIER_ORDER: tuple[str, ...] = ("cpu", "8", "12", "16", "24")

# Descending GPU VRAM budgets (GB) that name the non-cpu tiers.
GPU_TIERS: tuple[int, ...] = (24, 16, 12, 8)

# Selection order also defines the id order written to the installer state.
# v2.2.3 Phase 7 (7.1): document OCR joined as a multi-pick section so the
# Document tab pre-ticks a default (RapidOCR on low tiers, Unlimited-OCR 3B
# on GPU tiers that fit it).
SECTION_ORDER: tuple[str, ...] = (
    "chat",
    "agentic",
    "embed",
    "image",
    "video",
    "audio",
    "document",
)

# Sections that must always contribute at least one model.
GUARANTEED_SECTIONS: tuple[str, ...] = ("chat", "agentic")

# Sections that select exactly one default (the first fitting id in the tier's
# priority list). The remaining sections take every fitting id (e.g. audio
# defaults to both a speech-to-text and a text-to-speech model).
SINGLE_PICK_SECTIONS: tuple[str, ...] = ("chat", "agentic")

# Sections excluded entirely on GPU-less hosts.
GPU_ONLY_SECTIONS: tuple[str, ...] = ("image", "video")


class FitModel(Protocol):
    """The catalog attributes the default-selection logic reads."""

    id: str
    task: str
    size_gb: float
    required_vram_gb: int
    # v1.9.0 Phase 4 -- agentic-coding capability. Agentic-capable chat models
    # (Gemma 4) set this so they satisfy the `agentic` section without carrying
    # `task == "agentic"`. Optional on the protocol: `_qualifies` reads it via
    # getattr with a False default so pre-Phase-4 fit models still work.
    agentic: bool


def _qualifies(model: FitModel, section: str) -> bool:
    """Whether `model` can serve the given catalog section.

    v1.9.0 Phase 4: the ``agentic`` section accepts both the coding
    specialists (``task == "agentic"``) and agentic-capable chat models (the
    Gemma 4 family, which set the ``agentic`` flag but keep ``task ==
    "chat"``). Every other section requires an exact task match.
    """
    if section == "agentic":
        return model.task == "agentic" or bool(getattr(model, "agentic", False))
    return model.task == section


def resolve_tier(vram_mb: int, gpu_vendor: str) -> str:
    """Map detected hardware to a `recommended.json` tier key."""
    if not gpu_vendor or gpu_vendor == "none" or vram_mb <= 0:
        return "cpu"
    vram_gb = vram_mb / 1024
    for budget in GPU_TIERS:
        if vram_gb >= budget:
            return str(budget)
    return str(GPU_TIERS[-1])


def load_tier_matrix(recommended_path: Path) -> dict[str, dict[str, list[str]]]:
    """Read `recommended.json` and return `{tier: {section: [model_id]}}`.

    Tolerant like the catalog loader: a missing or malformed file yields an
    empty matrix (the page then pre-ticks nothing rather than crashing).
    """
    if not recommended_path.exists():
        return {}
    try:
        data = json.loads(recommended_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    tiers = data.get("tiers") if isinstance(data, dict) else None
    if not isinstance(tiers, dict):
        return {}
    matrix: dict[str, dict[str, list[str]]] = {}
    for tier, sections in tiers.items():
        if not isinstance(sections, dict):
            continue
        matrix[str(tier)] = {
            str(section): [str(i) for i in ids]
            for section, ids in sections.items()
            if isinstance(ids, list)
        }
    return matrix


def default_selection(
    models: Mapping[str, FitModel],
    matrix: Mapping[str, Mapping[str, Sequence[str]]],
    tier: str,
    *,
    vram_gb: int,
    free_disk_gb: int,
    reserve_gb: int,
) -> list[str]:
    """Return the fit-gated default model ids for the given tier, in order."""
    tier_map = matrix.get(tier, {})
    selected: list[str] = []
    total_gb = 0.0

    def fits_vram(model: FitModel) -> bool:
        if tier == "cpu":
            return True
        return model.required_vram_gb <= vram_gb

    def fits_disk(model: FitModel) -> bool:
        if free_disk_gb <= 0:
            return True
        return free_disk_gb - total_gb - model.size_gb >= reserve_gb

    def take(model: FitModel) -> None:
        nonlocal total_gb
        selected.append(model.id)
        total_gb += model.size_gb

    for section in SECTION_ORDER:
        if tier == "cpu" and section in GPU_ONLY_SECTIONS:
            continue
        single = section in SINGLE_PICK_SECTIONS
        picked = False
        for model_id in tier_map.get(section, []):
            model = models.get(model_id)
            if model is None:
                continue
            if model.id in selected:
                # Already chosen by an earlier section (e.g. the Gemma 4 chat
                # pick also covers the agentic section): the section is
                # satisfied, so a single-pick section adds no redundant model.
                if _qualifies(model, section):
                    picked = True
                    if single:
                        break
                continue
            if not _qualifies(model, section):
                continue
            if fits_vram(model) and fits_disk(model):
                take(model)
                picked = True
                if single:
                    break
        if picked or section not in GUARANTEED_SECTIONS:
            continue
        # Guaranteed-section fallback: best qualifying model that fits.
        candidates = [
            m
            for m in models.values()
            if _qualifies(m, section) and m.id not in selected
        ]
        fitting = [m for m in candidates if fits_vram(m) and fits_disk(m)]
        if fitting:
            best = max(fitting, key=lambda m: (m.required_vram_gb, -m.size_gb))
            take(best)
            continue
        # Nothing fits VRAM: take the smallest of the task that fits disk
        # (Ollama models still run via RAM offload; slow beats absent).
        by_size = sorted(candidates, key=lambda m: m.size_gb)
        for model in by_size:
            if fits_disk(model):
                take(model)
                break
    return selected


__all__ = [
    "GPU_ONLY_SECTIONS",
    "GPU_TIERS",
    "GUARANTEED_SECTIONS",
    "SECTION_ORDER",
    "SINGLE_PICK_SECTIONS",
    "TIER_ORDER",
    "FitModel",
    "default_selection",
    "load_tier_matrix",
    "resolve_tier",
]

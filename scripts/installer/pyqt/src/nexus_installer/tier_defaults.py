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
SECTION_ORDER: tuple[str, ...] = ("chat", "agentic", "embed", "image", "video", "audio")

# Sections that must always contribute at least one model.
GUARANTEED_SECTIONS: tuple[str, ...] = ("chat", "agentic")

# Sections excluded entirely on GPU-less hosts.
GPU_ONLY_SECTIONS: tuple[str, ...] = ("image", "video")


class FitModel(Protocol):
    """The catalog attributes the default-selection logic reads."""

    id: str
    task: str
    size_gb: float
    required_vram_gb: int


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
        picked = False
        for model_id in tier_map.get(section, []):
            model = models.get(model_id)
            if model is None or model.id in selected:
                continue
            if model.task != section:
                continue
            if fits_vram(model) and fits_disk(model):
                take(model)
                picked = True
        if picked or section not in GUARANTEED_SECTIONS:
            continue
        # Guaranteed-section fallback: best model of the task that fits.
        candidates = [
            m
            for m in models.values()
            if m.task == section and m.id not in selected
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
    "TIER_ORDER",
    "FitModel",
    "default_selection",
    "load_tier_matrix",
    "resolve_tier",
]

"""VRAM budget knobs for diffusion pipelines (v2.1.0 Phase 6)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


SLOW_DISK_MBPS = 80.0


@dataclass(frozen=True)
class MemoryBudget:
    max_cache_vram_gb: float
    max_cache_ram_gb: float
    working_mem_reserve_gb: float
    layer_streaming: bool


def validate_budget(
    budget: MemoryBudget,
    model_min_vram_gb: float,
    disk_sequential_mbps: Optional[float] = None,
) -> tuple[bool, list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    if budget.max_cache_vram_gb <= 0 or budget.max_cache_ram_gb <= 0 or budget.working_mem_reserve_gb < 0:
        errors.append("Budget numbers must be finite and non-negative (cache caps > 0).")
    usable = budget.max_cache_vram_gb - budget.working_mem_reserve_gb
    if usable < model_min_vram_gb and not budget.layer_streaming:
        errors.append(
            f"max_cache_vram_gb {budget.max_cache_vram_gb} minus reserve "
            f"{budget.working_mem_reserve_gb} is below the model minimum "
            f"{model_min_vram_gb} GB."
        )
    if (
        budget.layer_streaming
        and disk_sequential_mbps is not None
        and disk_sequential_mbps < SLOW_DISK_MBPS
    ):
        warnings.append(
            f"Layer streaming on a {disk_sequential_mbps} MB/s disk may thrash."
        )
    return len(errors) == 0, errors, warnings

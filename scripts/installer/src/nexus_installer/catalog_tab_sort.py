"""Shared Models-tab collapse + sort (v2.2.8 Phase 4).

Installer `typed_catalog._sorted_section_models` and desktop `visibleModelsOnTab`
must produce the same id order for the same rows: hideBelowVram, one best-fit
per family, required / recommended / compatible, then over-budget last.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def release_ordinal(value: str | None) -> int:
    """YYYYMMDD integer for newest-first sort; missing/invalid dates sort last."""
    text = (value or "").strip()
    parts = text.split("-")
    try:
        year = int(parts[0])
        month = int(parts[1]) if len(parts) > 1 else 0
        day = int(parts[2]) if len(parts) > 2 else 0
        return year * 10000 + month * 100 + day
    except (TypeError, ValueError):
        return 0


def row_vram(row: Mapping[str, Any]) -> float:
    raw = row.get("vramGB", row.get("vram_gb", 0)) or 0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def row_hide_below(row: Mapping[str, Any]) -> float:
    raw = row.get("hideBelowVramGB", row.get("hide_below_vram_gb", 0)) or 0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


def is_over_budget(
    row: Mapping[str, Any],
    host_vram_gb: int | float | None,
    gpu_vendor: str,
) -> bool:
    vram = row_vram(row)
    if vram <= 0:
        return False
    if gpu_vendor == "none":
        return True
    if host_vram_gb is None:
        return False
    return float(host_vram_gb) < vram


def is_hidden_by_vram_floor(
    row: Mapping[str, Any],
    host_vram_gb: int | float | None,
) -> bool:
    floor = row_hide_below(row)
    if floor <= 0 or host_vram_gb is None:
        return False
    if row.get("installed") and row.get("source") not in (None, "catalog-only"):
        return False
    return float(host_vram_gb) < floor


def is_required_row(row: Mapping[str, Any]) -> bool:
    tags = row.get("tags") or ()
    if "required" in tags:
        return True
    return row.get("type") == "embed" or row.get("task") == "embed"


def recommend_group(
    row: Mapping[str, Any],
    defaults: set[str],
    rec_rank: Mapping[str, int],
) -> int:
    row_id = str(row.get("id") or "")
    if row_id in defaults:
        return 0
    tags = row.get("tags") or ()
    if row_id in rec_rank or "recommended" in tags:
        return 1
    return 2


def display_name(row: Mapping[str, Any]) -> str:
    return str(row.get("displayName") or row.get("id") or "")


def collapse_and_sort(
    rows: Sequence[Mapping[str, Any]],
    *,
    host_vram_gb: int | float | None,
    gpu_vendor: str = "nvidia",
    defaults: set[str] | None = None,
    recommend_order: Sequence[str] | None = None,
) -> list[str]:
    """Return collapsed ids: required, recommended, compatible, over-budget."""
    default_ids = defaults or set()
    rec_rank = {model_id: index for index, model_id in enumerate(recommend_order or ())}
    visible = [r for r in rows if not is_hidden_by_vram_floor(r, host_vram_gb)]

    by_family: dict[str, list[Mapping[str, Any]]] = {}
    for row in visible:
        key = str(row.get("family") or row.get("id") or "")
        by_family.setdefault(key, []).append(row)

    enabled: list[Mapping[str, Any]] = []
    disabled: list[Mapping[str, Any]] = []
    for members in by_family.values():
        kept = [
            m
            for m in members
            if m.get("installed") and m.get("source") not in (None, "catalog-only")
        ]
        kept_ids = {str(m.get("id") or "") for m in kept}
        rest = [m for m in members if str(m.get("id") or "") not in kept_ids]
        enabled.extend(
            m for m in kept if not is_over_budget(m, host_vram_gb, gpu_vendor)
        )
        disabled.extend(m for m in kept if is_over_budget(m, host_vram_gb, gpu_vendor))
        if not rest:
            continue
        fitting = [m for m in rest if not is_over_budget(m, host_vram_gb, gpu_vendor)]
        over = [m for m in rest if is_over_budget(m, host_vram_gb, gpu_vendor)]
        if fitting:
            in_defaults = [m for m in fitting if str(m.get("id") or "") in default_ids]
            pool = in_defaults or fitting
            best = min(pool, key=lambda m: (-row_vram(m), display_name(m)))
            enabled.append(best)
            disabled.extend(over)
        else:
            disabled.append(min(rest, key=lambda m: (row_vram(m), display_name(m))))

    def enabled_key(m: Mapping[str, Any]) -> tuple:
        return (
            not is_required_row(m),
            recommend_group(m, default_ids, rec_rank),
            rec_rank.get(str(m.get("id") or ""), 10_000),
            -release_ordinal(str(m.get("releaseDate") or "")),
            -row_vram(m),
            display_name(m),
        )

    enabled.sort(key=enabled_key)
    disabled.sort(key=lambda m: (row_vram(m), display_name(m)))
    return [str(m.get("id") or "") for m in enabled + disabled]


def is_downloaded_row(row: Mapping[str, Any]) -> bool:
    """Installed-and-ready: probed on disk from a real source (not catalog-only)."""
    return bool(row.get("installed")) and row.get("source") not in (
        None,
        "catalog-only",
    )


def downloaded_first(
    rows: Sequence[Mapping[str, Any]],
    *,
    host_vram_gb: int | float | None,
    gpu_vendor: str = "nvidia",
    defaults: set[str] | None = None,
    recommend_order: Sequence[str] | None = None,
) -> list[str]:
    """Settings-only order (v2.2.9 Phase 5, T011).

    Partition installed-and-ready (downloaded) ids first, then the rest; each
    partition keeps the ``collapse_and_sort`` (installer recommendation) order.
    The installer picker itself never uses this -- it keeps pure installer
    order. Dual-asserted with desktop ``visibleModelsOnTab`` via
    tests/fixtures/v2.2.9-catalog-tab-sort.json.
    """
    ordered = collapse_and_sort(
        rows,
        host_vram_gb=host_vram_gb,
        gpu_vendor=gpu_vendor,
        defaults=defaults,
        recommend_order=recommend_order,
    )
    by_id = {str(r.get("id") or ""): r for r in rows}
    downloaded = [i for i in ordered if is_downloaded_row(by_id.get(i, {}))]
    downloaded_set = set(downloaded)
    return downloaded + [i for i in ordered if i not in downloaded_set]

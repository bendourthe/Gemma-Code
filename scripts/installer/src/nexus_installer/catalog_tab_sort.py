"""Shared legacy and v2.4.1 model display ordering helpers.

The v2.4.1 installer and desktop use ``canonical_display_order`` so every
selectable catalog row appears in the same deterministic order. The older
collapse helpers remain only for compatibility tests and callers outside the
new catalog surfaces.
"""

from __future__ import annotations

import hashlib
import json
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


def row_ram(row: Mapping[str, Any]) -> float:
    raw = row.get("requiredRamGB", row.get("ramGB", row.get("ram_gb", 0))) or 0
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


def is_incompatible(
    row: Mapping[str, Any],
    *,
    host_vram_gb: int | float | None,
    host_ram_gb: int | float | None,
    gpu_vendor: str,
) -> bool:
    if is_over_budget(row, host_vram_gb, gpu_vendor):
        return True
    ram = row_ram(row)
    return ram > 0 and host_ram_gb is not None and float(host_ram_gb) < ram


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
    return "required" in tags


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

    def enabled_key(m: Mapping[str, Any]) -> tuple[bool, int, int, int, float, str]:
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


def canonical_display_order(
    rows: Sequence[Mapping[str, Any]],
    *,
    host_vram_gb: int | float | None = None,
    host_ram_gb: int | float | None = None,
    gpu_vendor: str = "nvidia",
) -> list[str]:
    """Return every selectable catalog id in the stable v2.4.1 display order."""

    def tier(row: Mapping[str, Any]) -> int:
        tags = row.get("tags") or ()
        if "required" in tags:
            return 0
        if "recommended" in tags:
            return 1
        return 2

    selectable = [
        row
        for row in rows
        if str(row.get("task") or "").strip() and row.get("source") != "external"
    ]
    selectable.sort(
        key=lambda row: (
            is_incompatible(
                row,
                host_vram_gb=host_vram_gb,
                host_ram_gb=host_ram_gb,
                gpu_vendor=gpu_vendor,
            ),
            tier(row),
            -release_ordinal(str(row.get("releaseDate") or "")),
            display_name(row).casefold(),
            str(row.get("id") or "").casefold(),
        )
    )
    return [str(row.get("id") or "") for row in selectable]


def settings_display_order(
    rows: Sequence[Mapping[str, Any]],
    *,
    host_vram_gb: int | float | None = None,
    host_ram_gb: int | float | None = None,
    gpu_vendor: str = "nvidia",
) -> list[str]:
    """Settings order: downloaded, compatible catalog, incompatible catalog."""
    canonical_ids = canonical_display_order(
        rows,
        host_vram_gb=host_vram_gb,
        host_ram_gb=host_ram_gb,
        gpu_vendor=gpu_vendor,
    )
    by_id = {str(row.get("id") or ""): row for row in rows}

    def availability(model_id: str) -> int:
        row = by_id.get(model_id, {})
        if is_downloaded_row(row):
            return 0
        return (
            2
            if is_incompatible(
                row,
                host_vram_gb=host_vram_gb,
                host_ram_gb=host_ram_gb,
                gpu_vendor=gpu_vendor,
            )
            else 1
        )

    return sorted(canonical_ids, key=availability)


def catalog_fingerprint(catalog: Mapping[str, Any]) -> str:
    def normalize(value: Any) -> Any:
        if isinstance(value, float) and value.is_integer():
            return int(value)
        if isinstance(value, Mapping):
            return {str(key): normalize(item) for key, item in value.items()}
        if isinstance(value, Sequence) and not isinstance(
            value, (str, bytes, bytearray)
        ):
            return [normalize(item) for item in value]
        return value

    payload = json.dumps(
        normalize(catalog), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()

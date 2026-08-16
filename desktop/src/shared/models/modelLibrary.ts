/**
 * v1.16.0 Phase 5 (adoption item A4) -- pure catalog-discovery helpers for
 * Settings > Models. Search, source, and tier-fit filtering live here so the
 * page and its tests share one rule, and so the v1.15 list/install/remove
 * client is not duplicated.
 */

import type { ListedModelDto, ModelType } from "../../pages/settings/modelsTypes";

export type SourceFilter = "all" | "installed" | "available" | "external";
export type TierFitFilter = "all" | "fits" | "over-budget";

export interface CatalogFilter {
  readonly query?: string;
  readonly type?: "all" | ModelType;
  readonly family?: string;
  readonly source?: SourceFilter;
  readonly tierFit?: TierFitFilter;
  readonly hostVramGB?: number | null;
}

/**
 * Whether `model` fits the host's VRAM. `null` means we cannot tell (the
 * catalog entry has no `vramGB`, or the host VRAM is unknown). RapidOCR-class
 * entries with `vramGB: 0` always fit.
 */
export function modelFitsHost(
  model: ListedModelDto,
  hostVramGB: number | null | undefined,
): boolean | null {
  if (typeof model.vramGB !== "number") return null;
  if (typeof hostVramGB !== "number") return null;
  return model.vramGB <= hostVramGB;
}

export function sourceLabel(source: ListedModelDto["source"]): string {
  switch (source) {
    case "registry":
      return "Installed";
    case "catalog-only":
      return "Available";
    case "external":
      return "External";
  }
}

export function filterCatalog(
  models: readonly ListedModelDto[],
  filter: CatalogFilter,
): ListedModelDto[] {
  const query = (filter.query ?? "").trim().toLowerCase();
  const type = filter.type ?? "all";
  const family = filter.family ?? "all";
  const source = filter.source ?? "all";
  const tierFit = filter.tierFit ?? "all";

  return models.filter((m) => {
    if (type !== "all" && m.type !== type) return false;
    if (family !== "all" && m.family !== family) return false;
    if (source === "installed" && m.source !== "registry") return false;
    if (source === "available" && m.source !== "catalog-only") return false;
    if (source === "external" && m.source !== "external") return false;
    if (tierFit !== "all") {
      const fits = modelFitsHost(m, filter.hostVramGB);
      if (tierFit === "fits" && fits !== true) return false;
      if (tierFit === "over-budget" && fits !== false) return false;
    }
    if (query) {
      const hay = `${m.id} ${m.displayName} ${m.family ?? ""} ${m.type ?? ""} ${(m.tags ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

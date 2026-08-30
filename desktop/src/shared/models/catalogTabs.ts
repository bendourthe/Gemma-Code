/**
 * v2.2.4 Phase 5 -- Settings > Models tab assignment, matching the
 * installer typed catalog (Chat / Agentic / Image / Video / Audio / Document).
 *
 * Unknown tasks land in Other so a catalog row is never dropped.
 */

import type { ListedModelDto, ModelType } from "../../pages/settings/modelsTypes";
import {
  canonicalModelDisplayOrder,
  installedOutsideCatalog,
} from "../../../../core/registry/modelDisplayPolicy";

export type CatalogTab =
  | "embeddings"
  | "chat"
  | "agentic"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "other";

/**
 * v2.2.9 Phase 5 (T010): Embeddings is its own first tab, before Chat --
 * embed rows no longer park on Chat. Mirrors installer TYPE_TABS.
 */
export const CATALOG_TAB_DEFS: readonly { id: CatalogTab; label: string }[] = [
  { id: "embeddings", label: "Embeddings" },
  { id: "chat", label: "Chat" },
  { id: "agentic", label: "Agentic" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "document", label: "Document" },
];

const TASK_TAB: Record<string, CatalogTab> = {
  chat: "chat",
  embed: "embeddings",
  agentic: "agentic",
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
};

const TYPE_TAB: Partial<Record<ModelType, CatalogTab>> = {
  llm: "chat",
  embed: "embeddings",
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
};

export function primaryCatalogTab(model: Pick<ListedModelDto, "task" | "type">): CatalogTab {
  const fromTask = model.task ? TASK_TAB[model.task] : undefined;
  if (fromTask) return fromTask;
  const fromType = model.type ? TYPE_TAB[model.type] : undefined;
  if (fromType) return fromType;
  return "other";
}

/** Chat models with `agentic: true` also appear on the Agentic tab, as in the installer. */
export function catalogTabsFor(
  model: Pick<ListedModelDto, "task" | "type" | "agentic">,
): CatalogTab[] {
  const primary = primaryCatalogTab(model);
  if (model.agentic && primary === "chat") return ["chat", "agentic"];
  return [primary];
}

export function modelsOnTab(
  models: readonly ListedModelDto[],
  tab: CatalogTab,
): ListedModelDto[] {
  return models.filter((m) => catalogTabsFor(m).includes(tab));
}

export function installedOutsideCatalogModels(
  models: readonly ListedModelDto[],
): ListedModelDto[] {
  return installedOutsideCatalog(models);
}

export type RecommendationKind = "required" | "recommended" | "compatible";

export function recommendationKind(
  model: Pick<ListedModelDto, "tags" | "type" | "task">,
): RecommendationKind {
  const tags = model.tags ?? [];
  if (tags.includes("required")) {
    return "required";
  }
  if (tags.includes("recommended")) return "recommended";
  return "compatible";
}

/**
 * v2.2.5 Phase 3 -- installer `_card_status` priority: Required, then
 * hardware incompatibility, then Recommended, then Compatible. Over-budget
 * rows never display Compatible. Missing VRAM numbers do not invent Compatible.
 */
export function cardBadgeLabel(
  model: Pick<ListedModelDto, "tags" | "type" | "task" | "vramGB">,
  hostVramGB: number | null | undefined,
): string {
  const kind = recommendationKind(model);
  if (kind === "required") return "Required";
  const fits =
    typeof model.vramGB === "number" && typeof hostVramGB === "number"
      ? model.vramGB <= hostVramGB
      : null;
  if (fits === false) return `Needs ${model.vramGB} GB VRAM`;
  if (kind === "recommended") return "Recommended";
  if (fits === null) return "";
  return "Compatible";
}

export function catalogSortRank(
  model: Pick<ListedModelDto, "tags" | "type" | "task" | "vramGB">,
  hostVramGB: number | null | undefined,
): number {
  const kind = recommendationKind(model);
  const fits =
    typeof model.vramGB === "number" && typeof hostVramGB === "number"
      ? model.vramGB <= hostVramGB
      : null;
  if (kind === "required") return 0;
  if (fits === false) return 3;
  if (kind === "recommended") return 1;
  return 2;
}

export function sortModelsOnTab(
  models: readonly ListedModelDto[],
  hostVramGB: number | null | undefined,
): ListedModelDto[] {
  return [...models].sort((a, b) => {
    const rank = catalogSortRank(a, hostVramGB) - catalogSortRank(b, hostVramGB);
    if (rank !== 0) return rank;
    const da = a.releaseDate ?? "";
    const db = b.releaseDate ?? "";
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return db.localeCompare(da);
    }
    return (a.displayName || a.id).localeCompare(b.displayName || b.id);
  });
}

/**
 * v2.2.8 Phase 4 -- installer `catalog_tab_sort.collapse_and_sort`.
 * Hide `hideBelowVramGB` rows, keep one best-fit per family, then
 * required / recommended / compatible, with over-budget last.
 */
export interface CatalogSortOptions {
  hostVramGB?: number | null;
  gpuVendor?: string;
  defaults?: ReadonlySet<string>;
  recommendOrder?: readonly string[];
}

export function catalogSortGpuVendor(hostVramGB: number | null | undefined): string {
  return hostVramGB === 0 ? "none" : "nvidia";
}

function rowVram(model: Pick<ListedModelDto, "vramGB">): number {
  return typeof model.vramGB === "number" ? model.vramGB : 0;
}

function releaseOrdinal(value: string | undefined): number {
  const text = (value ?? "").trim();
  const parts = text.split("-");
  const year = Number(parts[0]);
  if (!Number.isFinite(year)) return 0;
  const month = Number(parts[1] ?? 0);
  const day = Number(parts[2] ?? 0);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return 0;
  return year * 10000 + month * 100 + day;
}

function isDownloaded(model: Pick<ListedModelDto, "installed" | "source">): boolean {
  return Boolean(model.installed && model.source && model.source !== "catalog-only");
}

export function isCatalogOverBudget(
  model: Pick<ListedModelDto, "vramGB">,
  hostVramGB: number | null | undefined,
  gpuVendor: string,
): boolean {
  const vram = rowVram(model);
  if (vram <= 0) return false;
  if (gpuVendor === "none") return true;
  if (typeof hostVramGB !== "number") return false;
  return hostVramGB < vram;
}

export function isHiddenByVramFloor(
  model: Pick<ListedModelDto, "hideBelowVramGB" | "installed" | "source">,
  hostVramGB: number | null | undefined,
): boolean {
  const floor = model.hideBelowVramGB ?? 0;
  if (floor <= 0 || typeof hostVramGB !== "number") return false;
  if (isDownloaded(model)) return false;
  return hostVramGB < floor;
}

function recommendGroup(
  model: Pick<ListedModelDto, "id" | "tags">,
  defaults: ReadonlySet<string>,
  recRank: ReadonlyMap<string, number>,
): number {
  if (defaults.has(model.id)) return 0;
  const tags = model.tags ?? [];
  if (recRank.has(model.id) || tags.includes("recommended")) return 1;
  return 2;
}

function nameOf(model: Pick<ListedModelDto, "id" | "displayName">): string {
  return model.displayName || model.id;
}

function pickHighestVramThenName(rows: readonly ListedModelDto[]): ListedModelDto {
  const ranked = [...rows].sort(
    (a, b) => rowVram(b) - rowVram(a) || nameOf(a).localeCompare(nameOf(b)),
  );
  return ranked[0] ?? rows[0]!;
}

function pickLowestVramThenName(rows: readonly ListedModelDto[]): ListedModelDto {
  const ranked = [...rows].sort(
    (a, b) => rowVram(a) - rowVram(b) || nameOf(a).localeCompare(nameOf(b)),
  );
  return ranked[0] ?? rows[0]!;
}

/**
 * Family collapse + hideBelowVram + required/recommended/compatible then
 * over-budget. Same contract as installer `collapse_and_sort`.
 */
export function collapseAndSortModels(
  models: readonly ListedModelDto[],
  options: CatalogSortOptions = {},
): ListedModelDto[] {
  const hostVramGB = options.hostVramGB;
  const gpuVendor = options.gpuVendor ?? catalogSortGpuVendor(hostVramGB);
  const defaults = options.defaults ?? new Set<string>();
  const recRank = new Map((options.recommendOrder ?? []).map((id, i) => [id, i]));
  const visible = models.filter((m) => !isHiddenByVramFloor(m, hostVramGB));

  const byFamily = new Map<string, ListedModelDto[]>();
  for (const row of visible) {
    const key = row.family || row.id;
    const list = byFamily.get(key);
    if (list) list.push(row);
    else byFamily.set(key, [row]);
  }

  const enabled: ListedModelDto[] = [];
  const disabled: ListedModelDto[] = [];
  for (const members of byFamily.values()) {
    const kept = members.filter(isDownloaded);
    const keptIds = new Set(kept.map((m) => m.id));
    const rest = members.filter((m) => !keptIds.has(m.id));
    for (const m of kept) {
      if (isCatalogOverBudget(m, hostVramGB, gpuVendor)) disabled.push(m);
      else enabled.push(m);
    }
    if (rest.length === 0) continue;
    const fitting = rest.filter((m) => !isCatalogOverBudget(m, hostVramGB, gpuVendor));
    const over = rest.filter((m) => isCatalogOverBudget(m, hostVramGB, gpuVendor));
    if (fitting.length > 0) {
      const pool = fitting.filter((m) => defaults.has(m.id));
      const pickFrom = pool.length > 0 ? pool : fitting;
      enabled.push(pickHighestVramThenName(pickFrom));
      disabled.push(...over);
    } else {
      disabled.push(pickLowestVramThenName(rest));
    }
  }

  enabled.sort((a, b) => {
    const req = Number(recommendationKind(a) !== "required") - Number(recommendationKind(b) !== "required");
    if (req !== 0) return req;
    const grp = recommendGroup(a, defaults, recRank) - recommendGroup(b, defaults, recRank);
    if (grp !== 0) return grp;
    const ra = recRank.get(a.id) ?? 10_000;
    const rb = recRank.get(b.id) ?? 10_000;
    if (ra !== rb) return ra - rb;
    const date = releaseOrdinal(b.releaseDate) - releaseOrdinal(a.releaseDate);
    if (date !== 0) return date;
    const vram = rowVram(b) - rowVram(a);
    if (vram !== 0) return vram;
    return nameOf(a).localeCompare(nameOf(b));
  });
  disabled.sort((a, b) => rowVram(a) - rowVram(b) || nameOf(a).localeCompare(nameOf(b)));
  return [...enabled, ...disabled];
}

/**
 * v2.2.9 Phase 5 (T011) -- Settings order: installed-and-ready (downloaded)
 * rows first, then the rest; each partition keeps the `collapseAndSortModels`
 * (installer recommendation) order. The installer picker keeps pure installer
 * order -- this partition is Settings-side only. Dual-asserted with installer
 * `catalog_tab_sort.downloaded_first` via tests/fixtures/v2.2.9-catalog-tab-sort.json.
 */
export function visibleModelsOnTab(
  models: readonly ListedModelDto[],
  tab: CatalogTab,
  options: CatalogSortOptions = {},
): ListedModelDto[] {
  return canonicalModelDisplayOrder(modelsOnTab(models, tab), options);
}

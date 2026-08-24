/**
 * v2.2.4 Phase 5 -- Settings > Models tab assignment, matching the
 * installer typed catalog (Chat / Agentic / Image / Video / Audio / Document).
 *
 * Unknown tasks land in Other so a catalog row is never dropped.
 */

import type { ListedModelDto, ModelType } from "../../pages/settings/modelsTypes";

export type CatalogTab =
  | "chat"
  | "agentic"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "other";

export const CATALOG_TAB_DEFS: readonly { id: CatalogTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "agentic", label: "Agentic" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "document", label: "Document" },
];

const TASK_TAB: Record<string, CatalogTab> = {
  chat: "chat",
  embed: "chat",
  agentic: "agentic",
  image: "image",
  video: "video",
  audio: "audio",
  document: "document",
};

const TYPE_TAB: Partial<Record<ModelType, CatalogTab>> = {
  llm: "chat",
  embed: "chat",
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

export type RecommendationKind = "required" | "recommended" | "compatible";

export function recommendationKind(
  model: Pick<ListedModelDto, "tags" | "type" | "task">,
): RecommendationKind {
  const tags = model.tags ?? [];
  if (tags.includes("required") || model.task === "embed" || model.type === "embed") {
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

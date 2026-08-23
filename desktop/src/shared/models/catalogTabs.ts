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
  if (model.task && TASK_TAB[model.task]) return TASK_TAB[model.task];
  if (model.type && TYPE_TAB[model.type]) return TYPE_TAB[model.type];
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

/**
 * v2.2.4 Phase 2 / 7 -- canonical picker feed.
 *
 * Chat, Agents, Images, and Videos must call `installedForTask` plus the
 * `~/.nexus/selected-models.json` snapshot. Catalog-shaped FALLBACK_LLMS
 * arrays are placeholders with `installed: false`, not a second feed.
 *
 * A picker row is eligible when it is installed, not catalog-only, matches
 * the tab's model type, and is in this install's ordered id list or was
 * downloaded later in Settings. A missing snapshot is an empty allowlist,
 * never every model on disk.
 */

import type {
  ListedModelDto,
  ModelType,
} from "../../pages/settings/modelsTypes";
import { pickerOrder, recommendationKind } from "./catalogTabs";

export type TaskKey =
  "chat" | "agentic" | "image" | "video" | "audio" | "document";

export interface SelectionSnapshot {
  schemaVersion: 1;
  orderedIds: readonly string[];
  recommendedByTask: Partial<Record<TaskKey, string>>;
  downloadedSinceInstall: readonly string[];
}

export const FAVORITE_STORAGE_PREFIX = "nexus.ui.favoriteModel.";

export function favoriteStorageKey(task: TaskKey): string {
  return `${FAVORITE_STORAGE_PREFIX}${task}`;
}

export function modelTypeForTask(task: TaskKey): ModelType {
  if (task === "image") return "image";
  if (task === "video") return "video";
  if (task === "audio") return "audio";
  if (task === "document") return "document";
  return "llm";
}

export function ownedIdSet(
  snapshot: SelectionSnapshot | null | undefined,
): Set<string> {
  if (!snapshot) return new Set();
  return new Set([...snapshot.orderedIds, ...snapshot.downloadedSinceInstall]);
}

/** Offline / ipc-unavailable fallback so a sentinel model can still be selected. */
export function snapshotForOwnedIds(
  ids: readonly string[],
  recommendedByTask: SelectionSnapshot["recommendedByTask"] = {},
): SelectionSnapshot {
  return {
    schemaVersion: 1,
    orderedIds: [...ids],
    recommendedByTask,
    downloadedSinceInstall: [],
  };
}

export function installedForTask(
  models: readonly ListedModelDto[],
  task: TaskKey,
  snapshot?: SelectionSnapshot | null,
): ListedModelDto[] {
  const type = modelTypeForTask(task);
  const owned = ownedIdSet(snapshot);
  const ready = models.filter(
    (m) =>
      m.installed &&
      m.source !== "catalog-only" &&
      m.type === type &&
      owned.has(m.id),
  );
  if (!snapshot) return ready;
  // v2.4.8 Phase 5 (T021): installer picker order -- catalog tier first, then
  // installer order, then in-app downloads -- so `ready[0]` is the top
  // recommendation a fresh session should default to.
  return pickerOrder(ready, {
    recommendOrder: [
      ...snapshot.orderedIds,
      ...snapshot.downloadedSinceInstall,
    ],
  });
}

/**
 * v2.4.8 Phase 5 (T021): a snapshot recommendation is honored unless the
 * catalog disagrees. Operator evidence (2026-09-06): the on-disk snapshot named
 * `gpt-oss:20b` as the agentic pick while the catalog tags Gemma 4 12B as the
 * recommendation, and the Agents session opened on gpt-oss. When the snapshot's
 * pick carries no `required` / `recommended` tag and some ready row does, the
 * first tagged row in picker order wins. A snapshot pick that is itself tagged,
 * or a catalog with no tagged rows at all, behaves exactly as before.
 */
export function resolveDefaultId(
  ready: readonly ListedModelDto[],
  opts: {
    favorite?: string | null;
    recommended?: string | null;
    applyFavorite?: boolean;
  } = {},
): string {
  if (ready.length === 0) return "";
  if (
    opts.applyFavorite === true &&
    opts.favorite &&
    ready.some((m) => m.id === opts.favorite)
  ) {
    return opts.favorite;
  }
  const pick = opts.recommended
    ? ready.find((m) => m.id === opts.recommended)
    : undefined;
  if (pick) {
    if (recommendationKind(pick) !== "compatible") return pick.id;
    const endorsed = ready.find((m) => recommendationKind(m) !== "compatible");
    return endorsed ? endorsed.id : pick.id;
  }
  return ready[0]?.id ?? "";
}

/** Installer recommend order for a task: required/recommended id first, then snapshot ids. */
export function recommendOrderForTask(
  snapshot: SelectionSnapshot | null | undefined,
  task: TaskKey,
): string[] {
  const recommended = snapshot?.recommendedByTask[task];
  const ids: string[] = [];
  if (recommended) ids.push(recommended);
  for (const id of snapshot?.orderedIds ?? []) {
    if (!ids.includes(id)) ids.push(id);
  }
  for (const id of snapshot?.downloadedSinceInstall ?? []) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function readFavorite(
  task: TaskKey,
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(favoriteStorageKey(task));
  } catch {
    return null;
  }
}

export function writeFavorite(
  task: TaskKey,
  id: string | null,
  storage: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const key = favoriteStorageKey(task);
    if (!id) storage.removeItem(key);
    else storage.setItem(key, id);
  } catch {
    // Preference is optional; a blocked store must not break pickers.
  }
}

function defaultStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

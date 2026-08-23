/**
 * v2.2.4 Phase 2 / 7 -- canonical picker feed.
 *
 * Chat, Agents, Images, and Videos must call `installedForTask` plus the
 * `~/.nexus/selected-models.json` snapshot. Catalog-shaped FALLBACK_LLMS
 * arrays are placeholders with `installed: false`, not a second feed.
 *
 * A picker row is eligible when it is installed, not catalog-only, matches
 * the tab's model type, and (when a snapshot exists) is in this install's
 * ordered id list or was downloaded later in Settings.
 */

import type { ListedModelDto, ModelType } from "../../pages/settings/modelsTypes";

export type TaskKey = "chat" | "agentic" | "image" | "video" | "audio" | "document";

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

export function ownedIdSet(snapshot: SelectionSnapshot | null | undefined): Set<string> | null {
  if (!snapshot) return null;
  return new Set([...snapshot.orderedIds, ...snapshot.downloadedSinceInstall]);
}

export function installedForTask(
  models: readonly ListedModelDto[],
  task: TaskKey,
  snapshot?: SelectionSnapshot | null,
): ListedModelDto[] {
  const type = modelTypeForTask(task);
  const owned = ownedIdSet(snapshot);
  const ready = models.filter(
    (m) => m.installed && m.source !== "catalog-only" && m.type === type && (!owned || owned.has(m.id)),
  );
  if (!snapshot) return ready;
  const rank = new Map<string, number>();
  snapshot.orderedIds.forEach((id, i) => rank.set(id, i));
  snapshot.downloadedSinceInstall.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, snapshot.orderedIds.length + i);
  });
  return [...ready].sort((a, b) => (rank.get(a.id) ?? 10_000) - (rank.get(b.id) ?? 10_000));
}

export function resolveDefaultId(
  ready: readonly ListedModelDto[],
  opts: { favorite?: string | null; recommended?: string | null } = {},
): string {
  if (ready.length === 0) return "";
  if (opts.favorite && ready.some((m) => m.id === opts.favorite)) return opts.favorite;
  if (opts.recommended && ready.some((m) => m.id === opts.recommended)) return opts.recommended;
  return ready[0].id;
}

export function readFavorite(task: TaskKey, storage: Pick<Storage, "getItem"> | null = defaultStorage()): string | null {
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
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = defaultStorage(),
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

function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

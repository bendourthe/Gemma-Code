/**
 * v2.4.6 Phase 4 -- installer-or-Settings owned model set.
 *
 * `~/.nexus/selected-models.json` is the AD-13 allowlist: wizard ticks plus
 * later Settings downloads. A missing or unreadable snapshot is an empty set,
 * never every model on disk (that pass-through leak is the desktop Phase 7
 * repair). This module is vscode-free.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { nexusHome } from "../storage/paths.js";

export type SelectionTaskKey =
  "chat" | "agentic" | "image" | "video" | "audio" | "document";

export interface SelectionSnapshot {
  schemaVersion: 1;
  orderedIds: readonly string[];
  recommendedByTask: Partial<Record<SelectionTaskKey, string>>;
  downloadedSinceInstall: readonly string[];
}

export const SELECTION_SNAPSHOT_FILENAME = "selected-models.json";

const TASK_KEYS: readonly SelectionTaskKey[] = [
  "chat",
  "agentic",
  "image",
  "video",
  "audio",
  "document",
];

export function selectionSnapshotPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), SELECTION_SNAPSHOT_FILENAME);
}

export function parseSelectionSnapshot(raw: unknown): SelectionSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.schemaVersion !== 1) return null;
  if (!Array.isArray(rec.orderedIds)) return null;
  const orderedIds = rec.orderedIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  const downloadedSinceInstall = Array.isArray(rec.downloadedSinceInstall)
    ? rec.downloadedSinceInstall.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  const recommendedByTask: SelectionSnapshot["recommendedByTask"] = {};
  const recMap = rec.recommendedByTask;
  if (recMap && typeof recMap === "object" && !Array.isArray(recMap)) {
    const map = recMap as Record<string, unknown>;
    for (const key of TASK_KEYS) {
      const value = map[key];
      if (typeof value === "string" && value.length > 0) {
        recommendedByTask[key] = value;
      }
    }
  }
  return {
    schemaVersion: 1,
    orderedIds,
    recommendedByTask,
    downloadedSinceInstall,
  };
}

/**
 * Fail-closed owned set. A missing snapshot yields empty, not "every installed
 * id". Callers that need the desktop pass-through must not use this helper.
 */
export function ownedIdSet(
  snapshot: SelectionSnapshot | null | undefined,
): Set<string> {
  if (!snapshot) return new Set();
  return new Set([...snapshot.orderedIds, ...snapshot.downloadedSinceInstall]);
}

export async function loadSelectionSnapshot(
  homeDirFn?: () => string,
): Promise<SelectionSnapshot | null> {
  try {
    const text = await fs.readFile(selectionSnapshotPath(homeDirFn), "utf8");
    return parseSelectionSnapshot(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function recommendOrderForTask(
  snapshot: SelectionSnapshot | null | undefined,
  task: SelectionTaskKey,
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

/** Kept for tests that construct a snapshot without I/O. */
export function emptySelectionSnapshot(): SelectionSnapshot {
  return {
    schemaVersion: 1,
    orderedIds: [],
    recommendedByTask: {},
    downloadedSinceInstall: [],
  };
}

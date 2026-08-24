/**
 * v2.2.4 Phase 2 -- installer selection snapshot on disk.
 *
 * `~/.nexus/selected-models.json` is the ordered list of models this install
 * (plus later Settings downloads) owns. Pickers intersect it with on-disk
 * presence so leftover weights from a previous install do not appear.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type TaskKey = "chat" | "agentic" | "image" | "video";

export interface SelectionSnapshot {
  schemaVersion: 1;
  orderedIds: string[];
  recommendedByTask: Partial<Record<TaskKey, string>>;
  downloadedSinceInstall: string[];
}

export const SNAPSHOT_FILENAME = "selected-models.json";

export function selectionSnapshotPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".nexus", SNAPSHOT_FILENAME);
}

export function emptySnapshot(): SelectionSnapshot {
  return {
    schemaVersion: 1,
    orderedIds: [],
    recommendedByTask: {},
    downloadedSinceInstall: [],
  };
}

export function parseSnapshot(raw: unknown): SelectionSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (rec.schemaVersion !== 1) return null;
  if (!Array.isArray(rec.orderedIds)) return null;
  const orderedIds = rec.orderedIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  const downloaded = Array.isArray(rec.downloadedSinceInstall)
    ? rec.downloadedSinceInstall.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const recommendedByTask: SelectionSnapshot["recommendedByTask"] = {};
  const recMap = rec.recommendedByTask;
  if (recMap && typeof recMap === "object") {
    for (const key of ["chat", "agentic", "image", "video"] as const) {
      const value = (recMap as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) recommendedByTask[key] = value;
    }
  }
  return { schemaVersion: 1, orderedIds, recommendedByTask, downloadedSinceInstall: downloaded };
}

export async function loadSnapshot(homeDir?: string): Promise<SelectionSnapshot | null> {
  try {
    const text = await fs.readFile(selectionSnapshotPath(homeDir), "utf8");
    return parseSnapshot(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: SelectionSnapshot, homeDir?: string): Promise<void> {
  const file = selectionSnapshotPath(homeDir);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

/** First-run reconstruction: every currently installed non-catalog id, in list order. */
export function migrateFromInstalled(
  models: ReadonlyArray<{ id: string; installed: boolean; source: string; type?: string; task?: string; tags?: readonly string[] }>,
): SelectionSnapshot {
  const installed = models.filter((m) => m.installed && m.source !== "catalog-only");
  const recommendedByTask: SelectionSnapshot["recommendedByTask"] = {};
  for (const model of installed) {
    const task = taskForModel(model);
    if (!task || recommendedByTask[task]) continue;
    if (model.tags?.includes("recommended") || model.task === task) {
      recommendedByTask[task] = model.id;
    }
  }
  return {
    schemaVersion: 1,
    orderedIds: installed.map((m) => m.id),
    recommendedByTask,
    downloadedSinceInstall: [],
  };
}

export async function loadOrMigrate(
  models: ReadonlyArray<{ id: string; installed: boolean; source: string; type?: string; task?: string; tags?: readonly string[] }>,
  homeDir?: string,
): Promise<SelectionSnapshot> {
  const existing = await loadSnapshot(homeDir);
  if (existing) return existing;
  const migrated = migrateFromInstalled(models);
  try {
    await saveSnapshot(migrated, homeDir);
  } catch {
    // Read path still works even if the write is denied.
  }
  return migrated;
}

export async function appendDownloadedId(id: string, homeDir?: string): Promise<void> {
  const current = await loadSnapshot(homeDir);
  if (!current) return;
  if (current.orderedIds.includes(id) || current.downloadedSinceInstall.includes(id)) return;
  current.downloadedSinceInstall.push(id);
  await saveSnapshot(current, homeDir);
}

function taskForModel(model: { type?: string; task?: string }): TaskKey | null {
  if (model.task === "chat" || model.task === "agentic" || model.task === "image" || model.task === "video") {
    return model.task;
  }
  if (model.type === "image") return "image";
  if (model.type === "video") return "video";
  if (model.type === "llm") return "chat";
  return null;
}

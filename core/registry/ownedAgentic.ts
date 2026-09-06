/**
 * v2.4.6 Phase 4 -- installer-or-Settings owned agentic enum.
 *
 * Intersection of (1) catalog agentic entries (`task === "agentic"` or
 * `agentic === true`, matching the installer Agentic tab), (2) the AD-13
 * owned set, and (3) on-disk / Ollama presence. Catalog-only ids and
 * leftover installed ids are excluded. vscode-free.
 */

import type { CatalogFile, ModelSpec } from "./catalog.js";
import {
  isInstalledByAliases,
  isOnDisk,
  ollamaTagsIncludeModel,
  type InstalledProbe,
} from "./installedProbe.js";
import {
  ownedIdSet,
  recommendOrderForTask,
  type SelectionSnapshot,
} from "./ownedSelection.js";

export const EMPTY_OWNED_AGENTIC_MESSAGE =
  "No installer-or-Settings-owned agentic models. Open Settings > Models in Nexus to add one.";

export const UNKNOWN_OWNED_AGENTIC_MESSAGE =
  "That model is not in this install's owned agentic set. Open Settings > Models in Nexus to add it.";

export interface OwnedAgenticEntry {
  readonly id: string;
  readonly displayName: string;
}

export type OwnedAgenticResolve =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      readonly code: "empty" | "not_owned";
      readonly message: string;
    };

export function isAgenticSpec(
  spec: Pick<ModelSpec, "task" | "agentic">,
): boolean {
  return spec.task === "agentic" || spec.agentic === true;
}

export function isPresentOnProbe(
  modelId: string,
  probe: InstalledProbe,
): boolean {
  return (
    ollamaTagsIncludeModel(modelId, probe.ollamaTags) ||
    isOnDisk(modelId, probe) ||
    isInstalledByAliases(modelId, probe)
  );
}

export function enumerateOwnedAgenticModels(
  catalog: CatalogFile,
  snapshot: SelectionSnapshot | null | undefined,
  probe: InstalledProbe,
): OwnedAgenticEntry[] {
  const owned = ownedIdSet(snapshot);
  if (owned.size === 0) return [];
  const ready: OwnedAgenticEntry[] = [];
  for (const spec of catalog.models) {
    if (!isAgenticSpec(spec)) continue;
    if (!owned.has(spec.id)) continue;
    if (!isPresentOnProbe(spec.id, probe)) continue;
    ready.push({
      id: spec.id,
      displayName: spec.displayName?.trim() ? spec.displayName : spec.id,
    });
  }
  return sortOwnedAgentic(ready, snapshot);
}

export function sortOwnedAgentic(
  entries: readonly OwnedAgenticEntry[],
  snapshot: SelectionSnapshot | null | undefined,
): OwnedAgenticEntry[] {
  const order = recommendOrderForTask(snapshot ?? null, "agentic");
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...entries].sort(
    (a, b) => (rank.get(a.id) ?? 10_000) - (rank.get(b.id) ?? 10_000),
  );
}

export function defaultOwnedAgenticId(
  entries: readonly OwnedAgenticEntry[],
  snapshot: SelectionSnapshot | null | undefined,
): string | null {
  if (entries.length === 0) return null;
  const recommended = snapshot?.recommendedByTask.agentic;
  if (recommended && entries.some((entry) => entry.id === recommended)) {
    return recommended;
  }
  return entries[0]?.id ?? null;
}

export function resolveOwnedAgenticId(
  id: string | undefined,
  entries: readonly OwnedAgenticEntry[],
): OwnedAgenticResolve {
  if (entries.length === 0) {
    return { ok: false, code: "empty", message: EMPTY_OWNED_AGENTIC_MESSAGE };
  }
  if (!id) {
    return {
      ok: false,
      code: "not_owned",
      message: UNKNOWN_OWNED_AGENTIC_MESSAGE,
    };
  }
  if (!entries.some((entry) => entry.id === id)) {
    return {
      ok: false,
      code: "not_owned",
      message: UNKNOWN_OWNED_AGENTIC_MESSAGE,
    };
  }
  return { ok: true, id };
}

export type CodingModelSelection =
  | { readonly kind: "keep"; readonly id: string; readonly displayName: string }
  | { readonly kind: "set"; readonly id: string; readonly displayName: string }
  | { readonly kind: "empty" };

/**
 * Keep the current VS Code model when it is already owned and present.
 * Otherwise default to `recommendedByTask.agentic` when that id is in the
 * enum (16 GB hosts: `gemma-4-12b-it-gguf` when owned).
 */
export function resolveCodingModelSelection(
  currentModelName: string,
  entries: readonly OwnedAgenticEntry[],
  snapshot: SelectionSnapshot | null | undefined,
): CodingModelSelection {
  if (entries.length === 0) return { kind: "empty" };
  const current = entries.find((entry) => entry.id === currentModelName);
  if (current) {
    return { kind: "keep", id: current.id, displayName: current.displayName };
  }
  const nextId = defaultOwnedAgenticId(entries, snapshot);
  if (!nextId) return { kind: "empty" };
  const next = entries.find((entry) => entry.id === nextId);
  if (!next) return { kind: "empty" };
  return { kind: "set", id: next.id, displayName: next.displayName };
}

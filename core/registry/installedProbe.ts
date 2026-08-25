/**
 * v1.15.0 Phase 4 (Issue 3) -- reconcile the registry's manifest view with what
 * the installer actually wrote to disk.
 *
 * `NexusModelRegistry.list()` only sees models it installed itself (manifests
 * under `~/.nexus/models/manifests/`). The Nexus AI Studio installer, however,
 * writes Ollama models into Ollama's own store and Hugging Face / diffusers
 * weights into `~/.nexus/models/weights/<id>/` WITHOUT a Nexus manifest, so
 * those otherwise show as "catalog-only" (not installed) even though they are
 * present. This module flips a catalog-only entry to installed when a probe of
 * Ollama's tag list or the weights tree proves it is there.
 *
 * Pure and dependency-light: the actual I/O probes (querying Ollama's
 * `/api/tags`, scanning the weights dir) live in the sidecar; this module just
 * applies their results to a `ListedModel[]`.
 */

import type { CatalogFile } from "./catalog.js";
import { findSpec } from "./catalog.js";
import { aliasesFor, foldModelId, lookupAlias } from "./modelAliases.js";
import type { ListedModel } from "./NexusModelRegistry.js";

/**
 * Derive the Ollama pull tag for a spec (`ollama://gemma4:12b` -> `gemma4:12b`).
 * Returns null for non-Ollama specs or a URL that is not an `ollama://` ref.
 */
export function ollamaTagForSpec(
  spec: { source?: { protocol?: string; url?: string } } | undefined,
): string | null {
  if (!spec || spec.source?.protocol !== "ollama") return null;
  const url = spec.source.url ?? "";
  if (url.startsWith("ollama://")) return url.slice("ollama://".length);
  return null;
}

/**
 * v2.2.0 Phase 2 (2.1): mirror of the installer's `safe_dir_name()` in
 * `scripts/installer/src/nexus_installer/engine/hf_weights_puller.py`
 * (`_SAFE_DIR_CHAR_RE = [^A-Za-z0-9._-]` -> "-"). The installer writes weights
 * to `weights/<safe_dir_name(id)>/`, so ids containing `:` (e.g.
 * `sam2:hiera-tiny`) land in a directory whose name is NOT the raw id. The
 * pre-v2.2.0 probe compared raw ids against directory names and silently
 * missed every such model. Keep the two implementations in sync.
 */
export function safeDirName(modelId: string): string {
  return modelId.replace(/[^A-Za-z0-9._-]/g, "-");
}

export interface InstalledProbe {
  /** Model tags reported by Ollama's `/api/tags` (e.g. `"gemma4:12b"`). */
  readonly ollamaTags: ReadonlySet<string>;
  /**
   * Directory names found under `<modelsRoot>/weights/` (as written by the
   * installer, i.e. already `safe_dir_name`-sanitized).
   */
  readonly weightsIds: ReadonlySet<string>;
  /**
   * v2.2.0 Phase 2 (2.1): model ids read from `.nexus-model-id` marker files
   * the installer writes inside each weights dir. Authoritative when present
   * -- it survives any future change to the directory-naming rule.
   */
  readonly weightsMarkerIds?: ReadonlySet<string>;
}

/**
 * True when Ollama's `/api/tags` set covers this catalog id or one of its
 * aliases. Unknown tags never fold onto Gemma: `foldModelId` of an unmapped
 * id is itself, so `totally-unknown:7b` cannot mark `gemma-4-12b-it-gguf`.
 */
export function ollamaTagsIncludeModel(
  modelId: string,
  ollamaTags: ReadonlySet<string>,
): boolean {
  const candidates = new Set<string>([modelId, ...aliasesFor(modelId)]);
  const folded = foldModelId(modelId);
  if (folded) candidates.add(folded);
  for (const candidate of candidates) {
    if (ollamaTags.has(candidate)) return true;
  }
  for (const tag of ollamaTags) {
    if (foldModelId(tag) === folded && lookupAlias(modelId) !== undefined) {
      return true;
    }
  }
  return false;
}

/** True when the probe proves this catalog id is present on disk. */
export function isOnDisk(modelId: string, probe: InstalledProbe): boolean {
  if (probe.weightsMarkerIds?.has(modelId)) return true;
  // Marker absent (pre-v2.2.0 install): fall back to directory-name matching,
  // comparing sanitized-to-sanitized so `:`/`/` ids still resolve.
  if (probe.weightsIds.has(modelId)) return true;
  return probe.weightsIds.has(safeDirName(modelId));
}

/**
 * v2.2.5 Phase 1 (T004) -- installed if any alias is in Ollama tags or the
 * weights tree. Snapshot membership is not consulted here.
 */
export function isInstalledByAliases(modelId: string, probe: InstalledProbe): boolean {
  if (ollamaTagsIncludeModel(modelId, probe.ollamaTags)) return true;
  const rec = lookupAlias(modelId);
  const ids = rec ? rec.aliases : aliasesFor(modelId);
  for (const alias of ids) {
    if (isOnDisk(alias, probe)) return true;
  }
  return false;
}

/**
 * Return a copy of `listed` with catalog-only entries flipped to
 * installed (`source: "registry"`) when the probe proves they are present in
 * Ollama's store or the weights tree. Registry and external entries pass
 * through unchanged.
 */
export function markInstalledFromProbe(
  listed: readonly ListedModel[],
  catalog: CatalogFile,
  probe: InstalledProbe,
): ListedModel[] {
  return listed.map((model) => {
    if (model.installed || model.source !== "catalog-only") return model;
    const tag = ollamaTagForSpec(findSpec(catalog, model.id));
    const inOllama =
      (tag !== null && ollamaTagsIncludeModel(tag, probe.ollamaTags)) ||
      ollamaTagsIncludeModel(model.id, probe.ollamaTags);
    if (inOllama || isOnDisk(model.id, probe) || isInstalledByAliases(model.id, probe)) {
      return { ...model, installed: true, source: "registry" };
    }
    return model;
  });
}

/**
 * v2.2.0 Phase 2 (2.1): synthesize installed rows directly from the probe when
 * the catalog could not be loaded (`catalog-load-failed`).
 *
 * `markInstalledFromProbe` can only FLIP rows the catalog produced, so a
 * catalog load failure used to erase every model the user actually has. This
 * degrades to metadata-poor rows (id + type guess) rather than an empty list;
 * the UI still shows the catalog-load-failed banner alongside them.
 *
 * `known` is the set of ids already present in `listed` (they must not be
 * duplicated).
 */
export function synthesizeInstalledFromProbe(
  probe: InstalledProbe,
  known: ReadonlySet<string> = new Set(),
): ListedModel[] {
  const rows: ListedModel[] = [];
  const seen = new Set<string>(known);
  const push = (id: string, displayName: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({
      id,
      displayName,
      installed: true,
      source: "registry",
    } as unknown as ListedModel);
  };
  // Ollama tags are already the user-facing id form (`gemma4:12b`).
  for (const tag of probe.ollamaTags) push(tag, tag);
  // Prefer marker ids (true catalog ids); fall back to directory names.
  const markers = probe.weightsMarkerIds;
  // A marker id is the UNSANITIZED id, so it never equals its own directory
  // name for ids containing `:` or `/`. Compare on the sanitized form, or the
  // directory gets emitted a second time as a near-duplicate row.
  const markerDirNames = new Set<string>();
  if (markers && markers.size > 0) {
    for (const id of markers) {
      push(id, id);
      markerDirNames.add(safeDirName(id));
    }
  }
  for (const dir of probe.weightsIds) {
    if (markerDirNames.has(dir)) continue;
    push(dir, dir);
  }
  return rows;
}

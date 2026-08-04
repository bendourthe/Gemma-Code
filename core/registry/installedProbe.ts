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

export interface InstalledProbe {
  /** Model tags reported by Ollama's `/api/tags` (e.g. `"gemma4:12b"`). */
  readonly ollamaTags: ReadonlySet<string>;
  /** Model ids that have a directory under `~/.nexus/models/weights/`. */
  readonly weightsIds: ReadonlySet<string>;
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
    const inOllama = tag !== null && probe.ollamaTags.has(tag);
    const onDisk = probe.weightsIds.has(model.id);
    if (inOllama || onDisk) {
      return { ...model, installed: true, source: "registry" };
    }
    return model;
  });
}

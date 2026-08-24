/**
 * v2.1.0 Phase 1 -- catalog visibility gates for VRAM floor and Ollama version.
 *
 * Installer and Settings hide an entry entirely when the host is below
 * `hideBelowVramGB` (not merely gray it as over-budget). An older Ollama than
 * `minOllamaVersion` hides the entry at runtime and surfaces an update note.
 * When Ollama's version is not yet known (installer catalog page, before the
 * Ollama step), the version gate does not hide; callers show the note instead.
 *
 * Boundary: pure; core/** (no modules/**).
 */

import type { ModelSpec } from "./catalog.js";
import { ollamaVersionAtLeast } from "./extremeLowBit.js";

export interface CatalogVisibilityHost {
  /** Detected GPU VRAM in GB. 0 means no GPU. */
  readonly hostVramGb: number;
  /**
   * Detected Ollama version string, or null/undefined when unknown.
   * Unknown does not hide on the version axis (the installer has not
   * installed Ollama yet); a known-too-old version does hide.
   */
  readonly ollamaVersion?: string | null;
  /** When true, a missing Ollama version fails closed (runtime Settings). */
  readonly requireKnownOllama?: boolean;
}

export type CatalogVisibilityReason =
  | "visible"
  | "hidden-vram"
  | "hidden-ollama";

export interface CatalogVisibility {
  readonly visible: boolean;
  readonly reason: CatalogVisibilityReason;
  /** User-facing note when hidden by Ollama version, or an advisory when version is unknown. */
  readonly note?: string;
}

function ollamaUpdateNote(minVersion: string): string {
  return `Update Ollama to ${minVersion} or newer to install this model.`;
}

/** True when the host VRAM is below the entry's hide-below floor. */
export function isHiddenByVram(
  spec: Pick<ModelSpec, "hideBelowVramGB">,
  hostVramGb: number,
): boolean {
  const floor = spec.hideBelowVramGB;
  if (typeof floor !== "number" || !Number.isFinite(floor) || floor <= 0) {
    return false;
  }
  return hostVramGb < floor;
}

/** Visibility for one catalog entry against the current host. */
export function catalogEntryVisibility(
  spec: Pick<ModelSpec, "id" | "hideBelowVramGB" | "minOllamaVersion">,
  host: CatalogVisibilityHost,
): CatalogVisibility {
  if (isHiddenByVram(spec, host.hostVramGb)) {
    return { visible: false, reason: "hidden-vram" };
  }
  const min = spec.minOllamaVersion?.trim();
  if (!min) {
    return { visible: true, reason: "visible" };
  }
  const version = host.ollamaVersion;
  if (version == null || version.trim() === "") {
    if (host.requireKnownOllama) {
      return {
        visible: false,
        reason: "hidden-ollama",
        note: ollamaUpdateNote(min),
      };
    }
    return { visible: true, reason: "visible", note: ollamaUpdateNote(min) };
  }
  if (!ollamaVersionAtLeast(version, min)) {
    return {
      visible: false,
      reason: "hidden-ollama",
      note: ollamaUpdateNote(min),
    };
  }
  return { visible: true, reason: "visible" };
}

/** Filter a catalog list to entries the host may see. */
export function visibleCatalogEntries<T extends Pick<ModelSpec, "hideBelowVramGB" | "minOllamaVersion" | "id">>(
  entries: readonly T[],
  host: CatalogVisibilityHost,
): readonly T[] {
  return entries.filter((entry) => catalogEntryVisibility(entry, host).visible);
}

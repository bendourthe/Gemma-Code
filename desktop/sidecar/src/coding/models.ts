// v1.1.0 Phase 2 (sub-task 2.3 / closes 1.9.P1.E) -- derived view over
// `core/registry/ModelCatalog`.
//
// The earlier v1.0.0 Phase 3.2 implementation inlined the catalog here as a
// sidecar-local copy and relied on a parity test to keep it in sync with
// `core/registry/models.json`. With the desktop tsconfig now including
// `../core/registry` directly (and esbuild resolving the relative path at
// bundle time), the sidecar imports the canonical catalog and projects it
// down to the public sidecar-facing shape. Removing the duplication closes
// v1.0.0 carryforward 3.P2.S without waiting for the broader project-
// references graph (deferred to a future Phase 1c follow-up).
//
// The public export surface (`SidecarModelEntry`, `SIDECAR_MODELS`,
// `lookupModel`, `requireModel`, the four named type aliases) is preserved
// verbatim so existing consumers compile unchanged.

import {
  ModelCatalog,
  type LlmCatalogEntry,
  type ModelFamily as CoreModelFamily,
  type PromptFormatName as CorePromptFormatName,
  type ToolFormatName as CoreToolFormatName,
} from "../../../../core/registry/ModelCatalog";
import {
  lookupAlias,
  toSidecarRuntime,
  unknownModelIdError,
} from "../../../../core/registry/modelAliases";

export type ModelFamily = CoreModelFamily;
export type PromptFormatName = CorePromptFormatName;
export type ToolFormatName = CoreToolFormatName;

export type SidecarModelEntry = Pick<
  LlmCatalogEntry,
  "id" | "displayName" | "family" | "promptFormat" | "toolFormat"
> & {
  readonly codingAvailable?: boolean;
};

function project(entry: LlmCatalogEntry): SidecarModelEntry {
  return Object.freeze({
    id: entry.id,
    displayName: entry.displayName,
    family: entry.family,
    promptFormat: entry.promptFormat,
    toolFormat: entry.toolFormat,
    codingAvailable: true,
  });
}

export const SIDECAR_MODELS: readonly SidecarModelEntry[] = Object.freeze(
  ModelCatalog.listLlm().map(project),
);

export function lookupModel(id: string): SidecarModelEntry | undefined {
  const aliased = lookupAlias(id);
  if (aliased) {
    const runtime = toSidecarRuntime(aliased);
    return runtime
      ? Object.freeze({
          id: runtime.id,
          displayName: runtime.displayName,
          family: runtime.family,
          promptFormat: runtime.promptFormat,
          toolFormat: runtime.toolFormat,
          codingAvailable: runtime.codingAvailable,
        })
      : undefined;
  }
  const entry = ModelCatalog.byId(id);
  return entry ? project(entry) : undefined;
}

export function requireModel(id: string): SidecarModelEntry {
  const found = lookupModel(id);
  if (!found) throw unknownModelIdError(id);
  return found;
}

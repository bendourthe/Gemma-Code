// v1.1.0 Phase 2 (sub-task 2.3 / closes 1.9.P1.E) -- derived view over
// `core/registry/ModelCatalog`.
//
// The desktop UI consumes this list to render the model dropdown and to
// look up the display name for a session's active backend. Previously the
// list was inlined here and a parity test asserted it stayed in sync with
// the sidecar copy + `core/registry/models.json`. The desktop tsconfig now
// includes `../core/registry`, so the frontend imports the canonical
// catalog and projects it to the frontend-facing shape (Pick: id +
// displayName + family).

import {
  ModelCatalog,
  type LlmCatalogEntry,
  type ModelFamily as CoreModelFamily,
} from "../../../../core/registry/ModelCatalog";

export type ModelFamily = CoreModelFamily;

export type FrontendModelEntry = Pick<
  LlmCatalogEntry,
  "id" | "displayName" | "family"
>;

function project(entry: LlmCatalogEntry): FrontendModelEntry {
  return Object.freeze({
    id: entry.id,
    displayName: entry.displayName,
    family: entry.family,
  });
}

export const FRONTEND_MODELS: readonly FrontendModelEntry[] = Object.freeze(
  ModelCatalog.listLlm().map(project),
);

export const DEFAULT_MODEL_ID = "gemma4:e4b";

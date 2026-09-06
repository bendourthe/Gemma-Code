/**
 * v2.4.6 Phase 4 -- load the owned agentic enum for the VS Code coding host.
 *
 * Combines the catalog, `~/.nexus/selected-models.json`, Ollama tags, and
 * the weights tree. vscode-free so unit tests can inject a fixture probe.
 */

import {
  loadCatalog,
  type CatalogFile,
} from "../../../core/registry/catalog.js";
import type { InstalledProbe } from "../../../core/registry/installedProbe.js";
import {
  enumerateOwnedAgenticModels,
  type OwnedAgenticEntry,
} from "../../../core/registry/ownedAgentic.js";
import {
  loadSelectionSnapshot,
  type SelectionSnapshot,
} from "../../../core/registry/ownedSelection.js";
import {
  collectWeightsProbe,
  modelsRoot,
} from "../../../core/registry/scanWeightsProbe.js";

export {
  EMPTY_OWNED_AGENTIC_MESSAGE,
  UNKNOWN_OWNED_AGENTIC_MESSAGE,
  type OwnedAgenticEntry,
} from "../../../core/registry/ownedAgentic.js";

export interface OwnedAgenticFeedDeps {
  readonly homeDirFn?: () => string;
  readonly catalog?: CatalogFile;
  readonly snapshot?: SelectionSnapshot | null;
  readonly probe?: InstalledProbe;
  readonly ollamaTags?: ReadonlySet<string>;
}

export async function listOwnedAgenticModels(
  deps: OwnedAgenticFeedDeps = {},
): Promise<OwnedAgenticEntry[]> {
  const catalog = deps.catalog ?? (await loadCatalog());
  const snapshot =
    deps.snapshot !== undefined
      ? deps.snapshot
      : await loadSelectionSnapshot(deps.homeDirFn);
  const probe =
    deps.probe ??
    (await collectWeightsProbe(
      modelsRoot(deps.homeDirFn),
      deps.ollamaTags ?? new Set(),
    ));
  return enumerateOwnedAgenticModels(catalog, snapshot, probe);
}

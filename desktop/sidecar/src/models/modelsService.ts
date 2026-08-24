/**
 * v1.15.0 Phase 4 (Issue 3) -- sidecar model registry service.
 *
 * Backs the Settings > Models page's `models.*` IPC. It composes the core
 * `NexusModelRegistry` with two reconciliation probes so the page reflects what
 * is ACTUALLY installed, not just what the app installed itself:
 *
 *   - Ollama's `/api/tags` (LLM / embed models live in Ollama's own store), and
 *   - the installer's weights tree `~/.nexus/models/weights/<id>/` (Hugging Face
 *     / diffusers weights, written without a Nexus manifest).
 *
 * `list()` returns `ListedModelDto`-shaped rows; `remove()` and `diskUsage()`
 * are thin pass-throughs. The install job surface lives in `installManager.ts`.
 *
 * Dependencies are injectable so the whole thing is unit-testable without a
 * real Ollama daemon, disk, or catalog.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CatalogFile } from "../../../../core/registry/catalog.js";
import { loadCatalog } from "../../../../core/registry/catalog.js";
import {
  type InstalledProbe,
  markInstalledFromProbe,
  synthesizeInstalledFromProbe,
} from "../../../../core/registry/installedProbe.js";
import { ModelStorage } from "../../../../core/registry/ModelStorage.js";
import {
  type ListedModel,
  NexusModelRegistry,
} from "../../../../core/registry/NexusModelRegistry.js";
import { aliasesFor, foldModelId } from "../../../../core/registry/modelAliases.js";
import { HttpOllamaPullClient, InstallManager } from "./installManager.js";
import { loadSnapshot, type SelectionSnapshot } from "./selectionSnapshot.js";

export interface ListedModelDto {
  id: string;
  displayName: string;
  family?: string;
  tag?: string;
  type?: ListedModel["type"];
  installed: boolean;
  source: "registry" | "catalog-only" | "external";
  sizeBytes?: number;
  vramGB?: number;
  license?: string;
  /** v1.19.0 Phase 1 -- catalog task (chat | agentic | ...). */
  task?: string;
  licenseUrl?: string;
  licenseNote?: string;
  tags?: readonly string[];
  absPath?: string;
  toolCallingVerified?: boolean;
    toolCallingBenchmark?: {
      readonly suite: string;
      readonly date: string;
      readonly result: string;
    };
    activeParams?: number;
    totalParams?: number;
    /** v2.0.0 Phase 1 -- catalog input modalities for Chat gating. */
    modalities?: readonly ("text" | "image" | "audio")[];
    vision?: boolean;
    visualTokenBudget?: {
      readonly maxImages?: number;
      readonly maxPixels?: number;
      readonly maxVideoFrames?: number;
      readonly maxVideoSeconds?: number;
    };
    description?: string;
    strengths?: readonly string[];
    whyRecommended?: string;
    differentiators?: string;
    agentic?: boolean;
    origin?: string;
    releaseDate?: string;
    uncensored?: boolean;
    selectedAtInstall?: boolean;
  }

export interface DiskUsageDto {
  usedBytes: number;
  freeBytes: number | null;
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * `~/.nexus/models` -- the registry root the installer + app share.
 *
 * v2.2.0 Phase 2 (2.1): honours `NEXUS_MODELS_ROOT`, which the sidecar boot
 * hook populates from the installer-written `~/.nexus/runtime.json`
 * `modelsRoot`. Without this, a custom `models_root` install was structurally
 * invisible to the app: the installer wrote weights somewhere else and the
 * sidecar only ever looked in the default location.
 */
export function defaultModelsRoot(
  homeDirFn: () => string = os.homedir,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env["NEXUS_MODELS_ROOT"];
  if (override && override.trim().length > 0) return override;
  return path.join(homeDirFn(), ".nexus", "models");
}

/** Query Ollama's `/api/tags`; returns the set of model names (e.g. `gemma4:12b`). */
export async function queryOllamaTags(
  baseUrl: string = DEFAULT_OLLAMA_URL,
  fetchFn: typeof fetch = fetch,
): Promise<Set<string>> {
  try {
    const res = await fetchFn(`${baseUrl}/api/tags`);
    if (!res.ok) return new Set();
    const body = (await res.json()) as { models?: Array<{ name?: string }> };
    const tags = new Set<string>();
    for (const m of body.models ?? []) {
      if (m.name) tags.add(m.name);
    }
    return tags;
  } catch {
    // Ollama not running / unreachable -> no Ollama-resident models to surface.
    return new Set();
  }
}

/** Scan `<root>/weights/` for installed model ids (the installer's HF layout). */
export async function scanWeightsIds(modelsRoot: string): Promise<Set<string>> {
  const weightsDir = path.join(modelsRoot, "weights");
  try {
    const entries = await fs.readdir(weightsDir, { withFileTypes: true });
    return new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  } catch {
    // No weights dir yet (nothing HF-installed) -> empty.
    return new Set();
  }
}

/** Name of the marker file the installer writes inside each weights dir. */
export const MODEL_ID_MARKER = ".nexus-model-id";

/**
 * v2.2.0 Phase 2 (2.1): read the `.nexus-model-id` markers under
 * `<root>/weights/*`. The marker carries the TRUE catalog id, so a model whose
 * directory name was sanitized (`sam2:hiera-tiny` -> `sam2-hiera-tiny`) still
 * matches. Absent for pre-v2.2.0 installs, where the caller falls back to
 * sanitized directory-name matching.
 */
export async function scanWeightsMarkerIds(modelsRoot: string): Promise<Set<string>> {
  const weightsDir = path.join(modelsRoot, "weights");
  const ids = new Set<string>();
  let dirNames: string[];
  try {
    const entries = await fs.readdir(weightsDir, { withFileTypes: true });
    dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return ids;
  }
  await Promise.all(
    dirNames.map(async (dirName) => {
        try {
          const raw = await fs.readFile(
            path.join(weightsDir, dirName, MODEL_ID_MARKER),
            "utf8",
          );
          const id = raw.trim();
          if (id) ids.add(id);
        } catch {
          // No marker in this dir -> directory-name matching covers it.
        }
      }),
  );
  return ids;
}

export interface ModelsServiceOptions {
  registry: NexusModelRegistry;
  catalog: CatalogFile;
  modelsRoot: string;
  ollamaBaseUrl?: string;
  fetchFn?: typeof fetch;
  /** Test seam for `~/.nexus/selected-models.json`. */
  loadSnapshot?: () => Promise<SelectionSnapshot | null>;
}

export class ModelsService {
  private readonly _registry: NexusModelRegistry;
  private readonly _catalog: CatalogFile;
  private readonly _modelsRoot: string;
  private readonly _ollamaBaseUrl: string;
  private readonly _fetch: typeof fetch;
  private readonly _loadSnapshot: () => Promise<SelectionSnapshot | null>;

  constructor(opts: ModelsServiceOptions) {
    this._registry = opts.registry;
    this._catalog = opts.catalog;
    this._modelsRoot = opts.modelsRoot;
    this._ollamaBaseUrl = opts.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
    this._fetch = opts.fetchFn ?? fetch;
    this._loadSnapshot = opts.loadSnapshot ?? (() => loadSnapshot());
  }

  get registry(): NexusModelRegistry {
    return this._registry;
  }

  /**
   * Enumerate models, reconciling the registry's manifest view with Ollama's
   * store and the installer's weights tree so installer-downloaded models show
   * as Installed rather than catalog-only.
   */
  async list(): Promise<ListedModelDto[]> {
    const [listed, ollamaTags, weightsIds, weightsMarkerIds] = await Promise.all([
      this._registry.list(),
      queryOllamaTags(this._ollamaBaseUrl, this._fetch),
      scanWeightsIds(this._modelsRoot),
      scanWeightsMarkerIds(this._modelsRoot),
    ]);
    const probe: InstalledProbe = { ollamaTags, weightsIds, weightsMarkerIds };
    const reconciled = markInstalledFromProbe(listed, this._catalog, probe);
    // v2.2.0 Phase 2 (2.1): with no catalog (load failed), `markInstalledFrom
    // Probe` has nothing to flip -- every model the user has would vanish.
    // Synthesize metadata-poor rows straight off the probe instead; the UI
    // still shows the catalog-load-failed banner beside them.
    if (this._catalog.models.length === 0) {
      const known = new Set(reconciled.map((m) => m.id));
      const synthesized = synthesizeInstalledFromProbe(probe, known);
      return this._withSelection([...reconciled, ...synthesized].map(toDto));
    }
    return this._withSelection(reconciled.map(toDto));
  }

  private async _withSelection(dtos: ListedModelDto[]): Promise<ListedModelDto[]> {
    const snapshot = await this._loadSnapshot();
    const selected = expandSnapshotIds(snapshot?.orderedIds ?? []);
    return dtos.map((dto) => ({
      ...dto,
      selectedAtInstall: idSelectedAtInstall(dto.id, selected),
    }));
  }

  /** Remove an installed model (rejects for external models, per the registry). */
  async remove(id: string): Promise<void> {
    await this._registry.remove(id);
  }

  /** Used bytes (installed models) + free bytes on the models volume (best-effort). */
  async diskUsage(): Promise<DiskUsageDto> {
    const listed = await this.list();
    const usedBytes = listed
      .filter((m) => m.installed && m.source === "registry")
      .reduce((acc, m) => acc + (m.sizeBytes ?? 0), 0);
    let freeBytes: number | null = null;
    try {
      const statfs = (fs as { statfs?: (p: string) => Promise<{ bavail: number; bsize: number }> }).statfs;
      if (statfs) {
        const st = await statfs(this._modelsRoot);
        freeBytes = st.bavail * st.bsize;
      }
    } catch {
      freeBytes = null;
    }
    return { usedBytes, freeBytes };
  }
}

function toDto(m: ListedModel): ListedModelDto {
  return {
    id: m.id,
    displayName: m.displayName,
    family: m.family,
    tag: m.tag,
    type: m.type,
    installed: m.installed,
    source: m.source,
    sizeBytes: m.sizeBytes,
    vramGB: m.vramGB,
    license: m.license,
    task: m.task,
    licenseUrl: m.licenseUrl,
    licenseNote: m.licenseNote,
    tags: m.tags,
    absPath: m.absPath,
    toolCallingVerified: m.toolCallingVerified,
    toolCallingBenchmark: m.toolCallingBenchmark,
    activeParams: m.activeParams,
    totalParams: m.totalParams,
    modalities: m.modalities,
    vision: m.vision,
    visualTokenBudget: m.visualTokenBudget,
    description: m.description,
    strengths: m.strengths,
    whyRecommended: m.whyRecommended,
    differentiators: m.differentiators,
    agentic: m.agentic,
    origin: m.origin,
    releaseDate: m.releaseDate,
    uncensored: m.uncensored,
  };
}

function expandSnapshotIds(orderedIds: readonly string[]): Set<string> {
  const selected = new Set<string>();
  for (const id of orderedIds) {
    selected.add(id);
    selected.add(foldModelId(id));
    for (const alias of aliasesFor(id)) selected.add(alias);
  }
  return selected;
}

function idSelectedAtInstall(id: string, selected: ReadonlySet<string>): boolean {
  if (selected.has(id) || selected.has(foldModelId(id))) return true;
  return aliasesFor(id).some((alias) => selected.has(alias));
}

/**
 * v2.2.0 Phase 1 (1.1): catalog resolution outcome. `error` is null on success;
 * on failure it carries the load error so `models.list` replies can surface a
 * distinct `catalog-load-failed` status instead of a silent empty list.
 */
export interface ResolvedCatalog {
  file: CatalogFile;
  error: string | null;
}

/**
 * Resolve the shared `catalog.json` for the running sidecar. Honours a
 * `NEXUS_CATALOG_PATH` override, else falls back to the core loader's default
 * (which resolves the bundled/adjacent catalog). Degrades to an empty catalog
 * so `list()` still surfaces Ollama / weights-probed installs when the catalog
 * cannot be found -- but the failure is captured, logged to stderr, and
 * reported through `ModelsRuntime.catalogStatus`, never swallowed.
 */
export async function resolveCatalog(): Promise<ResolvedCatalog> {
  const override = process.env.NEXUS_CATALOG_PATH;
  try {
    const file = override ? await loadCatalog(override) : await loadCatalog();
    return { file, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[nexus-sidecar] catalog-load-failed: ${message}\n`);
    return { file: { models: [] } as unknown as CatalogFile, error: message };
  }
}

/** `models.list` catalog health: `ok`, or `catalog-load-failed: <reason>`. */
export type CatalogStatus = "ok" | `catalog-load-failed: ${string}`;

/** The reflect (`service`) + install (`installer`) surfaces for the `models.*` IPC. */
export interface ModelsRuntime {
  service: ModelsService;
  installer: InstallManager;
  /** v2.2.0 Phase 1 (1.1): whether the shared catalog actually loaded. */
  catalogStatus: CatalogStatus;
}

/**
 * Build the real models runtime: the shared catalog, a disk-backed registry
 * wired to an Ollama pull client, the reconciling `ModelsService`, and the
 * streaming `InstallManager`. Async (loads the catalog + ensures the storage
 * layout); callers memoize it.
 */
export async function createModelsRuntime(
  opts: { modelsRoot?: string; ollamaBaseUrl?: string; fetchFn?: typeof fetch } = {},
): Promise<ModelsRuntime> {
  const modelsRoot = opts.modelsRoot ?? defaultModelsRoot();
  const ollamaBaseUrl = opts.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
  const fetchFn = opts.fetchFn ?? fetch;
  const resolved = await resolveCatalog();
  const catalog = resolved.file;
  const catalogStatus: CatalogStatus =
    resolved.error === null ? "ok" : `catalog-load-failed: ${resolved.error}`;
  const storage = new ModelStorage(modelsRoot);
  await storage.ensureLayout();
  const registry = new NexusModelRegistry({
    storage,
    catalog,
    ollama: new HttpOllamaPullClient(ollamaBaseUrl, fetchFn),
  });
  const service = new ModelsService({ registry, catalog, modelsRoot, ollamaBaseUrl, fetchFn });
  const installer = new InstallManager(registry);
  return { service, installer, catalogStatus };
}

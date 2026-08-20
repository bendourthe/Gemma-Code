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
} from "../../../../core/registry/installedProbe.js";
import { ModelStorage } from "../../../../core/registry/ModelStorage.js";
import {
  type ListedModel,
  NexusModelRegistry,
} from "../../../../core/registry/NexusModelRegistry.js";
import { HttpOllamaPullClient, InstallManager } from "./installManager.js";

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
  }

export interface DiskUsageDto {
  usedBytes: number;
  freeBytes: number | null;
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/** `~/.nexus/models` -- the registry root the installer + app share. */
export function defaultModelsRoot(homeDirFn: () => string = os.homedir): string {
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

export interface ModelsServiceOptions {
  registry: NexusModelRegistry;
  catalog: CatalogFile;
  modelsRoot: string;
  ollamaBaseUrl?: string;
  fetchFn?: typeof fetch;
}

export class ModelsService {
  private readonly _registry: NexusModelRegistry;
  private readonly _catalog: CatalogFile;
  private readonly _modelsRoot: string;
  private readonly _ollamaBaseUrl: string;
  private readonly _fetch: typeof fetch;

  constructor(opts: ModelsServiceOptions) {
    this._registry = opts.registry;
    this._catalog = opts.catalog;
    this._modelsRoot = opts.modelsRoot;
    this._ollamaBaseUrl = opts.ollamaBaseUrl ?? DEFAULT_OLLAMA_URL;
    this._fetch = opts.fetchFn ?? fetch;
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
    const [listed, ollamaTags, weightsIds] = await Promise.all([
      this._registry.list(),
      queryOllamaTags(this._ollamaBaseUrl, this._fetch),
      scanWeightsIds(this._modelsRoot),
    ]);
    const probe: InstalledProbe = { ollamaTags, weightsIds };
    const reconciled = markInstalledFromProbe(listed, this._catalog, probe);
    return reconciled.map(toDto);
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
  };
}

/**
 * Resolve the shared `catalog.json` for the running sidecar. Honours a
 * `NEXUS_CATALOG_PATH` override, else falls back to the core loader's default
 * (which resolves the bundled/adjacent catalog). Degrades to an empty catalog
 * so `list()` still surfaces Ollama / weights-probed installs when the catalog
 * cannot be found.
 */
export async function resolveCatalog(): Promise<CatalogFile> {
  const override = process.env.NEXUS_CATALOG_PATH;
  try {
    return override ? await loadCatalog(override) : await loadCatalog();
  } catch {
    return { models: [] } as unknown as CatalogFile;
  }
}

/** The reflect (`service`) + install (`installer`) surfaces for the `models.*` IPC. */
export interface ModelsRuntime {
  service: ModelsService;
  installer: InstallManager;
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
  const catalog = await resolveCatalog();
  const storage = new ModelStorage(modelsRoot);
  await storage.ensureLayout();
  const registry = new NexusModelRegistry({
    storage,
    catalog,
    ollama: new HttpOllamaPullClient(ollamaBaseUrl, fetchFn),
  });
  const service = new ModelsService({ registry, catalog, modelsRoot, ollamaBaseUrl, fetchFn });
  const installer = new InstallManager(registry);
  return { service, installer };
}

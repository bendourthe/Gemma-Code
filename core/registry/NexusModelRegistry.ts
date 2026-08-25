/**
 * v1.0.0 Phase 5.3 -- orchestration layer for catalog + storage + downloader.
 *
 * `NexusModelRegistry` is the disk-backed evolution of the Phase 2.6 stub
 * `InMemoryModelRegistry`. It composes:
 *
 *   - `core/registry/ModelStorage.ts` for the content-addressed FS layout
 *   - `core/registry/Downloader.ts` for resumable + SHA-256-verified HTTP
 *   - `core/registry/catalog.json` (the curated installable set)
 *   - `core/registry/ExtraModelPaths.ts` for ComfyUI-style external dirs
 *
 * `install(id)` looks up the spec, dispatches to either Ollama (`ollama pull`
 * via an injectable client) or the HTTP downloader, and writes a manifest
 * into the storage layer.
 *
 * `list(filter)` enumerates the disk manifests plus catalog entries that
 * have not been installed yet, augmenting each with `installed: boolean`
 * and the matching catalog spec. External (`extra_model_paths.yaml`)
 * entries flow through `_external` when an `ExternalModelIndex` is wired.
 *
 * The `InMemoryModelRegistry` class in `core/registry/ModelRegistry.ts`
 * remains for tests + Phase 2.6 consumers that don't need disk semantics.
 */

import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  Downloader,
  type DownloadOptions,
  type DownloadResult,
} from "./Downloader.js";
import {
  ModelStorage,
  type ModelManifest,
} from "./ModelStorage.js";
import {
  type CatalogFile,
  type ModelSpec,
  findSpec,
  loadCatalog,
} from "./catalog.js";
import { catalogContextFromSpec } from "./contextWindow.js";

export type InstallProgress = (bytes: number, total: number | null) => void;

export interface OllamaPullClient {
  /**
   * Pull a model via the local Ollama daemon. Implementations may stream
   * progress; the registry consumes only the final outcome.
   */
  pull(modelTag: string, opts?: { signal?: AbortSignal; onProgress?: InstallProgress }): Promise<void>;
}

export interface ExternalModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly absPath: string;
  readonly profile: string;
  readonly category: string;
  readonly sizeBytes: number;
}

export interface ExternalModelIndex {
  list(): Promise<readonly ExternalModelEntry[]>;
}

export interface ListedModel {
  readonly id: string;
  readonly displayName: string;
  readonly family?: string;
  readonly tag?: string;
  readonly type?: ModelSpec["type"];
  readonly installed: boolean;
  readonly source: "registry" | "catalog-only" | "external";
  readonly sizeBytes?: number;
  readonly vramGB?: number;
  readonly license?: string;
  /**
   * v1.19.0 Phase 1 -- catalog `task` (chat | agentic | image | ...). Surfaced
   * so pickers can show the Agentic-tab entry without re-reading the catalog.
   */
  readonly task?: ModelSpec["task"];
  /** v1.19.0 Phase 1 -- first-party license page linked from the use-restriction. */
  readonly licenseUrl?: string;
  /**
   * v1.19.0 Phase 1 -- ungated commercial-use restriction copy. Absent on
   * entries that have no extra restriction beyond `license`.
   */
  readonly licenseNote?: string;
  readonly tags?: readonly string[];
  readonly absPath?: string;
  /**
   * v1.5.0 Phase 5 (item 33) -- surfaced from the catalog `multimodal` flag so
   * consumers (the model picker, the multimodal-input gate) can tell which
   * models accept native image input without re-reading the catalog.
   */
  readonly multimodal?: boolean;
  /**
   * v1.18.0 Phase 3 (OW-A4) -- catalog `toolCallingVerified`. Absent means
   * unverified (conservative default).
   */
  readonly toolCallingVerified?: boolean;
  /** v1.18.0 Phase 3 (OW-A4) -- provenance tooltip for the verified badge. */
  readonly toolCallingBenchmark?: ModelSpec["toolCallingBenchmark"];
  /** v1.18.0 Phase 3 (LG-A3) -- MoE active params in billions, when declared. */
  readonly activeParams?: number;
  /** v1.18.0 Phase 3 (LG-A3) -- MoE total / resident params in billions. */
  readonly totalParams?: number;
  /**
   * v2.0.0 Phase 1 -- catalog `modalities` so Chat can gate image/audio
   * attachments without a second catalog round-trip.
   */
  readonly modalities?: ModelSpec["modalities"];
  /** v2.1.0 Phase 4 -- chat vision flag from the catalog. */
  readonly vision?: boolean;
  /** v2.1.0 Phase 4 -- visual-token budget from the catalog. */
  readonly visualTokenBudget?: ModelSpec["visualTokenBudget"];
  /** v2.2.4 Phase 5 -- installer card copy. */
  readonly description?: string;
  readonly strengths?: readonly string[];
  readonly whyRecommended?: string;
  readonly differentiators?: string;
  readonly agentic?: boolean;
  /** v2.2.5 Phase 3 -- installer card chips. */
  readonly origin?: string;
  readonly releaseDate?: string;
  readonly uncensored?: boolean;
  /**
   * v2.2.7 Phase 1 -- catalog-reported token window. null when the catalog
   * omitted or junked the field. Never a default 128000.
   */
  readonly contextWindow?: number | null;
  readonly contextWindowIn?: number | null;
  readonly contextWindowOut?: number | null;
  /** v2.2.8 Phase 4 -- installer hide-below floor. */
  readonly hideBelowVramGB?: number;
}

export interface ListFilter {
  readonly type?: ModelSpec["type"];
  readonly family?: string;
  readonly query?: string;
  readonly installed?: boolean;
}

export interface InstallOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: InstallProgress;
  /** Override the downloader's fetch (tests). */
  readonly fetch?: typeof fetch;
}

export interface NexusModelRegistryOptions {
  readonly storage: ModelStorage;
  readonly catalog: CatalogFile;
  readonly downloader?: Downloader;
  readonly ollama?: OllamaPullClient;
  readonly external?: ExternalModelIndex;
  readonly now?: () => Date;
}

export class ExternalRemovalError extends Error {
  constructor(id: string) {
    super(
      `NexusModelRegistry: cannot remove external model '${id}' -- it is sourced from extra_model_paths.yaml and lives outside the Nexus storage root. Edit your YAML or remove the file directly.`,
    );
    this.name = "ExternalRemovalError";
  }
}

function contextFields(spec: ModelSpec | undefined, id: string) {
  return catalogContextFromSpec(spec, id);
}

export class NexusModelRegistry {
  private readonly _storage: ModelStorage;
  private readonly _catalog: CatalogFile;
  private readonly _downloader: Downloader;
  private readonly _ollama: OllamaPullClient | null;
  private readonly _external: ExternalModelIndex | null;
  private readonly _now: () => Date;

  constructor(opts: NexusModelRegistryOptions) {
    this._storage = opts.storage;
    this._catalog = opts.catalog;
    this._downloader = opts.downloader ?? new Downloader(opts.storage);
    this._ollama = opts.ollama ?? null;
    this._external = opts.external ?? null;
    this._now = opts.now ?? (() => new Date());
  }

  static async create(opts: { root: string; catalogPath?: string; ollama?: OllamaPullClient; external?: ExternalModelIndex }): Promise<NexusModelRegistry> {
    const storage = new ModelStorage(opts.root);
    await storage.ensureLayout();
    const catalog = await loadCatalog(opts.catalogPath);
    return new NexusModelRegistry({ storage, catalog, ollama: opts.ollama, external: opts.external });
  }

  get storage(): ModelStorage {
    return this._storage;
  }

  get catalog(): CatalogFile {
    return this._catalog;
  }

  async list(filter: ListFilter = {}): Promise<readonly ListedModel[]> {
    const manifests = await this._storage.listManifests();
    const installedById = new Map<string, ModelManifest>();
    for (const m of manifests) installedById.set(m.id, m);

    const out: ListedModel[] = [];

    // Installed: catalog match (preferred) else manifest-only.
    for (const manifest of manifests) {
      const spec = findSpec(this._catalog, manifest.id);
      out.push({
        id: manifest.id,
        displayName: manifest.displayName ?? spec?.displayName ?? manifest.id,
        family: manifest.family,
        tag: manifest.tag,
        type: manifest.type,
        installed: true,
        source: "registry",
        sizeBytes: manifest.sizeBytes,
        vramGB: manifest.vramGb ?? spec?.vramGB,
        license: manifest.license ?? spec?.license,
        task: spec?.task,
        licenseUrl: spec?.licenseUrl,
        licenseNote: spec?.licenseNote,
        tags: manifest.tags ?? spec?.tags,
        multimodal: spec?.multimodal,
        toolCallingVerified: spec?.toolCallingVerified,
        toolCallingBenchmark: spec?.toolCallingBenchmark,
        activeParams: spec?.activeParams,
        totalParams: spec?.totalParams,
        modalities: spec?.modalities,
        vision: spec?.vision,
        visualTokenBudget: spec?.visualTokenBudget,
        description: spec?.description,
        strengths: spec?.strengths,
        whyRecommended: spec?.whyRecommended,
        differentiators: spec?.differentiators,
        agentic: spec?.agentic,
        origin: spec?.origin,
        releaseDate: spec?.releaseDate,
        uncensored: spec?.uncensored,
        hideBelowVramGB: spec?.hideBelowVramGB,
        ...contextFields(spec, manifest.id),
      });
    }

    // Catalog entries that have NOT been installed.
    for (const spec of this._catalog.models) {
      if (installedById.has(spec.id)) continue;
      out.push({
        id: spec.id,
        displayName: spec.displayName,
        family: spec.family,
        tag: spec.tag,
        type: spec.type,
        installed: false,
        source: "catalog-only",
        sizeBytes: spec.sizeGB !== undefined ? Math.round(spec.sizeGB * 1024 * 1024 * 1024) : undefined,
        vramGB: spec.vramGB,
        license: spec.license,
        task: spec.task,
        licenseUrl: spec.licenseUrl,
        licenseNote: spec.licenseNote,
        tags: spec.tags,
        multimodal: spec.multimodal,
        toolCallingVerified: spec.toolCallingVerified,
        toolCallingBenchmark: spec.toolCallingBenchmark,
        activeParams: spec.activeParams,
        totalParams: spec.totalParams,
        modalities: spec.modalities,
        vision: spec.vision,
        visualTokenBudget: spec.visualTokenBudget,
        description: spec.description,
        strengths: spec.strengths,
        whyRecommended: spec.whyRecommended,
        differentiators: spec.differentiators,
        agentic: spec.agentic,
        origin: spec.origin,
        releaseDate: spec.releaseDate,
        uncensored: spec.uncensored,
        hideBelowVramGB: spec.hideBelowVramGB,
        ...contextFields(spec, spec.id),
      });
    }

    // External (extra_model_paths.yaml).
    if (this._external) {
      const ext = await this._external.list();
      for (const e of ext) {
        out.push({
          id: e.id,
          displayName: e.displayName,
          family: e.category,
          installed: true,
          source: "external",
          sizeBytes: e.sizeBytes,
          absPath: e.absPath,
        });
      }
    }

    return applyFilter(out, filter);
  }

  async install(spec: ModelSpec, opts: InstallOptions = {}): Promise<InstallResult> {
    validateSpecOrThrow(this._catalog, spec);

    if (spec.source.protocol === "ollama") {
      return this._installOllama(spec, opts);
    }
    if (spec.source.protocol === "huggingface" || spec.source.protocol === "url") {
      return this._installHttp(spec, opts);
    }
    throw new Error(`NexusModelRegistry: unsupported protocol ${spec.source.protocol}`);
  }

  async remove(id: string): Promise<void> {
    if (this._external) {
      const ext = await this._external.list();
      if (ext.some((e) => e.id === id)) {
        throw new ExternalRemovalError(id);
      }
    }
    const manifests = await this._storage.listManifests();
    const target = manifests.find((m) => m.id === id);
    if (!target) {
      throw new Error(`NexusModelRegistry: not installed: ${id}`);
    }
    await this._storage.unlinkManifest(target.family, target.name, target.tag);
    await this._storage.gcUnreferencedBlobs();
  }

  /** True when the registry holds a manifest for `id`. */
  async isInstalled(id: string): Promise<boolean> {
    const manifests = await this._storage.listManifests();
    return manifests.some((m) => m.id === id);
  }

  /** Convenience: install by id (looks up the spec in the catalog). */
  async installById(id: string, opts: InstallOptions = {}): Promise<InstallResult> {
    const spec = findSpec(this._catalog, id);
    if (!spec) throw new Error(`NexusModelRegistry: unknown catalog id ${id}`);
    return this.install(spec, opts);
  }

  private async _installOllama(spec: ModelSpec, opts: InstallOptions): Promise<InstallResult> {
    if (!this._ollama) {
      throw new Error("NexusModelRegistry: Ollama client not wired");
    }
    const tag = ollamaTagFromSpec(spec);
    await this._ollama.pull(tag, { signal: opts.signal, onProgress: opts.onProgress });
    const manifest = makeOllamaManifest(spec, this._now());
    await this._storage.linkManifest(spec.family, spec.name, spec.tag, manifest);
    return { id: spec.id, status: "installed", bytesDownloaded: 0, manifestPath: this._storage.manifestPath(spec.family, spec.name, spec.tag) };
  }

  private async _installHttp(spec: ModelSpec, opts: InstallOptions): Promise<InstallResult> {
    const url = spec.source.url;
    const sha = spec.source.sha256;
    if (!url) throw new Error(`NexusModelRegistry: ${spec.id} missing source.url`);
    if (!sha) throw new Error(`NexusModelRegistry: ${spec.id} missing source.sha256 (verifier digest required for http downloads)`);

    const dlOpts: DownloadOptions = {
      signal: opts.signal,
      onProgress: opts.onProgress,
      fetch: opts.fetch,
    };
    const result = await this._downloader.download(url, sha, dlOpts);
    const manifest = makeHttpManifest(spec, result, this._now());
    await this._storage.linkManifest(spec.family, spec.name, spec.tag, manifest);
    return {
      id: spec.id,
      status: "installed",
      bytesDownloaded: result.bytes,
      manifestPath: this._storage.manifestPath(spec.family, spec.name, spec.tag),
      blobPath: result.path,
    };
  }
}

export interface InstallResult {
  readonly id: string;
  readonly status: "installed";
  readonly bytesDownloaded: number;
  readonly manifestPath: string;
  readonly blobPath?: string;
}

function applyFilter(items: readonly ListedModel[], filter: ListFilter): readonly ListedModel[] {
  return items.filter((m) => {
    if (filter.type && m.type !== filter.type) return false;
    if (filter.family && m.family !== filter.family) return false;
    if (filter.installed !== undefined && m.installed !== filter.installed) return false;
    if (filter.query) {
      const q = filter.query.toLowerCase();
      const hay = `${m.id} ${m.displayName} ${m.family ?? ""} ${m.tag ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function validateSpecOrThrow(catalog: CatalogFile, spec: ModelSpec): void {
  const known = findSpec(catalog, spec.id);
  if (!known) {
    // Caller passed an off-catalog spec -- still allow it but check fields.
    if (!spec.id || !spec.family || !spec.name || !spec.tag || !spec.source) {
      throw new Error(`NexusModelRegistry: spec is missing required fields for ${spec.id}`);
    }
  }
}

function ollamaTagFromSpec(spec: ModelSpec): string {
  // ollama://gemma4:e4b -> gemma4:e4b
  const url = spec.source.url ?? "";
  if (url.startsWith("ollama://")) return url.slice("ollama://".length);
  return spec.id;
}

function makeOllamaManifest(spec: ModelSpec, now: Date): ModelManifest {
  // Ollama owns the blob; we record an opaque sha derived from the spec id so
  // listManifests has a stable handle. Storage GC will never visit these
  // blobs because no `blobs/sha256-*` file is written.
  const opaqueSha = sha256OfString(spec.id);
  return {
    schemaVersion: 1,
    id: spec.id,
    family: spec.family,
    name: spec.name,
    tag: spec.tag,
    type: spec.type,
    runtime: "ollama",
    displayName: spec.displayName,
    license: spec.license,
    vramGb: spec.vramGB,
    sizeBytes: spec.sizeGB !== undefined ? Math.round(spec.sizeGB * 1024 * 1024 * 1024) : undefined,
    blobs: [{ role: "weights", sha256: opaqueSha, filename: `${spec.id}` }],
    source: { protocol: "ollama", url: spec.source.url ?? `ollama://${spec.id}` },
    tags: spec.tags,
    createdAt: now.toISOString(),
  };
}

function makeHttpManifest(spec: ModelSpec, result: DownloadResult, now: Date): ModelManifest {
  return {
    schemaVersion: 1,
    id: spec.id,
    family: spec.family,
    name: spec.name,
    tag: spec.tag,
    type: spec.type,
    runtime:
      spec.type === "llm"
        ? "lmstudio"
        : spec.type === "embed"
          ? "embed"
          : spec.type === "image"
            ? "diffusion"
            : spec.type === "controlnet"
              ? "controlnet"
              : spec.type === "vae"
                ? "vae"
                : spec.type === "audio"
                  ? "audio"
                  : spec.type === "document"
                    ? "ocr"
                    : "video",
    displayName: spec.displayName,
    license: spec.license,
    vramGb: spec.vramGB,
    sizeBytes: result.bytes,
    blobs: [
      {
        role: "weights",
        sha256: result.sha256,
        sizeBytes: result.bytes,
        filename: path.basename(spec.source.url ?? `${spec.id}.bin`),
      },
    ],
    source: {
      protocol: spec.source.protocol,
      url: spec.source.url,
      repo: spec.source.repo,
    },
    tags: spec.tags,
    createdAt: now.toISOString(),
  };
}

function sha256OfString(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

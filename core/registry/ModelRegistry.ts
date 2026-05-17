/**
 * v1.0.0 Phase 2.6 -- ModelRegistry stub.
 *
 * Cross-module surface for listing, installing, removing, and inspecting
 * locally-available models. Backed by an in-memory map plus a directory
 * scan of `~/.nexus/models/` for the stub; Phase 5 replaces the
 * implementation with content-addressed storage and resumable downloads.
 *
 * Consumers: Coding, Chat, Image, Video pillars all flow through here.
 *
 * The stub deliberately exposes only what every pillar needs in v1.0.0:
 *  - `list()` with an optional family / runtime filter
 *  - `install(spec)` (no-op stub; returns `{ status: 'queued' }`)
 *  - `remove(id)` (no-op stub)
 *  - `metadata(id)` (returns the in-memory record or throws)
 *
 * Phase 5 will add SHA-256 verification, resumable downloads, and the
 * `extra_model_paths.yaml` compatibility shim.
 */

export type ModelRuntime = "ollama" | "lmstudio" | "diffusion" | "video";

export type ModelFamily = "gemma" | "llama" | "qwen" | "sdxl" | "ltx" | "svd" | "other";

export interface ModelRecord {
  /** Canonical id (e.g. `gemma4:e4b`, `sdxl-turbo`). */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  family: ModelFamily;
  runtime: ModelRuntime;
  /** Approximate VRAM footprint in GB at the default precision. */
  vramGb?: number;
  /** Absolute path to the on-disk artifact when installed. */
  path?: string;
  /** Free-form tags surfaced to the UI (e.g. `recommended`, `thinking`, `vision`). */
  tags?: readonly string[];
}

export interface ModelFilter {
  family?: ModelFamily;
  runtime?: ModelRuntime;
}

export interface ModelSpec {
  id: string;
  source: { kind: "ollama" } | { kind: "url"; url: string; sha256?: string };
}

export type InstallStatus = "queued" | "in-progress" | "complete";

export interface InstallResult {
  status: InstallStatus;
  /** Bytes downloaded (0 until Phase 5 wires real downloads). */
  bytesDownloaded: number;
}

export interface ModelMetadata extends ModelRecord {
  installedAt?: string;
  lastUsedAt?: string;
}

export interface ModelRegistry {
  list(filter?: ModelFilter): readonly ModelRecord[];
  install(spec: ModelSpec): Promise<InstallResult>;
  remove(id: string): Promise<void>;
  metadata(id: string): ModelMetadata;
}

export class InMemoryModelRegistry implements ModelRegistry {
  private readonly _records = new Map<string, ModelMetadata>();

  constructor(initial: readonly ModelRecord[] = DEFAULT_REGISTRY) {
    for (const record of initial) {
      this._records.set(record.id, { ...record });
    }
  }

  list(filter?: ModelFilter): readonly ModelRecord[] {
    const all = Array.from(this._records.values());
    if (!filter) return all;
    return all.filter((r) => {
      if (filter.family && r.family !== filter.family) return false;
      if (filter.runtime && r.runtime !== filter.runtime) return false;
      return true;
    });
  }

  async install(spec: ModelSpec): Promise<InstallResult> {
    // Stub: a Phase 5 implementation will download, SHA-256-verify, and
    // record the on-disk path. For now we register the spec so `list` and
    // `metadata` reflect it.
    if (!this._records.has(spec.id)) {
      this._records.set(spec.id, {
        id: spec.id,
        displayName: spec.id,
        family: "other",
        runtime: spec.source.kind === "ollama" ? "ollama" : "diffusion",
        installedAt: new Date().toISOString(),
      });
    }
    return { status: "queued", bytesDownloaded: 0 };
  }

  async remove(id: string): Promise<void> {
    this._records.delete(id);
  }

  metadata(id: string): ModelMetadata {
    const record = this._records.get(id);
    if (!record) {
      throw new Error(`ModelRegistry: unknown model id ${id}`);
    }
    return { ...record };
  }
}

const DEFAULT_REGISTRY: readonly ModelRecord[] = [
  {
    id: "gemma4:e4b",
    displayName: "Gemma 4 E4B",
    family: "gemma",
    runtime: "ollama",
    vramGb: 6,
    tags: ["recommended", "coding", "chat"],
  },
];

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

/**
 * v1.3.0 Phase 2 (adoption-skill-cleaner T004) -- fallback context window
 * applied when a model record does not declare one. Matches skill-cleaner's
 * default for GPT-5.5 (see
 * `docs/versions/v1/v1.3.0/comparison-skill-cleaner.md`, insight I-05); used
 * as a model-agnostic upper bound when the active model is unknown.
 */
export const DEFAULT_CONTEXT_WINDOW = 272_000;

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
  /**
   * v1.3.0 Phase 2 (adoption-skill-cleaner T004, insight I-05) -- the model's
   * maximum context-window size in tokens. Optional on the wire; the registry
   * normalises an absent value to `DEFAULT_CONTEXT_WINDOW` on store, so
   * `list()` / `metadata()` always return a concrete number.
   *
   * Recommended seed values (sourced from each model's published spec; no
   * network fetch -- all model facts stay local per README "Privacy by
   * construction"):
   *   - Gemma 4 E2B/E4B = 128_000   (https://ai.google.dev/gemma/docs/core)
   *   - Llama 3.1 8B    = 131_072   (https://ai.meta.com/blog/meta-llama-3-1/)
   *   - Llama 3.2 1B/3B = 128_000   (https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_2/)
   *   - Qwen 2.5 Coder  = 131_072   (https://qwenlm.github.io/blog/qwen2.5-coder/)
   */
  contextWindow?: number;
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
  /**
   * v1.3.0 Phase 2 (T004) -- mark `id` as the active model so
   * `getActiveContextWindow()` reads from it. Pass `null` to clear.
   */
  setActiveModel(id: string | null): void;
  /**
   * v1.3.0 Phase 2 (T004, insight I-05) -- the active model's context window
   * in tokens, or `DEFAULT_CONTEXT_WINDOW` when no model is active (or the
   * active id is unknown). Consumers (the Phase 3 SkillAuditor) derive the
   * budget envelope from this value.
   */
  getActiveContextWindow(): number;
}

export class InMemoryModelRegistry implements ModelRegistry {
  private readonly _records = new Map<string, ModelMetadata>();
  /** Active model id, or null when none has been selected. */
  private _activeId: string | null = null;

  constructor(initial: readonly ModelRecord[] = DEFAULT_REGISTRY) {
    for (const record of initial) {
      this._records.set(record.id, normalizeContextWindow(record));
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
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        installedAt: new Date().toISOString(),
      });
    }
    return { status: "queued", bytesDownloaded: 0 };
  }

  async remove(id: string): Promise<void> {
    this._records.delete(id);
    if (this._activeId === id) this._activeId = null;
  }

  metadata(id: string): ModelMetadata {
    const record = this._records.get(id);
    if (!record) {
      throw new Error(`ModelRegistry: unknown model id ${id}`);
    }
    return { ...record };
  }

  setActiveModel(id: string | null): void {
    this._activeId = id;
  }

  getActiveContextWindow(): number {
    if (this._activeId === null) return DEFAULT_CONTEXT_WINDOW;
    const record = this._records.get(this._activeId);
    return record?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  }
}

/**
 * Fill an absent `contextWindow` with `DEFAULT_CONTEXT_WINDOW` so stored
 * records always carry a concrete value. Returns a shallow copy.
 */
function normalizeContextWindow(record: ModelRecord): ModelMetadata {
  return {
    ...record,
    contextWindow: record.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
  };
}

const DEFAULT_REGISTRY: readonly ModelRecord[] = [
  {
    id: "gemma4:e4b",
    displayName: "Gemma 4 E4B",
    family: "gemma",
    runtime: "ollama",
    vramGb: 6,
    // Gemma 4 E2B/E4B context window: 128K tokens
    // (https://ai.google.dev/gemma/docs/core).
    contextWindow: 128_000,
    tags: ["recommended", "coding", "chat"],
  },
];

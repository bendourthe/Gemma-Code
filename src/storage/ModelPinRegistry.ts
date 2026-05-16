/**
 * v0.8.0 Phase 6.6 (item F8) -- Per-model TTL + pinning registry.
 *
 * Tracks per-model load timestamps and pin state. Pinned models receive
 * a `keep_alive: -1` hint on the next Ollama request (effectively
 * disabling Ollama's idle-eviction for that model). Unpinned models fall
 * back to the default keep-alive window (5 minutes per Ollama's default,
 * overrideable via `OLLAMA_KEEP_ALIVE`).
 *
 * The registry is pure in-memory state; the caller (MemoryPanelHost) is
 * responsible for persisting the pin set across VSCode reloads via
 * VS Code's workspaceState (out of scope for this module).
 */

export type KeepAlive = number | string;

export interface ModelRecord {
  readonly model: string;
  /** Epoch ms of the most recent load or use. */
  readonly lastLoadedAt: number;
  readonly pinned: boolean;
}

export interface ModelRegistrySnapshot {
  readonly records: readonly ModelRecord[];
  readonly capturedAt: number;
}

export interface ModelPinRegistryOptions {
  readonly now?: () => number;
}

export class ModelPinRegistry {
  private readonly _records = new Map<string, ModelRecord>();
  private readonly _now: () => number;

  constructor(options: ModelPinRegistryOptions = {}) {
    this._now = options.now ?? Date.now;
  }

  /** Record (or re-record) a model load. Preserves the existing pin state. */
  recordLoad(model: string): ModelRecord {
    const existing = this._records.get(model);
    const record: ModelRecord = {
      model,
      lastLoadedAt: this._now(),
      pinned: existing?.pinned ?? false,
    };
    this._records.set(model, record);
    return record;
  }

  pin(model: string): ModelRecord {
    const existing = this._records.get(model);
    const record: ModelRecord = {
      model,
      lastLoadedAt: existing?.lastLoadedAt ?? this._now(),
      pinned: true,
    };
    this._records.set(model, record);
    return record;
  }

  unpin(model: string): ModelRecord | null {
    const existing = this._records.get(model);
    if (!existing) return null;
    const record: ModelRecord = { ...existing, pinned: false };
    this._records.set(model, record);
    return record;
  }

  /** Returns the keep_alive hint to send on the next Ollama request. */
  keepAliveFor(model: string): KeepAlive {
    const record = this._records.get(model);
    if (record?.pinned) return -1;
    // Honor the operator's OLLAMA_KEEP_ALIVE env-var if present; otherwise
    // fall back to Ollama's 5-minute default which we encode as the
    // canonical "5m" string so the value survives a round-trip to the API.
    const env = process.env.OLLAMA_KEEP_ALIVE;
    if (env && env.length > 0) return env;
    return "5m";
  }

  isPinned(model: string): boolean {
    return this._records.get(model)?.pinned ?? false;
  }

  get(model: string): ModelRecord | undefined {
    return this._records.get(model);
  }

  /** Snapshot for the MemoryPanel Models tab. */
  snapshot(): ModelRegistrySnapshot {
    return {
      records: Array.from(this._records.values()).sort((a, b) =>
        a.model.localeCompare(b.model),
      ),
      capturedAt: this._now(),
    };
  }

  /** Forget a model entirely (e.g. after the operator clicks "unload"). */
  forget(model: string): boolean {
    return this._records.delete(model);
  }

  clear(): void {
    this._records.clear();
  }
}

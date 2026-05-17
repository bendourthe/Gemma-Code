/**
 * v1.0.0 Phase 5.6 -- core-side ModelPinRegistry (closes [v0.9.0:10.N.A]).
 *
 * Ported from `src/storage/ModelPinRegistry.ts`. The legacy module is
 * preserved as a re-export so VS Code-bound callers (StreamingPipeline,
 * MemoryPanelHost) continue to compile unchanged. The new module
 * additionally persists the pin set via the shared `SettingsStore`
 * (key: `nexus.llm.modelPins`).
 *
 * Per-model `keepAliveFor(modelId)` resolves through the registry and is
 * wired into `StreamingPipeline` via the existing `KeepAliveResolver`
 * callback (see desktop sidecar's `codingBootstrap.ts`).
 */

import type { SettingsStore } from "../storage/SettingsStore.js";

export type KeepAlive = number | string;

export interface ModelRecord {
  readonly model: string;
  readonly lastLoadedAt: number;
  readonly pinned: boolean;
}

export interface ModelRegistrySnapshot {
  readonly records: readonly ModelRecord[];
  readonly capturedAt: number;
}

export interface ModelPinRegistryOptions {
  readonly now?: () => number;
  readonly settings?: SettingsStore;
  /**
   * Defaults to `nexus.llm.modelPins`. Override for tests or namespacing.
   */
  readonly settingsKey?: string;
  /**
   * Optional injectable env reader (defaults to `process.env.OLLAMA_KEEP_ALIVE`).
   */
  readonly envKeepAlive?: () => string | undefined;
}

const DEFAULT_KEEP_ALIVE = "5m";
const DEFAULT_SETTINGS_KEY = "nexus.llm.modelPins";

export class ModelPinRegistry {
  private readonly _records = new Map<string, ModelRecord>();
  private readonly _now: () => number;
  private readonly _settings: SettingsStore | null;
  private readonly _settingsKey: string;
  private readonly _envKeepAlive: () => string | undefined;
  private _loaded = false;

  constructor(options: ModelPinRegistryOptions = {}) {
    this._now = options.now ?? Date.now;
    this._settings = options.settings ?? null;
    this._settingsKey = options.settingsKey ?? DEFAULT_SETTINGS_KEY;
    this._envKeepAlive = options.envKeepAlive ?? (() => process.env.OLLAMA_KEEP_ALIVE);
  }

  /** Hydrate pin set from the SettingsStore. Idempotent. */
  async hydrate(): Promise<void> {
    if (this._loaded) return;
    this._loaded = true;
    if (!this._settings) return;
    const persisted = await this._settings.get<readonly string[]>(this._settingsKey);
    if (!persisted) return;
    const now = this._now();
    for (const model of persisted) {
      this._records.set(model, { model, lastLoadedAt: now, pinned: true });
    }
  }

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
    void this._persist();
    return record;
  }

  unpin(model: string): ModelRecord | null {
    const existing = this._records.get(model);
    if (!existing) return null;
    const record: ModelRecord = { ...existing, pinned: false };
    this._records.set(model, record);
    void this._persist();
    return record;
  }

  /**
   * Toggle helper used by the Settings UI checkbox.
   * Returns the resulting record (pinned or unpinned).
   */
  async setPinned(model: string, pinned: boolean): Promise<ModelRecord> {
    if (pinned) {
      const record = this.pin(model);
      await this._persist();
      return record;
    }
    const existing = this._records.get(model);
    const record: ModelRecord = {
      model,
      lastLoadedAt: existing?.lastLoadedAt ?? this._now(),
      pinned: false,
    };
    this._records.set(model, record);
    await this._persist();
    return record;
  }

  keepAliveFor(model: string): KeepAlive {
    const record = this._records.get(model);
    if (record?.pinned) return -1;
    const env = this._envKeepAlive();
    if (env && env.length > 0) return env;
    return DEFAULT_KEEP_ALIVE;
  }

  isPinned(model: string): boolean {
    return this._records.get(model)?.pinned ?? false;
  }

  get(model: string): ModelRecord | undefined {
    return this._records.get(model);
  }

  snapshot(): ModelRegistrySnapshot {
    return {
      records: Array.from(this._records.values()).sort((a, b) =>
        a.model.localeCompare(b.model),
      ),
      capturedAt: this._now(),
    };
  }

  forget(model: string): boolean {
    const removed = this._records.delete(model);
    if (removed) void this._persist();
    return removed;
  }

  clear(): void {
    this._records.clear();
    void this._persist();
  }

  /** Bind the runtime resolver to StreamingPipeline. */
  resolver(): (model: string) => KeepAlive {
    return (m) => this.keepAliveFor(m);
  }

  private async _persist(): Promise<void> {
    if (!this._settings) return;
    const pinned = Array.from(this._records.values())
      .filter((r) => r.pinned)
      .map((r) => r.model)
      .sort();
    await this._settings.set(this._settingsKey, pinned);
  }
}

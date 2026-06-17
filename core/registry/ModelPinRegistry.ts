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
 *
 * v1.6.0 adoption-openrouter-fusion Phase 3 (OF008) -- panel keep-alive.
 * `holdForPanel(models)` places a transient, ref-counted keep-alive hold on a
 * panel run's models so they stay resident (`keepAliveFor` returns `-1`) for
 * the run's duration, and releases them via the returned handle afterward. The
 * hold is in-memory only (never persisted) and is layered *over* the pin set:
 * a user's explicit pin survives a panel run unchanged (releasing a panel hold
 * only clears the transient hold, never the persisted `pinned` flag). The
 * registry structurally satisfies the scheduler's `PanelKeepAliveCoordinator`
 * port (see `GpuScheduler.enqueuePanel`).
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

/**
 * Handle for a transient panel keep-alive hold (OF008). `release()` clears the
 * hold this handle placed; it is idempotent and never touches the persisted
 * pin set. Structurally compatible with the scheduler's
 * `PanelKeepAliveCoordinator` return type.
 */
export interface PanelKeepAliveHandle {
  /** The distinct models this handle holds resident. */
  readonly models: readonly string[];
  /** Release this hold. Idempotent; a second call is a no-op. */
  release(): void;
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
  /**
   * Ref-counted transient panel keep-alive holds (OF008): `model -> active
   * hold count`. Layered over the pin set; never persisted. Ref-counting lets
   * overlapping panel runs that share a model release independently without one
   * run dropping another's hold.
   */
  private readonly _panelHolds = new Map<string, number>();
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
    // A transient panel hold keeps the model resident (-1) for the run's
    // duration without persisting a pin (OF008).
    if ((this._panelHolds.get(model) ?? 0) > 0) return -1;
    const env = this._envKeepAlive();
    if (env && env.length > 0) return env;
    return DEFAULT_KEEP_ALIVE;
  }

  isPinned(model: string): boolean {
    return this._records.get(model)?.pinned ?? false;
  }

  /**
   * Place a transient keep-alive hold on `models` for the duration of a panel
   * run, then release it via the returned handle (OF008). Held models report
   * `keepAliveFor === -1` (kept resident) without being pinned or persisted, so
   * the panel's models survive the fan-out and are released after fusion. A
   * user's explicit pin is untouched by hold/release.
   *
   * Distinct, non-empty model ids only; the hold is ref-counted, so two
   * overlapping panels sharing a model each hold and release independently.
   */
  holdForPanel(models: readonly string[]): PanelKeepAliveHandle {
    const distinct = Array.from(
      new Set(models.map((m) => m.trim()).filter((m) => m.length > 0)),
    );
    for (const model of distinct) {
      this._panelHolds.set(model, (this._panelHolds.get(model) ?? 0) + 1);
    }
    let released = false;
    return {
      models: distinct,
      release: (): void => {
        if (released) return;
        released = true;
        for (const model of distinct) {
          const next = (this._panelHolds.get(model) ?? 0) - 1;
          if (next <= 0) this._panelHolds.delete(model);
          else this._panelHolds.set(model, next);
        }
      },
    };
  }

  /** True while at least one panel hold is active on `model` (OF008). */
  isHeldForPanel(model: string): boolean {
    return (this._panelHolds.get(model) ?? 0) > 0;
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

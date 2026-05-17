/**
 * v1.0.0 Phase 5.6 -- minimal SettingsStore for persisting cross-session
 * preferences (pin sets, default model, telemetry opt-in, etc.).
 *
 * Backed by a single JSON file at `<root>/settings.json`. The interface
 * is intentionally tiny so VS Code's `Memento`, the Tauri app's
 * `localStorage` shim, and a Node-only test stub all satisfy it.
 *
 * Phase 2.6 was scheduled to ship this; it slipped (see v1.0.0 known
 * gaps). Phase 5.6 introduces the minimum surface needed to wire
 * `ModelPinRegistry`. Future phases extend the same key namespace
 * (`nexus.<scope>.<key>`).
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

export interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemorySettingsStore implements SettingsStore {
  private readonly _data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this._data.has(key) ? (this._data.get(key) as T) : undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this._data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this._data.delete(key);
  }

  /** Test helper: snapshot of all keys. */
  entries(): readonly [string, unknown][] {
    return Array.from(this._data.entries());
  }
}

export interface JsonFileSettingsStoreOptions {
  /** Absolute path to the JSON file (the file is created if missing). */
  readonly filePath: string;
}

export class JsonFileSettingsStore implements SettingsStore {
  private _cache: Record<string, unknown> | null = null;
  private _loaded = false;

  constructor(private readonly _opts: JsonFileSettingsStoreOptions) {}

  private async _load(): Promise<Record<string, unknown>> {
    if (this._loaded && this._cache) return this._cache;
    try {
      const body = await fs.readFile(this._opts.filePath, "utf8");
      this._cache = JSON.parse(body) as Record<string, unknown>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this._cache = {};
      } else {
        throw e;
      }
    }
    this._loaded = true;
    return this._cache ?? {};
  }

  private async _flush(): Promise<void> {
    const dir = path.dirname(this._opts.filePath);
    await fs.mkdir(dir, { recursive: true });
    const body = JSON.stringify(this._cache ?? {}, null, 2);
    await fs.writeFile(this._opts.filePath, body, "utf8");
  }

  async get<T>(key: string): Promise<T | undefined> {
    const data = await this._load();
    return data[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const data = await this._load();
    data[key] = value;
    await this._flush();
  }

  async delete(key: string): Promise<void> {
    const data = await this._load();
    if (!(key in data)) return;
    delete data[key];
    await this._flush();
  }
}

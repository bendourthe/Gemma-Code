/**
 * v1.0.0 Phase 2.1: Settings compatibility shim.
 *
 * Reads a `nexus.*` setting; if the key is unset in workspace, user, and
 * default scopes BUT the legacy `gemma-code.*` counterpart in
 * `settingsKeyMap.ts` has a value, returns the legacy value and emits a
 * one-line deprecation warning once per (legacy key, session). Removed in
 * v1.1.0 (the legacy keys themselves are then deleted from `package.json`).
 *
 * Design notes:
 *  - We use `inspect()` rather than `get()` because `get()` falls back to the
 *    schema default and would mask "key is genuinely unset" cases.
 *  - The deprecation log goes to `console.warn` so it appears in VS Code's
 *    Extension Host output channel and in CI logs without requiring a
 *    `vscode.OutputChannel` (which would couple this module to the panel
 *    construction order).
 *  - Tests inject a `WorkspaceConfigurationLike` factory plus a `WarnSink` to
 *    avoid pulling in the real `vscode` namespace.
 */

import { LEGACY_TO_NEW, SETTINGS_KEY_MAP, splitSettingKey } from "./settingsKeyMap.js";

export interface ConfigInspection<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export interface WorkspaceConfigurationLike {
  get<T>(section: string): T | undefined;
  inspect<T>(section: string): ConfigInspection<T> | undefined;
}

export type ConfigurationFactory = (section?: string) => WorkspaceConfigurationLike;

export type WarnSink = (message: string) => void;

const DEPRECATION_MESSAGE_VERSION = "v1.1.0";

/**
 * SettingsCompat resolves new `nexus.*` keys with a one-time deprecation
 * warning when only the legacy `gemma-code.*` key is set.
 */
export class SettingsCompat {
  private readonly _warned = new Set<string>();
  private readonly _factory: ConfigurationFactory;
  private readonly _warn: WarnSink;

  constructor(factory: ConfigurationFactory, warn: WarnSink = defaultWarn) {
    this._factory = factory;
    this._warn = warn;
  }

  /**
   * Resolve a setting by its new `nexus.*` key. Returns `defaultValue` when
   * neither the new nor the mapped legacy key has an explicit value.
   *
   * The resolution order is:
   *   1. The new key in workspace > user > default scope (via `inspect`).
   *   2. The mapped legacy key in workspace > user scope (default scope on
   *      the legacy key is ignored because we own it and it has been removed
   *      from the schema in `package.json`).
   *   3. The provided `defaultValue`.
   */
  get<T>(newKey: string, defaultValue: T): T {
    const newValue = this._readExplicit<T>(newKey);
    if (newValue !== undefined) {
      return newValue;
    }
    const legacyKey = SETTINGS_KEY_MAP[newKey];
    if (legacyKey) {
      const legacyValue = this._readExplicit<T>(legacyKey);
      if (legacyValue !== undefined) {
        this._warnOnce(legacyKey, newKey);
        return legacyValue;
      }
    }
    return defaultValue;
  }

  /**
   * Returns the explicit value (workspace > user) or `undefined` if no
   * caller-set value exists. The schema default is intentionally ignored so
   * callers can decide between "no override" and "override == default".
   *
   * Implementation note: the canonical path uses `inspect()` because `get()`
   * masks "key is unset" by returning the schema default. Test environments
   * with simpler mocks that only expose `get(key, defaultValue)` are
   * supported via a graceful fallback that calls `get(leaf, undefined)` and
   * treats any non-undefined return as an explicit value.
   */
  private _readExplicit<T>(fullKey: string): T | undefined {
    const { section, leaf } = splitSettingKey(fullKey);
    const config = this._factory(section);
    if (typeof config.inspect === "function") {
      const inspected = config.inspect<T>(leaf);
      if (!inspected) return undefined;
      if (inspected.workspaceFolderValue !== undefined) {
        return inspected.workspaceFolderValue;
      }
      if (inspected.workspaceValue !== undefined) return inspected.workspaceValue;
      if (inspected.globalValue !== undefined) return inspected.globalValue;
      return undefined;
    }
    if (typeof config.get === "function") {
      return config.get<T>(leaf);
    }
    return undefined;
  }

  private _warnOnce(legacyKey: string, newKey: string): void {
    if (this._warned.has(legacyKey)) return;
    this._warned.add(legacyKey);
    this._warn(
      `[nexus] Deprecated setting ${legacyKey} -- migrate to ${newKey}. ` +
        `Removed in ${DEPRECATION_MESSAGE_VERSION}.`,
    );
  }

  /**
   * Test-only: clear the per-session deprecation-warned set so a unit test
   * can verify the warning fires on first access.
   */
  resetForTesting(): void {
    this._warned.clear();
  }
}

function defaultWarn(message: string): void {
  // eslint-disable-next-line no-console -- intentional one-line deprecation log
  console.warn(message);
}

/**
 * Re-export so consumers only import from this module.
 */
export { LEGACY_TO_NEW, SETTINGS_KEY_MAP };

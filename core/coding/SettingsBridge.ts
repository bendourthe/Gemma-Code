/**
 * v1.1.0 Phase 11.8 -- settings bridge.
 *
 * Settings configured in the extension write back to the daemon's
 * `SettingsStore`; the desktop app and the extension share one store
 * (SQLite-backed in production, in-memory in tests). The bridge exposes
 * three pieces:
 *
 *   - `SettingsStorePort`: the storage abstraction the daemon implements.
 *   - `buildSettingsGetHandler` / `buildSettingsSetHandler`: IPC handlers
 *     the proxy mounts behind `settings.get` and `settings.set`.
 *   - `reconcileSecondaryMirror`: the activation-time worker that compares
 *     VS Code's own `nexus.coding.*` settings (the secondary mirror) with
 *     the daemon's authoritative store and surfaces a one-time dialog
 *     payload when they diverge.
 */

export interface SettingsStorePort {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  /** Snapshot of every `nexus.*` key currently in the store. */
  snapshot(): Readonly<Record<string, unknown>>;
}

export interface SettingsGetRequest {
  readonly key: string;
}

export interface SettingsGetResponse {
  readonly key: string;
  readonly value: unknown;
}

export interface SettingsSetRequest {
  readonly key: string;
  readonly value: unknown;
}

export interface SettingsSetResponse {
  readonly key: string;
  readonly value: unknown;
}

export const SETTINGS_GET_METHOD = "settings.get";
export const SETTINGS_SET_METHOD = "settings.set";

const SETTINGS_KEY_PREFIX = "nexus.";

function assertSettingsKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || !key.startsWith(SETTINGS_KEY_PREFIX)) {
    throw new Error(
      `Settings keys must start with '${SETTINGS_KEY_PREFIX}'; got: ${JSON.stringify(key)}`,
    );
  }
}

export function buildSettingsGetHandler(
  store: SettingsStorePort,
): (request: SettingsGetRequest) => SettingsGetResponse {
  return (request) => {
    assertSettingsKey(request?.key);
    return Object.freeze({
      key: request.key,
      value: store.get(request.key),
    });
  };
}

export function buildSettingsSetHandler(
  store: SettingsStorePort,
): (request: SettingsSetRequest) => SettingsSetResponse {
  return (request) => {
    assertSettingsKey(request?.key);
    store.set(request.key, request.value);
    return Object.freeze({
      key: request.key,
      value: store.get(request.key),
    });
  };
}

// ---------------------------------------------------------------------------
// In-memory store (testing + activation fallback)
// ---------------------------------------------------------------------------

export class InMemorySettingsStore implements SettingsStorePort {
  private _data: Record<string, unknown>;

  constructor(seed: Readonly<Record<string, unknown>> = {}) {
    this._data = { ...seed };
  }

  get(key: string): unknown {
    return this._data[key];
  }

  set(key: string, value: unknown): void {
    this._data[key] = value;
  }

  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze({ ...this._data });
  }
}

// ---------------------------------------------------------------------------
// Secondary-mirror reconciliation
// ---------------------------------------------------------------------------

export interface SecondaryMirrorEntry {
  readonly key: string;
  /** Value currently configured in the secondary mirror (e.g. VS Code Settings). */
  readonly mirrorValue: unknown;
}

export interface SettingsReconciliationConflict {
  readonly key: string;
  readonly mirrorValue: unknown;
  readonly daemonValue: unknown;
}

export interface SettingsReconciliationOutcome {
  readonly applied: readonly { readonly key: string; readonly value: unknown }[];
  readonly conflicts: readonly SettingsReconciliationConflict[];
}

/**
 * Reconcile a snapshot of the VS Code-side settings mirror against the
 * daemon's authoritative store.
 *
 *  - Keys present only in the mirror copy through to the daemon.
 *  - Keys present in both with equal values: no-op.
 *  - Keys present in both with different values: surfaced as a conflict
 *    so the extension can show a one-time dialog. The daemon value wins
 *    by default -- the user explicitly resolves via the dialog.
 *
 * Pure function: returns the outcome and applies the mutations through
 * the supplied store. Tests assert against the outcome shape.
 */
export function reconcileSecondaryMirror(
  store: SettingsStorePort,
  mirror: readonly SecondaryMirrorEntry[],
): SettingsReconciliationOutcome {
  const applied: { key: string; value: unknown }[] = [];
  const conflicts: SettingsReconciliationConflict[] = [];
  for (const entry of mirror) {
    if (!entry.key.startsWith(SETTINGS_KEY_PREFIX)) continue;
    const current = store.get(entry.key);
    if (current === undefined) {
      store.set(entry.key, entry.mirrorValue);
      applied.push({ key: entry.key, value: entry.mirrorValue });
      continue;
    }
    if (!Object.is(current, entry.mirrorValue)) {
      conflicts.push({
        key: entry.key,
        mirrorValue: entry.mirrorValue,
        daemonValue: current,
      });
    }
  }
  return Object.freeze({
    applied: Object.freeze(applied),
    conflicts: Object.freeze(conflicts),
  });
}

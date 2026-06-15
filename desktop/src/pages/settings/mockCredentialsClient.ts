/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T017) -- in-process mock for the
 * Settings credentials page.
 *
 * Models the OS-keychain vault with an in-memory `integration -> key -> value`
 * map: there is no config-file path, mirroring the production contract where
 * every credential lives only in the keychain. Used by the default
 * `SettingsPage` route (no real keychain in a browser/Vitest context) and by
 * tests; tests can pass `{ available: false }` to exercise the disabled state.
 */

import type { CredentialsClient } from "./credentialsTypes";

export interface MockCredentialsOptions {
  /** Seed: integration -> (key -> value). */
  readonly seed?: Record<string, Record<string, string>>;
  /** Reported keychain availability (default true). */
  readonly available?: boolean;
}

/** A mock client plus a peek into its in-memory store (for assertions). */
export interface MockCredentialsClient extends CredentialsClient {
  /** Read the in-memory store value (test-only; the real vault never exposes this). */
  peek(integration: string, key: string): string | undefined;
}

export function createMockCredentialsClient(
  opts: MockCredentialsOptions = {},
): MockCredentialsClient {
  const available = opts.available ?? true;
  const store = new Map<string, Map<string, string>>();
  for (const [integration, kv] of Object.entries(opts.seed ?? {})) {
    store.set(integration, new Map(Object.entries(kv)));
  }

  function bucket(integration: string): Map<string, string> {
    let b = store.get(integration);
    if (!b) {
      b = new Map();
      store.set(integration, b);
    }
    return b;
  }

  return {
    async status() {
      return { available };
    },
    async listKeys(integration: string) {
      return Array.from(store.get(integration)?.keys() ?? []);
    },
    async setSecret(integration: string, key: string, value: string) {
      if (!available) throw new Error("keychain unavailable");
      bucket(integration).set(key, value);
    },
    async deleteSecret(integration: string, key: string) {
      return store.get(integration)?.delete(key) ?? false;
    },
    peek(integration: string, key: string) {
      return store.get(integration)?.get(key);
    },
  };
}

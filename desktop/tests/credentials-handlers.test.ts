/**
 * v1.5.0 Phase 5 (adoption-ecosystem-2026-06 T017) -- sidecar credential-vault
 * handler routing.
 *
 * Proves the `credentials.*` IPC methods route to the injected
 * `CredentialVault` ONLY: a `credentials.set` lands in the vault (keychain),
 * never in a config file (the handlers touch no filesystem path -- only
 * `ctx.credentials`).
 */

import { describe, it, expect } from "vitest";
import type { CredentialVault } from "../../core/security/CredentialVault";
import { createHandlerContext, dispatch } from "../sidecar/src/handlers";

/** An in-memory vault standing in for the OS keychain (no file, no plaintext). */
function makeFakeVault(available = true): CredentialVault & {
  store: Map<string, Map<string, string>>;
} {
  const store = new Map<string, Map<string, string>>();
  const bucket = (integration: string): Map<string, string> => {
    let b = store.get(integration);
    if (!b) {
      b = new Map();
      store.set(integration, b);
    }
    return b;
  };
  return {
    store,
    async isAvailable() {
      return available;
    },
    async get(integration, key) {
      return store.get(integration)?.get(key);
    },
    async set(integration, key, value) {
      bucket(integration).set(key, value);
    },
    async delete(integration, key) {
      return store.get(integration)?.delete(key) ?? false;
    },
    async list(integration) {
      return Array.from(store.get(integration)?.keys() ?? []);
    },
  };
}

function ctxWith(vault: CredentialVault) {
  return createHandlerContext(
    { pid: 1, platform: "linux" },
    undefined,
    undefined,
    undefined,
    vault,
  );
}

describe("sidecar credentials.* handlers", () => {
  it("credentials.status reports keychain availability", async () => {
    const available = ctxWith(makeFakeVault(true));
    const unavailable = ctxWith(makeFakeVault(false));
    expect(await dispatch("credentials.status", {}, available)).toEqual({
      available: true,
    });
    expect(await dispatch("credentials.status", {}, unavailable)).toEqual({
      available: false,
    });
  });

  it("credentials.set lands the secret in the vault (keychain), not a config file", async () => {
    const vault = makeFakeVault();
    const ctx = ctxWith(vault);

    const res = await dispatch(
      "credentials.set",
      { integration: "github-mcp", key: "GITHUB_TOKEN", value: "ghp_secret" },
      ctx,
    );

    expect(res).toEqual({ ok: true });
    // The value is held by the vault store ONLY -- the handler has no other sink.
    expect(vault.store.get("github-mcp")?.get("GITHUB_TOKEN")).toBe("ghp_secret");
  });

  it("credentials.list returns key names for an integration (values withheld)", async () => {
    const v = makeFakeVault();
    await v.set("svc", "A", "1");
    await v.set("svc", "B", "2");
    const ctx = ctxWith(v);

    const res = (await dispatch("credentials.list", { integration: "svc" }, ctx)) as {
      keys: string[];
    };
    expect(res.keys.sort()).toEqual(["A", "B"]);
  });

  it("credentials.delete removes a stored secret", async () => {
    const v = makeFakeVault();
    await v.set("svc", "A", "1");
    const ctx = ctxWith(v);

    const removed = await dispatch("credentials.delete", { integration: "svc", key: "A" }, ctx);
    expect(removed).toEqual({ removed: true });
    expect(v.store.get("svc")?.has("A")).toBe(false);

    const missing = await dispatch("credentials.delete", { integration: "svc", key: "A" }, ctx);
    expect(missing).toEqual({ removed: false });
  });

  it("rejects malformed credential requests via the strict schema", async () => {
    const ctx = ctxWith(makeFakeVault());
    await expect(dispatch("credentials.set", { integration: "x" }, ctx)).rejects.toThrow();
    await expect(dispatch("credentials.list", {}, ctx)).rejects.toThrow();
  });
});

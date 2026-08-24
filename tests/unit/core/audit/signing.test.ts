import { describe, expect, it } from "vitest";

import {
  MemoryActorKeyStore,
  VaultActorKeyStore,
  createActorKeyStore,
  generateActorKey,
  signPayload,
  verifyPayload,
} from "../../../../core/audit/signing.js";
import type { CredentialVault } from "../../../../core/security/CredentialVault.js";

function memoryVault(): CredentialVault & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(integration, key) {
      return store.get(`${integration}:${key}`);
    },
    async set(integration, key, value) {
      store.set(`${integration}:${key}`, value);
    },
    async delete(integration, key) {
      return store.delete(`${integration}:${key}`);
    },
    async list(integration) {
      return [...store.keys()]
        .filter((k) => k.startsWith(`${integration}:`))
        .map((k) => k.slice(integration.length + 1));
    },
    async isAvailable() {
      return true;
    },
  };
}

describe("audit key stores", () => {
  it("round-trips actor keys through the vault-backed store", async () => {
    const vault = memoryVault();
    const store = new VaultActorKeyStore(vault);
    const pair = generateActorKey("planner");
    await store.set(pair);
    const loaded = await store.get("planner");
    expect(loaded?.publicPem).toBe(pair.publicPem);
    expect(vault.store.get("audit:planner")).toContain("BEGIN PRIVATE KEY");
  });

  it("memory store keeps keys process-local", async () => {
    const mem = new MemoryActorKeyStore();
    const pair = generateActorKey("worker");
    await mem.set(pair);
    expect((await mem.get("worker"))?.actor).toBe("worker");
    expect(await mem.get("app")).toBeUndefined();
  });

  it("verifyPayload returns false for a tampered signature", () => {
    const pair = generateActorKey("app");
    const sig = signPayload(pair.privatePem, "hello");
    expect(verifyPayload(pair.publicPem, "hello", sig)).toBe(true);
    expect(verifyPayload(pair.publicPem, "hello", "not-base64!!!")).toBe(false);
    expect(verifyPayload(pair.publicPem, "other", sig)).toBe(false);
  });

  it("vault get ignores malformed JSON and vault set failures stay in memory", async () => {
    const vault = memoryVault();
    vault.store.set("audit:critic", "{not-json");
    const store = new VaultActorKeyStore(vault);
    expect(await store.get("critic")).toBeUndefined();

    const failing: CredentialVault = {
      ...vault,
      async set() {
        throw new Error("keychain down");
      },
    };
    const memOnly = new VaultActorKeyStore(failing);
    const pair = generateActorKey("app");
    await memOnly.set(pair);
    expect((await memOnly.get("app"))?.publicPem).toBe(pair.publicPem);
  });

  it("createActorKeyStore uses memory when the vault is missing or unavailable", async () => {
    const mem = await createActorKeyStore();
    expect(mem).toBeInstanceOf(MemoryActorKeyStore);
    const vault = memoryVault();
    const withVault = await createActorKeyStore(vault);
    expect(withVault).toBeInstanceOf(VaultActorKeyStore);
    const down = memoryVault();
    down.isAvailable = async () => false;
    const fallback = await createActorKeyStore(down);
    expect(fallback).toBeInstanceOf(MemoryActorKeyStore);
  });
});

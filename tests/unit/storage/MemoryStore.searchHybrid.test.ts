import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";
import type { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";
import { mockOf } from "../../helpers/factories.js";

function makeMockEmbedder(embeddings?: number[][]): EmbeddingClient {
  let i = 0;
  return mockOf<EmbeddingClient>({
    embed: vi.fn(async (_text: string) => embeddings?.[i++] ?? null),
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map(() => embeddings?.[i++] ?? null),
    ),
    isAvailable: vi.fn(async () => !!embeddings),
  });
}

describe("MemoryStore.searchHybrid", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("returns empty list for empty query", async () => {
    const out = await store.searchHybrid("");
    expect(out).toEqual([]);
  });

  it("fuses keyword and semantic candidates into a hybrid list with reasons", async () => {
    const vec = [1, 0, 0];
    const embedder = makeMockEmbedder([vec, vec, vec, vec]);
    store = new MemoryStore(":memory:", embedder);
    await store.save("authentication token rotation", "decision");
    await store.save("oauth provider selection", "decision");
    await store.save("frontend rendering performance", "fact");

    const results = await store.searchHybrid("authentication", 5);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.matchSource).toBe("hybrid");
      expect(r.reason).toBeDefined();
      expect(r.reason!.length).toBeGreaterThan(0);
    }
  });

  it("respects the explicit limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.save(`alpha beta gamma ${i}`, "fact");
    }
    const results = await store.searchHybrid("alpha", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("supports the weighted fusion method", async () => {
    await store.save("memory entry one", "fact");
    await store.save("memory entry two", "fact");
    const results = await store.searchHybrid("memory", 5, "weighted");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.matchSource).toBe("hybrid");
      expect(r.reason).toBeDefined();
    }
  });

  // v0.9.0 Phase 2.2 ------------------------------------------------------

  describe("retrieveHybrid (Phase 2.2)", () => {
    it("returns empty string for an empty query", async () => {
      expect(await store.retrieveHybrid("", 1000)).toBe("");
    });

    it("packs hybrid results into a Recalled Memories block with reasons", async () => {
      await store.save("authentication uses OAuth tokens", "decision");
      await store.save("frontend uses Vite for bundling", "fact");
      const out = await store.retrieveHybrid("authentication", 1000);
      expect(out).toMatch(/## Recalled Memories/);
      expect(out).toContain("authentication");
      expect(out).toMatch(/\[.*?\]$/m);
    });

    it("respects the token budget", async () => {
      for (let i = 0; i < 10; i++) {
        await store.save(`entry ${i} content content content`, "fact");
      }
      const full = await store.retrieveHybrid("entry", 1000);
      const tiny = await store.retrieveHybrid("entry", 40);
      expect(tiny.length).toBeLessThanOrEqual(full.length);
    });
  });
});

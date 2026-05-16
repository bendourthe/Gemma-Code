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
});

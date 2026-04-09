import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";
import type { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";
import type { Message } from "../../../src/chat/types.js";

function makeMessage(role: "user" | "assistant" | "system", content: string): Message {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}

function makeMockEmbedder(embeddings?: number[][]): EmbeddingClient {
  let callIndex = 0;
  return {
    embed: vi.fn(async (_text: string) => {
      if (!embeddings) return null;
      return embeddings[callIndex++] ?? null;
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      if (!embeddings) return texts.map(() => null);
      return texts.map(() => embeddings[callIndex++] ?? null);
    }),
    isAvailable: vi.fn(async () => !!embeddings),
  } as unknown as EmbeddingClient;
}

describe("MemoryStore", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  // -------------------------------------------------------------------------

  describe("save()", () => {
    it("saves a memory entry and returns it with a generated id", async () => {
      const entry = await store.save("Chose SQLite FTS5 over ChromaDB", "decision");

      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(entry.content).toBe("Chose SQLite FTS5 over ChromaDB");
      expect(entry.type).toBe("decision");
      expect(entry.sessionId).toBeNull();
      expect(entry.embedding).toBeNull();
      expect(entry.createdAt).toBeGreaterThan(0);
    });

    it("stores a session id when provided", async () => {
      const entry = await store.save("Some fact", "fact", "session-123");
      expect(entry.sessionId).toBe("session-123");
    });

    it("computes and stores an embedding when embedder is available", async () => {
      const embedder = makeMockEmbedder([[0.1, 0.2, 0.3]]);
      const storeWithEmbedder = new MemoryStore(":memory:", embedder);

      const entry = await storeWithEmbedder.save("test content", "fact");
      expect(entry.embedding).toEqual([0.1, 0.2, 0.3]);

      storeWithEmbedder.close();
    });
  });

  // -------------------------------------------------------------------------

  describe("searchKeyword()", () => {
    it("finds memories matching keyword query via FTS5", async () => {
      await store.save("Chose SQLite FTS5 over ChromaDB", "decision");
      await store.save("The backend runs on port 11435", "fact");
      await store.save("User prefers dark mode", "preference");

      const results = store.searchKeyword("SQLite");

      expect(results).toHaveLength(1);
      expect(results[0]?.entry.content).toContain("SQLite");
      expect(results[0]?.matchSource).toBe("keyword");
    });

    it("returns empty array when no matches found", async () => {
      await store.save("some content", "fact");
      const results = store.searchKeyword("nonexistent-xyz");
      expect(results).toEqual([]);
    });

    it("returns empty array for empty query", () => {
      const results = store.searchKeyword("");
      expect(results).toEqual([]);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 10; i++) {
        await store.save(`Memory about testing number ${i}`, "fact");
      }

      const results = store.searchKeyword("testing", 3);
      expect(results).toHaveLength(3);
    });

    it("updates access count on search", async () => {
      await store.save("Testing access count tracking", "fact");

      store.searchKeyword("access");
      store.searchKeyword("access");

      const stats = store.getStats();
      expect(stats.totalEntries).toBe(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("searchSemantic()", () => {
    it("returns empty when no embedder is provided", async () => {
      await store.save("some content", "fact");
      const results = await store.searchSemantic("query");
      expect(results).toEqual([]);
    });

    it("returns results ranked by cosine similarity", async () => {
      // Embedder returns [1, 0, 0] for first save, [0, 1, 0] for second.
      const embedder = makeMockEmbedder([
        [1, 0, 0],
        [0, 1, 0],
        [1, 0, 0], // query embedding
      ]);
      const storeWithEmbedder = new MemoryStore(":memory:", embedder);

      await storeWithEmbedder.save("Similar content", "fact");
      await storeWithEmbedder.save("Different content", "fact");

      const results = await storeWithEmbedder.searchSemantic("query");

      expect(results.length).toBeGreaterThan(0);
      // First result should be the one with matching [1, 0, 0] embedding.
      expect(results[0]?.entry.content).toBe("Similar content");
      expect(results[0]?.matchSource).toBe("semantic");

      storeWithEmbedder.close();
    });
  });

  // -------------------------------------------------------------------------

  describe("retrieve()", () => {
    it("returns formatted memory context string", async () => {
      await store.save("Chose SQLite FTS5 over ChromaDB", "decision");
      await store.save("The backend runs on port 11435", "fact");

      const result = await store.retrieve("SQLite", 1000);

      expect(result).toContain("## Recalled Memories");
      expect(result).toContain("[decision]");
      expect(result).toContain("SQLite FTS5");
    });

    it("returns empty string for empty query", async () => {
      await store.save("some content", "fact");
      const result = await store.retrieve("", 1000);
      expect(result).toBe("");
    });

    it("returns empty string when no memories match", async () => {
      await store.save("unrelated content", "fact");
      const result = await store.retrieve("nonexistent-xyz-query", 1000);
      expect(result).toBe("");
    });

    it("respects the token budget by limiting entries", async () => {
      for (let i = 0; i < 20; i++) {
        await store.save(`Memory about budget testing item number ${i}`, "fact");
      }

      // Very small budget should limit the number of returned entries.
      const smallBudget = await store.retrieve("budget", 20);
      const largeBudget = await store.retrieve("budget", 2000);

      // Small budget should have fewer lines than large budget.
      const smallLines = smallBudget.split("\n").filter((l) => l.startsWith("- "));
      const largeLines = largeBudget.split("\n").filter((l) => l.startsWith("- "));
      expect(smallLines.length).toBeLessThan(largeLines.length);
    });
  });

  // -------------------------------------------------------------------------

  describe("extractAndSave()", () => {
    it("extracts decisions from conversation messages", async () => {
      const messages = [
        makeMessage("user", "I think we should use SQLite FTS5."),
        makeMessage("assistant", "Agreed. I decided to go with FTS5 for zero-dependency search."),
      ];

      const count = await store.extractAndSave(messages);
      expect(count).toBeGreaterThan(0);

      const stats = store.getStats();
      expect(stats.byType.decision).toBeGreaterThan(0);
    });

    it("extracts preferences from conversation messages", async () => {
      const messages = [
        makeMessage("user", "I always use functional React components with hooks, never class components."),
      ];

      const count = await store.extractAndSave(messages);
      expect(count).toBeGreaterThan(0);

      const stats = store.getStats();
      expect(stats.byType.preference).toBeGreaterThan(0);
    });

    it("extracts error resolutions from assistant messages", async () => {
      const messages = [
        makeMessage("user", "I am getting a connection error when starting the server."),
        makeMessage(
          "assistant",
          "The fix for the ECONNREFUSED error is to start Ollama first with `ollama serve`.",
        ),
      ];

      const count = await store.extractAndSave(messages);
      expect(count).toBeGreaterThan(0);

      const stats = store.getStats();
      expect(stats.byType.error_resolution).toBeGreaterThan(0);
    });

    it("skips system messages", async () => {
      const messages = [
        makeMessage("system", "You decided to use SQLite FTS5 for search."),
      ];

      const count = await store.extractAndSave(messages);
      expect(count).toBe(0);
    });

    it("deduplicates against existing memories", async () => {
      await store.save("I decided to go with FTS5 for search", "decision");

      const messages = [
        makeMessage("assistant", "I decided to go with FTS5 for zero-dependency search."),
      ];

      const count = await store.extractAndSave(messages);
      // Should skip since "FTS5" already exists in a memory.
      expect(count).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  describe("prune()", () => {
    it("removes excess entries keeping the most accessed ones", async () => {
      for (let i = 0; i < 10; i++) {
        await store.save(`Memory ${i}`, "fact");
      }

      expect(store.getStats().totalEntries).toBe(10);

      const removed = store.prune(5);
      expect(removed).toBe(5);
      expect(store.getStats().totalEntries).toBe(5);
    });

    it("does nothing when under the limit", async () => {
      await store.save("Only one", "fact");

      const removed = store.prune(100);
      expect(removed).toBe(0);
      expect(store.getStats().totalEntries).toBe(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("clear()", () => {
    it("removes all memories", async () => {
      await store.save("Memory 1", "fact");
      await store.save("Memory 2", "decision");

      expect(store.getStats().totalEntries).toBe(2);

      store.clear();

      expect(store.getStats().totalEntries).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  describe("getStats()", () => {
    it("returns zero counts for an empty store", () => {
      const stats = store.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.embeddingCount).toBe(0);
      expect(stats.oldestEntryAt).toBeNull();
      expect(stats.newestEntryAt).toBeNull();
      expect(stats.byType.decision).toBe(0);
      expect(stats.byType.fact).toBe(0);
      expect(stats.byType.preference).toBe(0);
      expect(stats.byType.file_pattern).toBe(0);
      expect(stats.byType.error_resolution).toBe(0);
    });

    it("returns correct counts by type", async () => {
      await store.save("A decision", "decision");
      await store.save("A fact", "fact");
      await store.save("Another fact", "fact");

      const stats = store.getStats();
      expect(stats.totalEntries).toBe(3);
      expect(stats.byType.decision).toBe(1);
      expect(stats.byType.fact).toBe(2);
      expect(stats.oldestEntryAt).toBeGreaterThan(0);
      expect(stats.newestEntryAt).toBeGreaterThanOrEqual(stats.oldestEntryAt!);
    });

    it("counts entries with embeddings", async () => {
      const embedder = makeMockEmbedder([[0.1, 0.2], [0.3, 0.4]]);
      const storeWithEmbedder = new MemoryStore(":memory:", embedder);

      await storeWithEmbedder.save("With embedding", "fact");
      await storeWithEmbedder.save("Also with embedding", "fact");

      const stats = storeWithEmbedder.getStats();
      expect(stats.embeddingCount).toBe(2);

      storeWithEmbedder.close();
    });
  });
});

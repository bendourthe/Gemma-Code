import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifiedMemoryRetriever } from "../../../src/storage/UnifiedMemoryRetriever.js";
import type { WorkingMemory } from "../../../src/storage/WorkingMemory.js";
import type { EpisodicMemory } from "../../../src/storage/EpisodicMemory.js";
import type { MemoryStore } from "../../../src/storage/MemoryStore.js";
import type { GraphQueryEngine } from "../../../src/storage/GraphQueryEngine.js";
import { mockOf } from "../../helpers/factories.js";

function mockWorkingMemory(): WorkingMemory {
  return mockOf<WorkingMemory>({
    serialize: vi.fn((_maxTokens: number) => "## Working Memory\n\n**Task**: Test task"),
    getState: vi.fn(() => ({
      currentTask: "Test task",
      openFiles: [],
      recentErrors: [],
      architecturalDecisions: [],
      activeGoals: [],
      scratchpad: {},
    })),
    setCurrentTask: vi.fn(),
    addOpenFile: vi.fn(),
    removeOpenFile: vi.fn(),
    addRecentError: vi.fn(),
    addDecision: vi.fn(),
    setActiveGoals: vi.fn(),
    setScratchpad: vi.fn(),
    getScratchpad: vi.fn(),
    clear: vi.fn(),
    toJSON: vi.fn(),
  });
}

function mockEpisodicMemory(): EpisodicMemory {
  return mockOf<EpisodicMemory>({
    retrieve: vi.fn(async (_q: string, _b: number) => "## Past Experiences\n\n- [edit_file] Fixed auth bug -> Success"),
    record: vi.fn(),
    searchKeyword: vi.fn(),
    searchSemantic: vi.fn(),
    getSessionEvents: vi.fn(),
    prune: vi.fn(),
    close: vi.fn(),
  });
}

function mockSemanticMemory(): MemoryStore {
  return mockOf<MemoryStore>({
    retrieve: vi.fn(async (_q: string, _b: number) => "## Recalled Memories\n\n- [fact] We use SQLite for storage"),
    retrieveHybrid: vi.fn(async (_q: string, _b: number) => "## Recalled Memories\n\n- [fact] Hybrid path [HNSW]"),
    save: vi.fn(),
    saveWithProvenance: vi.fn(),
    searchKeyword: vi.fn(),
    searchSemantic: vi.fn(),
    searchHybrid: vi.fn(),
    extractAndSave: vi.fn(),
    prune: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    isDuplicate: vi.fn(),
    getStats: vi.fn(() => ({ totalEntries: 5, byType: {}, oldestEntryAt: null, newestEntryAt: null, embeddingCount: 0 })),
    setGraphEngine: vi.fn(),
  });
}

function mockGraphEngine(): GraphQueryEngine {
  return mockOf<GraphQueryEngine>({
    queryContextFor: vi.fn((_q: string, _l: number) => ({
      entities: [{ id: "1", name: "MemoryStore", type: "class", properties: {}, firstSeenAt: 0, lastSeenAt: 0, mentionCount: 5 }],
      relations: [],
      totalWeight: 0.5,
    })),
    formatAsContext: vi.fn((_r: unknown, _t: number) => "## Knowledge Graph Context\n\n### Entities\n- [class] MemoryStore (mentioned 5 times)"),
    queryByEntity: vi.fn(),
    queryByRelationType: vi.fn(),
    explainPath: vi.fn(),
  });
}

describe("UnifiedMemoryRetriever", () => {
  describe("retrieve()", () => {
    it("merges context from all layers", async () => {
      const retriever = new UnifiedMemoryRetriever(
        mockWorkingMemory(),
        mockEpisodicMemory(),
        mockSemanticMemory(),
        mockGraphEngine(),
      );

      const result = await retriever.retrieve({
        query: "memory storage",
        layers: ["working", "episodic", "semantic", "graph"],
        tokenBudget: 2000,
        maxResults: 20,
        includeStale: false,
      });

      expect(result).toContain("## Memory Context");
      expect(result).toContain("Working Memory");
      expect(result).toContain("Recalled Memories");
      expect(result).toContain("Knowledge Graph Context");
      expect(result).toContain("Past Experiences");
    });

    it("works with only semantic + graph (episodic null)", async () => {
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        mockSemanticMemory(),
        mockGraphEngine(),
      );

      const result = await retriever.retrieve({
        query: "test",
        layers: ["semantic", "graph"],
        tokenBudget: 1000,
        maxResults: 10,
        includeStale: false,
      });

      expect(result).toContain("Recalled Memories");
      expect(result).toContain("Knowledge Graph Context");
      expect(result).not.toContain("Working Memory");
    });

    it("returns empty string when no layers are available", async () => {
      const retriever = new UnifiedMemoryRetriever(null, null, null, null);

      const result = await retriever.retrieve({
        query: "test",
        layers: ["working", "semantic"],
        tokenBudget: 500,
        maxResults: 10,
        includeStale: false,
      });

      expect(result).toBe("");
    });

    it("redistributes budget when some layers are null", async () => {
      const semantic = mockSemanticMemory();
      // v0.9.0 Phase 2.2: pass the legacy route so the assertion on
      // `retrieve` (not `retrieveHybrid`) still holds. The hybrid-route
      // case is covered in its own describe block below.
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        semantic,
        null,
        null,
        null,
        1,
        "legacy",
      );

      await retriever.retrieve({
        query: "test",
        layers: ["working", "semantic", "graph", "episodic"],
        tokenBudget: 1000,
        maxResults: 10,
        includeStale: false,
      });

      // Semantic should get the full budget since it's the only active layer.
      // Third arg is the corroboration threshold, defaulting to 1.
      expect(semantic.retrieve).toHaveBeenCalledWith("test", 1000, 1);
    });

    it("trims episodic first when over budget", async () => {
      // Create a retriever where all layers return large content.
      const wm = mockWorkingMemory();
      const em = mockEpisodicMemory();
      const sm = mockSemanticMemory();
      const ge = mockGraphEngine();

      const retriever = new UnifiedMemoryRetriever(wm, em, sm, ge);

      // Very tight budget: should include working (never trimmed) but may truncate others.
      const result = await retriever.retrieve({
        query: "test",
        layers: ["working", "episodic", "semantic", "graph"],
        tokenBudget: 100, // ~400 chars
        maxResults: 10,
        includeStale: false,
      });

      // Should always contain working memory.
      expect(result).toContain("Working Memory");
    });
  });

  describe("retrieveForPrompt()", () => {
    it("calls retrieve with all layers", async () => {
      const retriever = new UnifiedMemoryRetriever(
        mockWorkingMemory(),
        mockEpisodicMemory(),
        mockSemanticMemory(),
        mockGraphEngine(),
      );

      const result = await retriever.retrieveForPrompt("test query", 1000);
      expect(result).toContain("## Memory Context");
    });
  });

  describe("getLayerStats()", () => {
    it("reports correct availability", () => {
      const retriever = new UnifiedMemoryRetriever(
        mockWorkingMemory(),
        null,
        mockSemanticMemory(),
        null,
      );

      const stats = retriever.getLayerStats();
      expect(stats.working.available).toBe(true);
      expect(stats.episodic.available).toBe(false);
      expect(stats.semantic.available).toBe(true);
      expect(stats.graph.available).toBe(false);
    });

    it("reports semantic entry count", () => {
      const sm = mockSemanticMemory();
      const retriever = new UnifiedMemoryRetriever(null, null, sm, null);

      const stats = retriever.getLayerStats();
      expect(stats.semantic.entryCount).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 5: searchToolOutputs
  // -------------------------------------------------------------------------

  describe("searchToolOutputs() (Phase 5 -- semantic + FTS5 fallback)", () => {
    function makeMockToolOutputCache(opts: {
      semanticResults?: Array<{
        absolutePath: string;
        similarity: number;
        content: string;
      }>;
      keywordResults?: Array<{
        absolutePath: string;
        similarity: number;
        content: string;
      }>;
    }): {
      cache: import("../../../src/storage/ToolOutputCache.js").ToolOutputCache;
      searchByEmbedding: ReturnType<typeof vi.fn>;
      searchByKeyword: ReturnType<typeof vi.fn>;
    } {
      const searchByEmbedding = vi.fn(() => opts.semanticResults ?? []);
      const searchByKeyword = vi.fn(() => opts.keywordResults ?? []);
      const cache = mockOf<
        import("../../../src/storage/ToolOutputCache.js").ToolOutputCache
      >({
        searchByEmbedding,
        searchByKeyword,
      });
      return { cache, searchByEmbedding, searchByKeyword };
    }

    function makeMockEmbedder(
      embedFn: (text: string) => Promise<number[] | null>,
    ): import("../../../src/storage/EmbeddingClient.js").EmbeddingClient {
      return mockOf<
        import("../../../src/storage/EmbeddingClient.js").EmbeddingClient
      >({
        embed: vi.fn(embedFn),
        embedBatch: vi.fn(),
        isAvailable: vi.fn(async () => true),
      });
    }

    it("returns [] when no ToolOutputCache is wired", async () => {
      const retriever = new UnifiedMemoryRetriever(null, null, null, null);
      expect(await retriever.searchToolOutputs("anything", { topK: 5 })).toEqual([]);
    });

    it("returns [] for an empty query", async () => {
      const { cache, searchByEmbedding, searchByKeyword } = makeMockToolOutputCache({
        semanticResults: [{ absolutePath: "p", similarity: 0.99, content: "x" }],
      });
      const retriever = new UnifiedMemoryRetriever(null, null, null, null, cache, null);
      expect(await retriever.searchToolOutputs("", { topK: 5 })).toEqual([]);
      expect(searchByEmbedding).not.toHaveBeenCalled();
      expect(searchByKeyword).not.toHaveBeenCalled();
    });

    it("uses semantic recall when an embedder returns a vector", async () => {
      const semanticResults = [
        { absolutePath: "/a", similarity: 0.97, content: "alpha content" },
      ];
      const { cache, searchByEmbedding, searchByKeyword } = makeMockToolOutputCache({
        semanticResults,
      });
      const embedder = makeMockEmbedder(async () => [1, 0, 0, 0]);
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        null,
        null,
        cache,
        embedder,
      );

      const results = await retriever.searchToolOutputs("alpha", { topK: 5 });
      expect(results).toEqual(semanticResults);
      expect(searchByEmbedding).toHaveBeenCalledOnce();
      expect(searchByKeyword).not.toHaveBeenCalled();
    });

    it("falls back to FTS5 when Ollama embedder returns null", async () => {
      const keywordResults = [
        { absolutePath: "/b", similarity: 1, content: "alpha keyword content" },
      ];
      const { cache, searchByEmbedding, searchByKeyword } = makeMockToolOutputCache({
        keywordResults,
      });
      const embedder = makeMockEmbedder(async () => null);
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        null,
        null,
        cache,
        embedder,
      );

      const results = await retriever.searchToolOutputs("alpha", { topK: 5 });
      expect(results).toEqual(keywordResults);
      expect(searchByEmbedding).not.toHaveBeenCalled();
      expect(searchByKeyword).toHaveBeenCalledOnce();
    });

    it("falls back to FTS5 when the embedder throws", async () => {
      const { cache, searchByEmbedding, searchByKeyword } = makeMockToolOutputCache({
        keywordResults: [
          { absolutePath: "/c", similarity: 0.8, content: "alpha thrown content" },
        ],
      });
      const embedder = makeMockEmbedder(async () => {
        throw new Error("network down");
      });
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        null,
        null,
        cache,
        embedder,
      );

      const results = await retriever.searchToolOutputs("alpha", { topK: 5 });
      expect(results.length).toBe(1);
      expect(searchByEmbedding).not.toHaveBeenCalled();
      expect(searchByKeyword).toHaveBeenCalledOnce();
    });

    it("falls back to FTS5 when semantic results are empty", async () => {
      const keywordResults = [
        { absolutePath: "/d", similarity: 0.5, content: "alpha keyword" },
      ];
      const { cache, searchByEmbedding, searchByKeyword } = makeMockToolOutputCache({
        semanticResults: [],
        keywordResults,
      });
      const embedder = makeMockEmbedder(async () => [1, 0, 0]);
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        null,
        null,
        cache,
        embedder,
      );

      const results = await retriever.searchToolOutputs("alpha", { topK: 5 });
      expect(results).toEqual(keywordResults);
      expect(searchByEmbedding).toHaveBeenCalledOnce();
      expect(searchByKeyword).toHaveBeenCalledOnce();
    });

    it("skips the semantic step entirely when no embedder is wired", async () => {
      const keywordResults = [
        { absolutePath: "/e", similarity: 0.9, content: "match" },
      ];
      const { cache, searchByEmbedding, searchByKeyword } = makeMockToolOutputCache({
        keywordResults,
      });
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        null,
        null,
        cache,
        null,
      );

      const results = await retriever.searchToolOutputs("alpha", { topK: 5 });
      expect(results).toEqual(keywordResults);
      expect(searchByEmbedding).not.toHaveBeenCalled();
      expect(searchByKeyword).toHaveBeenCalledOnce();
    });

    it("forwards the threshold override to searchByEmbedding", async () => {
      const { cache, searchByEmbedding } = makeMockToolOutputCache({
        semanticResults: [
          { absolutePath: "/f", similarity: 0.92, content: "x" },
        ],
      });
      const embedder = makeMockEmbedder(async () => [1, 0]);
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        null,
        null,
        cache,
        embedder,
      );

      await retriever.searchToolOutputs("alpha", { topK: 7, threshold: 0.99 });
      expect(searchByEmbedding).toHaveBeenCalledWith([1, 0], {
        topK: 7,
        threshold: 0.99,
      });
    });
  });

  // v0.9.0 Phase 2.2 ------------------------------------------------------

  describe("retrieval route (Phase 2.2)", () => {
    it("defaults to the hybrid route", async () => {
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        mockSemanticMemory(),
        null,
      );
      expect(retriever.getRetrievalRoute()).toBe("hybrid");
    });

    it("hybrid route routes the semantic layer through retrieveHybrid", async () => {
      const semantic = mockSemanticMemory();
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        semantic,
        null,
        null,
        null,
        1,
        "hybrid",
      );
      const out = await retriever.retrieveForPrompt("question", 1000);
      expect(semantic.retrieveHybrid).toHaveBeenCalled();
      expect(semantic.retrieve).not.toHaveBeenCalled();
      expect(out).toContain("Hybrid path");
    });

    it("legacy route preserves the v0.7.0 keyword + cosine merge path", async () => {
      const semantic = mockSemanticMemory();
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        semantic,
        null,
        null,
        null,
        1,
        "legacy",
      );
      const out = await retriever.retrieveForPrompt("question", 1000);
      expect(semantic.retrieve).toHaveBeenCalled();
      expect(semantic.retrieveHybrid).not.toHaveBeenCalled();
      expect(out).toContain("SQLite for storage");
    });

    it("setRetrievalRoute swaps routes at runtime", async () => {
      const semantic = mockSemanticMemory();
      const retriever = new UnifiedMemoryRetriever(
        null,
        null,
        semantic,
        null,
      );
      retriever.setRetrievalRoute("legacy");
      await retriever.retrieveForPrompt("question", 1000);
      expect(semantic.retrieve).toHaveBeenCalled();
    });
  });
});

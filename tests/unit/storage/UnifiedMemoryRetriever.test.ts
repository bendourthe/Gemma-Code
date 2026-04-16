import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifiedMemoryRetriever } from "../../../src/storage/UnifiedMemoryRetriever.js";
import type { WorkingMemory } from "../../../src/storage/WorkingMemory.js";
import type { EpisodicMemory } from "../../../src/storage/EpisodicMemory.js";
import type { MemoryStore } from "../../../src/storage/MemoryStore.js";
import type { GraphQueryEngine } from "../../../src/storage/GraphQueryEngine.js";

function mockWorkingMemory(): WorkingMemory {
  return {
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
  } as unknown as WorkingMemory;
}

function mockEpisodicMemory(): EpisodicMemory {
  return {
    retrieve: vi.fn(async (_q: string, _b: number) => "## Past Experiences\n\n- [edit_file] Fixed auth bug -> Success"),
    record: vi.fn(),
    searchKeyword: vi.fn(),
    searchSemantic: vi.fn(),
    getSessionEvents: vi.fn(),
    prune: vi.fn(),
    close: vi.fn(),
  } as unknown as EpisodicMemory;
}

function mockSemanticMemory(): MemoryStore {
  return {
    retrieve: vi.fn(async (_q: string, _b: number) => "## Recalled Memories\n\n- [fact] We use SQLite for storage"),
    save: vi.fn(),
    saveWithProvenance: vi.fn(),
    searchKeyword: vi.fn(),
    searchSemantic: vi.fn(),
    extractAndSave: vi.fn(),
    prune: vi.fn(),
    clear: vi.fn(),
    close: vi.fn(),
    isDuplicate: vi.fn(),
    getStats: vi.fn(() => ({ totalEntries: 5, byType: {}, oldestEntryAt: null, newestEntryAt: null, embeddingCount: 0 })),
    setGraphEngine: vi.fn(),
  } as unknown as MemoryStore;
}

function mockGraphEngine(): GraphQueryEngine {
  return {
    queryContextFor: vi.fn((_q: string, _l: number) => ({
      entities: [{ id: "1", name: "MemoryStore", type: "class", properties: {}, firstSeenAt: 0, lastSeenAt: 0, mentionCount: 5 }],
      relations: [],
      totalWeight: 0.5,
    })),
    formatAsContext: vi.fn((_r: unknown, _t: number) => "## Knowledge Graph Context\n\n### Entities\n- [class] MemoryStore (mentioned 5 times)"),
    queryByEntity: vi.fn(),
    queryByRelationType: vi.fn(),
    explainPath: vi.fn(),
  } as unknown as GraphQueryEngine;
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
      const retriever = new UnifiedMemoryRetriever(null, null, semantic, null);

      await retriever.retrieve({
        query: "test",
        layers: ["working", "semantic", "graph", "episodic"],
        tokenBudget: 1000,
        maxResults: 10,
        includeStale: false,
      });

      // Semantic should get the full budget since it's the only active layer.
      expect(semantic.retrieve).toHaveBeenCalledWith("test", 1000);
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
});

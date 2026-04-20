import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EpisodicMemory, recordToolEvent, recordDecisionEvent } from "../../../src/storage/EpisodicMemory.js";
import type { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";
import type { MemoryProvenance } from "../../../src/storage/MemoryLayers.types.js";
import { mockOf } from "../../helpers/factories.js";

function makeProvenance(overrides?: Partial<MemoryProvenance>): MemoryProvenance {
  return {
    source: "tool_verified",
    sourceSessionId: "session-1",
    sourceMessageId: null,
    timestamp: Date.now(),
    confidence: 0.9,
    ...overrides,
  };
}

function makeMockEmbedder(embeddings?: number[][]): EmbeddingClient {
  let callIndex = 0;
  return mockOf<EmbeddingClient>({
    embed: vi.fn(async (_text: string) => {
      if (!embeddings) return null;
      return embeddings[callIndex++] ?? null;
    }),
    embedBatch: vi.fn(async (texts: string[]) => {
      if (!embeddings) return texts.map(() => null);
      return texts.map(() => embeddings[callIndex++] ?? null);
    }),
    isAvailable: vi.fn(async () => !!embeddings),
  });
}

describe("EpisodicMemory", () => {
  let em: EpisodicMemory;

  beforeEach(() => {
    em = new EpisodicMemory(":memory:");
  });

  afterEach(() => {
    em.close();
  });

  describe("record()", () => {
    it("creates an entry with a generated id", async () => {
      const entry = await em.record({
        sessionId: "session-1",
        action: "write_file(path=src/app.ts)",
        context: "Creating the main application file",
        outcome: "File created successfully",
        timestamp: Date.now(),
        provenance: makeProvenance(),
        tags: ["write_file"],
      });

      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(entry.action).toBe("write_file(path=src/app.ts)");
      expect(entry.context).toBe("Creating the main application file");
      expect(entry.outcome).toBe("File created successfully");
      expect(entry.sessionId).toBe("session-1");
      expect(entry.tags).toEqual(["write_file"]);
    });
  });

  describe("searchKeyword()", () => {
    it("finds relevant events via FTS5", async () => {
      await em.record({
        sessionId: "s1",
        action: "edit_file",
        context: "Fixed authentication bug in login handler",
        outcome: "Success",
        timestamp: Date.now(),
        provenance: makeProvenance(),
        tags: ["edit_file"],
      });
      await em.record({
        sessionId: "s1",
        action: "write_file",
        context: "Added database migration script",
        outcome: "Success",
        timestamp: Date.now(),
        provenance: makeProvenance(),
        tags: ["write_file"],
      });

      const results = em.searchKeyword("authentication login", 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.context).toContain("authentication");
    });

    it("returns empty array for no matches", () => {
      const results = em.searchKeyword("nonexistent query xyz");
      expect(results).toEqual([]);
    });
  });

  describe("searchSemantic()", () => {
    it("works with a mock embedder", async () => {
      const embedder = makeMockEmbedder([
        [1.0, 0.0, 0.0], // first record embedding
        [0.9, 0.1, 0.0], // query embedding (similar to first)
      ]);
      const emWithEmbedder = new EpisodicMemory(":memory:", embedder);

      await emWithEmbedder.record({
        sessionId: "s1",
        action: "test action",
        context: "test context",
        outcome: "test outcome",
        timestamp: Date.now(),
        provenance: makeProvenance(),
        tags: [],
      });

      const results = await emWithEmbedder.searchSemantic("test query", 5);
      expect(results.length).toBe(1);
      expect(results[0]!.action).toBe("test action");

      emWithEmbedder.close();
    });

    it("returns empty when embedder is null", async () => {
      const results = await em.searchSemantic("some query", 5);
      expect(results).toEqual([]);
    });
  });

  describe("retrieve()", () => {
    it("formats events within token budget", async () => {
      await em.record({
        sessionId: "s1",
        action: "write_file",
        context: "Created auth module",
        outcome: "Success",
        timestamp: Date.now(),
        provenance: makeProvenance({ confidence: 0.9 }),
        tags: ["write_file"],
      });

      const result = await em.retrieve("auth module", 500);
      expect(result).toContain("## Past Experiences");
      expect(result).toContain("[write_file]");
      expect(result).toContain("Created auth module");
      expect(result).toContain("confidence: 0.9");
    });

    it("returns empty string for empty query", async () => {
      const result = await em.retrieve("", 500);
      expect(result).toBe("");
    });
  });

  describe("getSessionEvents()", () => {
    it("returns events in chronological order", async () => {
      const now = Date.now();
      await em.record({
        sessionId: "s1",
        action: "first",
        context: "first event",
        outcome: null,
        timestamp: now,
        provenance: makeProvenance(),
        tags: [],
      });
      await em.record({
        sessionId: "s1",
        action: "second",
        context: "second event",
        outcome: null,
        timestamp: now + 1000,
        provenance: makeProvenance(),
        tags: [],
      });
      await em.record({
        sessionId: "s2",
        action: "other session",
        context: "should not appear",
        outcome: null,
        timestamp: now + 500,
        provenance: makeProvenance(),
        tags: [],
      });

      const events = em.getSessionEvents("s1");
      expect(events).toHaveLength(2);
      expect(events[0]!.action).toBe("first");
      expect(events[1]!.action).toBe("second");
    });
  });

  describe("prune()", () => {
    it("removes oldest events exceeding the limit", async () => {
      for (let i = 0; i < 5; i++) {
        await em.record({
          sessionId: "s1",
          action: `action-${i}`,
          context: `context ${i}`,
          outcome: null,
          timestamp: Date.now() + i * 1000,
          provenance: makeProvenance(),
          tags: [],
        });
      }

      const removed = em.prune(3);
      expect(removed).toBe(2);

      const remaining = em.getSessionEvents("s1");
      expect(remaining).toHaveLength(3);
      expect(remaining[0]!.action).toBe("action-2");
    });

    it("returns 0 when under the limit", async () => {
      await em.record({
        sessionId: "s1",
        action: "single",
        context: "only one",
        outcome: null,
        timestamp: Date.now(),
        provenance: makeProvenance(),
        tags: [],
      });

      expect(em.prune(10)).toBe(0);
    });
  });

  describe("recordToolEvent()", () => {
    it("creates correct entry structure", async () => {
      const entry = await recordToolEvent(
        em,
        "session-1",
        "write_file",
        { path: "src/app.ts", content: "hello" },
        { success: true, output: "File written" },
        "Writing application entry point",
      );

      expect(entry.action).toContain("write_file");
      expect(entry.action).toContain("path=src/app.ts");
      expect(entry.outcome).toBe("File written");
      expect(entry.provenance.source).toBe("tool_verified");
      expect(entry.provenance.confidence).toBe(0.9);
      expect(entry.tags).toContain("write_file");
    });

    it("sets lower confidence on failure", async () => {
      const entry = await recordToolEvent(
        em,
        "session-1",
        "run_terminal",
        { command: "npm test" },
        { success: false, error: "Tests failed" },
        "Running test suite",
      );

      expect(entry.provenance.confidence).toBe(0.5);
      expect(entry.outcome).toBe("Tests failed");
    });
  });

  describe("recordDecisionEvent()", () => {
    it("creates a decision entry", async () => {
      const entry = await recordDecisionEvent(
        em,
        "session-1",
        "Use SQLite for storage",
        "Need local-only persistence without external dependencies",
      );

      expect(entry.action).toContain("decision:");
      expect(entry.action).toContain("Use SQLite");
      expect(entry.context).toContain("local-only persistence");
      expect(entry.provenance.source).toBe("llm_extracted");
      expect(entry.tags).toContain("decision");
    });
  });
});

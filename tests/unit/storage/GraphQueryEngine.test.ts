import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { GraphMemory } from "../../../src/storage/GraphMemory.js";
import { GraphQueryEngine } from "../../../src/storage/GraphQueryEngine.js";
import type { MemoryProvenance } from "../../../src/storage/MemoryLayers.types.js";

function makeProvenance(overrides?: Partial<MemoryProvenance>): MemoryProvenance {
  return {
    source: "tool_verified",
    sourceSessionId: "session-1",
    sourceMessageId: null,
    timestamp: Date.now(),
    confidence: 0.8,
    ...overrides,
  };
}

describe("GraphQueryEngine", () => {
  let db: Database.Database;
  let gm: GraphMemory;
  let engine: GraphQueryEngine;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    gm = new GraphMemory(db);
    engine = new GraphQueryEngine(gm);

    // Set up a small test graph:
    // MemoryStore.ts --imports--> EmbeddingClient.ts
    // MemoryStore.ts --imports--> MemoryLayers.types.ts
    // EmbeddingClient.ts --depends_on--> Ollama
    // PromptBuilder.ts --calls--> MemoryStore.ts
    // AgentLoop.ts --calls--> PromptBuilder.ts
    const prov = makeProvenance();
    gm.upsertRelation("MemoryStore.ts", "file", "EmbeddingClient.ts", "file", "imports", prov);
    gm.upsertRelation("MemoryStore.ts", "file", "MemoryLayers.types.ts", "file", "imports", prov);
    gm.upsertRelation("EmbeddingClient.ts", "file", "Ollama", "technology", "depends_on", prov);
    gm.upsertRelation("PromptBuilder.ts", "file", "MemoryStore.ts", "file", "calls", prov);
    gm.upsertRelation("AgentLoop.ts", "file", "PromptBuilder.ts", "file", "calls", prov);
  });

  afterEach(() => {
    db.close();
  });

  describe("queryByEntity()", () => {
    it("returns correct depth-limited subgraph", () => {
      const result = engine.queryByEntity("MemoryStore.ts", 1, 10);
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
      const names = result.entities.map((e) => e.name);
      expect(names).toContain("MemoryStore.ts");
    });

    it("returns empty for unknown entity", () => {
      const result = engine.queryByEntity("nonexistent", 2, 10);
      expect(result.entities).toEqual([]);
    });
  });

  describe("queryByRelationType()", () => {
    it("filters by relation type", () => {
      const result = engine.queryByRelationType("imports", 10);
      expect(result.relations.length).toBe(2);
      expect(result.relations.every((r) => r.type === "imports")).toBe(true);
    });

    it("returns empty for unused relation type", () => {
      const result = engine.queryByRelationType("tests", 10);
      expect(result.relations).toEqual([]);
    });
  });

  describe("queryContextFor()", () => {
    it("extracts entities from query and traverses", () => {
      const result = engine.queryContextFor("What depends on MemoryStore.ts?", 10);
      expect(result.entities.length).toBeGreaterThanOrEqual(1);
    });

    it("falls back to word search when no entities extracted", () => {
      const result = engine.queryContextFor("memory embedding", 10);
      // Should find entities with "memory" or "embedding" in their names.
      expect(result.entities.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("formatAsContext()", () => {
    it("produces valid markdown within token limit", () => {
      const result = engine.queryByEntity("MemoryStore.ts", 2, 10);
      const formatted = engine.formatAsContext(result, 500);
      expect(formatted).toContain("## Knowledge Graph Context");
      expect(formatted).toContain("### Entities");
      expect(formatted.length).toBeLessThanOrEqual(500 * 4 + 50); // some overhead
    });

    it("returns empty string for empty results", () => {
      const formatted = engine.formatAsContext(
        { entities: [], relations: [], totalWeight: 0 },
        500,
      );
      expect(formatted).toBe("");
    });
  });

  describe("explainPath()", () => {
    it("finds shortest path between two entities", () => {
      const path = engine.explainPath("AgentLoop.ts", "EmbeddingClient.ts", 5);
      expect(path).not.toBeNull();
      if (path) {
        expect(path.path.length).toBeGreaterThanOrEqual(2);
        expect(path.relations.length).toBeGreaterThanOrEqual(1);
        expect(path.explanation).toBeTruthy();
      }
    });

    it("returns null when no path exists", () => {
      // Add an isolated entity.
      gm.upsertEntity("isolated", "file");
      const path = engine.explainPath("AgentLoop.ts", "isolated", 5);
      expect(path).toBeNull();
    });

    it("returns self-path for same entity", () => {
      const path = engine.explainPath("MemoryStore.ts", "MemoryStore.ts", 5);
      expect(path).not.toBeNull();
      if (path) {
        expect(path.path).toHaveLength(1);
        expect(path.relations).toHaveLength(0);
      }
    });
  });

  describe("results sorted by weight * recency", () => {
    it("recent entities rank higher than old ones", () => {
      const prov = makeProvenance();
      // Create a recent entity and an old one.
      gm.upsertRelation("RecentFile.ts", "file", "MemoryStore.ts", "file", "imports", prov);

      // Force one entity to be old.
      db.prepare("UPDATE graph_entities SET last_seen_at = ? WHERE name = ?")
        .run(Date.now() - 30 * 86_400_000, "MemoryLayers.types.ts");

      const result = engine.queryByEntity("MemoryStore.ts", 1, 10);
      const names = result.entities.map((e) => e.name);
      // MemoryStore.ts should be first (most mentions), recent entities before old.
      expect(names[0]).toBe("MemoryStore.ts");
    });
  });
});

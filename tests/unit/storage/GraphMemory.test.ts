import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { GraphMemory } from "../../../src/storage/GraphMemory.js";
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

describe("GraphMemory", () => {
  let db: Database.Database;
  let gm: GraphMemory;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    gm = new GraphMemory(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("upsertEntity()", () => {
    it("creates a new entity", () => {
      const entity = gm.upsertEntity("MemoryStore", "class");
      expect(entity.name).toBe("MemoryStore");
      expect(entity.type).toBe("class");
      expect(entity.mentionCount).toBe(1);
      expect(typeof entity.id).toBe("string");
      expect(entity.id.length).toBeGreaterThan(0);
    });

    it("increments mentionCount on duplicate (name, type)", () => {
      gm.upsertEntity("MemoryStore", "class");
      const updated = gm.upsertEntity("MemoryStore", "class");
      expect(updated.mentionCount).toBe(2);
    });

    it("trims whitespace from name", () => {
      const entity = gm.upsertEntity("  MemoryStore  ", "class");
      expect(entity.name).toBe("MemoryStore");
    });

    it("merges properties on update", () => {
      gm.upsertEntity("MemoryStore", "class", { version: "1.0" });
      const updated = gm.upsertEntity("MemoryStore", "class", { author: "dev" });
      expect(updated.properties).toEqual({ version: "1.0", author: "dev" });
    });
  });

  describe("upsertRelation()", () => {
    it("creates entities and relation", () => {
      const prov = makeProvenance();
      const rel = gm.upsertRelation(
        "MemoryStore.ts", "file",
        "EmbeddingClient.ts", "file",
        "imports", prov,
      );
      expect(rel.type).toBe("imports");
      expect(rel.weight).toBe(0.5);
      expect(typeof rel.sourceId).toBe("string");
      expect(rel.sourceId.length).toBeGreaterThan(0);
      expect(typeof rel.targetId).toBe("string");
      expect(rel.targetId.length).toBeGreaterThan(0);
    });

    it("increases weight on duplicate relation (capped at 1.0)", () => {
      const prov = makeProvenance();
      gm.upsertRelation("A", "file", "B", "file", "imports", prov);
      const rel2 = gm.upsertRelation("A", "file", "B", "file", "imports", prov);
      expect(rel2.weight).toBeCloseTo(0.6, 1);

      // Push weight toward cap.
      for (let i = 0; i < 10; i++) {
        gm.upsertRelation("A", "file", "B", "file", "imports", prov);
      }
      const final = gm.upsertRelation("A", "file", "B", "file", "imports", prov);
      expect(final.weight).toBeLessThanOrEqual(1.0);
    });
  });

  describe("getEntityRelations()", () => {
    it("returns correct direction", () => {
      const prov = makeProvenance();
      gm.upsertRelation("A", "file", "B", "file", "imports", prov);
      gm.upsertRelation("C", "file", "A", "file", "depends_on", prov);

      const entityA = gm.getEntity("A", "file")!;

      const outgoing = gm.getEntityRelations(entityA.id, "outgoing");
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0]!.type).toBe("imports");

      const incoming = gm.getEntityRelations(entityA.id, "incoming");
      expect(incoming).toHaveLength(1);
      expect(incoming[0]!.type).toBe("depends_on");

      const both = gm.getEntityRelations(entityA.id, "both");
      expect(both).toHaveLength(2);
    });
  });

  describe("findRelatedEntities()", () => {
    it("BFS traversal returns entities at specified depth", () => {
      const prov = makeProvenance();
      gm.upsertRelation("A", "file", "B", "file", "imports", prov);
      gm.upsertRelation("B", "file", "C", "file", "imports", prov);

      // Depth 1 from A: should find B only.
      const depth1 = gm.findRelatedEntities("A", 1);
      expect(depth1.map((e) => e.name)).toEqual(["B"]);

      // Depth 2 from A: should find B and C.
      const depth2 = gm.findRelatedEntities("A", 2);
      expect(depth2.map((e) => e.name).sort()).toEqual(["B", "C"]);
    });

    it("returns empty for unknown entity", () => {
      expect(gm.findRelatedEntities("nonexistent", 3)).toEqual([]);
    });

    it("caps at 50 results", () => {
      const prov = makeProvenance();
      // Create a star graph with center and 60 spokes.
      for (let i = 0; i < 60; i++) {
        gm.upsertRelation("center", "file", `spoke-${i}`, "file", "imports", prov);
      }
      const results = gm.findRelatedEntities("center", 1);
      expect(results.length).toBeLessThanOrEqual(50);
    });
  });

  describe("searchEntities()", () => {
    it("finds entities by name pattern", () => {
      gm.upsertEntity("MemoryStore", "class");
      gm.upsertEntity("WorkingMemory", "class");
      gm.upsertEntity("GraphMemory", "class");

      const results = gm.searchEntities("Memory");
      expect(results).toHaveLength(3);
    });

    it("filters by type", () => {
      gm.upsertEntity("SQLite", "technology");
      gm.upsertEntity("sqlite.db", "file");

      // SQLite's LIKE is case-insensitive for ASCII by default, so "sqlite"
      // matches "SQLite". The type filter narrows to the technology row.
      const results = gm.searchEntities("sqlite", "technology");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("SQLite");
      expect(results[0].type).toBe("technology");
    });
  });

  describe("prune()", () => {
    it("removes low-mention old entities and their relations", () => {
      const prov = makeProvenance();
      // Create entities: "old" has 1 mention, "popular" has many.
      gm.upsertEntity("old-entity", "file");
      const popular = gm.upsertEntity("popular-entity", "file");
      for (let i = 0; i < 5; i++) gm.upsertEntity("popular-entity", "file");

      gm.upsertRelation("old-entity", "file", "popular-entity", "file", "imports", prov);

      // upsertRelation bumped old-entity's mention_count to 2 and refreshed
      // last_seen_at to now. Reset both so the entity looks stale + rare, the
      // state prune() is designed to catch.
      db.prepare(
        "UPDATE graph_entities SET last_seen_at = ?, mention_count = ? WHERE name = ?",
      ).run(Date.now() - 999999999, 1, "old-entity");

      const removed = gm.prune(2, 1000);
      expect(removed).toBe(1);
      expect(gm.getEntity("old-entity")).toBeNull();
      expect(gm.getEntity("popular-entity")).not.toBeNull();

      // Relation should be gone too.
      const rels = gm.getEntityRelations(popular.id, "incoming");
      expect(rels).toHaveLength(0);
    });
  });

  describe("getStats()", () => {
    it("returns correct counts", () => {
      const prov = makeProvenance();
      gm.upsertEntity("A", "file");
      gm.upsertEntity("B", "class");
      gm.upsertRelation("A", "file", "B", "class", "imports", prov);

      const stats = gm.getStats();
      expect(stats.entityCount).toBe(2);
      expect(stats.relationCount).toBe(1);
      expect(stats.byType["file"]).toBe(1);
      expect(stats.byType["class"]).toBe(1);
    });
  });
});

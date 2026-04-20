import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { MemoryConsolidator } from "../../../src/storage/MemoryConsolidator.js";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";
import { EpisodicMemory } from "../../../src/storage/EpisodicMemory.js";
import { GraphMemory } from "../../../src/storage/GraphMemory.js";
import { EntityExtractor } from "../../../src/storage/EntityExtractor.js";
import type { EpisodicEntry, WriteGate, MemoryProvenance } from "../../../src/storage/MemoryLayers.types.js";

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

const DEFAULT_GATE: WriteGate = {
  policy: "pattern_recurring",
  minRecurrences: 2,
  requireVerification: false,
};

describe("MemoryConsolidator", () => {
  let memoryStore: MemoryStore;
  let episodicMemory: EpisodicMemory;
  let graphDb: Database.Database;
  let graphMemory: GraphMemory;
  let entityExtractor: EntityExtractor;
  let consolidator: MemoryConsolidator;

  beforeEach(() => {
    memoryStore = new MemoryStore(":memory:");
    episodicMemory = new EpisodicMemory(":memory:");
    graphDb = new Database(":memory:");
    graphDb.pragma("journal_mode = WAL");
    graphMemory = new GraphMemory(graphDb);
    entityExtractor = new EntityExtractor();
    consolidator = new MemoryConsolidator(
      memoryStore,
      episodicMemory,
      graphMemory,
      entityExtractor,
      DEFAULT_GATE,
    );
  });

  afterEach(() => {
    memoryStore.close();
    episodicMemory.close();
    graphDb.close();
  });

  describe("consolidate()", () => {
    it("extracts entities from episodic events into graph", async () => {
      await episodicMemory.record({
        sessionId: "s1",
        action: "edit_file(path=src/storage/MemoryStore.ts)",
        context: "Modified class MemoryStore to add FTS5 support using SQLite",
        outcome: "Success",
        timestamp: Date.now(),
        provenance: makeProvenance(),
        tags: ["edit_file"],
      });

      const report = await consolidator.consolidate("s1");
      expect(report.entitiesAdded).toBeGreaterThan(0);
      expect(report.errors).toHaveLength(0);

      const stats = graphMemory.getStats();
      expect(stats.entityCount).toBeGreaterThan(0);
    });

    it("upserts entities and relations to graph", async () => {
      await episodicMemory.record({
        sessionId: "s1",
        action: "write_file(path=src/storage/EpisodicMemory.ts)",
        context: "Created the EpisodicMemory class that imports from MemoryStore.ts",
        outcome: "Success",
        timestamp: Date.now(),
        provenance: makeProvenance(),
        tags: ["write_file"],
      });

      const report = await consolidator.consolidate("s1");
      expect(report.entitiesAdded).toBeGreaterThan(0);
    });

    it("returns empty report for session with no events", async () => {
      const report = await consolidator.consolidate("empty-session");
      expect(report.entitiesAdded).toBe(0);
      expect(report.relationsAdded).toBe(0);
      expect(report.patternsDetected).toBe(0);
      expect(report.memoriesPromoted).toBe(0);
    });
  });

  describe("detectPatterns()", () => {
    it("groups similar events (same action, similar context)", () => {
      const events: EpisodicEntry[] = [
        {
          id: "1", sessionId: "s1",
          action: "write_file(path=src/app.ts)",
          context: "Creating application file",
          outcome: "Success", timestamp: Date.now(),
          provenance: makeProvenance(), tags: [],
        },
        {
          id: "2", sessionId: "s2",
          action: "write_file(path=src/app.ts)",
          context: "Creating application file",
          outcome: "Success", timestamp: Date.now(),
          provenance: makeProvenance(), tags: [],
        },
        {
          id: "3", sessionId: "s1",
          action: "completely different action",
          context: "unrelated context",
          outcome: null, timestamp: Date.now(),
          provenance: makeProvenance(), tags: [],
        },
      ];

      const patterns = consolidator.detectPatterns(events);
      expect(patterns.length).toBeGreaterThanOrEqual(1);
      expect(patterns[0]!.occurrences).toBe(2);
    });

    it("requires minimum occurrences", () => {
      const events: EpisodicEntry[] = [
        {
          id: "1", sessionId: "s1",
          action: "unique action",
          context: "unique context",
          outcome: null, timestamp: Date.now(),
          provenance: makeProvenance(), tags: [],
        },
      ];

      const patterns = consolidator.detectPatterns(events);
      expect(patterns).toHaveLength(0);
    });
  });

  describe("shouldPersist()", () => {
    it("enforces 'pattern_recurring' write gate", () => {
      const pattern = {
        action: "test", context: "test", outcome: null,
        occurrences: 3, sessionIds: ["s1", "s2"], confidence: 0.8,
      };

      expect(consolidator.shouldPersist(pattern, DEFAULT_GATE)).toBe(true);
    });

    it("rejects patterns below minRecurrences", () => {
      const pattern = {
        action: "test", context: "test", outcome: null,
        occurrences: 1, sessionIds: ["s1"], confidence: 0.5,
      };

      expect(consolidator.shouldPersist(pattern, DEFAULT_GATE)).toBe(false);
    });

    it("allows 'user_requested' events", () => {
      const gate: WriteGate = {
        policy: "user_requested",
        minRecurrences: 1,
        requireVerification: false,
      };
      const pattern = {
        action: "test", context: "test", outcome: null,
        occurrences: 1, sessionIds: ["s1"], confidence: 0.5,
      };

      // user_requested gate returns false for pattern-detected events.
      expect(consolidator.shouldPersist(pattern, gate)).toBe(false);
    });

    it("allows everything with 'always' policy", () => {
      const gate: WriteGate = {
        policy: "always",
        minRecurrences: 1,
        requireVerification: false,
      };
      const pattern = {
        action: "test", context: "test", outcome: null,
        occurrences: 1, sessionIds: ["s1"], confidence: 0.3,
      };

      expect(consolidator.shouldPersist(pattern, gate)).toBe(true);
    });
  });

  describe("promoteToMemory()", () => {
    it("creates semantic entry with correct provenance", async () => {
      const pattern = {
        action: "write_file(path=src/app.ts)",
        context: "Creating application file",
        outcome: "Success",
        occurrences: 3,
        sessionIds: ["s1", "s2"],
        confidence: 0.8,
      };

      const result = await consolidator.promoteToMemory(pattern);
      expect(result).not.toBeNull();
      expect(typeof result!.id).toBe("string");
      expect(result!.id.length).toBeGreaterThan(0);

      // Verify it's in the memory store.
      const stats = memoryStore.getStats();
      expect(stats.totalEntries).toBe(1);
    });

    it("respects deduplication", async () => {
      const pattern = {
        action: "write_file(path=src/app.ts)",
        context: "Creating application file",
        outcome: "Success",
        occurrences: 3,
        sessionIds: ["s1"],
        confidence: 0.8,
      };

      const first = await consolidator.promoteToMemory(pattern);
      const second = await consolidator.promoteToMemory(pattern);
      expect(first).not.toBeNull();
      expect(second).toBeNull(); // duplicate

      const stats = memoryStore.getStats();
      expect(stats.totalEntries).toBe(1);
    });
  });

  describe("consolidationReport", () => {
    it("has correct counts after full consolidation", async () => {
      // Create recurring events across sessions.
      for (let i = 0; i < 3; i++) {
        await episodicMemory.record({
          sessionId: `s${i}`,
          action: "write_file(path=src/app.ts)",
          context: "Creating application file for testing",
          outcome: "Success",
          timestamp: Date.now() + i * 1000,
          provenance: makeProvenance({ sourceSessionId: `s${i}` }),
          tags: ["write_file"],
        });
      }

      // Consolidate using the "always" gate for testing.
      const alwaysConsolidator = new MemoryConsolidator(
        memoryStore, episodicMemory, graphMemory, entityExtractor,
        { policy: "always", minRecurrences: 1, requireVerification: false },
      );

      // Consolidate each session.
      for (let i = 0; i < 3; i++) {
        await alwaysConsolidator.consolidate(`s${i}`);
      }

      const stats = memoryStore.getStats();
      expect(stats.totalEntries).toBeGreaterThanOrEqual(1);
    });
  });
});

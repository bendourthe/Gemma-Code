import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { performance } from "perf_hooks";
import { MemoryConsolidator } from "../../src/storage/MemoryConsolidator.js";
import { MemoryStore } from "../../src/storage/MemoryStore.js";
import { EpisodicMemory } from "../../src/storage/EpisodicMemory.js";
import { GraphMemory } from "../../src/storage/GraphMemory.js";
import { EntityExtractor } from "../../src/storage/EntityExtractor.js";
import type { WriteGate } from "../../src/storage/MemoryLayers.types.js";

const GATE: WriteGate = {
  policy: "pattern_recurring",
  minRecurrences: 2,
  requireVerification: false,
};

describe("MemoryConsolidator large-session stress", () => {
  let memoryStore: MemoryStore;
  let episodicMemory: EpisodicMemory;
  let graphDb: Database.Database;
  let graphMemory: GraphMemory;
  let consolidator: MemoryConsolidator;

  beforeEach(() => {
    memoryStore = new MemoryStore(":memory:");
    episodicMemory = new EpisodicMemory(":memory:");
    graphDb = new Database(":memory:");
    graphDb.pragma("journal_mode = WAL");
    graphMemory = new GraphMemory(graphDb);
    consolidator = new MemoryConsolidator(
      memoryStore,
      episodicMemory,
      graphMemory,
      new EntityExtractor(),
      GATE,
    );
  });

  afterEach(() => {
    memoryStore.close();
    episodicMemory.close();
    graphDb.close();
  });

  it("consolidates 10K episodic events in under 15 seconds", async () => {
    const sessionId = "stress-session";
    const now = Date.now();

    // Seed 10K events with action/context strings that each yield a
    // small bounded set of entities. The pool is intentionally narrow so
    // the upsert path follows the existing-row branch (mention_count
    // increment) rather than inserting a new row each iteration. That
    // mirrors the realistic shape of a consolidation pass: many events,
    // few distinct entities -- the workload that the transaction wrap
    // is designed to keep cheap.
    const files = [
      "src/storage/MemoryStore.ts",
      "src/storage/EpisodicMemory.ts",
    ];
    const verbs = ["edit_file", "read_file"];

    for (let i = 0; i < 10_000; i++) {
      const file = files[i % files.length]!;
      const verb = verbs[i % verbs.length]!;
      await episodicMemory.record({
        sessionId,
        action: `${verb}(path=${file})`,
        context: `Touched ${file}`,
        outcome: "Success",
        timestamp: now + i,
        provenance: {
          source: "tool_verified",
          sourceSessionId: sessionId,
          sourceMessageId: null,
          timestamp: now + i,
          confidence: 0.9,
        },
        tags: [verb],
      });
    }

    // Sanity: events landed.
    const events = episodicMemory.getSessionEvents(sessionId);
    expect(events).toHaveLength(10_000);

    const t0 = performance.now();
    const report = await consolidator.consolidate(sessionId);
    const elapsedMs = performance.now() - t0;

    // The transaction wrap (Phase 7.3) collapses tens of thousands of
    // per-row fsyncs into one. Without it this assertion fails; with it
    // the consolidation pass runs comfortably under the budget on
    // commodity hardware. The 15s budget is the v0.8.0 measurement
    // (~11s on a low-end dev workstation; vitest 2.x runs it in ~1.4s
    // on the same box) plus ~36% headroom -- see v0.9.0 sub-task 1.2
    // and ADR-0002 / ADR-0018 for the consolidation path's intent.
    expect(elapsedMs).toBeLessThan(15000);
    expect(report.errors).toHaveLength(0);
    expect(report.entitiesAdded).toBeGreaterThan(0);

    // The graph should hold a small bounded set of distinct entities
    // (a handful of file paths from the rotation), proving the per-row
    // upserts coalesced through the existing-row branch instead of
    // exploding into 10K+ rows.
    const stats = graphMemory.getStats();
    expect(stats.entityCount).toBeGreaterThan(0);
    expect(stats.entityCount).toBeLessThan(50);
  }, 60_000);
});

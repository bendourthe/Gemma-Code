import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { MemoryConsolidator } from "../../../src/storage/MemoryConsolidator.js";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";
import { EpisodicMemory } from "../../../src/storage/EpisodicMemory.js";
import { GraphMemory } from "../../../src/storage/GraphMemory.js";
import { EntityExtractor } from "../../../src/storage/EntityExtractor.js";
import type { WriteGate } from "../../../src/storage/MemoryLayers.types.js";

const GATE: WriteGate = {
  policy: "pattern_recurring",
  minRecurrences: 2,
  requireVerification: false,
};

function buildConsolidator(threshold: number) {
  const memoryStore = new MemoryStore(":memory:");
  const episodicMemory = new EpisodicMemory(":memory:");
  const graphDb = new Database(":memory:");
  graphDb.pragma("journal_mode = WAL");
  const graphMemory = new GraphMemory(graphDb);
  const consolidator = new MemoryConsolidator(
    memoryStore,
    episodicMemory,
    graphMemory,
    new EntityExtractor(),
    GATE,
    threshold,
  );
  const cleanup = () => {
    memoryStore.close();
    episodicMemory.close();
    graphDb.close();
  };
  return { memoryStore, episodicMemory, consolidator, cleanup };
}

describe("MemoryConsolidator N-corroboration rule", () => {
  let cleanup: () => void;

  afterEach(() => cleanup?.());

  it("threshold=1 promotes every observation immediately (legacy behavior)", async () => {
    const ctx = buildConsolidator(1);
    cleanup = ctx.cleanup;
    const out = await ctx.consolidator.addObservation(
      "The project uses Vitest as its test runner",
      "fact",
    );
    expect(out.action).toBe("inserted");
    const entries = ctx.memoryStore.listAll();
    expect(entries[0]!.corroborationCount).toBe(1);
    // At threshold=1, retrieval treats all rows as facts (no candidate tier).
    const text = await ctx.memoryStore.retrieve("vitest test runner", 4096, 1);
    expect(text).toContain("Vitest");
  });

  it("threshold=2 keeps a single observation as a candidate", async () => {
    const ctx = buildConsolidator(2);
    cleanup = ctx.cleanup;
    const out = await ctx.consolidator.addObservation(
      "The backend listens on port 11435",
      "fact",
    );
    expect(out.action).toBe("inserted");
    expect(ctx.consolidator.getCounters().observationAdded).toBe(1);
    expect(ctx.consolidator.getCounters().candidatePromoted).toBe(0);
  });

  it("threshold=2 promotes after the second matching observation", async () => {
    const ctx = buildConsolidator(2);
    cleanup = ctx.cleanup;
    await ctx.consolidator.addObservation(
      "The backend listens on port 11435",
      "fact",
    );
    const second = await ctx.consolidator.addObservation(
      "The backend listens on port 11435",
      "fact",
    );
    expect(second.action).toBe("promoted");
    expect(ctx.consolidator.getCounters().candidatePromoted).toBe(1);
  });

  it("threshold=3 requires three matching observations", async () => {
    const ctx = buildConsolidator(3);
    cleanup = ctx.cleanup;
    const a = await ctx.consolidator.addObservation("Same fact about X", "fact");
    expect(a.action).toBe("inserted");
    const b = await ctx.consolidator.addObservation("Same fact about X", "fact");
    expect(b.action).toBe("incremented");
    const c = await ctx.consolidator.addObservation("Same fact about X", "fact");
    expect(c.action).toBe("promoted");
  });

  it("matches via Jaccard similarity > 0.9 (not only exact text)", async () => {
    const ctx = buildConsolidator(2);
    cleanup = ctx.cleanup;
    await ctx.consolidator.addObservation(
      "the project uses Vitest with default configuration for tests",
      "fact",
    );
    const second = await ctx.consolidator.addObservation(
      "the project uses Vitest with default configuration for tests now",
      "fact",
    );
    expect(["promoted", "incremented"]).toContain(second.action);
  });

  it("retrieval returns fact-tier rows above candidate-tier rows", async () => {
    const ctx = buildConsolidator(2);
    cleanup = ctx.cleanup;
    // candidate-tier observation about storage.
    await ctx.consolidator.addObservation(
      "Storage choice: Postgres handles persistence",
      "fact",
    );
    // fact-tier observation (promoted via two corroborations).
    await ctx.consolidator.addObservation(
      "Storage choice: Redis handles hot keys",
      "fact",
    );
    await ctx.consolidator.addObservation(
      "Storage choice: Redis handles hot keys",
      "fact",
    );

    const text = await ctx.memoryStore.retrieve("storage choice", 4096, 2);
    const redisIdx = text.indexOf("Redis");
    const postgresIdx = text.indexOf("Postgres");
    expect(redisIdx).toBeGreaterThanOrEqual(0);
    if (postgresIdx >= 0) {
      expect(redisIdx).toBeLessThan(postgresIdx);
    }
  });

  it("setCorroborationThreshold takes effect at the next observation", async () => {
    const ctx = buildConsolidator(2);
    cleanup = ctx.cleanup;
    ctx.consolidator.setCorroborationThreshold(1);
    const out = await ctx.consolidator.addObservation("Something true", "fact");
    expect(out.action).toBe("inserted");
    // At threshold=1, a single observation behaves as fact tier in retrieval.
    const text = await ctx.memoryStore.retrieve("something", 1024, 1);
    expect(text).toContain("Something");
  });
});

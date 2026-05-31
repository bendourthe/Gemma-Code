import { describe, it, expect, vi } from "vitest";
import { MemorySubsystem } from "../../../src/storage/MemorySubsystem.js";
import type {
  LLMClient,
  LLMStreamChunk,
} from "../../../modules/coding/llm/types.js";

/**
 * Phase 4 (v0.6.0): MemorySubsystem accepts an `LLMClient` port instead of
 * the (ollamaUrl, requestTimeout) pair. These tests pass a no-op fake; with
 * `embeddingModel: null` the subsystem never calls into it.
 */
function fakeClient(): LLMClient {
  return {
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: function* (): AsyncGenerator<LLMStreamChunk> {
      /* unused */
    } as unknown as LLMClient["streamChat"],
  };
}

describe("MemorySubsystem", () => {
  it("disabled() returns a subsystem with every layer set to null", () => {
    const sub = MemorySubsystem.disabled();

    expect(sub.memoryStore).toBeNull();
    expect(sub.workingMemory).toBeNull();
    expect(sub.episodicMemory).toBeNull();
    expect(sub.graphMemory).toBeNull();
    expect(sub.graphQueryEngine).toBeNull();
    expect(sub.entityExtractor).toBeNull();
    expect(sub.memoryConsolidator).toBeNull();
    expect(sub.unifiedRetriever).toBeNull();
    expect(sub.isReady).toBe(false);
  });

  it("constructs every layer when given a valid in-memory dbPath", () => {
    const sub = new MemorySubsystem({
      dbPath: ":memory:",
      llmClient: fakeClient(),
      embeddingModel: null,
    });

    expect(sub.memoryStore).not.toBeNull();
    expect(sub.workingMemory).not.toBeNull();
    expect(sub.episodicMemory).not.toBeNull();
    expect(sub.graphMemory).not.toBeNull();
    expect(sub.graphQueryEngine).not.toBeNull();
    expect(sub.entityExtractor).not.toBeNull();
    expect(sub.memoryConsolidator).not.toBeNull();
    expect(sub.unifiedRetriever).not.toBeNull();
    expect(sub.isReady).toBe(true);
  });

  it("wires the graph engine into the memory store", () => {
    const sub = new MemorySubsystem({
      dbPath: ":memory:",
      llmClient: fakeClient(),
      embeddingModel: null,
    });

    // The MemoryStore should hold the same graph engine instance.
    const memStore = sub.memoryStore as unknown as { _graphEngine: unknown };
    expect(memStore._graphEngine).toBe(sub.graphQueryEngine);
  });

  it("disabled() and a successfully-built subsystem behave differently for isReady", () => {
    const disabled = MemorySubsystem.disabled();
    const enabled = new MemorySubsystem({
      dbPath: ":memory:",
      llmClient: fakeClient(),
      embeddingModel: null,
    });

    expect(disabled.isReady).toBe(false);
    expect(enabled.isReady).toBe(true);
  });
});

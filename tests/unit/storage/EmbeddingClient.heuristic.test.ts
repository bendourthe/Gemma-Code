import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";
import type {
  LLMClient,
  LLMStreamChunk,
  LLMModel,
} from "../../../modules/coding/llm/types.js";

/**
 * Phase 4 (v0.6.0): EmbeddingClient consumes the LLM port; the fallback
 * tests now stub the port directly instead of the underlying HTTP layer.
 */
function makeFake(): {
  client: LLMClient;
  embed: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn();
  const client: LLMClient = {
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([] as LLMModel[]),
    streamChat: function* (): AsyncGenerator<LLMStreamChunk> {
      /* unused */
    } as unknown as LLMClient["streamChat"],
    embed,
  };
  return { client, embed };
}

describe("EmbeddingClient heuristic fallback", () => {
  let fake: ReturnType<typeof makeFake>;
  let client: EmbeddingClient;

  beforeEach(() => {
    fake = makeFake();
    client = new EmbeddingClient(fake.client, "nomic-embed-text");
  });

  it("returns provenance 'ollama' when the LLM port returns a vector", async () => {
    fake.embed.mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      available: true,
    });

    const result = await client.embedWithProvenance("hello");
    expect(result?.provenance).toBe("ollama");
    expect(result?.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("falls back to heuristic provenance when the port reports unavailable", async () => {
    fake.embed.mockResolvedValue({ embedding: null, available: false });

    const result = await client.embedWithProvenance(
      "function add(a, b) { return a + b; }",
    );
    expect(result?.provenance).toBe("heuristic");
    expect(result?.embedding).toHaveLength(EmbeddingClient.heuristicDimension());
  });

  it("falls back to heuristic when the port returns null for a transient error", async () => {
    fake.embed.mockResolvedValue({ embedding: null, available: true });

    const result = await client.embedWithProvenance("the cat sat on the mat");
    expect(result?.provenance).toBe("heuristic");
    expect(result?.embedding).toHaveLength(EmbeddingClient.heuristicDimension());
  });

  it("returns null for empty input without calling the port", async () => {
    const result = await client.embedWithProvenance("");
    expect(result).toBeNull();
    expect(fake.embed).not.toHaveBeenCalled();
  });

  it("embedHeuristic skips the port entirely", () => {
    const v = client.embedHeuristic("hello world");
    expect(v).toHaveLength(EmbeddingClient.heuristicDimension());
    expect(fake.embed).not.toHaveBeenCalled();
  });
});

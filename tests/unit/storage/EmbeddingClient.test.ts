import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";
import type {
  LLMClient,
  LLMEmbedResult,
  LLMChatRequest,
  LLMStreamChunk,
  LLMModel,
} from "../../../modules/coding/llm/types.js";

/**
 * Phase 4 (v0.6.0): EmbeddingClient now consumes the vendor-neutral LLM port
 * (`LLMClient`) instead of reaching into Ollama HTTP primitives. These tests
 * exercise the storage-side behavior (caching, fallback, batch handling)
 * against a fake `LLMClient`; the wire-protocol mapping is covered by the
 * integration tests for `OllamaClient` itself.
 */
function makeFake(): {
  client: LLMClient;
  embed: ReturnType<typeof vi.fn>;
  embedBatch: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn();
  const embedBatch = vi.fn();
  const client: LLMClient = {
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([] as LLMModel[]),
    streamChat: function* (
      _r: LLMChatRequest,
    ): AsyncGenerator<LLMStreamChunk> {
      // Intentionally unused in these tests.
      void _r;
    } as unknown as LLMClient["streamChat"],
    embed,
    embedBatch,
  };
  return { client, embed, embedBatch };
}

describe("EmbeddingClient", () => {
  let fake: ReturnType<typeof makeFake>;
  let client: EmbeddingClient;

  beforeEach(() => {
    fake = makeFake();
    client = new EmbeddingClient(fake.client, "nomic-embed-text");
  });

  // -------------------------------------------------------------------------

  describe("isAvailable()", () => {
    it("returns true when the underlying port reports available", async () => {
      fake.embed.mockResolvedValue({
        embedding: null,
        available: true,
      } satisfies LLMEmbedResult);
      expect(await client.isAvailable()).toBe(true);
    });

    it("returns false when the port reports unavailable", async () => {
      fake.embed.mockResolvedValue({
        embedding: null,
        available: false,
      } satisfies LLMEmbedResult);
      expect(await client.isAvailable()).toBe(false);
    });

    it("returns false when the port has no embed capability", async () => {
      const portless: LLMClient = {
        checkHealth: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        streamChat: function* (): AsyncGenerator<LLMStreamChunk> {
          /* unused */
        } as unknown as LLMClient["streamChat"],
      };
      const c = new EmbeddingClient(portless, "any-model");
      expect(await c.isAvailable()).toBe(false);
    });

    it("returns false when the probe throws", async () => {
      fake.embed.mockRejectedValue(new Error("ECONNREFUSED"));
      expect(await client.isAvailable()).toBe(false);
    });

    it("caches the result on subsequent calls", async () => {
      fake.embed.mockResolvedValue({ embedding: null, available: true });
      await client.isAvailable();
      await client.isAvailable();
      expect(fake.embed).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("embed()", () => {
    it("returns an embedding vector on success", async () => {
      fake.embed.mockResolvedValue({
        embedding: [0.1, 0.2, 0.3],
        available: true,
      });
      const result = await client.embed("hello world");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("returns null for empty input without invoking the port", async () => {
      const result = await client.embed("");
      expect(result).toBeNull();
      expect(fake.embed).not.toHaveBeenCalled();
    });

    it("returns null when the port reports unavailable", async () => {
      fake.embed.mockResolvedValue({ embedding: null, available: false });
      const result = await client.embed("hello");
      expect(result).toBeNull();
    });

    it("returns null when the port returns null but is reachable", async () => {
      fake.embed.mockResolvedValue({ embedding: null, available: true });
      const result = await client.embed("hello");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------

  describe("embedBatch()", () => {
    it("returns parallel embeddings for multiple texts", async () => {
      fake.embedBatch.mockResolvedValue([
        { embedding: [0.1, 0.2], available: true },
        { embedding: [0.3, 0.4], available: true },
      ]);
      const result = await client.embedBatch(["hello", "world"]);
      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });

    it("returns empty array for empty input", async () => {
      const result = await client.embedBatch([]);
      expect(result).toEqual([]);
      expect(fake.embedBatch).not.toHaveBeenCalled();
    });

    it("returns null entries when port is unavailable", async () => {
      fake.embedBatch.mockResolvedValue([
        { embedding: null, available: false },
        { embedding: null, available: false },
      ]);
      const result = await client.embedBatch(["a", "b"]);
      expect(result).toEqual([null, null]);
    });

    it("forwards null entries from the port without modification", async () => {
      fake.embedBatch.mockResolvedValue([
        { embedding: null, available: true },
        { embedding: [0.5, 0.6], available: true },
        { embedding: null, available: true },
      ]);
      const result = await client.embedBatch(["", "hello", ""]);
      expect(result[0]).toBeNull();
      expect(result[1]).toEqual([0.5, 0.6]);
      expect(result[2]).toBeNull();
    });

    it("polyfills via embed() when the port has no embedBatch", async () => {
      const portless: LLMClient = {
        checkHealth: vi.fn().mockResolvedValue(true),
        listModels: vi.fn().mockResolvedValue([]),
        streamChat: function* (): AsyncGenerator<LLMStreamChunk> {
          /* unused */
        } as unknown as LLMClient["streamChat"],
        embed: vi
          .fn()
          .mockResolvedValueOnce({ embedding: [1, 2], available: true })
          .mockResolvedValueOnce({ embedding: [3, 4], available: true }),
      };
      const c = new EmbeddingClient(portless, "any-model");
      const result = await c.embedBatch(["a", "b"]);
      expect(result).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";

const mockFetch = vi.fn();

describe("EmbeddingClient", () => {
  let client: EmbeddingClient;

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    client = new EmbeddingClient("http://localhost:11434", "nomic-embed-text", 5000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------

  describe("isAvailable()", () => {
    it("returns true when the model is listed by Ollama", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [
            { name: "nomic-embed-text:latest" },
            { name: "gemma4:latest" },
          ],
        }),
      });

      expect(await client.isAvailable()).toBe(true);
    });

    it("returns false when the model is not listed", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: "gemma4:latest" }],
        }),
      });

      expect(await client.isAvailable()).toBe(false);
    });

    it("returns false on network error", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      expect(await client.isAvailable()).toBe(false);
    });

    it("caches the result on subsequent calls", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }],
        }),
      });

      await client.isAvailable();
      await client.isAvailable();

      // Only one fetch call for /api/tags despite two isAvailable() calls.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------

  describe("embed()", () => {
    it("returns an embedding vector on success", async () => {
      // First call: isAvailable check.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }],
        }),
      });
      // Second call: embed request.
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [[0.1, 0.2, 0.3]],
        }),
      });

      const result = await client.embed("hello world");

      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("returns null for empty input without making a request", async () => {
      const result = await client.embed("");

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null when the model is unavailable", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const result = await client.embed("hello");

      expect(result).toBeNull();
    });

    it("returns null on network error and logs a warning", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }],
        }),
      });
      mockFetch.mockRejectedValueOnce(new Error("timeout"));

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const result = await client.embed("hello");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("marks model unavailable on 404 response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }],
        }),
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await client.embed("hello");
      expect(result).toBeNull();

      // Subsequent call should not make a fetch for embedding.
      const result2 = await client.embed("world");
      expect(result2).toBeNull();
    });
  });

  // -------------------------------------------------------------------------

  describe("embedBatch()", () => {
    it("returns parallel embeddings for multiple texts", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        }),
      });

      const result = await client.embedBatch(["hello", "world"]);

      expect(result).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ]);
    });

    it("returns empty array for empty input", async () => {
      const result = await client.embedBatch([]);
      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null entries when model is unavailable", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      });

      const result = await client.embedBatch(["a", "b"]);
      expect(result).toEqual([null, null]);
    });

    it("handles empty strings within the batch", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "nomic-embed-text:latest" }],
        }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          embeddings: [[0.5, 0.6]],
        }),
      });

      const result = await client.embedBatch(["", "hello", ""]);
      expect(result[0]).toBeNull();
      expect(result[1]).toEqual([0.5, 0.6]);
      expect(result[2]).toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EmbeddingClient } from "../../../src/storage/EmbeddingClient.js";

const mockFetch = vi.fn();

describe("EmbeddingClient heuristic fallback", () => {
  let client: EmbeddingClient;

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    client = new EmbeddingClient("http://localhost:11434", "nomic-embed-text", 5000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns provenance 'ollama' when the HTTP path succeeds", async () => {
    // First fetch: /api/tags availability probe.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [{ name: "nomic-embed-text:latest" }],
      }),
    });
    // Second fetch: /api/embed.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embeddings: [[0.1, 0.2, 0.3]] }),
    });

    const result = await client.embedWithProvenance("hello");
    expect(result?.provenance).toBe("ollama");
    expect(result?.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("falls back to heuristic provenance when Ollama is unavailable", async () => {
    // /api/tags reports the model is missing.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    const result = await client.embedWithProvenance("function add(a, b) { return a + b; }");
    expect(result?.provenance).toBe("heuristic");
    expect(result?.embedding).toHaveLength(EmbeddingClient.heuristicDimension());
  });

  it("falls back to heuristic when the embed endpoint errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: "nomic-embed-text:latest" }] }),
    });
    mockFetch.mockRejectedValueOnce(new Error("connection reset"));

    const result = await client.embedWithProvenance("the cat sat on the mat");
    expect(result?.provenance).toBe("heuristic");
    expect(result?.embedding).toHaveLength(EmbeddingClient.heuristicDimension());
  });

  it("returns null for empty input regardless of Ollama state", async () => {
    const result = await client.embedWithProvenance("");
    expect(result).toBeNull();
    // Should not have called fetch.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("embedHeuristic skips Ollama entirely", () => {
    const v = client.embedHeuristic("hello world");
    expect(v).toHaveLength(EmbeddingClient.heuristicDimension());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

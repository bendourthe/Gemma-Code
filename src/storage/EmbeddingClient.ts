import type { LLMClient } from "../llm/types.js";
import {
  HeuristicEmbedder,
  HEURISTIC_DIMENSION,
} from "./HeuristicEmbedder.js";

export type EmbeddingProvenance = "ollama" | "heuristic";

export interface ProvenancedEmbedding {
  readonly embedding: number[];
  readonly provenance: EmbeddingProvenance;
}

/**
 * Wraps the LLM port's optional `embed` capability for generating text
 * embeddings. Gracefully degrades to null when the underlying provider does
 * not implement `embed` or the embedding model is unavailable.
 *
 * Phase 4 (v0.6.0): consumes the vendor-neutral `LLMClient` port instead of
 * reaching into the concrete Ollama HTTP primitives. Storage modules no
 * longer cross the LLM-folder boundary; the wire-protocol mapping lives
 * exclusively in `src/llm/OllamaClient.ts`.
 *
 * Phase 12 (v0.5.0): exposes `embedWithProvenance` which falls back to a
 * deterministic 128-D `HeuristicEmbedder` when the embedding port is
 * unreachable so semantic search keeps functioning offline. Heuristic
 * vectors are tagged so callers (e.g. `ToolOutputCache.searchByEmbedding`)
 * can raise the cosine threshold for the noisier signal.
 */
export class EmbeddingClient {
  private readonly _client: LLMClient;
  private readonly _model: string;
  private readonly _heuristic = new HeuristicEmbedder();
  private _available: boolean | null = null;

  constructor(client: LLMClient, model: string) {
    this._client = client;
    this._model = model;
  }

  /** Dimensionality of the heuristic fallback embedder. */
  static heuristicDimension(): number {
    return HEURISTIC_DIMENSION;
  }

  /** Check whether the embedding capability + configured model are available. */
  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;
    if (!this._client.embed) {
      this._available = false;
      return false;
    }
    // Probe the embed endpoint with an empty string to learn whether the
    // model is loaded without paying for a full embedding round-trip.
    try {
      const probe = await this._client.embed("", this._model);
      this._available = probe.available;
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  /** Embed a single text. Returns null if the model is unavailable or on error. */
  async embed(text: string): Promise<number[] | null> {
    if (!text) return null;
    if (!this._client.embed) return null;
    const result = await this._client.embed(text, this._model);
    if (!result.available) {
      this._available = false;
    }
    return result.embedding;
  }

  /**
   * Embed `text` and report which embedder produced the vector. When the
   * primary embedder succeeds, returns provenance `'ollama'`. When the
   * embedder is offline or errors, falls back to the deterministic 128-D
   * heuristic embedder and returns provenance `'heuristic'`. Returns null
   * only for empty input.
   */
  async embedWithProvenance(text: string): Promise<ProvenancedEmbedding | null> {
    if (!text) return null;
    const primary = await this.embed(text);
    if (primary) {
      return { embedding: primary, provenance: "ollama" };
    }
    return {
      embedding: this._heuristic.embed(text),
      provenance: "heuristic",
    };
  }

  /** Direct heuristic embedding without trying the primary embedder first. */
  embedHeuristic(text: string): number[] {
    return this._heuristic.embed(text);
  }

  /**
   * Batch embed multiple texts. Returns an array parallel to the input;
   * null entries indicate individual failures.
   */
  async embedBatch(texts: string[]): Promise<Array<number[] | null>> {
    if (texts.length === 0) return [];
    if (this._client.embedBatch) {
      const results = await this._client.embedBatch(texts, this._model);
      // If the entire batch is unavailable, cache the verdict.
      if (results.every((r) => !r.available)) {
        this._available = false;
      }
      return results.map((r) => r.embedding);
    }
    if (!this._client.embed) {
      return texts.map(() => null);
    }
    // Polyfill: serial calls when the provider does not implement batch.
    const out: Array<number[] | null> = [];
    for (const text of texts) {
      out.push(await this.embed(text));
    }
    return out;
  }
}

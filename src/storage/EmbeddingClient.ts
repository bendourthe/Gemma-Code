import { OllamaHttp } from "../llm/OllamaHttp.js";
import { getLogger } from "../utils/logger.js";

/**
 * Wraps Ollama's /api/embed endpoint for generating text embeddings.
 * Gracefully degrades to null when the embedding model is unavailable.
 *
 * Shares the HTTP primitives (timeouts, URL normalization, /api/tags
 * availability probing) with the chat `OllamaClient` via `OllamaHttp`.
 */
export class EmbeddingClient {
  private readonly _http: OllamaHttp;
  private readonly _model: string;
  private _available: boolean | null = null;

  constructor(baseUrl: string, model: string, timeoutMs = 30000) {
    this._http = new OllamaHttp(baseUrl, timeoutMs);
    this._model = model;
  }

  /** Check whether the configured embedding model is available on the Ollama server. */
  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;

    try {
      const response = await this._http.get("/api/tags");
      if (!response.ok) {
        this._available = false;
        return false;
      }
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      this._available = models.some(
        (m) => m.name === this._model || m.name.startsWith(`${this._model}:`),
      );
      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  /** Embed a single text. Returns null if the model is unavailable or on error. */
  async embed(text: string): Promise<number[] | null> {
    if (!text) return null;

    const available = await this.isAvailable();
    if (!available) return null;

    try {
      const response = await this._http.postJson(
        "/api/embed",
        JSON.stringify({ model: this._model, input: text }),
      );

      if (!response.ok) {
        if (response.status === 404) {
          this._available = false;
        }
        return null;
      }

      const data = (await response.json()) as { embeddings?: number[][] };
      return data.embeddings?.[0] ?? null;
    } catch (err) {
      getLogger().warn("[EmbeddingClient] embed failed:", err);
      return null;
    }
  }

  /**
   * Batch embed multiple texts. Returns an array parallel to the input;
   * null entries indicate individual failures.
   */
  async embedBatch(texts: string[]): Promise<Array<number[] | null>> {
    if (texts.length === 0) return [];

    const available = await this.isAvailable();
    if (!available) return texts.map(() => null);

    // Filter out empty strings but track original indices.
    const nonEmpty = texts.map((t, i) => ({ text: t, index: i })).filter((e) => e.text);
    if (nonEmpty.length === 0) return texts.map(() => null);

    try {
      const response = await this._http.postJson(
        "/api/embed",
        JSON.stringify({
          model: this._model,
          input: nonEmpty.map((e) => e.text),
        }),
      );

      if (!response.ok) {
        if (response.status === 404) {
          this._available = false;
        }
        return texts.map(() => null);
      }

      const data = (await response.json()) as { embeddings?: number[][] };
      const embeddings = data.embeddings ?? [];

      const result: Array<number[] | null> = texts.map(() => null);
      for (let i = 0; i < nonEmpty.length; i++) {
        const entry = nonEmpty[i];
        if (entry) {
          result[entry.index] = embeddings[i] ?? null;
        }
      }
      return result;
    } catch (err) {
      getLogger().warn("[EmbeddingClient] embedBatch failed:", err);
      return texts.map(() => null);
    }
  }
}

/**
 * Wraps Ollama's /api/embed endpoint for generating text embeddings.
 * Gracefully degrades to null when the embedding model is unavailable.
 */
export class EmbeddingClient {
  private readonly _baseUrl: string;
  private readonly _model: string;
  private readonly _timeoutMs: number;
  private _available: boolean | null = null;

  constructor(baseUrl: string, model: string, timeoutMs = 30000) {
    this._baseUrl = baseUrl.replace(/\/$/, "");
    this._model = model;
    this._timeoutMs = timeoutMs;
  }

  /** Check whether the configured embedding model is available on the Ollama server. */
  async isAvailable(): Promise<boolean> {
    if (this._available !== null) return this._available;

    try {
      const response = await fetch(`${this._baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(this._timeoutMs),
      });
      if (!response.ok) {
        this._available = false;
        return false;
      }
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      this._available = models.some(
        (m) => m.name === this._model || m.name.startsWith(`${this._model}:`)
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
      const response = await fetch(`${this._baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this._model, input: text }),
        signal: AbortSignal.timeout(this._timeoutMs),
      });

      if (!response.ok) {
        if (response.status === 404) {
          this._available = false;
        }
        return null;
      }

      const data = (await response.json()) as { embeddings?: number[][] };
      return data.embeddings?.[0] ?? null;
    } catch (err) {
      console.warn("[EmbeddingClient] embed failed:", err);
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
      const response = await fetch(`${this._baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this._model,
          input: nonEmpty.map((e) => e.text),
        }),
        signal: AbortSignal.timeout(this._timeoutMs),
      });

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
      console.warn("[EmbeddingClient] embedBatch failed:", err);
      return texts.map(() => null);
    }
  }
}

import { LLMError, LLMListModelsResponseSchema } from "./types.js";

/**
 * Shared HTTP primitives for the two Ollama consumers (`OllamaClient` for chat
 * and `EmbeddingClient` for embeddings). Consolidates fetch-with-timeout, URL
 * normalization, and the `/api/tags` availability check so retries, headers,
 * and trace spans can be added in one place.
 */
export class OllamaHttp {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  get url(): string {
    return this.baseUrl;
  }

  get timeout(): number {
    return this.timeoutMs;
  }

  /** Combine an optional caller-supplied signal with an internal timeout signal. */
  combineSignal(signal: AbortSignal | undefined): { signal: AbortSignal; dispose: () => void } {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combined = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
    return {
      signal: combined,
      dispose: () => clearTimeout(timeoutId),
    };
  }

  /**
   * Issue a GET, enforcing the configured timeout. Returns the raw `Response`
   * so callers can stream or read as JSON themselves.
   */
  async get(path: string, signal?: AbortSignal): Promise<Response> {
    const { signal: combined, dispose } = this.combineSignal(signal);
    try {
      return await fetch(`${this.baseUrl}${path}`, { signal: combined });
    } finally {
      dispose();
    }
  }

  /**
   * Issue a POST with a JSON body. Caller is responsible for stringifying the
   * body; the helper sets the `Content-Type` header and enforces the timeout.
   */
  async postJson(path: string, body: string, signal?: AbortSignal): Promise<Response> {
    const { signal: combined, dispose } = this.combineSignal(signal);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: combined,
      });
    } finally {
      dispose();
    }
  }

  /**
   * Check whether the Ollama server responds to `/api/tags`. Used both by the
   * chat client's `checkHealth` and the embedding client's `isAvailable`.
   * Returns `false` on any network or non-OK response (never throws).
   */
  async isReachable(): Promise<boolean> {
    try {
      const response = await this.get("/api/tags");
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch `/api/tags` and return the array of installed models. Throws
   * `LLMError` on non-OK responses so callers can surface the status code.
   */
  async listModels(): Promise<Array<{ name: string; modified_at: string; size: number }>> {
    const response = await this.get("/api/tags");
    if (!response.ok) {
      throw new LLMError(
        `Failed to list models: ${response.statusText}`,
        response.status,
      );
    }
    const raw = (await response.json()) as unknown;
    const parsed = LLMListModelsResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new LLMError(
        `Malformed /api/tags response: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        response.status,
      );
    }
    return parsed.data.models ?? [];
  }
}

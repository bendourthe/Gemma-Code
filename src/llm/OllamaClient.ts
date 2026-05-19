import { getSettings } from "../config/settings.js";
import { getLogger } from "../../modules/coding/utils/logger.js";
import type {
  LLMClient,
  LLMChatRequest,
  LLMEmbedResult,
  LLMModel,
  LLMStreamChunk,
} from "./types.js";
import { LLMError, LLMStreamChunkSchema } from "./types.js";
import { OllamaHttp } from "./OllamaHttp.js";

/**
 * Options threaded in from the composition root. When omitted, the client
 * falls back to reading from `getSettings()` directly so existing dynamic
 * import sites continue to work; new call sites should always provide a
 * snapshot.
 */
export interface CreateOllamaClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

function parseChunk(line: string): LLMStreamChunk {
  const raw = JSON.parse(line) as unknown;
  const parsed = LLMStreamChunkSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LLMError(
      `Malformed Ollama stream chunk: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      0,
    );
  }
  return parsed.data;
}

class OllamaClientImpl implements LLMClient {
  private readonly http: OllamaHttp;
  private readonly _embeddingModelAvailability = new Map<string, boolean>();

  constructor(http: OllamaHttp) {
    this.http = http;
  }

  async checkHealth(): Promise<boolean> {
    return this.http.isReachable();
  }

  async listModels(): Promise<LLMModel[]> {
    return this.http.listModels();
  }

  /**
   * Probe `/api/tags` to confirm the named embedding model is loaded. The
   * verdict is cached per model so repeated `embed` calls do not pay the
   * round-trip cost.
   */
  private async _isEmbeddingModelAvailable(model: string): Promise<boolean> {
    const cached = this._embeddingModelAvailability.get(model);
    if (cached !== undefined) return cached;
    try {
      const response = await this.http.get("/api/tags");
      if (!response.ok) {
        this._embeddingModelAvailability.set(model, false);
        return false;
      }
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      const available = models.some(
        (m) => m.name === model || m.name.startsWith(`${model}:`),
      );
      this._embeddingModelAvailability.set(model, available);
      return available;
    } catch {
      this._embeddingModelAvailability.set(model, false);
      return false;
    }
  }

  async embed(text: string, model: string): Promise<LLMEmbedResult> {
    if (!text) return { embedding: null, available: true };
    const available = await this._isEmbeddingModelAvailable(model);
    if (!available) return { embedding: null, available: false };

    try {
      const response = await this.http.postJson(
        "/api/embed",
        JSON.stringify({ model, input: text }),
      );
      if (!response.ok) {
        if (response.status === 404) {
          this._embeddingModelAvailability.set(model, false);
          return { embedding: null, available: false };
        }
        return { embedding: null, available: true };
      }
      const data = (await response.json()) as { embeddings?: number[][] };
      const embedding = data.embeddings?.[0] ?? null;
      return { embedding, available: true };
    } catch (err) {
      getLogger().warn("[OllamaClient] embed failed:", err);
      return { embedding: null, available: true };
    }
  }

  async embedBatch(
    texts: readonly string[],
    model: string,
  ): Promise<LLMEmbedResult[]> {
    if (texts.length === 0) return [];
    const available = await this._isEmbeddingModelAvailable(model);
    if (!available) {
      return texts.map(() => ({ embedding: null, available: false }));
    }
    const nonEmpty = texts
      .map((t, i) => ({ text: t, index: i }))
      .filter((e) => e.text);
    if (nonEmpty.length === 0) {
      return texts.map(() => ({ embedding: null, available: true }));
    }
    try {
      const response = await this.http.postJson(
        "/api/embed",
        JSON.stringify({ model, input: nonEmpty.map((e) => e.text) }),
      );
      if (!response.ok) {
        if (response.status === 404) {
          this._embeddingModelAvailability.set(model, false);
          return texts.map(() => ({ embedding: null, available: false }));
        }
        return texts.map(() => ({ embedding: null, available: true }));
      }
      const data = (await response.json()) as { embeddings?: number[][] };
      const embeddings = data.embeddings ?? [];
      const result: LLMEmbedResult[] = texts.map(() => ({
        embedding: null,
        available: true,
      }));
      for (let i = 0; i < nonEmpty.length; i++) {
        const entry = nonEmpty[i];
        if (entry) {
          result[entry.index] = {
            embedding: embeddings[i] ?? null,
            available: true,
          };
        }
      }
      return result;
    } catch (err) {
      getLogger().warn("[OllamaClient] embedBatch failed:", err);
      return texts.map(() => ({ embedding: null, available: true }));
    }
  }

  async *streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk> {
    const response = await this.http.postJson(
      "/api/chat",
      JSON.stringify({ ...request, stream: true }),
      signal,
    );

    if (!response.ok) {
      throw new LLMError(
        `Ollama chat request failed: ${response.statusText}`,
        response.status,
      );
    }

    if (!response.body) {
      throw new LLMError("Response body is null", response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const chunk = parseChunk(trimmed);
          yield chunk;
          if (chunk.done) return;
        }
      }

      if (buffer.trim()) {
        const chunk = parseChunk(buffer.trim());
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export function createOllamaClient(
  options?: CreateOllamaClientOptions | string,
): LLMClient {
  // Backward-compat: a bare string was previously accepted as `baseUrl`.
  const opts: CreateOllamaClientOptions =
    typeof options === "string" ? { baseUrl: options } : options ?? {};

  // The composition root (`extension.ts` / `NexusCodingPanel`) supplies values
  // explicitly. The dev `gemma-code.ping` command and several tests use the
  // legacy zero-arg form, which is allowed to read `getSettings()` here as a
  // backstop. Per Phase 6 sub-task 6.9, this is the only `getSettings()` call
  // outside `extension.ts` and the panel.
  let baseUrl = opts.baseUrl;
  let timeoutMs = opts.timeoutMs;
  if (baseUrl === undefined || timeoutMs === undefined) {
    const s = getSettings();
    baseUrl = baseUrl ?? s.ollamaUrl;
    timeoutMs = timeoutMs ?? s.requestTimeout;
  }
  return new OllamaClientImpl(new OllamaHttp(baseUrl, timeoutMs));
}

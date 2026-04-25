import { getSettings } from "../config/settings.js";
import type {
  LLMClient,
  LLMChatRequest,
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

  constructor(http: OllamaHttp) {
    this.http = http;
  }

  async checkHealth(): Promise<boolean> {
    return this.http.isReachable();
  }

  async listModels(): Promise<LLMModel[]> {
    return this.http.listModels();
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

  // The composition root (`extension.ts` / `GemmaCodePanel`) supplies values
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

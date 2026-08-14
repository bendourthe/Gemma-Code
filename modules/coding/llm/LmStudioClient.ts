import { getLogger } from "../utils/logger.js";
import { instrumentStream } from "./instrumentStream.js";
import type {
  LLMClient,
  LLMChatRequest,
  LLMEmbedResult,
  LLMModel,
  LLMStreamChunk,
} from "./types.js";
import { LLMError } from "./types.js";

/**
 * v0.8.0 Phase 4 sub-task 4.2 (item F1) -- second `LLMClient` adapter that
 * speaks the OpenAI-compatible streaming format LM Studio exposes by default
 * on `127.0.0.1:1234`. Wire-shape:
 *
 *   POST /v1/chat/completions
 *     SSE stream of `data: {...}` lines terminated by `data: [DONE]`
 *   POST /v1/embeddings
 *
 * The adapter maps between the OpenAI message shape
 * (`choices[0].delta.content`) and Gemma-Code's `LLMStreamChunk`
 * (`message.content`).
 *
 * Auto-detection lives in `NexusCodingRuntime.getOllamaClient()`: on macOS we
 * probe `:1234/v1/models` first and fall back to Ollama at `:11434`. On
 * Windows / Linux the default is Ollama unless the user explicitly opts in.
 *
 * Local-only by design: the default `baseUrl` is `127.0.0.1` rather than
 * `localhost` so DNS resolution cannot accidentally route to a non-loopback
 * address.
 */

export interface CreateLmStudioClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:1234";
const DEFAULT_TIMEOUT_MS = 60_000;

interface OpenAiStreamChunk {
  readonly id?: string;
  readonly choices?: ReadonlyArray<{
    readonly delta?: { readonly content?: string; readonly role?: string };
    readonly finish_reason?: string | null;
  }>;
  /** v1.16.0 Phase 2.1: forwarded to the metrics layer when the runtime sends it. */
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

interface OpenAiModelsResponse {
  readonly data?: ReadonlyArray<{ readonly id: string; readonly created?: number }>;
}

interface OpenAiEmbeddingsResponse {
  readonly data?: ReadonlyArray<{ readonly embedding: number[] }>;
}

class LmStudioClientImpl implements LLMClient {
  private readonly _baseUrl: string;
  private readonly _timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this._baseUrl = baseUrl.replace(/\/$/, "");
    this._timeoutMs = timeoutMs;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this._withTimeout((signal) =>
        fetch(`${this._baseUrl}/v1/models`, { signal }),
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LLMModel[]> {
    try {
      const res = await this._withTimeout((signal) =>
        fetch(`${this._baseUrl}/v1/models`, { signal }),
      );
      if (!res.ok) {
        throw new LLMError(
          `LM Studio listModels failed: ${res.statusText}`,
          res.status,
        );
      }
      const data = (await res.json()) as OpenAiModelsResponse;
      const list = data.data ?? [];
      return list.map((m) => ({
        name: m.id,
        modified_at: m.created ? new Date(m.created * 1000).toISOString() : "",
        size: 0,
      }));
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw new LLMError(`LM Studio listModels error: ${formatError(err)}`, 0);
    }
  }

  async embed(text: string, model: string): Promise<LLMEmbedResult> {
    if (!text) return { embedding: null, available: true };
    try {
      const res = await this._withTimeout((signal) =>
        fetch(`${this._baseUrl}/v1/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: text }),
          signal,
        }),
      );
      if (!res.ok) {
        return { embedding: null, available: res.status !== 404 };
      }
      const data = (await res.json()) as OpenAiEmbeddingsResponse;
      const first = data.data?.[0];
      return { embedding: first?.embedding ?? null, available: true };
    } catch (err) {
      getLogger().warn(`[LmStudioClient] embed failed: ${formatError(err)}`);
      return { embedding: null, available: true };
    }
  }

  async embedBatch(
    texts: readonly string[],
    model: string,
  ): Promise<LLMEmbedResult[]> {
    if (texts.length === 0) return [];
    try {
      const res = await this._withTimeout((signal) =>
        fetch(`${this._baseUrl}/v1/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, input: texts }),
          signal,
        }),
      );
      if (!res.ok) {
        return texts.map(() => ({
          embedding: null,
          available: res.status !== 404,
        }));
      }
      const data = (await res.json()) as OpenAiEmbeddingsResponse;
      const embeddings = data.data ?? [];
      return texts.map((_, i) => ({
        embedding: embeddings[i]?.embedding ?? null,
        available: true,
      }));
    } catch (err) {
      getLogger().warn(`[LmStudioClient] embedBatch failed: ${formatError(err)}`);
      return texts.map(() => ({ embedding: null, available: true }));
    }
  }

  /**
   * v1.16.0 Phase 2.1 (adoption item A2): transparent per-request metric
   * capture, matching the Ollama client. No memory probe -- LM Studio exposes no
   * `/api/ps` equivalent, so the footprint stays null rather than being guessed.
   */
  streamChat(request: LLMChatRequest, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
    return instrumentStream(this._streamChatRaw(request, signal), {
      model: request.model,
      adapter: "lmstudio",
    });
  }

  private async *_streamChatRaw(
    request: LLMChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      stream: true,
    };
    if (request.options) {
      if (request.options.temperature !== undefined) body.temperature = request.options.temperature;
      if (request.options.top_p !== undefined) body.top_p = request.options.top_p;
      if (request.options.top_k !== undefined) body.top_k = request.options.top_k;
      if (request.options.num_ctx !== undefined) body.max_tokens = request.options.num_ctx;
    }
    if (request.tools) {
      body.tools = request.tools;
    }

    const response = await this._withTimeout((effectiveSignal) =>
      fetch(`${this._baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: combineSignal(signal, effectiveSignal),
      }),
    );

    if (!response.ok) {
      throw new LLMError(
        `LM Studio chat failed: ${response.statusText}`,
        response.status,
      );
    }
    if (!response.body) {
      throw new LLMError("LM Studio response body is null", response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pendingUsage: OpenAiStreamChunk["usage"];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx = buffer.indexOf("\n");
        while (newlineIdx !== -1) {
          const rawLine = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          newlineIdx = buffer.indexOf("\n");
          if (!rawLine) continue;
          if (!rawLine.startsWith("data:")) continue;

          const payload = rawLine.slice(5).trim();
          if (payload === "[DONE]") {
            yield {
              message: { role: "assistant", content: "" },
              done: true,
              ...(pendingUsage ? { usage: pendingUsage } : {}),
            };
            return;
          }

          try {
            const parsed = JSON.parse(payload) as OpenAiStreamChunk;
            // v1.16.0 Phase 2.1: usage lands on a late frame, often after
            // finish_reason, so hold it and attach it to the terminal chunk.
            if (parsed.usage) pendingUsage = parsed.usage;
            const choice = parsed.choices?.[0];
            const content = choice?.delta?.content ?? "";
            const role = choice?.delta?.role ?? "assistant";
            const isDone = choice?.finish_reason !== null && choice?.finish_reason !== undefined;
            yield {
              message: { role, content },
              done: isDone,
              ...(isDone && pendingUsage ? { usage: pendingUsage } : {}),
            };
            if (isDone) return;
          } catch {
            // Ignore malformed lines so a single corrupt frame does not
            // abort the entire stream.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async _withTimeout(
    op: (signal: AbortSignal) => Promise<Response>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);
    try {
      return await op(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

function combineSignal(
  userSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
): AbortSignal {
  if (!userSignal) return timeoutSignal;
  // Avoid AbortSignal.any when running under older Node where it might be missing.
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  if (userSignal.aborted) controller.abort();
  if (timeoutSignal.aborted) controller.abort();
  userSignal.addEventListener("abort", () => controller.abort(), { once: true });
  timeoutSignal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller.signal;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function createLmStudioClient(
  options?: CreateLmStudioClientOptions,
): LLMClient {
  const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new LmStudioClientImpl(baseUrl, timeoutMs);
}

/**
 * Probe the LM Studio `/v1/models` endpoint. Returns `true` only when the
 * endpoint responds OK within `timeoutMs`. Used by `NexusCodingRuntime` auto-detect.
 */
export async function probeLmStudio(
  baseUrl = DEFAULT_BASE_URL,
  timeoutMs = 2_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

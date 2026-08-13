// v1.16.0 Phase 1 (adoption item A1) -- vscode-free OpenAI-compatible client.
//
// The exact counterpart of `headlessOllamaClient.ts`, for the same reason:
// `createLmStudioClient` (LmStudioClient.ts) statically imports `utils/logger`,
// which does `import * as vscode`, so it cannot be bundled by esbuild or loaded
// in a plain-Node host. This factory builds the same `LLMClient` over `fetch`
// with no logger dependency, so the desktop sidecar's serving gateway can route
// to an OpenAI-compatible local runtime (LM Studio, an mlx-vlm server, or any
// `nexus.llm.localAdapters` manifest with `protocol: "openai"`).
//
// The SSE parsing loop mirrors `LmStudioClientImpl.streamChat`; consolidating the
// two behind one shared helper (once LmStudioClient.ts is decoupled from the
// vscode-bound logger) is a recorded follow-up, the same one
// `headlessOllamaClient.ts` records for the Ollama pair.

import {
  LLMError,
  type LLMChatRequest,
  type LLMClient,
  type LLMModel,
  type LLMStreamChunk,
} from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:1234";
const DEFAULT_TIMEOUT_MS = 120_000;

export interface HeadlessOpenAiClientOptions {
  /** Base URL of the OpenAI-compatible server (no trailing `/v1`). */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: { role?: string; content?: string };
    finish_reason?: string | null;
  }>;
}

interface OpenAiModelsResponse {
  data?: Array<{ id?: string }>;
}

/**
 * Construct a vscode-free `LLMClient` against an OpenAI-compatible local server.
 * Supports `checkHealth` / `listModels` / `streamChat` (embeddings are omitted --
 * the serving gateway exposes chat completions only).
 */
export function createHeadlessOpenAiClient(
  options: HeadlessOpenAiClientOptions = {},
): LLMClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async checkHealth(): Promise<boolean> {
      try {
        const res = await withTimeout((signal) => fetch(`${baseUrl}/v1/models`, { signal }));
        return res.ok;
      } catch {
        return false;
      }
    },

    async listModels(): Promise<LLMModel[]> {
      const res = await withTimeout((signal) => fetch(`${baseUrl}/v1/models`, { signal }));
      if (!res.ok) {
        throw new LLMError(`Model list request failed: ${res.statusText}`, res.status);
      }
      const body = (await res.json()) as OpenAiModelsResponse;
      return (body.data ?? [])
        .filter((m): m is { id: string } => typeof m.id === "string")
        .map((m) => ({ name: m.id, modified_at: "", size: 0 }));
    },

    async *streamChat(
      request: LLMChatRequest,
      signal?: AbortSignal,
    ): AsyncGenerator<LLMStreamChunk> {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages,
        stream: true,
      };
      if (request.options) {
        const { temperature, top_p, top_k, num_ctx } = request.options;
        if (temperature !== undefined) body.temperature = temperature;
        if (top_p !== undefined) body.top_p = top_p;
        if (top_k !== undefined) body.top_k = top_k;
        if (num_ctx !== undefined) body.max_tokens = num_ctx;
      }
      if (request.tools) body.tools = request.tools;

      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (!response.ok) {
        throw new LLMError(`Chat request failed: ${response.statusText}`, response.status);
      }
      if (!response.body) {
        throw new LLMError("Response body is null", response.status);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let newlineIdx = buffer.indexOf("\n");
          while (newlineIdx !== -1) {
            const rawLine = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            newlineIdx = buffer.indexOf("\n");
            if (!rawLine || !rawLine.startsWith("data:")) continue;

            const payload = rawLine.slice(5).trim();
            if (payload === "[DONE]") {
              yield { message: { role: "assistant", content: "" }, done: true };
              return;
            }
            try {
              const parsed = JSON.parse(payload) as OpenAiStreamChunk;
              const choice = parsed.choices?.[0];
              const content = choice?.delta?.content ?? "";
              const role = choice?.delta?.role ?? "assistant";
              const isDone = choice?.finish_reason !== null && choice?.finish_reason !== undefined;
              yield { message: { role, content }, done: isDone };
              if (isDone) return;
            } catch {
              // Ignore a malformed frame rather than aborting the whole stream.
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

// v1.7.0 -- vscode-free Ollama client factory for headless hosts.
//
// `createOllamaClient` (OllamaClient.ts) statically imports `config/settings` +
// `utils/logger`, both of which `import * as vscode`, so it cannot be bundled
// (esbuild) or loaded in a plain-Node host (the desktop sidecar, the `nexus`
// CLI, the optimizer rollout). This factory builds the same `LLMClient` over the
// vscode-free `OllamaHttp` transport, with no settings/logger dependency, so a
// headless composition root can construct a live LLM port. It lives under
// `modules/coding/llm/` to satisfy the `no-llm-outside-llm-folder` boundary.
//
// The streamChat NDJSON loop mirrors `OllamaClientImpl.streamChat`; consolidating
// the two behind one shared helper (once OllamaClient.ts is decoupled from the
// vscode-bound settings/logger) is a recorded follow-up.

import { OllamaHttp } from "./OllamaHttp.js";
import { instrumentStream } from "./instrumentStream.js";
import { createOllamaMemoryProbe } from "./ollamaMemory.js";
import {
  LLMError,
  LLMStreamChunkSchema,
  type LLMChatRequest,
  type LLMClient,
  type LLMModel,
  type LLMStreamChunk,
} from "./types.js";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 120_000;

export interface HeadlessOllamaClientOptions {
  /** Base URL of the Ollama server (default: NEXUS_OLLAMA_URL env or localhost). */
  readonly baseUrl?: string;
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs?: number;
}

function parseChunk(line: string): LLMStreamChunk {
  return LLMStreamChunkSchema.parse(JSON.parse(line));
}

/**
 * Construct a vscode-free `LLMClient` backed by `OllamaHttp`. Supports the
 * `checkHealth` / `listModels` / `streamChat` surface the headless agent loop
 * needs (embeddings are omitted -- the coding agent does not use them).
 */
export function createHeadlessOllamaClient(
  options: HeadlessOllamaClientOptions = {},
): LLMClient {
  const baseUrl = options.baseUrl ?? process.env["NEXUS_OLLAMA_URL"] ?? DEFAULT_OLLAMA_URL;
  const http = new OllamaHttp(baseUrl, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  // v1.16.0 Phase 2.1: cached, synchronous `/api/ps` resident-size reader.
  const memoryProbe = createOllamaMemoryProbe(http);

  async function* streamChatRaw(
    request: LLMChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk> {
      const response = await http.postJson(
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
        for (;;) {
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
          yield parseChunk(buffer.trim());
        }
      } finally {
        reader.releaseLock();
      }
  }

  return {
    async checkHealth(): Promise<boolean> {
      return http.isReachable();
    },
    async listModels(): Promise<LLMModel[]> {
      return http.listModels();
    },
    // v1.16.0 Phase 2.1 (adoption item A2): transparent per-request metric
    // capture, matching the vscode-bound OllamaClient.
    streamChat(request: LLMChatRequest, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk> {
      return instrumentStream(streamChatRaw(request, signal), {
        model: request.model,
        adapter: "ollama",
        memoryProbe: () => memoryProbe(request.model),
      });
    },
  };
}

import { getSettings } from "../config/settings.js";
import type {
  OllamaClient,
  OllamaChatChunk,
  OllamaChatRequest,
  OllamaModel,
} from "./types.js";
import { OllamaError } from "./types.js";

class OllamaClientImpl implements OllamaClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new OllamaError(
        `Failed to list models: ${response.statusText}`,
        response.status
      );
    }
    const data = (await response.json()) as { models: OllamaModel[] };
    return data.models ?? [];
  }

  async *streamChat(
    request: OllamaChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<OllamaChatChunk> {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(),
      this.timeoutMs
    );

    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, stream: true }),
        signal: combinedSignal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      throw new OllamaError(
        `Ollama chat request failed: ${response.statusText}`,
        response.status
      );
    }

    if (!response.body) {
      throw new OllamaError("Response body is null", response.status);
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

          const chunk = JSON.parse(trimmed) as OllamaChatChunk;
          yield chunk;
          if (chunk.done) return;
        }
      }

      if (buffer.trim()) {
        const chunk = JSON.parse(buffer.trim()) as OllamaChatChunk;
        yield chunk;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export function createOllamaClient(baseUrl?: string): OllamaClient {
  const settings = getSettings();
  const resolvedUrl = baseUrl ?? settings.ollamaUrl;
  const timeoutMs = settings.requestTimeout;
  return new OllamaClientImpl(resolvedUrl, timeoutMs);
}

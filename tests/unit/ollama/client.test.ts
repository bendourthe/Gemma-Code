import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaError } from "../../../src/ollama/types.js";

// Mock the settings module so the client doesn't need a live vscode instance
vi.mock("../../../src/config/settings.js", () => ({
  getSettings: () => ({
    ollamaUrl: "http://localhost:11434",
    modelName: "test-model",
    maxTokens: 8192,
    temperature: 0.2,
    requestTimeout: 60000,
  }),
}));

// Import after mocking
const { createOllamaClient } = await import("../../../src/ollama/client.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>
): Response {
  const bodyStr = JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function makeNdjsonStream(chunks: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
      }
      controller.close();
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OllamaClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // checkHealth
  // -------------------------------------------------------------------------

  describe("checkHealth()", () => {
    it("returns true when Ollama responds with 200", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeResponse(200, { models: [] }))
      );

      const client = createOllamaClient("http://localhost:11434");
      expect(await client.checkHealth()).toBe(true);
    });

    it("returns false when Ollama responds with 404", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeResponse(404, { error: "not found" }))
      );

      const client = createOllamaClient("http://localhost:11434");
      expect(await client.checkHealth()).toBe(false);
    });

    it("returns false when fetch throws (server unreachable)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("ECONNREFUSED"))
      );

      const client = createOllamaClient("http://localhost:11434");
      expect(await client.checkHealth()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // listModels
  // -------------------------------------------------------------------------

  describe("listModels()", () => {
    it("parses the Ollama /api/tags response correctly", async () => {
      const models = [
        { name: "gemma3:27b", modified_at: "2024-01-01", size: 1000 },
        { name: "llama3:8b", modified_at: "2024-01-02", size: 2000 },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeResponse(200, { models }))
      );

      const client = createOllamaClient("http://localhost:11434");
      const result = await client.listModels();
      expect(result).toEqual(models);
    });

    it("returns an empty array when models field is missing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeResponse(200, {}))
      );

      const client = createOllamaClient("http://localhost:11434");
      const result = await client.listModels();
      expect(result).toEqual([]);
    });

    it("throws OllamaError with status code on non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeResponse(503, { error: "unavailable" }))
      );

      const client = createOllamaClient("http://localhost:11434");
      await expect(client.listModels()).rejects.toBeInstanceOf(OllamaError);
      await expect(client.listModels()).rejects.toMatchObject({ statusCode: 503 });
    });
  });

  // -------------------------------------------------------------------------
  // streamChat
  // -------------------------------------------------------------------------

  describe("streamChat()", () => {
    const request = {
      model: "gemma3:27b",
      messages: [{ role: "user" as const, content: "Hello" }],
      stream: true,
    };

    it("yields correct chunks from a mocked NDJSON stream", async () => {
      const ndjsonChunks = [
        { message: { role: "assistant", content: "Hello" }, done: false },
        { message: { role: "assistant", content: " world" }, done: false },
        { message: { role: "assistant", content: "" }, done: true },
      ];

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(makeNdjsonStream(ndjsonChunks), {
            status: 200,
            headers: { "Content-Type": "application/x-ndjson" },
          })
        )
      );

      const client = createOllamaClient("http://localhost:11434");
      const collected: string[] = [];

      for await (const chunk of client.streamChat(request)) {
        collected.push(chunk.message.content);
      }

      expect(collected).toEqual(["Hello", " world", ""]);
    });

    it("throws OllamaError with statusCode on non-2xx response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(makeResponse(401, { error: "unauthorized" }))
      );

      const client = createOllamaClient("http://localhost:11434");

      await expect(async () => {
        for await (const _ of client.streamChat(request)) {
          // should not reach here
        }
      }).rejects.toBeInstanceOf(OllamaError);

      await expect(async () => {
        for await (const _ of client.streamChat(request)) {
          // noop
        }
      }).rejects.toMatchObject({ statusCode: 401 });
    });

    it("stops yielding when AbortSignal is aborted", async () => {
      const encoder = new TextEncoder();
      let streamController!: ReadableStreamDefaultController<Uint8Array>;

      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                message: { role: "assistant", content: "partial" },
                done: false,
              }) + "\n"
            )
          );
        },
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/x-ndjson" },
          })
        )
      );

      const controller = new AbortController();
      const client = createOllamaClient("http://localhost:11434");
      const collected: string[] = [];

      try {
        for await (const chunk of client.streamChat(request, controller.signal)) {
          collected.push(chunk.message.content);
          // Abort after first chunk
          controller.abort();
          // Close the stream to unblock the reader
          streamController.close();
        }
      } catch {
        // AbortError is expected
      }

      expect(collected).toHaveLength(1);
      expect(collected[0]).toBe("partial");
    });
  });
});

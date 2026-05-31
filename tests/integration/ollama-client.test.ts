import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// The client reads settings at construction, so stub getSettings before import.
vi.mock("../../modules/coding/config/settings.js", () => ({
  getSettings: () => ({
    ollamaUrl: "http://localhost:11434",
    requestTimeout: 5000,
  }),
  onSettingsChange: () => ({ dispose: () => {} }),
}));

const { createOllamaClient } = await import("../../modules/coding/llm/OllamaClient.js");
const { OllamaError } = await import("../../modules/coding/llm/types.js");

const BASE_URL = "http://localhost:11434";
const TAGS_URL = `${BASE_URL}/api/tags`;
const CHAT_URL = `${BASE_URL}/api/chat`;

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe("OllamaClient against a mocked Ollama server", () => {
  describe("checkHealth", () => {
    it("returns true when /api/tags responds with 200", async () => {
      server.use(
        http.get(TAGS_URL, () =>
          HttpResponse.json({ models: [] }, { status: 200 }),
        ),
      );

      const client = createOllamaClient();
      const healthy = await client.checkHealth();
      expect(healthy).toBe(true);
    });

    it("returns false when /api/tags responds with 500", async () => {
      server.use(
        http.get(TAGS_URL, () =>
          HttpResponse.json({}, { status: 500 }),
        ),
      );

      const client = createOllamaClient();
      const healthy = await client.checkHealth();
      expect(healthy).toBe(false);
    });

    it("returns false when the server is unreachable", async () => {
      server.use(
        http.get(TAGS_URL, () => HttpResponse.error()),
      );

      const client = createOllamaClient();
      const healthy = await client.checkHealth();
      expect(healthy).toBe(false);
    });
  });

  describe("listModels", () => {
    it("returns the list from /api/tags on 200", async () => {
      server.use(
        http.get(TAGS_URL, () =>
          HttpResponse.json({
            models: [
              {
                name: "gemma4:e4b",
                modified_at: "2026-01-01T00:00:00Z",
                size: 1234,
              },
            ],
          }),
        ),
      );

      const client = createOllamaClient();
      const models = await client.listModels();
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe("gemma4:e4b");
    });

    it("throws OllamaError when /api/tags responds with a non-2xx status", async () => {
      server.use(
        http.get(TAGS_URL, () =>
          HttpResponse.json({}, { status: 503, statusText: "Service Unavailable" }),
        ),
      );

      const client = createOllamaClient();
      await expect(client.listModels()).rejects.toBeInstanceOf(OllamaError);
    });
  });

  describe("streamChat", () => {
    it("yields chunks parsed from the ndjson stream", async () => {
      const ndjson =
        JSON.stringify({
          message: { role: "assistant", content: "hello" },
          done: false,
        }) +
        "\n" +
        JSON.stringify({
          message: { role: "assistant", content: " world" },
          done: true,
        }) +
        "\n";

      server.use(
        http.post(CHAT_URL, () =>
          new HttpResponse(ndjson, {
            status: 200,
            headers: { "Content-Type": "application/x-ndjson" },
          }),
        ),
      );

      const client = createOllamaClient();
      const chunks = [];
      for await (const chunk of client.streamChat({
        model: "gemma4:e4b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
      expect(chunks[0]?.message.content).toBe("hello");
      expect(chunks[1]?.done).toBe(true);
    });

    it("throws OllamaError with 404 when the model is not found", async () => {
      server.use(
        http.post(CHAT_URL, () =>
          HttpResponse.json(
            { error: "model 'missing' not found" },
            { status: 404, statusText: "Not Found" },
          ),
        ),
      );

      const client = createOllamaClient();
      const iterator = client.streamChat({
        model: "missing",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });

      await expect(iterator.next()).rejects.toBeInstanceOf(OllamaError);
    });

    it("raises when the stream errors out before completion", async () => {
      server.use(
        http.post(CHAT_URL, () =>
          HttpResponse.json({}, { status: 500, statusText: "Internal Server Error" }),
        ),
      );

      const client = createOllamaClient();
      const iterator = client.streamChat({
        model: "gemma4:e4b",
        messages: [{ role: "user", content: "hi" }],
        stream: true,
      });

      await expect(iterator.next()).rejects.toBeInstanceOf(OllamaError);
    });
  });
});

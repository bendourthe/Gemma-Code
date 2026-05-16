import { describe, it, expect, afterEach, vi } from "vitest";
import { createLmStudioClient, probeLmStudio } from "../../../src/llm/LmStudioClient.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("LmStudioClient", () => {
  it("checkHealth returns true on a 200 response", async () => {
    mockFetch(async () => new Response("{}", { status: 200 }));
    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      timeoutMs: 1000,
    });
    expect(await client.checkHealth()).toBe(true);
  });

  it("checkHealth returns false on a non-OK response", async () => {
    mockFetch(async () => new Response("", { status: 500 }));
    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      timeoutMs: 1000,
    });
    expect(await client.checkHealth()).toBe(false);
  });

  it("listModels maps OpenAI shape to LLMModel", async () => {
    mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "gemma-4-9b", created: 1000000 },
            { id: "gemma-4-2b" },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      timeoutMs: 1000,
    });
    const models = await client.listModels();
    expect(models).toHaveLength(2);
    expect(models[0]!.name).toBe("gemma-4-9b");
    expect(models[0]!.modified_at).not.toBe("");
  });

  it("embed returns the first embedding from /v1/embeddings", async () => {
    mockFetch(async (url) => {
      expect(url).toContain("/v1/embeddings");
      return new Response(
        JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
        { status: 200 },
      );
    });
    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      timeoutMs: 1000,
    });
    const result = await client.embed!("hello", "nomic-embed-text");
    expect(result.available).toBe(true);
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("embed reports available=false on 404", async () => {
    mockFetch(async () => new Response("", { status: 404 }));
    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      timeoutMs: 1000,
    });
    const result = await client.embed!("hello", "nomic-embed-text");
    expect(result.available).toBe(false);
    expect(result.embedding).toBeNull();
  });

  it("streamChat parses OpenAI SSE delta frames", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"hel"},"finish_reason":null}]}\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n',
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n"));
        controller.close();
      },
    });
    mockFetch(async () =>
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      timeoutMs: 1000,
    });
    const chunks: string[] = [];
    let sawDone = false;
    for await (const chunk of client.streamChat({
      model: "gemma-4",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    })) {
      if (chunk.message.content) chunks.push(chunk.message.content);
      if (chunk.done) sawDone = true;
    }
    expect(chunks.join("")).toBe("hello");
    expect(sawDone).toBe(true);
  });

  it("probeLmStudio returns false when the endpoint is unreachable", async () => {
    mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const ok = await probeLmStudio("http://127.0.0.1:65535", 500);
    expect(ok).toBe(false);
  });
});

// v1.16.0 Phase 1.6 (adoption item A1) -- headless OpenAI-compatible client.
//
// Mirrors headlessOllamaClient.test.ts. The point of this factory is that it
// builds a working LLMClient with NO vscode dependency, so the desktop sidecar's
// serving gateway can route to LM Studio / mlx-vlm / any loopback OpenAI runtime.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createHeadlessOpenAiClient } from "../../../modules/coding/llm/headlessOpenAiClient.js";
import { LLMError } from "../../../modules/coding/llm/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(frames: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const frame of frames) controller.enqueue(enc.encode(`${frame}\n`));
      controller.close();
    },
  });
  return new Response(body, { status });
}

const delta = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}`;

describe("createHeadlessOpenAiClient", () => {
  it("streams parsed deltas and stops at [DONE]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([delta("Hel"), delta("lo"), "data: [DONE]", delta("IGNORED")])),
    );
    const client = createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" });
    const chunks: string[] = [];
    for await (const c of client.streamChat({ model: "m", messages: [], stream: true })) {
      if (!c.done) chunks.push(c.message.content);
    }
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("stops when a chunk carries a finish_reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          delta("done-ish"),
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
          delta("IGNORED"),
        ]),
      ),
    );
    const client = createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" });
    const chunks: string[] = [];
    for await (const c of client.streamChat({ model: "m", messages: [], stream: true })) {
      chunks.push(c.message.content);
    }
    expect(chunks).toEqual(["done-ish", ""]);
  });

  it("ignores a malformed frame instead of aborting the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([delta("a"), "data: {not json", delta("b"), "data: [DONE]"])),
    );
    const client = createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" });
    const chunks: string[] = [];
    for await (const c of client.streamChat({ model: "m", messages: [], stream: true })) {
      if (!c.done) chunks.push(c.message.content);
    }
    expect(chunks).toEqual(["a", "b"]);
  });

  it("maps sampling options onto the OpenAI request body", async () => {
    const fetchMock = vi.fn(async () => sseResponse(["data: [DONE]"]));
    vi.stubGlobal("fetch", fetchMock);
    const client = createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" });
    for await (const _c of client.streamChat({
      model: "m",
      messages: [],
      stream: true,
      options: { temperature: 0.5, top_p: 0.8, top_k: 40, num_ctx: 512 },
    })) {
      // drain
    }
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ temperature: 0.5, top_p: 0.8, top_k: 40, max_tokens: 512 });
  });

  it("throws LLMError on a non-ok chat response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500, statusText: "Server Error" })),
    );
    const client = createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" });
    await expect(async () => {
      for await (const _c of client.streamChat({ model: "m", messages: [], stream: true })) {
        // never reached
      }
    }).rejects.toBeInstanceOf(LLMError);
  });

  it("listModels maps the OpenAI models list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ data: [{ id: "model-a" }, { id: "model-b" }, {}] })),
    );
    const models = await createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" }).listModels();
    expect(models.map((m) => m.name)).toEqual(["model-a", "model-b"]);
  });

  it("listModels throws LLMError when the runtime rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 503, statusText: "Unavailable" })),
    );
    await expect(
      createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" }).listModels(),
    ).rejects.toBeInstanceOf(LLMError);
  });

  it("checkHealth reports false when the runtime is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(
      createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" }).checkHealth(),
    ).resolves.toBe(false);
  });

  it("checkHealth reports true when the models endpoint answers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [] })));
    await expect(
      createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234" }).checkHealth(),
    ).resolves.toBe(true);
  });

  it("constructs with no options and without requiring vscode/settings", () => {
    const client = createHeadlessOpenAiClient();
    expect(typeof client.streamChat).toBe("function");
    expect(typeof client.checkHealth).toBe("function");
    expect(typeof client.listModels).toBe("function");
  });

  it("strips a trailing slash from the base URL", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await createHeadlessOpenAiClient({ baseUrl: "http://127.0.0.1:1234/" }).listModels();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:1234/v1/models");
  });
});

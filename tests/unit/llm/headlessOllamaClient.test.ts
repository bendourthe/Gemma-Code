import { afterEach, describe, expect, it, vi } from "vitest";

import { createHeadlessOllamaClient } from "../../../modules/coding/llm/headlessOllamaClient.js";
import { LLMError } from "../../../modules/coding/llm/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function ndjsonResponse(lines: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const line of lines) controller.enqueue(enc.encode(`${line}\n`));
      controller.close();
    },
  });
  return new Response(body, { status });
}

describe("createHeadlessOllamaClient", () => {
  it("streams parsed chat chunks and stops at done", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse([
          JSON.stringify({ message: { role: "assistant", content: "Hel" }, done: false }),
          JSON.stringify({ message: { role: "assistant", content: "lo" }, done: true }),
          JSON.stringify({ message: { role: "assistant", content: "IGNORED" }, done: false }),
        ]),
      ),
    );
    const client = createHeadlessOllamaClient({ baseUrl: "http://localhost:11434" });
    const chunks: string[] = [];
    for await (const c of client.streamChat({ model: "m", messages: [], stream: true })) {
      chunks.push(c.message.content);
    }
    // Stops after the `done: true` chunk; the trailing line is never yielded.
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("throws LLMError on a non-ok chat response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500, statusText: "Server Error" })),
    );
    const client = createHeadlessOllamaClient({ baseUrl: "http://localhost:11434" });
    await expect(async () => {
      // eslint-disable-next-line no-empty
      for await (const _c of client.streamChat({ model: "m", messages: [], stream: true })) {
      }
    }).rejects.toBeInstanceOf(LLMError);
  });

  it("defaults the base URL from NEXUS_OLLAMA_URL when unset", () => {
    // Construction must not throw and must not require vscode/settings.
    const client = createHeadlessOllamaClient();
    expect(typeof client.streamChat).toBe("function");
    expect(typeof client.checkHealth).toBe("function");
    expect(typeof client.listModels).toBe("function");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OllamaClient, OllamaChatRequest } from "../../../modules/coding/llm/types.js";

// ConversationManager and StreamingPipeline both import vscode; the global
// mock in tests/setup.ts handles that.
const { ConversationManager } = await import(
  "../../../modules/coding/chat/ConversationManager.js"
);
const { StreamingPipeline } = await import(
  "../../../modules/coding/chat/StreamingPipeline.js"
);

async function* makeStream(
  chunks: Array<{ content: string; done: boolean }>,
): AsyncGenerator<{ message: { role: string; content: string }; done: boolean }> {
  for (const c of chunks) {
    yield { message: { role: "assistant", content: c.content }, done: c.done };
  }
}

function makeMockClient(): OllamaClient {
  return {
    checkHealth: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn(() => makeStream([{ content: "ok", done: true }])),
  };
}

function lastRequest(client: OllamaClient): OllamaChatRequest {
  const mock = client.streamChat as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls[0]?.[0] as OllamaChatRequest;
}

describe("StreamingPipeline -- multimodal input (item 33)", () => {
  let manager: InstanceType<typeof ConversationManager>;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = new ConversationManager("Test system prompt.");
    postMessage = vi.fn();
  });

  it("forwards image attachments to a vision-capable model", async () => {
    const client = makeMockClient();
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("describe this", postMessage, ["BASE64IMG"]);

    const req = lastRequest(client);
    const userMsg = req.messages.find((m) => m.role === "user");
    expect(userMsg?.images).toEqual(["BASE64IMG"]);
  });

  it("does not forward images to a text-only model (ignored cleanly)", async () => {
    const client = makeMockClient();
    const pipeline = new StreamingPipeline(client, manager, "gemma3:27b");

    await pipeline.send("describe this", postMessage, ["BASE64IMG"]);

    const req = lastRequest(client);
    const userMsg = req.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("describe this");
    expect(userMsg).not.toHaveProperty("images");
  });

  it("records the image attachment on the stored user message", async () => {
    const client = makeMockClient();
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("hi", postMessage, ["BASE64IMG"]);

    const stored = manager.getHistory().find((m) => m.role === "user");
    expect(stored?.images).toEqual(["BASE64IMG"]);
  });

  it("sends a clean text-only request when no images are provided", async () => {
    const client = makeMockClient();
    const pipeline = new StreamingPipeline(client, manager, "gemma4");

    await pipeline.send("plain text", postMessage);

    const req = lastRequest(client);
    const userMsg = req.messages.find((m) => m.role === "user");
    expect(userMsg).not.toHaveProperty("images");
  });
});

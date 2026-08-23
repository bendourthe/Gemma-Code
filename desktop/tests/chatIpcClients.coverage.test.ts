/**
 * Cover Chat and memory IPC helpers that previously sat at 33-50% functions.
 */

import { afterEach, describe, expect, it } from "vitest";

import { clearInvokeOverride, setInvokeOverride } from "../src/lib/ipc";
import { createChatIpcClient, joinChatReply } from "../src/modules/chat/chatIpcClient";
import { createIpcChatMemoryHub, searchIpcEpisodicMemory } from "../src/modules/chat/memoryIpcClient";

afterEach(() => clearInvokeOverride());

function stub(handler: (method: string, params: Record<string, unknown>) => unknown): void {
  setInvokeOverride(async (_cmd, args) => {
    const a = args as { method: string; params: Record<string, unknown> };
    return handler(a.method, a.params ?? {});
  });
}

describe("joinChatReply", () => {
  it("concatenates token events and ignores the done event", () => {
    expect(
      joinChatReply([
        { kind: "token", text: "Hel" },
        { kind: "token", text: "lo" },
        { kind: "done", finishReason: "stop" },
      ]),
    ).toBe("Hello");
  });
});

describe("createChatIpcClient", () => {
  it("starts a session and sends a message", async () => {
    stub((method, params) => {
      if (method === "chat.session.start") {
        expect(params.modelId).toBe("gemma4:e4b");
        return { sessionId: "s1", modelId: "gemma4:e4b", createdAt: "t0" };
      }
      if (method === "chat.session.sendMessage") {
        expect(params.sessionId).toBe("s1");
        return {
          sessionId: "s1",
          events: [{ kind: "token", text: "ok" }, { kind: "done" }],
        };
      }
      throw new Error(method);
    });
    const client = createChatIpcClient();
    expect(await client.start({ modelId: "gemma4:e4b", title: "Hi" })).toMatchObject({
      sessionId: "s1",
    });
    const sent = await client.sendMessage({
      sessionId: "s1",
      message: "hello",
      images: ["data:image/png;base64,xx"],
    });
    expect(joinChatReply(sent.events)).toBe("ok");
  });
});

describe("createIpcChatMemoryHub", () => {
  it("records an episodic event and searches hits", async () => {
    stub((method, params) => {
      if (method === "memory.episodic.record") {
        expect(params.content).toBe("note");
        return { ok: true };
      }
      if (method === "memory.episodic.search") {
        return { hits: [{ id: "h1", content: "note", capturedAt: "t0" }] };
      }
      throw new Error(method);
    });
    await createIpcChatMemoryHub().episodic.record({
      id: "e1",
      content: "note",
      source: "chat",
      scopeId: "s1",
    });
    expect(await searchIpcEpisodicMemory({ query: "note", limit: 5 })).toEqual([
      { id: "h1", content: "note", capturedAt: "t0" },
    ]);
  });
});

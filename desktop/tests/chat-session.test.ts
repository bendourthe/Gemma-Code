/**
 * v1.7.0 -- the desktop Local Chatbot Explorer now runs a real local-model chat
 * turn (not the "(local stub) Echo" placeholder). These tests cover the chat
 * session manager (delegation + history accumulation + fallback) and the
 * non-agentic message handler (stream -> token/done mapping, error-safe).
 */

import { describe, expect, it } from "vitest";

import type { LLMClient } from "../../modules/coding/llm/types";
import { createChatMessageHandler } from "../sidecar/src/chat/chatMessageHandler";
import { ChatSessionManager } from "../sidecar/src/chat/sessionManager";
import { requireModel } from "../sidecar/src/coding/models";

function scriptedLlm(perCall: string[][]): LLMClient {
  let call = 0;
  return {
    async checkHealth() {
      return true;
    },
    async listModels() {
      return [];
    },
    async *streamChat() {
      const tokens = perCall[call++] ?? ["Done."];
      for (const t of tokens) {
        yield { message: { role: "assistant", content: t }, done: false };
      }
      yield { message: { role: "assistant", content: "" }, done: true };
    },
  };
}

describe("createChatMessageHandler", () => {
  it("maps a streamed reply to token events plus a done", async () => {
    const runner = createChatMessageHandler({ llm: scriptedLlm([["Hel", "lo"]]) });
    const events = await runner({
      sessionId: "c1",
      model: requireModel("gemma4:e4b"),
      messages: [{ role: "user", content: "hi" }],
    });
    expect(events.filter((e) => e.kind === "token").map((e) => (e as { text: string }).text)).toEqual(
      ["Hel", "lo"],
    );
    expect(events.at(-1)).toEqual({ kind: "done", finishReason: "stop" });
  });

  it("never throws -- an LLM failure becomes a done with an error reason", async () => {
    const failing: LLMClient = {
      async checkHealth() {
        return true;
      },
      async listModels() {
        return [];
      },
      // eslint-disable-next-line require-yield
      async *streamChat() {
        throw new Error("ollama down");
      },
    };
    const runner = createChatMessageHandler({ llm: failing });
    const events = await runner({
      sessionId: "c1",
      model: requireModel("gemma4:e4b"),
      messages: [{ role: "user", content: "hi" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("done");
    expect((events[0] as { finishReason?: string }).finishReason).toMatch(/error: ollama down/);
  });
});

describe("ChatSessionManager", () => {
  it("starts a session and delegates a turn to the injected runner, accumulating history", async () => {
    const seen: Array<{ messages: readonly { role: string; content: string }[] }> = [];
    const mgr = new ChatSessionManager({
      idFactory: (() => {
        let i = 0;
        return () => `chat-${++i}`;
      })(),
      runner: async (input) => {
        seen.push({ messages: input.messages });
        return [
          { kind: "token", text: "reply-" },
          { kind: "token", text: String(input.messages.length) },
          { kind: "done", finishReason: "stop" },
        ];
      },
    });
    const started = mgr.start({ modelId: "gemma4:e4b", title: "My chat" });
    expect(started.sessionId).toBe("chat-1");
    expect(mgr.size()).toBe(1);

    const first = await mgr.sendMessage(started.sessionId, "hello");
    expect(first.some((e) => e.kind === "token")).toBe(true);
    // First turn: history = [system, user] = 2 messages seen by the runner.
    expect(seen[0]?.messages.length).toBe(2);

    // Second turn carries the accumulated assistant reply: [system,user,assistant,user] = 4.
    await mgr.sendMessage(started.sessionId, "again");
    expect(seen[1]?.messages.length).toBe(4);
    expect(seen[1]?.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("falls back to a deterministic echo when no runner is wired", async () => {
    const mgr = new ChatSessionManager();
    const started = mgr.start({ modelId: "gemma4:e4b" });
    const events = await mgr.sendMessage(started.sessionId, "ping");
    expect(events.at(-1)?.kind).toBe("done");
    expect((events[0] as { text?: string }).text).toContain("ping");
  });

  it("rejects an unknown sessionId", async () => {
    const mgr = new ChatSessionManager();
    await expect(mgr.sendMessage("nope", "m")).rejects.toThrow(/unknown sessionId/);
  });
});

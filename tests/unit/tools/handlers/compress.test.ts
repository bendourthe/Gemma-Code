import { describe, it, expect, beforeEach } from "vitest";
import { CompressRangeTool, CompressMessageTool } from "../../../../src/tools/handlers/compress.js";
import { CompressionState } from "../../../../modules/coding/chat/state/CompressionState.js";
import type { Message } from "../../../../modules/coding/chat/types.js";

class FakeManager {
  private _messages: Message[] = [];

  constructor(messages: Message[]) {
    this._messages = [...messages];
  }

  getHistory(): readonly Message[] {
    return this._messages;
  }

  replaceMessages(messages: readonly Message[]): void {
    this._messages = [...messages];
  }
}

function msg(role: Message["role"], content: string, idSuffix?: string): Message {
  const id = `id-${idSuffix ?? Math.random().toString(36).slice(2, 8)}`;
  return { id, role, content, timestamp: Date.now() };
}

function makeDeps(messages: Message[]) {
  const manager = new FakeManager(messages);
  const state = new CompressionState();
  return {
    deps: {
      conversation: manager as unknown as import("../../../../modules/coding/chat/ConversationManager.js").ConversationManager,
      state,
      protectedTools: ["write_file"],
      protectUserMessages: false,
    },
    manager,
    state,
  };
}

describe("CompressRangeTool", () => {
  it("compresses three messages and emits a placeholder block", async () => {
    const baseline: Message[] = [
      msg("system", "system prompt", "sys"),
      msg("assistant", "first", "a1"),
      msg("user", "second", "u2"),
      msg("assistant", "third", "a3"),
    ];
    const { deps, manager, state } = makeDeps(baseline);
    // Pre-allocate stable IDs by walking the conversation once.
    for (const m of baseline) if (m.role !== "system") state.allocateMessageId(m);

    const tool = new CompressRangeTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      topic: "test compaction",
      ranges: [{ startId: "m0001", endId: "m0003", summary: "compressed three messages" }],
    });

    expect(result.success).toBe(true);
    const remaining = manager.getHistory();
    const placeholder = remaining.find((m) => m.content.startsWith("[BLOCK b1:"));
    expect(placeholder).toBeDefined();
    expect(placeholder!.role).toBe("system");
    expect(placeholder!.content).toContain("compressed three messages");
  });

  it("rejects ranges that overlap each other within a single call", async () => {
    const baseline: Message[] = [
      msg("user", "1", "u1"),
      msg("user", "2", "u2"),
      msg("user", "3", "u3"),
    ];
    const { deps, state } = makeDeps(baseline);
    for (const m of baseline) state.allocateMessageId(m);

    const tool = new CompressRangeTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      topic: "bad",
      ranges: [
        { startId: "m0001", endId: "m0002", summary: "A" },
        { startId: "m0002", endId: "m0003", summary: "B" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("overlap");
  });

  it("rejects unknown stable IDs", async () => {
    const baseline: Message[] = [msg("user", "1", "u1")];
    const { deps, state } = makeDeps(baseline);
    state.allocateMessageId(baseline[0]!);

    const tool = new CompressRangeTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      topic: "bad",
      ranges: [{ startId: "m9999", endId: "m9999", summary: "X" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown startId");
  });

  it("nests an earlier block summary inside a later range", async () => {
    const baseline: Message[] = [
      msg("user", "outer-pre", "u1"),
      msg("user", "[BLOCK b1: prior topic]\nprior summary", "blk"),
      msg("user", "outer-post", "u2"),
    ];
    const { deps, manager, state } = makeDeps(baseline);
    // Reserve b1 so the new block becomes b2 -- mirrors a real session where
    // an earlier compress call had already produced b1.
    state.allocateBlockId();
    for (const m of baseline) state.allocateMessageId(m);

    const tool = new CompressRangeTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      topic: "outer",
      ranges: [{ startId: "m0001", endId: "m0003", summary: "outer summary" }],
    });
    expect(result.success).toBe(true);
    const placeholder = manager.getHistory().find((m) => m.content.startsWith("[BLOCK b2:"));
    expect(placeholder).toBeDefined();
    expect(placeholder!.content).toContain("Nested blocks embedded: b1");
  });

  it("preserves protected tool outputs at the tail of the placeholder block", async () => {
    const protectedResult = msg(
      "user",
      `<|tool_result>\n${JSON.stringify({ name: "write_file", response: { success: true, output: "wrote" } }, null, 2)}\n<tool_result|>`,
      "wf",
    );
    const baseline: Message[] = [
      msg("assistant", "head", "a1"),
      protectedResult,
      msg("assistant", "tail", "a2"),
    ];
    const { deps, manager, state } = makeDeps(baseline);
    for (const m of baseline) state.allocateMessageId(m);

    const tool = new CompressRangeTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      topic: "save tail",
      ranges: [{ startId: "m0001", endId: "m0003", summary: "S" }],
    });
    expect(result.success).toBe(true);
    const ids = manager.getHistory().map((m) => m.id);
    expect(ids).toContain(protectedResult.id);
  });

  it("refuses to run when manual-only mode is on", async () => {
    const baseline: Message[] = [msg("user", "1", "u1")];
    const { deps, state } = makeDeps(baseline);
    state.setManualOnly(true);

    const tool = new CompressRangeTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      topic: "x",
      ranges: [{ startId: "m0001", endId: "m0001", summary: "X" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("manual-only");
  });
});

describe("CompressMessageTool", () => {
  it("compresses a single message into a placeholder", async () => {
    const baseline: Message[] = [
      msg("user", "context-irrelevant", "u1"),
      msg("user", "long dump that we want compressed", "u2"),
      msg("user", "still relevant", "u3"),
    ];
    const { deps, manager, state } = makeDeps(baseline);
    for (const m of baseline) state.allocateMessageId(m);

    const tool = new CompressMessageTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      compressions: [{ messageId: "m0002", summary: "compressed long dump" }],
    });
    expect(result.success).toBe(true);
    const placeholder = manager.getHistory().find((m) => m.content.startsWith("[BLOCK b1:"));
    expect(placeholder?.content).toContain("compressed long dump");
  });

  it("rejects orphaning a tool-call/tool-result pair", async () => {
    const callMsg = msg("assistant", `<|tool_call>call:read_file{path:<|"|>x<|"|>}<tool_call|>`, "a1");
    const resultMsg = msg(
      "user",
      `<|tool_result>\n${JSON.stringify({ name: "read_file", response: { success: true, output: "ok" } }, null, 2)}\n<tool_result|>`,
      "u1",
    );
    const baseline: Message[] = [callMsg, resultMsg];
    const { deps, state } = makeDeps(baseline);
    for (const m of baseline) state.allocateMessageId(m);

    const tool = new CompressMessageTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      compressions: [{ messageId: "m0001", summary: "orphan" }],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("orphan");
  });

  it("round-trips through decompress correctly", async () => {
    const baseline: Message[] = [msg("user", "long", "u1"), msg("user", "tail", "u2")];
    const { deps, manager, state } = makeDeps(baseline);
    for (const m of baseline) state.allocateMessageId(m);

    const tool = new CompressMessageTool(deps);
    const result = await tool.execute({
      _callId: "c1",
      compressions: [{ messageId: "m0001", summary: "S" }],
    });
    expect(result.success).toBe(true);

    const restored = state.decompressBlock("b1").restoredMessages;
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe(baseline[0]!.id);
    expect(manager).toBeDefined();
  });
});

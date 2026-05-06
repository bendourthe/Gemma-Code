import { describe, it, expect } from "vitest";
import {
  parseCompactArgs,
  computeContextBreakdown,
  renderContextBreakdown,
  computeCompactionStats,
  renderCompactionStats,
  planSweep,
  decompressBlockInConversation,
  recompressBlockInConversation,
} from "../../../src/commands/compactCommand.js";
import { CompressionState } from "../../../src/chat/state/CompressionState.js";
import type { Message } from "../../../src/chat/types.js";
import type { ConversationManager } from "../../../src/chat/ConversationManager.js";

class FakeManager {
  private _messages: Message[];
  constructor(messages: Message[]) {
    this._messages = [...messages];
  }
  getHistory(): readonly Message[] {
    return this._messages;
  }
  replaceMessages(m: readonly Message[]): void {
    this._messages = [...m];
  }
}

function asManager(f: FakeManager): ConversationManager {
  return f as unknown as ConversationManager;
}

let counter = 0;
function msg(role: Message["role"], content: string, id?: string): Message {
  counter += 1;
  return { id: id ?? `m-${counter}`, role, content, timestamp: counter };
}

describe("parseCompactArgs", () => {
  it("returns 'legacy' for empty args", () => {
    expect(parseCompactArgs("")).toEqual({ verb: "legacy" });
  });

  it("recognises every documented verb", () => {
    expect(parseCompactArgs("context").verb).toBe("context");
    expect(parseCompactArgs("stats").verb).toBe("stats");
    expect(parseCompactArgs("sweep").verb).toBe("sweep");
    expect(parseCompactArgs("decompress b1")).toMatchObject({ verb: "decompress", stringArg: "b1" });
    expect(parseCompactArgs("recompress b1")).toMatchObject({ verb: "recompress", stringArg: "b1" });
    expect(parseCompactArgs("manual on")).toMatchObject({ verb: "manual", stringArg: "on" });
    expect(parseCompactArgs("manual off")).toMatchObject({ verb: "manual", stringArg: "off" });
  });

  it("parses sweep N", () => {
    expect(parseCompactArgs("sweep 5")).toEqual({ verb: "sweep", numericArg: 5 });
  });

  it("flags unknown verbs", () => {
    const r = parseCompactArgs("frobnicate");
    expect(r.verb).toBe("unknown");
  });
});

describe("computeContextBreakdown", () => {
  it("computes per-role token counts and percent used", () => {
    const messages: Message[] = [
      msg("system", "system instructions"),
      msg("user", "hello world"),
      msg("assistant", "hi back"),
    ];
    const breakdown = computeContextBreakdown(messages, 100);
    expect(breakdown.totalTokens).toBeGreaterThan(0);
    expect(breakdown.perRole["system"]).toBeGreaterThan(0);
    expect(breakdown.usedPercent).toBeGreaterThanOrEqual(0);
    expect(renderContextBreakdown(breakdown)).toContain("Context usage");
  });
});

describe("computeCompactionStats", () => {
  it("counts active runs and ignores decompressed ones", () => {
    const state = new CompressionState();
    const snapshot = [msg("user", "x", "x1")];
    state.recordRun({
      topic: "t",
      mode: "range",
      blockSummaries: [
        { blockId: "b1", startId: "m0001", endId: "m0001", summary: "S", nestedBlockIds: [], snapshot },
      ],
    });
    let stats = computeCompactionStats(state);
    expect(stats.compressionRuns).toBe(1);
    expect(stats.compressionBlocks).toBe(1);

    state.decompressBlock("b1");
    stats = computeCompactionStats(state);
    expect(stats.compressionRuns).toBe(0);

    expect(renderCompactionStats(stats)).toContain("Compaction stats");
  });
});

describe("planSweep", () => {
  it("returns null when there are no tool results since the last user message", () => {
    const messages: Message[] = [msg("user", "hi"), msg("assistant", "hello")];
    expect(planSweep(messages, 5)).toBeNull();
  });

  it("plans a sweep over the most-recent N tool-result messages", () => {
    const result = (n: number) => msg("user", `<|tool_result>\nresult ${n}\n<tool_result|>`);
    const messages: Message[] = [
      msg("user", "go"),
      msg("assistant", "calling"),
      result(1),
      msg("assistant", "calling"),
      result(2),
      msg("assistant", "calling"),
      result(3),
    ];
    const plan = planSweep(messages, 2);
    expect(plan).not.toBeNull();
    expect(plan!.count).toBeGreaterThan(0);
  });
});

describe("decompress / recompress flows", () => {
  it("decompress restores snapshot and recompress reverts", () => {
    const original = msg("user", "long original payload", "orig-id");
    const placeholder = msg("system", "[BLOCK b1: topic]\nshort summary", "placeholder-id");
    const manager = new FakeManager([msg("system", "sys", "sys"), placeholder, msg("user", "tail", "tail")]);

    const state = new CompressionState();
    state.recordRun({
      topic: "topic",
      mode: "range",
      blockSummaries: [
        {
          blockId: "b1",
          startId: "m0001",
          endId: "m0001",
          summary: "short summary",
          nestedBlockIds: [],
          snapshot: [original],
        },
      ],
    });

    const dec = decompressBlockInConversation(asManager(manager), state, "b1");
    expect(dec.ok).toBe(true);
    if (dec.ok) expect(dec.restored).toBe(1);
    expect(manager.getHistory().some((m) => m.id === "orig-id")).toBe(true);

    const rec = recompressBlockInConversation(asManager(manager), state, "b1");
    expect(rec.ok).toBe(true);
    expect(manager.getHistory().some((m) => m.content.startsWith("[BLOCK b1:"))).toBe(true);
  });
});

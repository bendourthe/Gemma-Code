import { describe, it, expect } from "vitest";
import { ToolCallStreamParser, type ToolCallStreamEvent } from "../../../src/chat/ToolCallStreamParser.js";

function collect(parser: ToolCallStreamParser, chunks: readonly string[]): ToolCallStreamEvent[] {
  const out: ToolCallStreamEvent[] = [];
  for (const chunk of chunks) out.push(...parser.feed(chunk));
  out.push(...parser.flush());
  return out;
}

function makeParser(): ToolCallStreamParser {
  let n = 0;
  return new ToolCallStreamParser(() => `call-${++n}`);
}

describe("ToolCallStreamParser", () => {
  it("emits header before any arg-delta or complete event", () => {
    const parser = makeParser();
    const events = collect(parser, [
      '<tool_use name="grep">',
      '{"pattern": "foo"}',
      "</tool_use>",
    ]);
    const order = events.map((e) => e.type);
    expect(order[0]).toBe("toolCallHeader");
    expect(order[order.length - 1]).toBe("toolCallComplete");
    const argDeltas = events.filter((e) => e.type === "toolCallArgDelta");
    expect(argDeltas.length).toBeGreaterThan(0);
  });

  it("handles multiple tool calls in one stream", () => {
    const parser = makeParser();
    const events = collect(parser, [
      '<tool_use name="a">{"x":1}</tool_use>',
      '<tool_use name="b">{"y":2}</tool_use>',
    ]);
    const headers = events.filter((e) => e.type === "toolCallHeader");
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({ toolName: "a", callId: "call-1" });
    expect(headers[1]).toMatchObject({ toolName: "b", callId: "call-2" });
  });

  it("buffers split-tag boundaries", () => {
    const parser = makeParser();
    const events = collect(parser, [
      '<tool_',
      'use name="grep">{"p":"x"}',
      '</tool_use>',
    ]);
    const types = events.map((e) => e.type);
    expect(types.indexOf("toolCallHeader")).toBe(0);
    expect(types).toContain("toolCallComplete");
  });

  it("recovers gracefully from a malformed tool-call (no close tag)", () => {
    const parser = makeParser();
    const events = collect(parser, ['<tool_use name="grep">{"p":"x"'])
      .map((e) => e.type);
    expect(events[0]).toBe("toolCallHeader");
    // The flush() at end should emit the trailing arg-delta but never a
    // complete event when no closing tag was seen.
    expect(events).not.toContain("toolCallComplete");
  });

  it("assigns a stable callId across delta and complete events", () => {
    const parser = makeParser();
    const events = collect(parser, ['<tool_use name="x">payload</tool_use>']);
    const callIds = new Set(events.map((e) => e.callId));
    expect(callIds.size).toBe(1);
  });
});

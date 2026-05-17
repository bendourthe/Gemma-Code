import { describe, expect, it } from "vitest";
import {
  applyEvent,
  applyEvents,
  emptyTurn,
  type StreamEvent,
} from "../src/modules/coding/toolCallCard";

describe("toolCallCard reducer", () => {
  it("emptyTurn is a clean slate", () => {
    expect(emptyTurn()).toEqual({ text: "", cards: [], done: false });
  });

  it("appends token text", () => {
    let s = emptyTurn();
    s = applyEvent(s, { kind: "token", text: "Hello, " });
    s = applyEvent(s, { kind: "token", text: "world" });
    expect(s.text).toBe("Hello, world");
  });

  it("opens a tool card on header and accumulates arg delta", () => {
    const events: StreamEvent[] = [
      { kind: "toolCallHeader", callId: "c1", name: "fs.read" },
      { kind: "toolCallArgDelta", callId: "c1", delta: '{"p' },
      { kind: "toolCallArgDelta", callId: "c1", delta: 'ath":"a.ts"}' },
    ];
    const s = applyEvents(events);
    expect(s.cards).toEqual([
      { callId: "c1", name: "fs.read", args: '{"path":"a.ts"}', result: null },
    ]);
  });

  it("toolCallComplete fills the result without disturbing args", () => {
    const events: StreamEvent[] = [
      { kind: "toolCallHeader", callId: "c1", name: "fs.read" },
      { kind: "toolCallArgDelta", callId: "c1", delta: "{}" },
      { kind: "toolCallComplete", callId: "c1", result: "ok" },
    ];
    const s = applyEvents(events);
    expect(s.cards[0]).toEqual({
      callId: "c1",
      name: "fs.read",
      args: "{}",
      result: "ok",
    });
  });

  it("done sets the terminal flag and propagates the finishReason", () => {
    const s = applyEvents([{ kind: "done", finishReason: "cancelled" }]);
    expect(s.done).toBe(true);
    expect(s.finishReason).toBe("cancelled");
  });

  it("two concurrent tool calls live side-by-side", () => {
    const events: StreamEvent[] = [
      { kind: "toolCallHeader", callId: "a", name: "tool.a" },
      { kind: "toolCallHeader", callId: "b", name: "tool.b" },
      { kind: "toolCallArgDelta", callId: "a", delta: "a1" },
      { kind: "toolCallArgDelta", callId: "b", delta: "b1" },
      { kind: "toolCallComplete", callId: "b", result: "B_OK" },
    ];
    const s = applyEvents(events);
    expect(s.cards.map((c) => c.callId)).toEqual(["a", "b"]);
    expect(s.cards[0]?.result).toBeNull();
    expect(s.cards[1]?.result).toBe("B_OK");
  });
});

import { describe, it, expect } from "vitest";
import {
  applyAutoModeEvent,
  applyAutoModeEvents,
  emptyAutoModeTurn,
  summarizeAutoModeTurn,
  type AutoModeEvent,
} from "../../../../core/coding/AutoModeStream.js";

describe("emptyAutoModeTurn", () => {
  it("returns the canonical zero state", () => {
    const state = emptyAutoModeTurn();
    expect(state.text).toBe("");
    expect(state.cards).toEqual([]);
    expect(state.done).toBe(false);
    expect(state.finishReason).toBeNull();
  });
});

describe("applyAutoModeEvent", () => {
  it("concatenates tokens", () => {
    let s = emptyAutoModeTurn();
    s = applyAutoModeEvent(s, { kind: "token", text: "Hello" });
    s = applyAutoModeEvent(s, { kind: "token", text: ", world" });
    expect(s.text).toBe("Hello, world");
  });

  it("creates a new card on toolCallHeader", () => {
    let s = emptyAutoModeTurn();
    s = applyAutoModeEvent(s, {
      kind: "toolCallHeader",
      callId: "c1",
      name: "read_file",
    });
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0]?.callId).toBe("c1");
    expect(s.cards[0]?.name).toBe("read_file");
    expect(s.cards[0]?.args).toBe("");
    expect(s.cards[0]?.result).toBeNull();
  });

  it("ignores duplicate toolCallHeader for the same callId", () => {
    let s = emptyAutoModeTurn();
    s = applyAutoModeEvent(s, {
      kind: "toolCallHeader",
      callId: "c1",
      name: "read_file",
    });
    s = applyAutoModeEvent(s, {
      kind: "toolCallHeader",
      callId: "c1",
      name: "different",
    });
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0]?.name).toBe("read_file");
  });

  it("accumulates args deltas on the matching card only", () => {
    let s = emptyAutoModeTurn();
    s = applyAutoModeEvent(s, {
      kind: "toolCallHeader",
      callId: "c1",
      name: "read_file",
    });
    s = applyAutoModeEvent(s, {
      kind: "toolCallHeader",
      callId: "c2",
      name: "write_file",
    });
    s = applyAutoModeEvent(s, {
      kind: "toolCallArgDelta",
      callId: "c1",
      delta: '{"path":"',
    });
    s = applyAutoModeEvent(s, {
      kind: "toolCallArgDelta",
      callId: "c1",
      delta: 'foo.ts"}',
    });
    expect(s.cards[0]?.args).toBe('{"path":"foo.ts"}');
    expect(s.cards[1]?.args).toBe("");
  });

  it("sets the result on toolCallComplete", () => {
    let s = emptyAutoModeTurn();
    s = applyAutoModeEvent(s, {
      kind: "toolCallHeader",
      callId: "c1",
      name: "read_file",
    });
    s = applyAutoModeEvent(s, {
      kind: "toolCallComplete",
      callId: "c1",
      result: "file contents",
    });
    expect(s.cards[0]?.result).toBe("file contents");
  });

  it("flips done=true on done with the finishReason captured", () => {
    let s = emptyAutoModeTurn();
    s = applyAutoModeEvent(s, { kind: "done", finishReason: "stop" });
    expect(s.done).toBe(true);
    expect(s.finishReason).toBe("stop");
  });
});

describe("applyAutoModeEvents", () => {
  it("folds a full session stream end-to-end", () => {
    const events: readonly AutoModeEvent[] = [
      { kind: "token", text: "Reading file..." },
      { kind: "toolCallHeader", callId: "c1", name: "read_file" },
      { kind: "toolCallArgDelta", callId: "c1", delta: '{"path":"a.ts"}' },
      { kind: "toolCallComplete", callId: "c1", result: "ok" },
      { kind: "token", text: " Done." },
      { kind: "done", finishReason: "stop" },
    ];
    const state = applyAutoModeEvents(events);
    expect(state.text).toBe("Reading file... Done.");
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0]?.result).toBe("ok");
    expect(state.done).toBe(true);
    expect(state.finishReason).toBe("stop");
  });
});

describe("summarizeAutoModeTurn", () => {
  it("produces a stable string representation for parity assertions", () => {
    const events: readonly AutoModeEvent[] = [
      { kind: "token", text: "Hi" },
      { kind: "toolCallHeader", callId: "c1", name: "ls" },
      { kind: "toolCallComplete", callId: "c1", result: "files" },
      { kind: "done" },
    ];
    const sumA = summarizeAutoModeTurn(applyAutoModeEvents(events));
    const sumB = summarizeAutoModeTurn(applyAutoModeEvents(events));
    expect(sumA).toBe(sumB);
    expect(sumA).toContain("c1:ls::files");
    expect(sumA).toContain("done=true");
  });
});

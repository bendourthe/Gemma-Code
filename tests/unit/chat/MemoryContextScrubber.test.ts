import { describe, it, expect } from "vitest";
import { MemoryContextScrubber } from "../../../modules/coding/chat/MemoryContextScrubber.js";

function feedAll(chunks: string[]): string {
  const s = new MemoryContextScrubber();
  let out = "";
  for (const c of chunks) out += s.feed(c);
  out += s.flush();
  return out;
}

describe("MemoryContextScrubber", () => {
  it("passes text through unchanged when no tags are present", () => {
    expect(feedAll(["hello "]) + "").toBe("hello ");
    expect(feedAll(["hello ", "world"])).toBe("hello world");
  });

  it("strips a single complete memory-context span in one chunk", () => {
    expect(
      feedAll(["before <memory-context>secret stuff</memory-context> after"]),
    ).toBe("before  after");
  });

  it("strips a span split across two chunks at the open tag", () => {
    expect(
      feedAll(["before <memory-", "context>secret</memory-context> after"]),
    ).toBe("before  after");
  });

  it("strips a span split across two chunks at the close tag", () => {
    expect(
      feedAll(["before <memory-context>secret</memory-", "context> after"]),
    ).toBe("before  after");
  });

  it("strips a span split byte-by-byte across many chunks", () => {
    const full = "x<memory-context>y</memory-context>z";
    const chunks = Array.from(full); // 1 char per chunk
    expect(feedAll(chunks)).toBe("xz");
  });

  it("handles two consecutive spans in one chunk", () => {
    expect(
      feedAll([
        "a<memory-context>1</memory-context>b<memory-context>2</memory-context>c",
      ]),
    ).toBe("abc");
  });

  it("emits a partial-tag tail at EOF when the model never closed the tag", () => {
    // Model started typing `<memo` but never finished -> emit verbatim.
    expect(feedAll(["hello <memo"])).toBe("hello <memo");
  });

  it("drops an unfinished span at EOF (inside_span at flush)", () => {
    // Span opened but never closed -> content + tag are dropped.
    expect(feedAll(["before <memory-context>never-closed"])).toBe("before ");
  });

  it("passes non-memory-context tags through verbatim", () => {
    expect(feedAll(["plain <p>html</p> chunk"])).toBe("plain <p>html</p> chunk");
  });

  it("handles a literal `<` that turns out not to be a tag", () => {
    expect(feedAll(["a < b < c"])).toBe("a < b < c");
  });

  it("a stray close tag without an open is dropped silently", () => {
    // `</memory-context>` without a paired open -> the close is a no-op.
    expect(feedAll(["before </memory-context> after"])).toBe("before  after");
  });

  it("reset() returns the FSM to the outside state", () => {
    const s = new MemoryContextScrubber();
    s.feed("<memory-");
    expect(s.getState()).toBe("inside_tag");
    s.reset();
    expect(s.getState()).toBe("outside");
    expect(s.feed("hello")).toBe("hello");
  });

  it("getState transitions: outside -> inside_tag -> inside_span -> outside", () => {
    const s = new MemoryContextScrubber();
    expect(s.getState()).toBe("outside");
    s.feed("text<");
    expect(s.getState()).toBe("inside_tag");
    s.feed("memory-context>");
    expect(s.getState()).toBe("inside_span");
    s.feed("payload");
    expect(s.getState()).toBe("inside_span");
    s.feed("</memory-context>");
    expect(s.getState()).toBe("outside");
  });
});

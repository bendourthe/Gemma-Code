import { describe, it, expect } from "vitest";
import { deduplicate, DeduplicationStrategy } from "../../../../src/chat/strategies/deduplication.js";
import type { Message } from "../../../../src/chat/types.js";

let counter = 0;
function msg(role: Message["role"], content: string): Message {
  counter += 1;
  return { id: `msg-${counter}`, role, content, timestamp: counter };
}

function callBlock(toolName: string, args: Record<string, unknown>): string {
  // Build a Gemma 4 tool_call body matching what the parser expects.
  // We reuse the JSON-style nested object form which `extractNestedJsonValues`
  // recognises so the resulting parameters reproduce `args` exactly.
  const body = `args:${JSON.stringify(args).replace(/"/g, "\"")}`.replace(/\"(\w+)\":/g, "$1:");
  return `<|tool_call>call:${toolName}{${body}}<tool_call|>`;
}

function flatCallBlock(toolName: string, key: string, value: string): string {
  return `<|tool_call>call:${toolName}{${key}:<|"|>${value}<|"|>}<tool_call|>`;
}

function resultBlock(name: string, success: boolean, output: string): string {
  const payload = JSON.stringify({ name, response: { success, output } }, null, 2);
  return `<|tool_result>\n${payload}\n<tool_result|>`;
}

const CONFIG = { protectedTools: [], protectedFilePatterns: [] };

describe("deduplicate", () => {
  it("collapses two identical read_file calls and keeps the newer payload", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "first dump")),
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "second dump")),
    ];

    const out = deduplicate(messages, CONFIG);

    expect(out[1]?.content).toMatch(/\[deduplicated -- see message #/);
    expect(out[3]?.content).toContain("second dump");
  });

  it("keeps both reads when the path differs", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "foo dump")),
      msg("assistant", flatCallBlock("read_file", "path", "src/bar.ts")),
      msg("user", resultBlock("read_file", true, "bar dump")),
    ];

    const out = deduplicate(messages, CONFIG);

    expect(out[1]?.content).toContain("foo dump");
    expect(out[3]?.content).toContain("bar dump");
  });

  it("respects protectedFilePatterns and keeps duplicate reads of a watched path", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "first dump")),
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "second dump")),
    ];

    const out = deduplicate(messages, {
      protectedTools: [],
      protectedFilePatterns: ["src/foo.ts"],
    });

    expect(out[1]?.content).toContain("first dump");
    expect(out[3]?.content).toContain("second dump");
  });

  it("leaves errored tool results alone", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", false, "ENOENT")),
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "later success")),
    ];

    const out = deduplicate(messages, CONFIG);

    expect(out[1]?.content).toContain("ENOENT");
    expect(out[3]?.content).toContain("later success");
  });

  it("does not mutate the input array", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "first")),
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "second")),
    ];
    const snapshot = JSON.stringify(messages);
    deduplicate(messages, CONFIG);
    expect(JSON.stringify(messages)).toBe(snapshot);
  });
});

describe("DeduplicationStrategy", () => {
  const strat = new DeduplicationStrategy(CONFIG);

  it("canApply returns false on a fresh conversation", () => {
    const messages: Message[] = [
      msg("user", "hi"),
      msg("assistant", "hello"),
    ];
    expect(strat.canApply(messages)).toBe(false);
  });

  it("canApply returns true when two identical signatures exist", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "out1")),
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "out2")),
    ];
    expect(strat.canApply(messages)).toBe(true);
  });

  it("apply matches the pure deduplicate function", async () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "out1")),
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "out2")),
    ];
    const a = await strat.apply(messages);
    const b = deduplicate(messages, CONFIG);
    expect(a).toEqual(b);
  });
});

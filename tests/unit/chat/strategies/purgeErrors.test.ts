import { describe, it, expect } from "vitest";
import { purgeErrors, PurgeErrorsStrategy } from "../../../../src/chat/strategies/purgeErrors.js";
import type { Message } from "../../../../src/chat/types.js";

let counter = 0;
function msg(role: Message["role"], content: string): Message {
  counter += 1;
  return { id: `msg-${counter}`, role, content, timestamp: counter };
}

function flatCallBlock(toolName: string, key: string, value: string): string {
  return `<|tool_call>call:${toolName}{${key}:<|"|>${value}<|"|>}<tool_call|>`;
}

function resultBlock(name: string, success: boolean, output: string): string {
  const payload = JSON.stringify({ name, response: { success, output } }, null, 2);
  return `<|tool_result>\n${payload}\n<tool_result|>`;
}

describe("purgeErrors", () => {
  it("purges errored read_file args after N user-message turns", () => {
    const messages: Message[] = [
      msg("user", "do work"),
      msg("assistant", flatCallBlock("read_file", "path", "src/missing.ts")),
      msg("user", resultBlock("read_file", false, "ENOENT")),
      msg("user", "more work"),
      msg("user", "again"),
      msg("user", "again"),
      msg("user", "again"),
    ];

    const out = purgeErrors(messages, {
      protectedTools: [],
      errorPurgeTurns: 4,
    });

    const purged = out[1]?.content ?? "";
    expect(purged).toContain("purged:");
    expect(purged).toContain("originalSize:");
    // The error result message stays intact:
    expect(out[2]?.content).toContain("ENOENT");
  });

  it("keeps args when the call is younger than errorPurgeTurns", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/missing.ts")),
      msg("user", resultBlock("read_file", false, "ENOENT")),
      msg("user", "second"),
    ];

    const out = purgeErrors(messages, {
      protectedTools: [],
      errorPurgeTurns: 4,
    });
    expect(out[0]?.content).toBe(messages[0]!.content);
  });

  it("never purges protected tools", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("write_file", "path", "src/foo.ts")),
      msg("user", resultBlock("write_file", false, "EACCES")),
      msg("user", "1"),
      msg("user", "2"),
      msg("user", "3"),
      msg("user", "4"),
      msg("user", "5"),
    ];

    const out = purgeErrors(messages, {
      protectedTools: ["write_file"],
      errorPurgeTurns: 4,
    });
    expect(out[0]?.content).toBe(messages[0]!.content);
  });

  it("returns input untouched when no errored calls exist", () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/foo.ts")),
      msg("user", resultBlock("read_file", true, "ok")),
    ];
    const out = purgeErrors(messages, { protectedTools: [], errorPurgeTurns: 4 });
    expect(out).toEqual(messages);
  });
});

describe("PurgeErrorsStrategy", () => {
  it("apply matches purgeErrors", async () => {
    const messages: Message[] = [
      msg("assistant", flatCallBlock("read_file", "path", "src/missing.ts")),
      msg("user", resultBlock("read_file", false, "ENOENT")),
      msg("user", "1"),
      msg("user", "2"),
      msg("user", "3"),
      msg("user", "4"),
      msg("user", "5"),
    ];
    const config = { protectedTools: [], errorPurgeTurns: 4 };
    const strat = new PurgeErrorsStrategy(config);
    expect(strat.canApply(messages)).toBe(true);
    expect(await strat.apply(messages)).toEqual(purgeErrors(messages, config));
  });
});

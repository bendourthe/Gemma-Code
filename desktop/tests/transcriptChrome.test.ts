import { describe, expect, it } from "vitest";

import {
  calendarDayKey,
  formatBubbleTime,
  formatBubbleTokens,
  formatDateHeading,
  isoTimestampFromMillis,
  parseMessageTime,
} from "../src/shared/chat/transcriptChrome";

describe("transcriptChrome", () => {
  it("formats a once-per-day heading in the given locale", () => {
    const date = new Date(2026, 7, 24, 14, 15);
    expect(formatDateHeading(date, "en-US")).toBe("Monday, August 24, 2026");
    expect(calendarDayKey(date)).toBe("2026-08-24");
  });

  it("formats a discrete local time, not a relative clock", () => {
    const date = new Date(2026, 7, 24, 14, 15);
    expect(formatBubbleTime(date, "en-US")).toMatch(/2:15/);
    expect(formatBubbleTime(date, "en-US")).not.toMatch(/ago/);
  });

  it("skips missing and Unix-epoch timestamps", () => {
    expect(parseMessageTime(undefined)).toBeNull();
    expect(parseMessageTime("")).toBeNull();
    expect(parseMessageTime("not-a-date")).toBeNull();
    expect(parseMessageTime("1970-01-01T00:00:00.000Z")).toBeNull();
    expect(isoTimestampFromMillis(0)).toBeUndefined();
    expect(isoTimestampFromMillis(undefined)).toBeUndefined();
    expect(parseMessageTime(new Date(2026, 7, 24, 14, 15).toISOString())).not.toBeNull();
  });

  // v2.2.9 Phase 1.3 (T003): full-word token copy; unknown counts omit the
  // span (empty string), never an em dash and never a guessed 0.
  it("prints full-word user token copy with correct pluralization", () => {
    expect(formatBubbleTokens({ role: "user", inputTokens: 1 })).toBe("1 input token");
    expect(formatBubbleTokens({ role: "user", inputTokens: 12 })).toBe("12 input tokens");
    expect(formatBubbleTokens({ role: "user" })).toBe("");
  });

  it("sums assistant reasoning + output into a total when both are known", () => {
    expect(
      formatBubbleTokens({ role: "assistant", reasoningTokens: 75, outputTokens: 96 }),
    ).toBe("171 tokens (75 reasoning + 96 output)");
    expect(
      formatBubbleTokens({ role: "assistant", reasoningTokens: 12, outputTokens: 36 }),
    ).toBe("48 tokens (12 reasoning + 36 output)");
  });

  it("names the single known assistant part and omits unknown counts", () => {
    expect(formatBubbleTokens({ role: "assistant", outputTokens: 48 })).toBe("48 output tokens");
    expect(formatBubbleTokens({ role: "assistant", outputTokens: 1 })).toBe("1 output token");
    expect(formatBubbleTokens({ role: "assistant", reasoningTokens: 75 })).toBe(
      "75 reasoning tokens",
    );
    expect(formatBubbleTokens({ role: "assistant" })).toBe("");
    expect(formatBubbleTokens({ role: "system" })).toBe("");
  });

  it("keeps the new copy ASCII-only (no em dash)", () => {
    const samples = [
      formatBubbleTokens({ role: "user", inputTokens: 1 }),
      formatBubbleTokens({ role: "assistant", reasoningTokens: 75, outputTokens: 96 }),
      formatBubbleTokens({ role: "assistant", outputTokens: 48 }),
      formatBubbleTokens({ role: "assistant" }),
    ];
    for (const sample of samples) {
      expect(sample).not.toMatch(/[^\x20-\x7E]/);
    }
  });
});

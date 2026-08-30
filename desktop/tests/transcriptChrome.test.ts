import { describe, expect, it } from "vitest";

import {
  bubbleTokenMetadata,
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

  it("formats the compact total for user messages", () => {
    expect(formatBubbleTokens({ role: "user", inputTokens: 1 })).toBe("(1 token)");
    expect(formatBubbleTokens({ role: "user", inputTokens: 12 })).toBe("(12 tokens)");
    expect(formatBubbleTokens({ role: "user" })).toBe("");
  });

  it("sums all reported assistant parts without inventing missing fields", () => {
    expect(
      formatBubbleTokens({ role: "assistant", inputTokens: 10, reasoningTokens: 75, outputTokens: 96 }),
    ).toBe("(181 tokens)");
    expect(formatBubbleTokens({ role: "assistant", outputTokens: 48 })).toBe("(48 tokens)");
  });

  it("provides accessible details, unavailable labels, and estimate state", () => {
    expect(
      bubbleTokenMetadata({ role: "assistant", reasoningTokens: 75, tokensEstimated: true }),
    ).toEqual({
      total: 75,
      label: "(75 tokens)",
      detail: "Estimated. Input: unavailable. Reasoning: 75. Output: unavailable.",
    });
    expect(formatBubbleTokens({ role: "assistant" })).toBe("");
    expect(formatBubbleTokens({ role: "system" })).toBe("");
    expect(formatBubbleTokens({ role: "assistant", outputTokens: -2 })).toBe("");
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

import { describe, expect, it } from "vitest";

import {
  UNKNOWN_TOKEN_MARK,
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

  it("prints tokens by role and an em dash when unknown", () => {
    expect(formatBubbleTokens({ role: "user", inputTokens: 12 })).toBe("12 in");
    expect(formatBubbleTokens({ role: "user" })).toBe(UNKNOWN_TOKEN_MARK);
    expect(
      formatBubbleTokens({ role: "assistant", reasoningTokens: 12, outputTokens: 36 }),
    ).toBe("12 think + 36 out");
    expect(formatBubbleTokens({ role: "assistant", outputTokens: 48 })).toBe("48 out");
    expect(formatBubbleTokens({ role: "assistant" })).toBe(UNKNOWN_TOKEN_MARK);
  });
});

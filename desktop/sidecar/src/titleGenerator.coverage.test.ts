import { describe, expect, it } from "vitest";

import {
  fallbackTitle,
  generateChatTitle,
  sanitizeTitle,
} from "./chat/titleGenerator";

describe("fallbackTitle", () => {
  it("uses the first words of the prompt, or New session when empty", () => {
    expect(fallbackTitle("   ")).toBe("New session");
    expect(fallbackTitle("one two three four five six seven")).toBe(
      "one two three four five six",
    );
  });
});

describe("sanitizeTitle", () => {
  it("strips quotes, a Title prefix, and trailing punctuation", () => {
    expect(sanitizeTitle('Title: "Collapse the rail"')).toBe(
      "Collapse the rail",
    );
  });
});

describe("generateChatTitle", () => {
  it("returns the model title when the port answers with usable text", async () => {
    const result = await generateChatTitle(
      { chatId: "c1", firstMessage: "How do I collapse the sidebar?" },
      { titleModel: { complete: async () => "Sidebar collapse" } },
    );
    expect(result).toEqual({ title: "Sidebar collapse", source: "model" });
  });

  it("falls back when no model port is available", async () => {
    const result = await generateChatTitle({
      chatId: "c1",
      firstMessage: "How do I collapse the sidebar?",
    });
    expect(result.source).toBe("fallback");
    expect(result.title.length).toBeGreaterThan(1);
  });
});

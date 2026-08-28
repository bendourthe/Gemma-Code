/**
 * v2.2.9 Phase 3.2 (T008) -- composer usage meters image/video sessions
 * against the model's visualTokenBudget (denominatorKind "visual"), never an
 * invented LLM window.
 */

import { describe, expect, it } from "vitest";

import { composerSessionUsage } from "../src/shared/chat/usageTurnsFromMessages";
import type { ChatMessage } from "../src/shared/chat/types";

const IMAGE_MEDIA = { kind: "image" as const, src: "data:image/png;base64,PNG==" };

describe("composerSessionUsage (visual budget)", () => {
  it("meters generated media against maxImages with denominatorKind visual", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "a fox" },
      { id: "a1", role: "assistant", content: "", media: IMAGE_MEDIA },
    ];
    const usage = composerSessionUsage(messages, {
      contextWindow: null,
      visualTokenBudget: { maxImages: 4 },
    });
    expect(usage.denominatorKind).toBe("visual");
    expect(usage.usedTokens).toBe(1);
    expect(usage.percent).toBe(25);
    expect(usage.atOrAbove80).toBe(false);
  });

  it("uses maxVideoFrames when maxImages is absent (video rows)", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", content: "a fox" },
      { id: "a1", role: "assistant", content: "", media: { kind: "video", src: "mock://clip.mp4" } },
      { id: "a2", role: "assistant", content: "", media: { kind: "video", src: "mock://clip2.mp4" } },
    ];
    const usage = composerSessionUsage(messages, {
      contextWindow: null,
      visualTokenBudget: { maxVideoFrames: 8 },
    });
    expect(usage.denominatorKind).toBe("visual");
    expect(usage.usedTokens).toBe(2);
    expect(usage.percent).toBe(25);
  });

  it("skips pending bubbles so an in-flight generation does not count", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", content: "", media: IMAGE_MEDIA },
      { id: "a2", role: "assistant", content: "", pending: true },
    ];
    const usage = composerSessionUsage(messages, {
      contextWindow: null,
      visualTokenBudget: { maxImages: 2 },
    });
    expect(usage.usedTokens).toBe(1);
    expect(usage.percent).toBe(50);
  });

  it("has no denominator without a budget or window (never invents 128k)", () => {
    const messages: ChatMessage[] = [
      { id: "a1", role: "assistant", content: "", media: IMAGE_MEDIA },
    ];
    const usage = composerSessionUsage(messages, { contextWindow: null, visualTokenBudget: null });
    expect(usage.denominatorKind).toBe("none");
    expect(usage.percent).toBeNull();
  });
});

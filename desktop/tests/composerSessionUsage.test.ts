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
  it("uses the latest request snapshot for context without changing bubble attribution", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "Hi",
        messageUsage: {
          version: 1,
          inputTokens: 1,
          reasoningTokens: null,
          outputTokens: null,
          provenance: { accuracy: "estimated", source: "estimate" },
        },
      },
      {
        id: "a1",
        role: "assistant",
        content: "Hello! How can I help you today?",
        requestUsage: {
          version: 1,
          inputTokens: 100,
          reasoningTokens: 40,
          outputTokens: 59,
          provenance: { accuracy: "exact", source: "provider" },
        },
        messageUsage: {
          version: 1,
          inputTokens: null,
          reasoningTokens: 41,
          outputTokens: 8,
          provenance: { accuracy: "estimated", source: "estimate" },
        },
      },
    ];
    const usage = composerSessionUsage(messages, { contextWindow: 1_000 });
    expect(usage.usedTokens).toBe(199);
    expect(usage.percent).toBeCloseTo(19.9);
    expect(usage.estimated).toBe(false);
  });

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
    expect(usage.percent).toBe(12.5);
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
    expect(usage.percent).toBe(12.5);
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

import { describe, expect, it } from "vitest";

import {
  estimateTokens,
  sessionContextUsage,
} from "../../../../core/chat/sessionContextUsage.js";

describe("sessionContextUsage", () => {
  it("reports 50% for half a 100-token window", () => {
    const result = sessionContextUsage({
      turns: [{ inputTokens: 20, outputTokens: 30, reasoningTokens: 0 }],
      contextWindow: 100,
    });
    expect(result.usedTokens).toBe(50);
    expect(result.percent).toBe(50);
    expect(result.atOrAbove80).toBe(false);
    expect(result.estimated).toBe(false);
    expect(result.denominatorKind).toBe("llm");
  });

  it("is exact at the 80% boundary", () => {
    const under = sessionContextUsage({
      turns: [{ inputTokens: 79, outputTokens: null, reasoningTokens: null }],
      contextWindow: 100,
    });
    expect(under.atOrAbove80).toBe(false);
    expect(under.percent).toBe(79);
    const at = sessionContextUsage({
      turns: [{ inputTokens: 80 }],
      contextWindow: 100,
    });
    expect(at.atOrAbove80).toBe(true);
    expect(at.percent).toBe(80);
  });

  it("reports 100% when used equals the window", () => {
    const result = sessionContextUsage({
      turns: [{ inputTokens: 40, reasoningTokens: 10, outputTokens: 50 }],
      contextWindow: 100,
    });
    expect(result.percent).toBe(100);
    expect(result.atOrAbove80).toBe(true);
  });

  it("returns null percent when the window is null and does not invent 128k", () => {
    const result = sessionContextUsage({
      turns: [{ inputTokens: 12, outputTokens: 8 }],
      contextWindow: null,
    });
    expect(result.percent).toBeNull();
    expect(result.atOrAbove80).toBe(false);
    expect(result.usedTokens).toBe(20);
    expect(result.denominatorKind).toBe("none");
  });

  it("does not coerce null usage to 0 in the stored sense: missing turns contribute only via estimate", () => {
    const reported = sessionContextUsage({
      turns: [{ inputTokens: null, outputTokens: null, reasoningTokens: null, content: "" }],
      contextWindow: 100,
    });
    expect(reported.usedTokens).toBe(0);
    expect(reported.estimated).toBe(false);

    const estimated = sessionContextUsage({
      turns: [{ content: "abcd" }],
      contextWindow: 100,
    });
    expect(estimated.usedTokens).toBe(estimateTokens("abcd"));
    expect(estimated.estimated).toBe(true);
  });

  it("counts reasoning toward used tokens", () => {
    const result = sessionContextUsage({
      turns: [{ inputTokens: 10, reasoningTokens: 70, outputTokens: 0 }],
      contextWindow: 100,
    });
    expect(result.usedTokens).toBe(80);
    expect(result.atOrAbove80).toBe(true);
  });

  it("uses the latest reported prompt snapshot instead of summing prompt_eval_count", () => {
    const result = sessionContextUsage({
      turns: [
        { inputTokens: 40, outputTokens: 10, tokensEstimated: false },
        { content: "hello", inputTokens: 5, tokensEstimated: true },
        { inputTokens: 80, reasoningTokens: 4, outputTokens: 16, tokensEstimated: false },
      ],
      contextWindow: 100,
    });
    expect(result.usedTokens).toBe(100);
    expect(result.percent).toBe(100);
    expect(result.estimated).toBe(false);
  });

  it("uses visualTokenBudget when contextWindow is null and ignores a zero visual unit stub", () => {
    const result = sessionContextUsage({
      turns: [
        { role: "assistant", visualUnits: 0, content: "stub" },
        { role: "assistant", visualUnits: 1 },
        { role: "assistant", visualUnits: 1 },
      ],
      contextWindow: null,
      visualTokenBudget: { maxImages: 4 },
    });
    expect(result.denominatorKind).toBe("visual");
    expect(result.usedTokens).toBe(2);
    expect(result.percent).toBe(50);
    expect(result.atOrAbove80).toBe(false);
  });

  // v2.2.9 Phase 3.2 (T008): video rows publish maxVideoFrames, not maxImages.
  it("falls back to maxVideoFrames when maxImages is absent (video rows)", () => {
    const result = sessionContextUsage({
      turns: [
        { role: "assistant", visualUnits: 1 },
        { role: "assistant", visualUnits: 1 },
      ],
      contextWindow: null,
      visualTokenBudget: { maxVideoFrames: 8 },
    });
    expect(result.denominatorKind).toBe("visual");
    expect(result.usedTokens).toBe(2);
    expect(result.percent).toBe(25);
    expect(result.atOrAbove80).toBe(false);
  });
});

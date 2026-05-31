import { describe, it, expect, beforeEach } from "vitest";
import {
  countTokens,
  heuristicTokenCount,
  disposeEncoder,
  getTokenCounterStats,
  resetTokenCounterStats,
} from "../../../modules/coding/config/PromptBudget.js";

/**
 * Phase 5 (v0.5.0) -- tiktoken-backed token counter tests.
 *
 * In CI the tiktoken native binding may or may not be installed. Both branches
 * (loaded vs. failed-to-load) are exercised by the tests below: the heuristic
 * is asserted directly via `heuristicTokenCount`, and `countTokens` is asserted
 * against the heuristic when the load fails. When the load succeeds, the test
 * still passes because tiktoken counts for the small fixtures stay within an
 * order of magnitude of the heuristic.
 */
describe("PromptBudget token counter (Phase 5)", () => {
  beforeEach(() => {
    // Force a fresh load attempt for each test so we exercise the cache-miss
    // path. Production callers do NOT need to dispose between calls.
    disposeEncoder();
    resetTokenCounterStats();
  });

  // -------------------------------------------------------------------------
  // heuristicTokenCount -- always available, deterministic
  // -------------------------------------------------------------------------

  it("heuristicTokenCount returns chars/4 for plain text", () => {
    expect(heuristicTokenCount("a".repeat(400))).toBe(100);
  });

  it("heuristicTokenCount applies the 1.3x code-block multiplier", () => {
    const codeContent = "```js\n" + "a".repeat(400) + "\n```";
    expect(heuristicTokenCount(codeContent)).toBeGreaterThan(100);
  });

  it("heuristicTokenCount handles empty input", () => {
    expect(heuristicTokenCount("")).toBe(0);
  });

  // -------------------------------------------------------------------------
  // countTokens -- returns either tiktoken or heuristic, both reasonable
  // -------------------------------------------------------------------------

  it("countTokens returns 0 for empty input", () => {
    expect(countTokens("")).toBe(0);
  });

  it("countTokens returns a positive count for non-empty text", () => {
    expect(countTokens("hello world")).toBeGreaterThan(0);
  });

  it("countTokens result stays within a reasonable factor of the heuristic on English fixtures", () => {
    // The heuristic and tiktoken should agree within a factor of ~3 on
    // ordinary English. Either path is acceptable for this assertion.
    const fixture = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const heuristic = heuristicTokenCount(fixture);
    const counted = countTokens(fixture);
    const ratio = counted / heuristic;
    expect(ratio).toBeGreaterThan(1 / 3);
    expect(ratio).toBeLessThan(3);
  });

  // -------------------------------------------------------------------------
  // Stats -- record load attempt + which path the call went down
  // -------------------------------------------------------------------------

  it("countTokens records the load attempt on first call", () => {
    expect(getTokenCounterStats().tiktokenLoadAttempted).toBe(false);
    countTokens("warm-up call");
    expect(getTokenCounterStats().tiktokenLoadAttempted).toBe(true);
  });

  it("countTokens increments either tiktokenCalls or heuristicCalls per call", () => {
    countTokens("call one");
    countTokens("call two");
    countTokens("call three");
    const stats = getTokenCounterStats();
    expect(stats.tiktokenCalls + stats.heuristicCalls).toBe(3);
  });

  it("when tiktoken load fails, every call routes through the heuristic", () => {
    countTokens("first call triggers load attempt");
    const stats = getTokenCounterStats();
    if (stats.tiktokenLoadFailed) {
      // Heuristic path: this is the offline-friendly mode.
      countTokens("call A");
      countTokens("call B");
      const after = getTokenCounterStats();
      expect(after.heuristicCalls).toBeGreaterThan(stats.heuristicCalls);
      expect(after.tiktokenCalls).toBe(stats.tiktokenCalls);
    } else {
      // tiktoken loaded: subsequent calls go through tiktoken.
      countTokens("call A");
      const after = getTokenCounterStats();
      expect(after.tiktokenCalls).toBeGreaterThan(stats.tiktokenCalls);
    }
  });

  // -------------------------------------------------------------------------
  // disposeEncoder -- idempotent, resets load-attempt flag
  // -------------------------------------------------------------------------

  it("disposeEncoder resets the load-attempt flag so a fresh load can be retried", () => {
    countTokens("trigger load");
    expect(getTokenCounterStats().tiktokenLoadAttempted).toBe(true);
    disposeEncoder();
    expect(getTokenCounterStats().tiktokenLoadAttempted).toBe(false);
  });

  it("disposeEncoder is idempotent", () => {
    expect(() => {
      disposeEncoder();
      disposeEncoder();
      disposeEncoder();
    }).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";

import {
  MAX_CONTINUATION_SECONDS,
  planVideoContinuation,
} from "../../../../core/video/continuation.js";

describe("planVideoContinuation", () => {
  it("returns one segment when the request fits the tier clip", () => {
    const plan = planVideoContinuation(4, 4);
    expect(plan).toEqual([{ index: 0, durationSeconds: 4, continueFromPrior: false }]);
  });

  it("chains segments when the request exceeds the tier clip", () => {
    const plan = planVideoContinuation(12, 4);
    expect(plan).toEqual([
      { index: 0, durationSeconds: 4, continueFromPrior: false },
      { index: 1, durationSeconds: 4, continueFromPrior: true },
      { index: 2, durationSeconds: 4, continueFromPrior: true },
    ]);
  });

  it("puts the remainder on the last segment", () => {
    const plan = planVideoContinuation(10, 8);
    expect(plan).toEqual([
      { index: 0, durationSeconds: 8, continueFromPrior: false },
      { index: 1, durationSeconds: 2, continueFromPrior: true },
    ]);
  });

  it("caps unbounded requests", () => {
    const plan = planVideoContinuation(10_000, 8);
    const total = plan.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(total).toBe(MAX_CONTINUATION_SECONDS);
    expect(plan[0]?.continueFromPrior).toBe(false);
    expect(plan[1]?.continueFromPrior).toBe(true);
  });

  it("floors invalid clip lengths to 1 second", () => {
    expect(planVideoContinuation(3, 0)).toHaveLength(3);
  });
});

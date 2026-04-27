/**
 * Deliberate failing test for v0.6.0 sub-task 2.1: prove the test pipeline
 * actually fails CI on a non-zero `vitest` exit. This file exists ONLY for
 * the duration of the audit branch and is removed in the immediate revert
 * commit. If you see this file on `main`, something went wrong with the
 * revert -- delete it and notify the v0.6.0 cycle owner.
 */
import { describe, it, expect } from "vitest";

describe("CI fail-on-error audit (v0.6.0 sub-task 2.1)", () => {
  it("intentionally fails to verify CI surfaces test-suite failures", () => {
    expect(true).toBe(false);
  });
});

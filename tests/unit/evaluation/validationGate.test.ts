import { describe, it, expect } from "vitest";
import type { GoldenTaskResult } from "../../../modules/coding/evaluation/GoldenTaskSuite.js";
import { zeroSessionMetrics } from "../../../modules/coding/evaluation/GoldenTaskRunner.js";
import {
  evaluateValidationGate,
  validationGate,
} from "../../../modules/coding/evaluation/validationGate.js";

/**
 * v1.7.0 Phase 2 (adoption-self-optimizing-skills S4 / SO002) -- unit tests for
 * the held-out validation gate. Proves it accepts a net-positive edit, rejects
 * a regressing one, enforces the regression tolerance, and that the boolean
 * wrapper agrees with the detailed report.
 */

function result(taskId: string, passed: boolean): GoldenTaskResult {
  return {
    taskId,
    passed,
    traceId: "",
    metrics: zeroSessionMetrics(),
    failures: passed ? [] : ["x"],
    durationMs: 1,
  };
}

describe("evaluateValidationGate", () => {
  it("accepts a net-positive edit (pass rate up, no regression)", () => {
    const before = [result("a", false), result("b", true)];
    const after = [result("a", true), result("b", true)];
    const report = evaluateValidationGate(before, after);
    expect(report.accepted).toBe(true);
    expect(report.beforePassRate).toBeCloseTo(0.5);
    expect(report.afterPassRate).toBeCloseTo(1.0);
    expect(report.aggregateDelta).toBeCloseTo(0.5);
    expect(report.regressions).toHaveLength(0);
    expect(report.improvements).toEqual(["a"]);
    expect(report.reason).toMatch(/^accepted:/);
  });

  it("rejects a regressing edit (pass rate down)", () => {
    const before = [result("a", true), result("b", true)];
    const after = [result("a", false), result("b", true)];
    const report = evaluateValidationGate(before, after);
    expect(report.accepted).toBe(false);
    expect(report.aggregateDelta).toBeCloseTo(-0.5);
    expect(report.regressions.map((r) => r.taskId)).toEqual(["a"]);
    expect(report.regressions[0]).toMatchObject({ field: "passed", previous: 1, current: 0, regression: true });
    expect(report.reason).toMatch(/^rejected:/);
  });

  it("rejects a flat result (no aggregate improvement)", () => {
    const before = [result("a", true), result("b", false)];
    const after = [result("a", true), result("b", false)];
    const report = evaluateValidationGate(before, after);
    expect(report.accepted).toBe(false);
    expect(report.aggregateDelta).toBe(0);
    expect(report.reason).toMatch(/aggregate did not improve/);
  });

  it("enforces the per-task regression tolerance even when the aggregate improves", () => {
    // a,b improve fail->pass; c regresses pass->fail. Net pass rate 1/3 -> 2/3.
    const before = [result("a", false), result("b", false), result("c", true)];
    const after = [result("a", true), result("b", true), result("c", false)];

    const strict = evaluateValidationGate(before, after); // tolerance 0
    expect(strict.aggregateDelta).toBeGreaterThan(0);
    expect(strict.regressions.map((r) => r.taskId)).toEqual(["c"]);
    expect(strict.accepted).toBe(false);
    expect(strict.reason).toMatch(/regression\(s\) exceed tolerance 0/);

    const tolerant = evaluateValidationGate(before, after, { regressionTolerance: 1 });
    expect(tolerant.accepted).toBe(true);
  });

  it("honors a minimum aggregate-delta margin", () => {
    const before = [result("a", true), result("b", false), result("c", false), result("d", false), result("e", false)];
    const after = [result("a", true), result("b", true), result("c", false), result("d", false), result("e", false)];
    // delta = +0.2
    expect(evaluateValidationGate(before, after).accepted).toBe(true);
    expect(evaluateValidationGate(before, after, { minAggregateDelta: 0.2 }).accepted).toBe(false);
    expect(evaluateValidationGate(before, after, { minAggregateDelta: 0.1 }).accepted).toBe(true);
  });

  it("ignores tasks absent from the before batch for per-task analysis", () => {
    const before = [result("a", false)];
    const after = [result("a", true), result("b", true)];
    const report = evaluateValidationGate(before, after);
    // b has no before counterpart, so it is neither an improvement nor a regression.
    expect(report.improvements).toEqual(["a"]);
    expect(report.regressions).toHaveLength(0);
  });

  it("handles empty batches without throwing (no improvement -> reject)", () => {
    const report = evaluateValidationGate([], []);
    expect(report.accepted).toBe(false);
    expect(report.beforePassRate).toBe(0);
    expect(report.afterPassRate).toBe(0);
    expect(report.aggregateDelta).toBe(0);
  });
});

describe("validationGate (boolean wrapper)", () => {
  it("agrees with evaluateValidationGate.accepted", () => {
    const before = [result("a", false)];
    const after = [result("a", true)];
    expect(validationGate(before, after)).toBe(evaluateValidationGate(before, after).accepted);
    expect(validationGate(before, after)).toBe(true);
    expect(validationGate(after, before)).toBe(false); // reverse regresses
  });
});

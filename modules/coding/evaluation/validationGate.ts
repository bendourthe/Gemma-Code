// ---------------------------------------------------------------------------
// v1.7.0 Phase 2 (adoption-self-optimizing-skills S4 / SO002) -- held-out
// validation gate.
//
// The optimizer (Phase 3) may accept a skill edit ONLY when it improves the
// held-out `validation` split with no per-task regression beyond a tolerance.
// This is the pure comparator that decides that: given the scored
// `GoldenTaskResult`s before and after an edit (over the same validation
// split), it returns whether the edit clears the gate, plus a structured
// report (reusing the existing `RegressionReport` shape) the rejected-edit
// buffer records.
//
// It is a pure function: no I/O, no clock, no randomness. Boundary: vscode-free
// (mirrors the rest of `modules/coding/evaluation/`).
// ---------------------------------------------------------------------------

import type { GoldenTaskResult, RegressionReport } from "./GoldenTaskSuite.js";

export interface ValidationGateOptions {
  /**
   * The aggregate validation pass-rate delta must strictly EXCEED this to pass
   * (default 0 -- any improvement clears it, a flat or worse result does not).
   * Raise it to demand a minimum margin.
   */
  readonly minAggregateDelta?: number;
  /**
   * Maximum number of per-task pass->fail regressions tolerated (default 0 --
   * a single regression rejects the edit even when the aggregate improves).
   */
  readonly regressionTolerance?: number;
}

export interface ValidationGateReport {
  /** Whether the edit clears the gate (aggregate improved + regressions within tolerance). */
  readonly accepted: boolean;
  /** Validation pass rate before the edit (passed / total, 0 when empty). */
  readonly beforePassRate: number;
  /** Validation pass rate after the edit. */
  readonly afterPassRate: number;
  /** `afterPassRate - beforePassRate`. */
  readonly aggregateDelta: number;
  /** Per-task pass->fail regressions (each as a `RegressionReport`). */
  readonly regressions: readonly RegressionReport[];
  /** Task ids that went fail->pass. */
  readonly improvements: readonly string[];
  /** Human-readable verdict, suitable as a rejected-edit buffer reason. */
  readonly reason: string;
}

const DEFAULT_MIN_AGGREGATE_DELTA = 0;
const DEFAULT_REGRESSION_TOLERANCE = 0;

function passRate(results: readonly GoldenTaskResult[]): number {
  if (results.length === 0) return 0;
  const passed = results.reduce((n, r) => (r.passed ? n + 1 : n), 0);
  return passed / results.length;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
}

/**
 * Compare two scored validation batches and produce the gate report. `before`
 * and `after` are expected to cover the same validation split; per-task deltas
 * are computed over the tasks present in both (a task only in one batch cannot
 * be a regression or improvement and is ignored for per-task analysis, though
 * it still counts toward each batch's own pass rate).
 */
export function evaluateValidationGate(
  before: readonly GoldenTaskResult[],
  after: readonly GoldenTaskResult[],
  options: ValidationGateOptions = {},
): ValidationGateReport {
  const minAggregateDelta = options.minAggregateDelta ?? DEFAULT_MIN_AGGREGATE_DELTA;
  const regressionTolerance = options.regressionTolerance ?? DEFAULT_REGRESSION_TOLERANCE;

  const beforePassRate = passRate(before);
  const afterPassRate = passRate(after);
  const aggregateDelta = afterPassRate - beforePassRate;

  const beforeById = new Map<string, boolean>();
  for (const r of before) beforeById.set(r.taskId, r.passed);

  const regressions: RegressionReport[] = [];
  const improvements: string[] = [];
  for (const r of after) {
    const wasPassing = beforeById.get(r.taskId);
    if (wasPassing === undefined) continue; // not in the before batch; no comparison
    if (wasPassing && !r.passed) {
      regressions.push({
        taskId: r.taskId,
        field: "passed",
        previous: 1,
        current: 0,
        delta: -1,
        regression: true,
      });
    } else if (!wasPassing && r.passed) {
      improvements.push(r.taskId);
    }
  }

  const aggregateImproved = aggregateDelta > minAggregateDelta;
  const regressionsWithinTolerance = regressions.length <= regressionTolerance;
  const accepted = aggregateImproved && regressionsWithinTolerance;

  const reason = buildReason({
    accepted,
    beforePassRate,
    afterPassRate,
    aggregateDelta,
    aggregateImproved,
    minAggregateDelta,
    regressions,
    regressionsWithinTolerance,
    regressionTolerance,
    improvements,
  });

  return { accepted, beforePassRate, afterPassRate, aggregateDelta, regressions, improvements, reason };
}

function buildReason(ctx: {
  accepted: boolean;
  beforePassRate: number;
  afterPassRate: number;
  aggregateDelta: number;
  aggregateImproved: boolean;
  minAggregateDelta: number;
  regressions: readonly RegressionReport[];
  regressionsWithinTolerance: boolean;
  regressionTolerance: number;
  improvements: readonly string[];
}): string {
  const rate = `pass rate ${ctx.beforePassRate.toFixed(3)} -> ${ctx.afterPassRate.toFixed(3)} (delta ${signed(ctx.aggregateDelta)})`;
  if (ctx.accepted) {
    return `accepted: validation ${rate}; ${ctx.regressions.length} regression(s), ${ctx.improvements.length} improvement(s)`;
  }
  const causes: string[] = [];
  if (!ctx.aggregateImproved) {
    causes.push(`aggregate did not improve (delta ${signed(ctx.aggregateDelta)} <= min ${signed(ctx.minAggregateDelta)})`);
  }
  if (!ctx.regressionsWithinTolerance) {
    const ids = ctx.regressions.map((r) => r.taskId).join(", ");
    causes.push(`${ctx.regressions.length} per-task regression(s) exceed tolerance ${ctx.regressionTolerance} (${ids})`);
  }
  return `rejected: validation ${rate}; ${causes.join("; ")}`;
}

/**
 * The boolean gate the plan specifies (`validationGate(before, after) ->
 * boolean`). Thin wrapper over {@link evaluateValidationGate}; use the report
 * variant when the reason / deltas are needed (e.g. to record a rejection).
 */
export function validationGate(
  before: readonly GoldenTaskResult[],
  after: readonly GoldenTaskResult[],
  options: ValidationGateOptions = {},
): boolean {
  return evaluateValidationGate(before, after, options).accepted;
}

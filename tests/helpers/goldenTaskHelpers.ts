import type {
  GoldenTaskExpectation,
  GoldenTaskResult,
  RegressionReport,
} from "../../modules/coding/evaluation/GoldenTaskSuite.js";

export function validateExpectation(
  result: GoldenTaskResult,
  expectation: GoldenTaskExpectation,
): string[] {
  const failures: string[] = [];

  if (
    expectation.maxToolCalls !== undefined &&
    result.metrics.toolStepCount > expectation.maxToolCalls
  ) {
    failures.push(
      `Tool calls exceeded: ${result.metrics.toolStepCount} > ${expectation.maxToolCalls}`,
    );
  }

  if (
    expectation.maxDurationMs !== undefined &&
    result.durationMs > expectation.maxDurationMs
  ) {
    failures.push(
      `Duration exceeded: ${result.durationMs}ms > ${expectation.maxDurationMs}ms`,
    );
  }

  if (expectation.mustPass === true && !result.passed) {
    failures.push("Task marked mustPass but did not pass.");
  }

  return failures;
}

export function detectRegressions(
  previous: readonly GoldenTaskResult[],
  current: readonly GoldenTaskResult[],
  thresholdPct = 20,
): RegressionReport[] {
  const reports: RegressionReport[] = [];
  const prevMap = new Map(previous.map((r) => [r.taskId, r]));

  for (const curr of current) {
    const prev = prevMap.get(curr.taskId);
    if (!prev) continue;

    const fields: Array<{ field: string; prev: number; curr: number }> = [
      { field: "durationMs", prev: prev.durationMs, curr: curr.durationMs },
      {
        field: "toolStepCount",
        prev: prev.metrics.toolStepCount,
        curr: curr.metrics.toolStepCount,
      },
    ];

    for (const { field, prev: p, curr: c } of fields) {
      if (p === 0) continue;
      const delta = ((c - p) / p) * 100;
      const regression = delta > thresholdPct;
      if (regression) {
        reports.push({
          taskId: curr.taskId,
          field,
          previous: p,
          current: c,
          delta,
          regression,
        });
      }
    }

    if (prev.passed && !curr.passed) {
      reports.push({
        taskId: curr.taskId,
        field: "passed",
        previous: 1,
        current: 0,
        delta: -100,
        regression: true,
      });
    }
  }

  return reports;
}

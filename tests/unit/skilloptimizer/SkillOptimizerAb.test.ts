import { describe, it, expect } from "vitest";
import {
  decideSkillOptimizerDefault,
  runSkillOptimizerAb,
} from "../../../modules/coding/skilloptimizer/SkillOptimizerAb.js";
import { zeroSessionMetrics } from "../../../modules/coding/evaluation/GoldenTaskRunner.js";
import type { AbReport } from "../../../modules/coding/orchestration/PanelAbHarness.js";
import type { GoldenTaskResult } from "../../../modules/coding/evaluation/GoldenTaskSuite.js";
import type { GoldenTaskSpec } from "../../../modules/coding/evaluation/goldenTaskLoader.js";
import type { OptimizerRollout, SkillOverride } from "../../../modules/coding/skilloptimizer/types.js";

/**
 * v1.7.0 Phase 3 (adoption-self-optimizing-skills S6 / SO004) -- unit tests for
 * the optimizer-quality A/B: it measures the baseline (single arm) against the
 * optimized skill (panel arm) over the validation split, and the default-on gate
 * flips only on a measured net win (mirroring the Fusion F4 OF011 gate).
 */

function spec(id: string): GoldenTaskSpec {
  return {
    id,
    name: id,
    category: "refactor",
    description: `do ${id}`,
    initialState: `snapshots/${id}`,
    expectedFilesChanged: [],
    successCriteria: [],
    maxIterations: 5,
    timeoutSeconds: 60,
    modelTier: "any",
    tags: [],
  };
}

function res(taskId: string, passed: boolean, durationMs = 10): GoldenTaskResult {
  return { taskId, passed, traceId: "", metrics: zeroSessionMetrics(), failures: passed ? [] : ["x"], durationMs };
}

/** Rollout where the optimized arm (override present) passes and the baseline fails. */
function improvingRollout(): OptimizerRollout {
  return {
    run: async (tasks: readonly GoldenTaskSpec[], override?: SkillOverride) =>
      tasks.map((t) => res(t.id, override !== undefined)),
  };
}

function report(over: Partial<AbReport>): AbReport {
  return {
    comparisons: [],
    panelWins: 0,
    singleWins: 0,
    ties: 0,
    aggregateQualityDelta: 0,
    latencyMultiplier: 1,
    taskCount: 0,
    ...over,
  };
}

describe("runSkillOptimizerAb", () => {
  it("scores the optimized skill against the baseline over the validation split", async () => {
    const ab = await runSkillOptimizerAb(
      { skillId: "skill-x", validation: [spec("v1"), spec("v2")], optimizedBody: "better body" },
      improvingRollout(),
    );
    expect(ab.taskCount).toBe(2);
    expect(ab.panelWins).toBe(2); // optimized arm wins both
    expect(ab.singleWins).toBe(0);
    expect(ab.aggregateQualityDelta).toBeCloseTo(1.0);
    expect(ab.latencyMultiplier).toBeCloseTo(1.0);
  });
});

describe("decideSkillOptimizerDefault", () => {
  it("flips default-on only on a net win at acceptable quality and latency", () => {
    const decision = decideSkillOptimizerDefault(
      report({ panelWins: 4, singleWins: 1, aggregateQualityDelta: 0.3, latencyMultiplier: 1.2, taskCount: 5 }),
    );
    expect(decision.enableByDefault).toBe(true);
    expect(decision.rationale).toMatch(/net win/);
  });

  it("stays opt-in (off) when there is no net win", () => {
    const decision = decideSkillOptimizerDefault(
      report({ panelWins: 1, singleWins: 3, aggregateQualityDelta: -0.1, latencyMultiplier: 1, taskCount: 4 }),
    );
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toMatch(/no net win/);
  });

  it("stays opt-in (off) when the quality delta is below the bar despite winning", () => {
    const decision = decideSkillOptimizerDefault(
      report({ panelWins: 3, singleWins: 2, aggregateQualityDelta: 0.01, latencyMultiplier: 1, taskCount: 5 }),
    );
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toMatch(/quality delta/);
  });

  it("stays opt-in (off) when latency exceeds the bound", () => {
    const decision = decideSkillOptimizerDefault(
      report({ panelWins: 5, singleWins: 0, aggregateQualityDelta: 0.5, latencyMultiplier: 9, taskCount: 5 }),
    );
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toMatch(/latency/);
  });

  it("stays opt-in (off) with no tasks", () => {
    const decision = decideSkillOptimizerDefault(report({ taskCount: 0 }));
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toMatch(/no A\/B tasks/);
  });
});

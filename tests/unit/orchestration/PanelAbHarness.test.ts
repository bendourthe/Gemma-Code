import { describe, it, expect } from "vitest";
import {
  buildAbReport,
  clampQuality,
  compareArm,
  decidePanelRoutingDefault,
  DEFAULT_PANEL_ROUTING_POLICY,
  measurePanelRun,
  runAbHarness,
  scoreByKeywords,
  type AbMeasurement,
  type AbRunners,
  type AbTask,
  type AbTaskComparison,
} from "../../../modules/coding/orchestration/PanelAbHarness.js";
import type { PanelRunResult } from "../../../modules/coding/orchestration/PanelExecutor.js";

// v1.6.0 adoption-openrouter-fusion Phase 4 (OF010 + OF012). The local A/B
// harness measures a small-model panel against the single best resident model
// on Nexus coding tasks and derives whether the budget-panel routing default
// may flip on. Pure aggregation + decision: no live model.

const TASK: AbTask = { id: "t1", prompt: "Write a parser.", category: "code" };

function m(quality: number, latencyMs: number): AbMeasurement {
  return { quality, latencyMs };
}

describe("PanelAbHarness -- scoring helpers (OF010)", () => {
  it("clampQuality bounds into [0,1] and maps NaN to 0", () => {
    expect(clampQuality(0.5)).toBe(0.5);
    expect(clampQuality(-1)).toBe(0);
    expect(clampQuality(2)).toBe(1);
    expect(clampQuality(Number.NaN)).toBe(0);
  });

  it("scoreByKeywords returns the case-insensitive fraction present", () => {
    expect(scoreByKeywords("anything", [])).toBe(1);
    expect(scoreByKeywords("throw on bad input", ["throw", "input"])).toBe(1);
    expect(scoreByKeywords("throw on bad data", ["throw", "input"])).toBe(0.5);
    expect(scoreByKeywords("THROW now", [" throw "])).toBe(1); // trim + case
    expect(scoreByKeywords("nothing here", ["absent"])).toBe(0);
  });
});

describe("PanelAbHarness -- per-task comparison (OF010)", () => {
  it("scores a panel win when the panel quality clears the tie epsilon", () => {
    const c = compareArm(TASK, m(0.6, 100), m(0.9, 250), 0.05);
    expect(c.verdict).toBe("panel-win");
    expect(c.qualityDelta).toBeCloseTo(0.3);
    expect(c.latencyMultiplier).toBeCloseTo(2.5);
    expect(c.category).toBe("code");
  });

  it("scores a single win when the single quality is higher", () => {
    const c = compareArm(TASK, m(0.9, 100), m(0.6, 300));
    expect(c.verdict).toBe("single-win");
    expect(c.qualityDelta).toBeCloseTo(-0.3);
  });

  it("scores a tie inside the epsilon band", () => {
    const c = compareArm(TASK, m(0.8, 100), m(0.82, 100), 0.05);
    expect(c.verdict).toBe("tie");
  });

  it("treats a zero single latency as a 1x multiplier (no divide-by-zero)", () => {
    const c = compareArm(TASK, m(0.5, 0), m(0.5, 0));
    expect(c.latencyMultiplier).toBe(1);
  });

  it("omits category when the task has none", () => {
    const c = compareArm({ id: "t2", prompt: "p" }, m(0.5, 100), m(0.5, 100));
    expect(c.category).toBeUndefined();
  });
});

describe("PanelAbHarness -- panel-run measurement (OF010)", () => {
  it("scores a panel run's fused output and pairs it with the measured latency", () => {
    const run = {
      candidates: [],
      fusion: {
        fusedOutput: "## Fused answer\nUse a Set to preserve order; O(n).",
        schemaValid: true,
        judgeModel: "judge",
        fusedCandidateCount: 2,
      },
      dispatched: ["m1", "m2"],
      skipped: [],
      succeeded: 2,
      failed: 0,
    } satisfies PanelRunResult;

    const measurement = measurePanelRun(run, 250, (fused) =>
      scoreByKeywords(fused, ["set", "order", "complexity"]),
    );

    // "set" + "order" present, "complexity" absent -> 2/3, clamped into [0,1].
    expect(measurement.quality).toBeCloseTo(2 / 3);
    expect(measurement.latencyMs).toBe(250);
  });
});

describe("PanelAbHarness -- aggregation (OF010)", () => {
  it("aggregates wins, ties, mean quality delta, and latency multiplier", () => {
    const comparisons: AbTaskComparison[] = [
      compareArm({ id: "a", prompt: "p" }, m(0.5, 100), m(0.9, 200)), // panel win
      compareArm({ id: "b", prompt: "p" }, m(0.9, 100), m(0.5, 200)), // single win
      compareArm({ id: "c", prompt: "p" }, m(0.7, 100), m(0.7, 200)), // tie
    ];
    const report = buildAbReport(comparisons);
    expect(report.taskCount).toBe(3);
    expect(report.panelWins).toBe(1);
    expect(report.singleWins).toBe(1);
    expect(report.ties).toBe(1);
    // deltas: +0.4, -0.4, 0 -> mean 0
    expect(report.aggregateQualityDelta).toBeCloseTo(0);
    // panel 600 / single 300 -> 2x
    expect(report.latencyMultiplier).toBeCloseTo(2);
  });

  it("returns neutral aggregates for an empty comparison set", () => {
    const report = buildAbReport([]);
    expect(report.taskCount).toBe(0);
    expect(report.aggregateQualityDelta).toBe(0);
    expect(report.latencyMultiplier).toBe(1);
  });
});

describe("PanelAbHarness -- end-to-end run (OF010 acceptance)", () => {
  it("runs both arms per task and emits a structured report", async () => {
    const tasks: AbTask[] = [
      { id: "t1", prompt: "p1" },
      { id: "t2", prompt: "p2" },
    ];
    const runners: AbRunners = {
      // async arm
      runSingle: async (t) => (t.id === "t1" ? m(0.5, 100) : m(0.6, 100)),
      // sync arm
      runPanel: (t) => (t.id === "t1" ? m(0.9, 220) : m(0.95, 220)),
    };

    const report = await runAbHarness(tasks, runners, { tieEpsilon: 0.05 });

    expect(report.taskCount).toBe(2);
    expect(report.comparisons.map((c) => c.taskId)).toEqual(["t1", "t2"]);
    expect(report.panelWins).toBe(2);
    expect(report.singleWins).toBe(0);
    expect(report.aggregateQualityDelta).toBeGreaterThan(0);
    expect(report.latencyMultiplier).toBeGreaterThan(1);
  });
});

describe("PanelAbHarness -- routing-default decision (OF011 gate / OF012)", () => {
  it("enables by default on a clear net win within the latency bound", () => {
    const report = buildAbReport([
      compareArm({ id: "a", prompt: "p" }, m(0.5, 100), m(0.9, 150)),
      compareArm({ id: "b", prompt: "p" }, m(0.6, 100), m(0.85, 150)),
    ]);
    const decision = decidePanelRoutingDefault(report);
    expect(decision.enableByDefault).toBe(true);
    expect(decision.rationale).toContain("net win");
  });

  it("stays opt-in when the panel does not net-win", () => {
    const report = buildAbReport([
      compareArm({ id: "a", prompt: "p" }, m(0.9, 100), m(0.5, 150)),
      compareArm({ id: "b", prompt: "p" }, m(0.9, 100), m(0.95, 150)),
    ]);
    const decision = decidePanelRoutingDefault(report);
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("no net win");
  });

  it("stays opt-in when the quality delta is below the policy bar", () => {
    // Panel wins both, but only marginally (delta 0.02 < 0.05).
    const report = buildAbReport([
      compareArm({ id: "a", prompt: "p" }, m(0.50, 100), m(0.52, 150)),
      compareArm({ id: "b", prompt: "p" }, m(0.60, 100), m(0.62, 150)),
    ]);
    const decision = decidePanelRoutingDefault(report);
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("below");
  });

  it("stays opt-in when the latency multiplier exceeds the bound", () => {
    const report = buildAbReport([
      compareArm({ id: "a", prompt: "p" }, m(0.5, 100), m(0.95, 500)),
      compareArm({ id: "b", prompt: "p" }, m(0.5, 100), m(0.95, 500)),
    ]);
    const decision = decidePanelRoutingDefault(report);
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("exceeds");
  });

  it("stays opt-in for an empty A/B run", () => {
    const decision = decidePanelRoutingDefault(buildAbReport([]));
    expect(decision.enableByDefault).toBe(false);
    expect(decision.rationale).toContain("no A/B tasks");
  });

  it("exposes a conservative default policy", () => {
    expect(DEFAULT_PANEL_ROUTING_POLICY.minAggregateQualityDelta).toBeGreaterThan(0);
    expect(DEFAULT_PANEL_ROUTING_POLICY.maxLatencyMultiplier).toBeGreaterThanOrEqual(1);
  });
});

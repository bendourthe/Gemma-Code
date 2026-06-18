/**
 * PanelAbHarness -- the local A/B harness for the budget-panel claim (F4).
 *
 * v1.6.0 adoption-openrouter-fusion Phase 4 (OF010). OpenRouter reports a budget
 * panel landing within ~1% of a frontier model; that claim is `vendor-reported`
 * and **unproven** for small *local* models on Nexus coding tasks. Before the
 * budget-panel routing heuristic (OF011) is allowed to default to on, a local
 * A/B must show a net quality win at acceptable latency. This module is that
 * measurement: it runs a fixed set of Nexus coding tasks twice -- once on the
 * single best resident model, once on a small-model panel via the
 * `FusionAgent`/`PanelExecutor` path -- and compares quality and wall-clock
 * latency per task and in aggregate.
 *
 * Local-only, no live cloud. The measurement (model dispatch + timing) is the
 * injected `AbRunners`' concern; this module is pure aggregation + the
 * default-state decision, so every branch is testable without a model and the
 * live wiring (the `tests/benchmarks/panel-ab.bench.ts` runner) stays thin.
 *
 * F5 -- eval integrity. An `AbTask` carries only the `prompt` the model sees;
 * the scoring oracle (expected keywords / a judge rubric) lives in the runner
 * and is NEVER concatenated into the prompt. Combined with the F2/F5 guarantee
 * that panelists get no tools, this is the local analogue of OpenRouter's
 * source-exclusion fix for the DRACO rubric leak: no panelist can reach the
 * reference answer, and the harness never leaks the expected output into the
 * model's context.
 */

import type { PanelRunResult } from "./PanelExecutor.js";

// ---------------------------------------------------------------------------
// Task + measurement types
// ---------------------------------------------------------------------------

/** One A/B task. Carries only what the model sees -- never the scoring oracle. */
export interface AbTask {
  readonly id: string;
  /** The exact prompt fed to both arms. Contains no reference / expected answer. */
  readonly prompt: string;
  /** Optional category label surfaced in the report (e.g. `refactor`, `bugfix`). */
  readonly category?: string;
}

/** One arm's outcome on one task: a quality score and a wall-clock latency. */
export interface AbMeasurement {
  /** Quality in [0,1] (assertion pass-rate or a local judge rubric score). */
  readonly quality: number;
  /** Wall-clock latency in milliseconds. */
  readonly latencyMs: number;
}

export type AbVerdict = "panel-win" | "single-win" | "tie";

/** The single-vs-panel comparison for one task. */
export interface AbTaskComparison {
  readonly taskId: string;
  readonly category?: string;
  readonly single: AbMeasurement;
  readonly panel: AbMeasurement;
  readonly verdict: AbVerdict;
  /** `panel.quality - single.quality`. */
  readonly qualityDelta: number;
  /** `panel.latencyMs / single.latencyMs` (1 when single latency is 0). */
  readonly latencyMultiplier: number;
}

/** The aggregate A/B report across all tasks. */
export interface AbReport {
  readonly comparisons: readonly AbTaskComparison[];
  readonly panelWins: number;
  readonly singleWins: number;
  readonly ties: number;
  /** Mean of `panel.quality - single.quality` across tasks. */
  readonly aggregateQualityDelta: number;
  /** Total panel latency / total single latency (1 when single total is 0). */
  readonly latencyMultiplier: number;
  readonly taskCount: number;
}

// ---------------------------------------------------------------------------
// Pure scoring helpers
// ---------------------------------------------------------------------------

/** Clamp a raw quality score into the [0,1] band. */
export function clampQuality(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * A deterministic, local assertion scorer: the fraction of `requiredKeywords`
 * present in `answer` (case-insensitive). Empty keyword sets score 1 (nothing
 * to satisfy). This is one valid OF010 quality oracle -- "task-specific
 * assertions" -- and it lives outside the prompt (F5 eval integrity).
 */
export function scoreByKeywords(
  answer: string,
  requiredKeywords: readonly string[],
): number {
  if (requiredKeywords.length === 0) return 1;
  const haystack = answer.toLowerCase();
  const hits = requiredKeywords.filter((kw) =>
    haystack.includes(kw.toLowerCase().trim()),
  ).length;
  return clampQuality(hits / requiredKeywords.length);
}

/**
 * Build the panel-arm measurement from a completed `PanelExecutor` run: score
 * the fused output with a local oracle (kept out of the prompt -- F5) and pair
 * it with the caller-measured wall-clock latency. The single arm has no
 * structured result to adapt, so it builds its `AbMeasurement` directly.
 */
export function measurePanelRun(
  run: PanelRunResult,
  latencyMs: number,
  score: (fusedOutput: string) => number,
): AbMeasurement {
  return { quality: clampQuality(score(run.fusion.fusedOutput)), latencyMs };
}

// ---------------------------------------------------------------------------
// Comparison + aggregation
// ---------------------------------------------------------------------------

/**
 * Compare one task's two arms into a verdict. A win requires the quality delta
 * to exceed `tieEpsilon` in magnitude; within the epsilon band the task is a
 * tie (so trivial floating-point noise never counts as a win).
 */
export function compareArm(
  task: AbTask,
  single: AbMeasurement,
  panel: AbMeasurement,
  tieEpsilon = 0,
): AbTaskComparison {
  const qualityDelta = panel.quality - single.quality;
  const epsilon = Math.max(0, tieEpsilon);
  let verdict: AbVerdict;
  if (qualityDelta > epsilon) verdict = "panel-win";
  else if (qualityDelta < -epsilon) verdict = "single-win";
  else verdict = "tie";
  const latencyMultiplier =
    single.latencyMs > 0 ? panel.latencyMs / single.latencyMs : 1;
  return {
    taskId: task.id,
    ...(task.category !== undefined ? { category: task.category } : {}),
    single,
    panel,
    verdict,
    qualityDelta,
    latencyMultiplier,
  };
}

/** Aggregate per-task comparisons into the whole-run report. */
export function buildAbReport(
  comparisons: readonly AbTaskComparison[],
): AbReport {
  const taskCount = comparisons.length;
  let panelWins = 0;
  let singleWins = 0;
  let ties = 0;
  let qualitySum = 0;
  let panelLatency = 0;
  let singleLatency = 0;
  for (const c of comparisons) {
    if (c.verdict === "panel-win") panelWins += 1;
    else if (c.verdict === "single-win") singleWins += 1;
    else ties += 1;
    qualitySum += c.qualityDelta;
    panelLatency += c.panel.latencyMs;
    singleLatency += c.single.latencyMs;
  }
  return {
    comparisons,
    panelWins,
    singleWins,
    ties,
    aggregateQualityDelta: taskCount > 0 ? qualitySum / taskCount : 0,
    latencyMultiplier: singleLatency > 0 ? panelLatency / singleLatency : 1,
    taskCount,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** The two arms under test. Each returns a quality + latency measurement. */
export interface AbRunners {
  /** Run a task on the single best resident model. */
  runSingle(task: AbTask): Promise<AbMeasurement> | AbMeasurement;
  /** Run a task on the small-model panel (via the FusionAgent path). */
  runPanel(task: AbTask): Promise<AbMeasurement> | AbMeasurement;
}

export interface RunAbHarnessOptions {
  /** Quality-delta magnitude below which a task is a tie. Default 0. */
  readonly tieEpsilon?: number;
}

/**
 * Run the A/B over `tasks`: each task is measured on both arms, compared, and
 * aggregated into a report. Tasks run in order; both arms of a task complete
 * before the next task starts (so a single GPU is never asked to hold both
 * arms' models at once).
 */
export async function runAbHarness(
  tasks: readonly AbTask[],
  runners: AbRunners,
  options: RunAbHarnessOptions = {},
): Promise<AbReport> {
  const comparisons: AbTaskComparison[] = [];
  for (const task of tasks) {
    const single = await runners.runSingle(task);
    const panel = await runners.runPanel(task);
    comparisons.push(compareArm(task, single, panel, options.tieEpsilon));
  }
  return buildAbReport(comparisons);
}

// ---------------------------------------------------------------------------
// Default-state decision (the OF011 gate)
// ---------------------------------------------------------------------------

/** Thresholds that gate flipping `nexus.llm.panelRouting` on by default. */
export interface PanelRoutingDefaultPolicy {
  /** Minimum mean quality delta (panel - single) to justify default-on. */
  readonly minAggregateQualityDelta: number;
  /** Maximum acceptable aggregate latency multiplier (panel / single). */
  readonly maxLatencyMultiplier: number;
}

export interface PanelRoutingDefaultDecision {
  readonly enableByDefault: boolean;
  readonly rationale: string;
}

/**
 * Default policy for the budget-panel routing default. A panel must win a clear
 * majority of tasks AND clear a meaningful quality bar AND not be ruinously
 * slower. Conservative by construction: when in doubt, stay opt-in.
 */
export const DEFAULT_PANEL_ROUTING_POLICY: PanelRoutingDefaultPolicy = {
  minAggregateQualityDelta: 0.05,
  maxLatencyMultiplier: 3,
};

/**
 * Derive whether `nexus.llm.panelRouting` should default to on from an A/B
 * report. The default flips to on ONLY when the panel shows a net win: more
 * panel wins than single wins, a mean quality delta clearing the policy bar,
 * and an aggregate latency multiplier within the acceptable bound. Otherwise it
 * stays opt-in (off) and the rationale records why -- the no-degradation gate.
 */
export function decidePanelRoutingDefault(
  report: AbReport,
  policy: PanelRoutingDefaultPolicy = DEFAULT_PANEL_ROUTING_POLICY,
): PanelRoutingDefaultDecision {
  if (report.taskCount === 0) {
    return {
      enableByDefault: false,
      rationale: "no A/B tasks were run; default stays opt-in (off)",
    };
  }
  const netWin = report.panelWins > report.singleWins;
  const qualityOk = report.aggregateQualityDelta >= policy.minAggregateQualityDelta;
  const latencyOk = report.latencyMultiplier <= policy.maxLatencyMultiplier;
  if (netWin && qualityOk && latencyOk) {
    return {
      enableByDefault: true,
      rationale:
        `panel net win: ${report.panelWins} wins vs ${report.singleWins} losses, ` +
        `mean quality delta ${report.aggregateQualityDelta.toFixed(3)} ` +
        `(>= ${policy.minAggregateQualityDelta}), latency ` +
        `${report.latencyMultiplier.toFixed(2)}x (<= ${policy.maxLatencyMultiplier}x)`,
    };
  }
  const reasons: string[] = [];
  if (!netWin) {
    reasons.push(
      `no net win (${report.panelWins} panel wins vs ${report.singleWins} single wins)`,
    );
  }
  if (!qualityOk) {
    reasons.push(
      `quality delta ${report.aggregateQualityDelta.toFixed(3)} below ${policy.minAggregateQualityDelta}`,
    );
  }
  if (!latencyOk) {
    reasons.push(
      `latency ${report.latencyMultiplier.toFixed(2)}x exceeds ${policy.maxLatencyMultiplier}x`,
    );
  }
  return {
    enableByDefault: false,
    rationale: `default stays opt-in (off): ${reasons.join("; ")}`,
  };
}

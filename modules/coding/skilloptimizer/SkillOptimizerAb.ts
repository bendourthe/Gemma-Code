// ---------------------------------------------------------------------------
// v1.7.0 Phase 3 (adoption-self-optimizing-skills S6 / SO004) -- the
// optimizer-quality A/B.
//
// The article's reported gains (+23.5 / +24.8) used a FRONTIER optimizer model;
// whether a small RESIDENT model produces net-positive skill edits on Nexus
// coding tasks is unproven (`candidate`) and must be measured locally before the
// optimizer is trusted to default on. This reuses the v1.6.0 Fusion F4
// `PanelAbHarness` (pure aggregation + the no-degradation default gate),
// mapping its two arms onto skills:
//
//   single arm  = the unedited BASELINE skill
//   panel arm   = the OPTIMIZED skill (the candidate body)
//
// Quality is the held-out validation pass signal (1 = passed, 0 = failed) and
// latency is the rollout wall-clock, both produced by the same `OptimizerRollout`
// seam the loop uses. `decideSkillOptimizerDefault` flips the opt-in default to
// on ONLY on a measured net win (more optimized wins than baseline wins, a
// quality delta clearing the bar, latency within bound) -- otherwise it stays
// opt-in (off) and records why, mirroring the Fusion F4 budget-panel discipline.
//
// Boundary: vscode-free; pure aggregation over the injected rollout.
// ---------------------------------------------------------------------------

import {
  buildAbReport,
  compareArm,
  type AbMeasurement,
  type AbReport,
  type AbTask,
  type RunAbHarnessOptions,
} from "../orchestration/PanelAbHarness.js";
import type { GoldenTaskSpec } from "../evaluation/goldenTaskLoader.js";
import type { OptimizerRollout } from "./types.js";

/** Inputs for the optimizer-quality A/B: baseline vs the optimized skill body. */
export interface SkillAbInput {
  readonly skillId: string;
  /** Held-out validation split both arms are measured on. */
  readonly validation: readonly GoldenTaskSpec[];
  /** The optimized skill body (the candidate the loop produced). */
  readonly optimizedBody: string;
}

/** Measure one task on one arm: pass -> quality 1, fail -> 0; latency = wall-clock. */
async function measureOne(
  rollout: OptimizerRollout,
  spec: GoldenTaskSpec,
  override?: { skillId: string; body: string },
): Promise<AbMeasurement> {
  const results = await rollout.run([spec], override);
  const result = results[0];
  return {
    quality: result?.passed ? 1 : 0,
    latencyMs: result?.durationMs ?? 0,
  };
}

/**
 * Run the optimizer-quality A/B over the validation split, comparing the
 * baseline skill (single arm) against the optimized skill (panel arm). Runs each
 * task on both arms in order (a single GPU never holds both at once) and
 * aggregates into an {@link AbReport}.
 */
export async function runSkillOptimizerAb(
  input: SkillAbInput,
  rollout: OptimizerRollout,
  options: RunAbHarnessOptions = {},
): Promise<AbReport> {
  const comparisons = [];
  for (const spec of input.validation) {
    const task: AbTask = { id: spec.id, prompt: spec.description, category: spec.category };
    const baseline = await measureOne(rollout, spec);
    const optimized = await measureOne(rollout, spec, { skillId: input.skillId, body: input.optimizedBody });
    comparisons.push(compareArm(task, baseline, optimized, options.tieEpsilon));
  }
  return buildAbReport(comparisons);
}

// ---------------------------------------------------------------------------
// Default-state decision (the SO004 gate -- mirrors the Fusion F4 OF011 gate)
// ---------------------------------------------------------------------------

/** Thresholds that gate flipping `nexus.coding.skillOptimizer.enabled` on by default. */
export interface SkillOptimizerDefaultPolicy {
  /** Minimum mean quality delta (optimized - baseline) to justify default-on. */
  readonly minAggregateQualityDelta: number;
  /** Maximum acceptable aggregate latency multiplier (optimized / baseline). */
  readonly maxLatencyMultiplier: number;
}

export interface SkillOptimizerDefaultDecision {
  readonly enableByDefault: boolean;
  readonly rationale: string;
}

/**
 * Default policy: the optimized skill must win a clear majority of validation
 * tasks, clear a meaningful quality bar, and not be ruinously slower.
 * Conservative by construction -- when in doubt, stay opt-in.
 */
export const DEFAULT_SKILL_OPTIMIZER_POLICY: SkillOptimizerDefaultPolicy = {
  minAggregateQualityDelta: 0.05,
  maxLatencyMultiplier: 3,
};

/**
 * Decide whether the skill optimizer should default to on. In the A/B report,
 * the "panel" arm is the optimized skill and the "single" arm is the baseline,
 * so `panelWins` counts tasks the optimized skill won. The default flips on ONLY
 * on a net win at acceptable latency; otherwise it stays opt-in (off) and the
 * rationale records why -- the no-degradation gate.
 */
export function decideSkillOptimizerDefault(
  report: AbReport,
  policy: SkillOptimizerDefaultPolicy = DEFAULT_SKILL_OPTIMIZER_POLICY,
): SkillOptimizerDefaultDecision {
  if (report.taskCount === 0) {
    return {
      enableByDefault: false,
      rationale: "no A/B tasks were run; the optimizer stays opt-in (off)",
    };
  }
  const netWin = report.panelWins > report.singleWins;
  const qualityOk = report.aggregateQualityDelta >= policy.minAggregateQualityDelta;
  const latencyOk = report.latencyMultiplier <= policy.maxLatencyMultiplier;
  if (netWin && qualityOk && latencyOk) {
    return {
      enableByDefault: true,
      rationale:
        `optimized skill net win: ${report.panelWins} wins vs ${report.singleWins} baseline wins, ` +
        `mean quality delta ${report.aggregateQualityDelta.toFixed(3)} (>= ${policy.minAggregateQualityDelta}), ` +
        `latency ${report.latencyMultiplier.toFixed(2)}x (<= ${policy.maxLatencyMultiplier}x)`,
    };
  }
  const reasons: string[] = [];
  if (!netWin) {
    reasons.push(`no net win (${report.panelWins} optimized wins vs ${report.singleWins} baseline wins)`);
  }
  if (!qualityOk) {
    reasons.push(`quality delta ${report.aggregateQualityDelta.toFixed(3)} below ${policy.minAggregateQualityDelta}`);
  }
  if (!latencyOk) {
    reasons.push(`latency ${report.latencyMultiplier.toFixed(2)}x exceeds ${policy.maxLatencyMultiplier}x`);
  }
  return {
    enableByDefault: false,
    rationale: `the optimizer stays opt-in (off): ${reasons.join("; ")}`,
  };
}

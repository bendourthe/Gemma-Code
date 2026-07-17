// ---------------------------------------------------------------------------
// v1.12.0 Phase 1 (adoption-ecosystem-2026-07 H1) -- the harness-selector A/B.
//
// The per-model scaffold profiles ([HarnessSelector.ts]) are heuristic until
// measured. This reuses the v1.6.0 Fusion F4 `PanelAbHarness` (pure aggregation
// + the no-degradation default gate) to measure, on a held-out golden split for
// a given (typically weak / quantized) model, whether the SELECTED scaffold
// beats the one-size DEFAULT scaffold. It maps the harness's two arms onto
// scaffolds:
//
//   single arm  = the one-size DEFAULT scaffold (today's behavior)
//   panel arm   = the per-model SELECTED scaffold
//
// Quality is the golden-task pass signal (1 = passed, 0 = failed) and latency is
// the rollout wall-clock -- both produced by the same injected `HarnessRollout`
// seam (the real driver is wired at the composition root, deferred like the v1.7
// SO001.P1.A rollout). `decideHarnessDefault` flips the opt-in default on ONLY
// on a measured net win at acceptable latency -- otherwise it stays opt-in
// (off), the SO003.P3.A discipline. No live weak-model A/B has been run here, so
// {@link HARNESS_SELECTOR_SHIPPED_DEFAULT} ships false.
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
} from "./PanelAbHarness.js";
import type { GoldenTaskSpec } from "../evaluation/goldenTaskLoader.js";
import {
  DEFAULT_HARNESS_PROFILE,
  HarnessSelector,
  defaultHarnessSelector,
  toPromptOverlay,
  type HarnessPromptOverlay,
} from "./HarnessSelector.js";

/** One golden-task rollout outcome under a given scaffold overlay. */
export interface HarnessRolloutResult {
  readonly passed: boolean;
  readonly durationMs: number;
}

/** Runs one golden task under a given prompt/tool overlay; the real driver is composition-root-wired. */
export interface HarnessRollout {
  run(spec: GoldenTaskSpec, overlay: HarnessPromptOverlay): Promise<HarnessRolloutResult>;
}

/** Inputs for the harness A/B: the model under test + its held-out validation split. */
export interface HarnessAbInput {
  /** The model whose SELECTED scaffold is the panel arm. */
  readonly modelName: string;
  /** Held-out validation split both arms are measured on. */
  readonly validation: readonly GoldenTaskSpec[];
}

/** Measure one task on one arm: pass -> quality 1, fail -> 0; latency = wall-clock. */
async function measureOne(
  rollout: HarnessRollout,
  spec: GoldenTaskSpec,
  overlay: HarnessPromptOverlay,
): Promise<AbMeasurement> {
  const result = await rollout.run(spec, overlay);
  return { quality: result.passed ? 1 : 0, latencyMs: result.durationMs };
}

/**
 * Run the harness A/B over the validation split, comparing the one-size default
 * scaffold (single arm) against the model's selected scaffold (panel arm). Runs
 * each task on both arms in order (a single GPU never holds both at once) and
 * aggregates into an {@link AbReport}.
 */
export async function runHarnessAb(
  input: HarnessAbInput,
  rollout: HarnessRollout,
  selector: HarnessSelector = defaultHarnessSelector,
  options: RunAbHarnessOptions = {},
): Promise<AbReport> {
  const baselineOverlay = toPromptOverlay(DEFAULT_HARNESS_PROFILE);
  const selectedOverlay = selector.overlayForModel(input.modelName);
  const comparisons = [];
  for (const spec of input.validation) {
    const task: AbTask = { id: spec.id, prompt: spec.description, category: spec.category };
    const baseline = await measureOne(rollout, spec, baselineOverlay);
    const selected = await measureOne(rollout, spec, selectedOverlay);
    comparisons.push(compareArm(task, baseline, selected, options.tieEpsilon));
  }
  return buildAbReport(comparisons);
}

// ---------------------------------------------------------------------------
// Default-state decision (the H1 gate -- mirrors the SO004 / OF011 gate)
// ---------------------------------------------------------------------------

/** Thresholds that gate flipping `nexus.coding.harnessSelector.enabled` on by default. */
export interface HarnessSelectorDefaultPolicy {
  /** Minimum mean quality delta (selected - default) to justify default-on. */
  readonly minAggregateQualityDelta: number;
  /** Maximum acceptable aggregate latency multiplier (selected / default). */
  readonly maxLatencyMultiplier: number;
}

export interface HarnessSelectorDefaultDecision {
  readonly enableByDefault: boolean;
  readonly rationale: string;
}

/**
 * Default policy: the selected scaffold must win a clear majority of validation
 * tasks, clear a meaningful quality bar, and not be materially slower (it is the
 * same model, so latency should be near-parity). Conservative by construction --
 * when in doubt, stay opt-in.
 */
export const DEFAULT_HARNESS_SELECTOR_POLICY: HarnessSelectorDefaultPolicy = {
  minAggregateQualityDelta: 0.05,
  maxLatencyMultiplier: 1.5,
};

/**
 * The single source of truth for whether the harness selector ships on by
 * default. False until a live weak-model A/B produces a `decideHarnessDefault`
 * net win -- the no-degradation / SO003.P3.A discipline.
 */
export const HARNESS_SELECTOR_SHIPPED_DEFAULT = false;

/**
 * Decide whether the harness selector should default to on. In the A/B report
 * the "panel" arm is the selected scaffold and the "single" arm is the default
 * scaffold, so `panelWins` counts tasks the selected scaffold won. The default
 * flips on ONLY on a net win at acceptable latency; otherwise it stays opt-in
 * (off) and the rationale records why -- the no-degradation gate.
 */
export function decideHarnessDefault(
  report: AbReport,
  policy: HarnessSelectorDefaultPolicy = DEFAULT_HARNESS_SELECTOR_POLICY,
): HarnessSelectorDefaultDecision {
  if (report.taskCount === 0) {
    return {
      enableByDefault: false,
      rationale: "no A/B tasks were run; the harness selector stays opt-in (off)",
    };
  }
  const netWin = report.panelWins > report.singleWins;
  const qualityOk = report.aggregateQualityDelta >= policy.minAggregateQualityDelta;
  const latencyOk = report.latencyMultiplier <= policy.maxLatencyMultiplier;
  if (netWin && qualityOk && latencyOk) {
    return {
      enableByDefault: true,
      rationale:
        `selected scaffold net win: ${report.panelWins} wins vs ${report.singleWins} default wins, ` +
        `mean quality delta ${report.aggregateQualityDelta.toFixed(3)} (>= ${policy.minAggregateQualityDelta}), ` +
        `latency ${report.latencyMultiplier.toFixed(2)}x (<= ${policy.maxLatencyMultiplier}x)`,
    };
  }
  const reasons: string[] = [];
  if (!netWin) {
    reasons.push(`no net win (${report.panelWins} selected wins vs ${report.singleWins} default wins)`);
  }
  if (!qualityOk) {
    reasons.push(`quality delta ${report.aggregateQualityDelta.toFixed(3)} below ${policy.minAggregateQualityDelta}`);
  }
  if (!latencyOk) {
    reasons.push(`latency ${report.latencyMultiplier.toFixed(2)}x exceeds ${policy.maxLatencyMultiplier}x`);
  }
  return {
    enableByDefault: false,
    rationale: `the harness selector stays opt-in (off): ${reasons.join("; ")}`,
  };
}

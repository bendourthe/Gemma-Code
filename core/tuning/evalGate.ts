/**
 * v2.1.0 Phase 5 -- adapter vs base golden-task gate.
 *
 * Quarantine when the adapter score drops more than `maxRegression` below the
 * base. The runner is injected so this module never imports modules/coding.
 */

export interface EvalScores {
  readonly base: number;
  readonly adapter: number;
}

export type EvalDecision = "pass" | "quarantine";

export function decideEvalGate(
  scores: EvalScores,
  maxRegression = 0.05,
): { decision: EvalDecision; delta: number } {
  const delta = scores.adapter - scores.base;
  if (delta < -Math.abs(maxRegression)) {
    return { decision: "quarantine", delta };
  }
  return { decision: "pass", delta };
}

export interface EvalPort {
  score(modelId: string): Promise<number>;
}

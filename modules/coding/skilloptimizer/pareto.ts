// ---------------------------------------------------------------------------
// v1.7.0 Phase 4 (adoption-self-optimizing-skills S3 / SO005) -- the pure
// Pareto / EvoSkill selection core.
//
// The evolutionary layer's algorithm, reverse-engineered as a lean local module
// (no DSPy / GEPA / EvoSkill dependency): given candidates each scored across a
// diverse task set, compute the non-dominated (Pareto) set -- candidates that no
// other candidate beats on every task -- and expose the held-out extremes the
// bounded population's replacement rule needs (evict the lowest, surface the
// highest).
//
// Pure functions only: no I/O, no clock, no randomness. Boundary: vscode-free
// (mirrors the rest of `modules/coding/skilloptimizer/`). The frontier
// orchestrator composes these; they are unit-tested directly over fixture score
// matrices.
// ---------------------------------------------------------------------------

import type { CandidateScore, PerTaskScores } from "./types.js";

/**
 * True when `a` Pareto-dominates `b`: `a` is >= `b` on every task they share and
 * strictly greater on at least one. Only tasks present in BOTH vectors are
 * compared (a candidate scored on a different task set cannot dominate). When the
 * shared task set is empty, neither dominates (returns false).
 */
export function dominates(a: PerTaskScores, b: PerTaskScores): boolean {
  const sharedKeys = Object.keys(a).filter((k) => Object.prototype.hasOwnProperty.call(b, k));
  if (sharedKeys.length === 0) return false;
  let strictlyBetterSomewhere = false;
  for (const key of sharedKeys) {
    const av = a[key]!;
    const bv = b[key]!;
    if (av < bv) return false; // worse on some task -> cannot dominate
    if (av > bv) strictlyBetterSomewhere = true;
  }
  return strictlyBetterSomewhere;
}

/**
 * The non-dominated (Pareto) set: the candidate ids not dominated by any other
 * candidate. Diverse winners -- each strong on a different subset of tasks --
 * all survive; candidates with identical vectors are mutually non-dominated and
 * both survive. The returned ids preserve the input order.
 */
export function paretoFrontier(scores: readonly CandidateScore[]): string[] {
  const frontier: string[] = [];
  for (const candidate of scores) {
    const dominated = scores.some(
      (other) =>
        other.candidateId !== candidate.candidateId &&
        dominates(other.perTask, candidate.perTask),
    );
    if (!dominated) frontier.push(candidate.candidateId);
  }
  return frontier;
}

/**
 * The candidate with the LOWEST held-out score (the replacement rule's eviction
 * target). Ties are broken deterministically by the lexicographically smallest
 * candidate id. Returns undefined for an empty input.
 */
export function lowestByHeldOut(
  scores: readonly CandidateScore[],
): CandidateScore | undefined {
  let lowest: CandidateScore | undefined;
  for (const candidate of scores) {
    if (lowest === undefined || isLower(candidate, lowest)) lowest = candidate;
  }
  return lowest;
}

/**
 * The candidate with the HIGHEST held-out score (the winner to surface for
 * approval), optionally restricted to `allowedIds` (e.g. the Pareto frontier).
 * Ties are broken deterministically by the lexicographically smallest candidate
 * id. Returns undefined when no candidate is eligible.
 */
export function highestByHeldOut(
  scores: readonly CandidateScore[],
  allowedIds?: ReadonlySet<string>,
): CandidateScore | undefined {
  let highest: CandidateScore | undefined;
  for (const candidate of scores) {
    if (allowedIds !== undefined && !allowedIds.has(candidate.candidateId)) continue;
    if (highest === undefined || isHigher(candidate, highest)) highest = candidate;
  }
  return highest;
}

function isLower(candidate: CandidateScore, incumbent: CandidateScore): boolean {
  if (candidate.heldOut < incumbent.heldOut) return true;
  if (candidate.heldOut > incumbent.heldOut) return false;
  return candidate.candidateId < incumbent.candidateId; // deterministic tie-break
}

function isHigher(candidate: CandidateScore, incumbent: CandidateScore): boolean {
  if (candidate.heldOut > incumbent.heldOut) return true;
  if (candidate.heldOut < incumbent.heldOut) return false;
  return candidate.candidateId < incumbent.candidateId; // deterministic tie-break
}

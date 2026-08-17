/**
 * One primary motion per surface (v1.17.0 Phase 5). Highest listed kind wins.
 * Components must not re-decide this order locally.
 */

export type MotionKind = "orb" | "metal" | "beam" | "aurora";

/** Flagship agent-state first, then hero action, then surface liveness, then aurora wash. */
export const MOTION_PRECEDENCE: readonly MotionKind[] = ["orb", "metal", "beam", "aurora"];

export function primaryMotion(candidates: readonly MotionKind[]): MotionKind | null {
  if (candidates.length === 0) return null;
  const present = new Set(candidates);
  for (const kind of MOTION_PRECEDENCE) {
    if (present.has(kind)) return kind;
  }
  return null;
}

export function allowsMotion(kind: MotionKind, candidates: readonly MotionKind[]): boolean {
  return primaryMotion(candidates) === kind;
}

/** Composer: streaming beam owns liveness; focus metal owns the hero send; idle is quiet. */
export function composerMotionCandidates(input: {
  streaming: boolean;
  focused: boolean;
}): MotionKind[] {
  if (input.streaming) return ["beam"];
  if (input.focused) return ["metal"];
  return [];
}

/** Model dock: working/loading orb; idle ready beam. */
export function dockMotionCandidates(input: { idle: boolean; loading?: boolean }): MotionKind[] {
  if (input.loading) return ["orb"];
  if (input.idle) return ["beam"];
  return ["orb"];
}

/**
 * Retained generation canvas lists every effect it used to stack; the winner
 * is always orb, so the beam pauses and aurora halts.
 */
export const GENERATION_CANVAS_CANDIDATES: readonly MotionKind[] = ["orb", "beam", "aurora"];

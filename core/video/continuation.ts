/**
 * v2.0.0 Phase 3 -- split a requested clip length into per-tier segments.
 *
 * Video models still generate one short clip at a time (`clipSeconds` from
 * `DiffusionTier`). Minutes-long output is a chain of those clips, each
 * conditioned on the prior segment's ending frames. This helper is the
 * planner; the sidecar and TimelinePreviewer consume the plan.
 */

export interface ContinuationSegmentPlan {
  readonly index: number;
  readonly durationSeconds: number;
  readonly continueFromPrior: boolean;
}

/** Hard cap so a typo cannot enqueue an unbounded GPU queue. */
export const MAX_CONTINUATION_SECONDS = 120;

export function planVideoContinuation(
  requestedSeconds: number,
  clipSeconds: number,
): readonly ContinuationSegmentPlan[] {
  const clip = Math.max(1, Math.floor(Number.isFinite(clipSeconds) ? clipSeconds : 1));
  const raw = Number.isFinite(requestedSeconds) ? requestedSeconds : 1;
  const requested = Math.min(MAX_CONTINUATION_SECONDS, Math.max(1, Math.floor(raw)));
  const segments: ContinuationSegmentPlan[] = [];
  let remaining = requested;
  let index = 0;
  while (remaining > 0) {
    const durationSeconds = Math.min(clip, remaining);
    segments.push({
      index,
      durationSeconds,
      continueFromPrior: index > 0,
    });
    remaining -= durationSeconds;
    index += 1;
  }
  return segments;
}

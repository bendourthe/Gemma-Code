/**
 * Shared cap on simultaneously animating metal rings (v1.17.0 Phase 4).
 * Hero controls share one GPU budget so a busy screen cannot open an
 * unbounded number of WebGL contexts.
 */

export const METAL_INSTANCE_CAP = 3;

let active = 0;

export function metalActiveCount(): number {
  return active;
}

export function tryAcquireMetalSlot(): boolean {
  if (active >= METAL_INSTANCE_CAP) return false;
  active += 1;
  return true;
}

export function releaseMetalSlot(): void {
  if (active > 0) active -= 1;
}

/** Test seam. */
export function resetMetalRegistry(): void {
  active = 0;
}

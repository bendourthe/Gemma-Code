/**
 * v2.1.0 Phase 2 -- model-swap cost model for routing escalations.
 *
 * Pure: no TelemetryBus, no GpuScheduler queue. The scheduler consults this
 * before honoring an EscalationPolicy model change so a single consumer GPU
 * does not OOM by loading the strong model on top of a resident worker or an
 * active diffusion job.
 *
 * Boundary: core/** (no modules/**).
 */

export type SwapOutcome = "honored" | "deferred" | "degraded";

export interface ModelSwapInput {
  /** Incumbent model VRAM (GB). 0 when unknown. */
  readonly fromVramGB: number;
  /** Target model VRAM (GB). */
  readonly toVramGB: number;
  /**
   * Free VRAM in GB. null / non-finite means telemetry is unavailable and
   * the swap must assume worst-case occupancy (defer, never guess a fit).
   */
  readonly freeVramGB: number | null;
  /** Module of the currently running GPU job, if any. */
  readonly activeModule?: "coding" | "chat" | "image" | "video" | null;
  /** True when an image/video generation job is occupying the GPU. */
  readonly diffusionActive?: boolean;
  /** True when the cheap worker is believed still resident. */
  readonly workerResident?: boolean;
}

export interface ModelSwapDecision {
  readonly outcome: SwapOutcome;
  /** Keep the worker loaded alongside the strong model when both fit. */
  readonly keepWorkerResident: boolean;
  readonly reason: string;
}

function finiteGb(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/**
 * Decide whether a routing model swap may proceed on a single GPU.
 *
 * - worker+strong fit: honor, keep worker resident.
 * - worker+strong do not fit: honor, evict the worker.
 * - diffusion occupying VRAM that would OOM the swap: defer (never kill).
 * - missing VRAM telemetry: defer (worst-case occupancy).
 * - coding vs diffusion contention when both are queued: coding wins the
 *   occupancy claim; the diffusion job stays queued, not killed.
 */
export function evaluateModelSwap(input: ModelSwapInput): ModelSwapDecision {
  const toVram = Math.max(0, input.toVramGB);
  const fromVram = Math.max(0, input.fromVramGB);
  const free = finiteGb(input.freeVramGB);

  if (free === null) {
    return {
      outcome: "deferred",
      keepWorkerResident: Boolean(input.workerResident),
      reason: "vram-telemetry-unavailable",
    };
  }

  const diffusionActive =
    input.diffusionActive === true ||
    input.activeModule === "image" ||
    input.activeModule === "video";

  if (diffusionActive && free < toVram) {
    return {
      outcome: "deferred",
      keepWorkerResident: Boolean(input.workerResident),
      reason: "diffusion-occupying-vram",
    };
  }

  if (input.workerResident === true) {
    if (free >= toVram) {
      return {
        outcome: "honored",
        keepWorkerResident: true,
        reason: "both-fit-keep-worker",
      };
    }
    if (free + fromVram >= toVram) {
      return {
        outcome: "honored",
        keepWorkerResident: false,
        reason: "evict-worker-for-strong",
      };
    }
    return {
      outcome: "deferred",
      keepWorkerResident: true,
      reason: "insufficient-free-vram",
    };
  }

  if (free < toVram) {
    return {
      outcome: "deferred",
      keepWorkerResident: false,
      reason: "insufficient-free-vram",
    };
  }

  return {
    outcome: "honored",
    keepWorkerResident: false,
    reason: "swap-fits",
  };
}

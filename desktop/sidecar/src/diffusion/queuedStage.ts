/**
 * v2.4.8 follow-up (2026-09-07) -- the `queued` stage for a studio job.
 *
 * A studio job that has not reached the Python runtime yet produces no
 * events, and the bubble read that silence as "Loading model..." for as long
 * as the GPU was held elsewhere (operator report: over twenty minutes at 0%
 * GPU with the chat model resident). While the job still waits in the
 * generation queue or behind another module in the GPU scheduler, the
 * drainEvents handler synthesizes a `queued` progress event naming the
 * module holding the GPU, so the shell can say "Waiting for GPU" honestly.
 */

import type { DiffusionEvent } from "./runtimeClient.js";

/** The two studio surfaces the decision reads; kept structural for tests. */
export interface QueuedStageSources {
  readonly scheduler: {
    snapshot(): {
      readonly active: { readonly id: string; readonly moduleId: string } | null;
      readonly queued: ReadonlyArray<{ readonly id: string }>;
    };
  };
  readonly queue: {
    get(id: string): { readonly state: string } | undefined | null;
  };
}

export function queuedStageEvent(
  studio: QueuedStageSources | undefined,
  jobId: string,
): DiffusionEvent | null {
  if (!studio) return null;
  const snap = studio.scheduler.snapshot();
  // The runtime owns it now; any silence from here is the runtime's to fill.
  if (snap.active?.id === jobId) return null;
  const waitingInQueue = studio.queue.get(jobId)?.state === "queued";
  const waitingForGpu = snap.queued.some((entry) => entry.id === jobId);
  if (!waitingInQueue && !waitingForGpu) return null;
  return {
    kind: "progress",
    jobId,
    stage: "queued",
    ...(snap.active ? { blockedBy: snap.active.moduleId } : {}),
  };
}

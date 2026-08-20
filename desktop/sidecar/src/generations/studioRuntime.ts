/**
 * v2.1.0 Phase 3 -- sidecar studio runtime (index + queue + completion cache).
 *
 * Tests inject `:memory:` stores via HandlerContext. Production opens
 * `~/.nexus/generations/studio.db`.
 */

import { GenerationIndex } from "../../../../core/generations/GenerationIndex.js";
import { GenerationQueue } from "../../../../core/generations/GenerationQueue.js";
import { GpuScheduler } from "../../../../core/scheduler/GpuScheduler.js";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";
import type { DiffusionEvent } from "../diffusion/runtimeClient.js";

export interface StudioRuntime {
  readonly index: GenerationIndex;
  readonly queue: GenerationQueue;
  readonly scheduler: GpuScheduler;
  readonly completions: Map<string, DiffusionEvent[]>;
}

export function createStudioRuntime(opts: {
  readonly dbPath?: string;
  readonly vramGB?: number;
} = {}): StudioRuntime {
  const dbPath = opts.dbPath ?? ":memory:";
  const bus = new InProcessTelemetryBus();
  return {
    index: new GenerationIndex({ dbPath }),
    queue: new GenerationQueue({ dbPath }),
    scheduler: new GpuScheduler({
      telemetry: bus,
      vramProvider: () => opts.vramGB ?? 24,
    }),
    completions: new Map(),
  };
}

export function recordCompletion(studio: StudioRuntime, event: DiffusionEvent): void {
  const queue = studio.completions.get(event.jobId) ?? [];
  queue.push(event);
  studio.completions.set(event.jobId, queue);
}

export function takeCompletions(studio: StudioRuntime, jobId: string): DiffusionEvent[] {
  const queued = studio.completions.get(jobId) ?? [];
  studio.completions.delete(jobId);
  return queued;
}

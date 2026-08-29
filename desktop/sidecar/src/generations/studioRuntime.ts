/**
 * v2.1.0 Phase 3 -- sidecar studio runtime (index + queue + completion cache).
 *
 * Tests inject `:memory:` stores via HandlerContext. Production opens
 * `~/.nexus/generations/studio.db`.
 */

import { GenerationIndex } from "../../../../core/generations/GenerationIndex.js";
import { GenerationQueue } from "../../../../core/generations/GenerationQueue.js";
import { GenerationDatabase } from "../../../../core/generations/GenerationDatabase.js";
import {
  GpuScheduler,
  type JobHandle,
} from "../../../../core/scheduler/GpuScheduler.js";
import {
  InProcessTelemetryBus,
  type TelemetryBus,
} from "../../../../core/telemetry/TelemetryBus.js";
import type { DiffusionEvent } from "../diffusion/runtimeClient.js";

export interface StudioRuntime {
  readonly database: GenerationDatabase;
  readonly index: GenerationIndex;
  readonly queue: GenerationQueue;
  readonly scheduler: GpuScheduler;
  readonly completions: Map<string, DiffusionEvent[]>;
  readonly activeHandles: Map<string, JobHandle>;
  readonly pump: {
    active: Promise<void> | null;
    requested: boolean;
    closing: boolean;
  };
}

export function createStudioRuntime(
  opts: {
    readonly dbPath?: string;
    readonly vramGB?: number;
    readonly telemetry?: TelemetryBus;
  } = {},
): StudioRuntime {
  const dbPath = opts.dbPath ?? ":memory:";
  const bus = opts.telemetry ?? new InProcessTelemetryBus();
  const database = new GenerationDatabase({ dbPath });
  return {
    database,
    index: new GenerationIndex({ database }),
    queue: new GenerationQueue({ database }),
    scheduler: new GpuScheduler({
      telemetry: bus,
      vramProvider: () => opts.vramGB ?? 24,
    }),
    completions: new Map(),
    activeHandles: new Map(),
    pump: { active: null, requested: false, closing: false },
  };
}

export function beginStudioRuntimeShutdown(studio: StudioRuntime): void {
  studio.pump.closing = true;
  studio.pump.requested = false;
  for (const handle of studio.activeHandles.values()) handle.cancel();
}

export async function closeStudioRuntime(
  studio: StudioRuntime,
  timeoutMs = 2_000,
): Promise<void> {
  beginStudioRuntimeShutdown(studio);
  if (studio.pump.active) {
    await Promise.race([
      studio.pump.active.catch(() => undefined),
      new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, timeoutMs)).unref(),
      ),
    ]);
  }
  studio.activeHandles.clear();
  studio.queue.close();
  studio.index.close();
  studio.database.close();
}

export function recordCompletion(
  studio: StudioRuntime,
  event: DiffusionEvent,
): void {
  const queue = studio.completions.get(event.jobId) ?? [];
  queue.push(event);
  studio.completions.set(event.jobId, queue);
}

export function takeCompletions(
  studio: StudioRuntime,
  jobId: string,
): DiffusionEvent[] {
  const queued = studio.completions.get(jobId) ?? [];
  studio.completions.delete(jobId);
  return queued;
}

/**
 * v2.2.0 Phase 2 (2.4) -- the renderer half of real GPU telemetry.
 *
 * Polls the sidecar's `gpu.sample` and feeds `createTelemetryStream`, which
 * already knows how to turn a raw sample into the widget's shape. Replaces
 * `createMockTelemetryStream` as the App default: the mock reported a
 * plausible-looking "Gemma 4 7B Active / GPU 41%" on hosts with no NVIDIA
 * adapter and nothing loaded, which is exactly the kind of confident-but-false
 * signal this release is removing.
 *
 * Two honest states the mock could not express:
 *   - unavailable: no sample (backend down, or no telemetry at all)
 *   - stale: the last sample is older than `staleAfterMs`
 */

import { ipcCall } from "./ipc";
import {
  createTelemetryStream,
  type RawGpuSample,
  type SchedulerSnapshotForWidget,
} from "./telemetryStream";
import type { TelemetryStream } from "../components/LocalModelStatus.types";
import { fetchSchedulerSnapshot } from "../shared/models/schedulerResidency";

export const DEFAULT_POLL_MS = 2000;
/** A sample older than this is surfaced as stale rather than as current. */
export const DEFAULT_STALE_AFTER_MS = 15000;

export interface GpuSampleReply {
  sample: RawGpuSample | null;
}

export interface LiveTelemetryOptions {
  intervalMs?: number;
  staleAfterMs?: number;
  /** Test seam: one poll. Resolves null when no sample is available. */
  fetchSample?: () => Promise<RawGpuSample | null>;
  /** Scheduler occupancy. Defaults to the sidecar snapshot. */
  fetchScheduler?: () => Promise<SchedulerSnapshotForWidget>;
  now?: () => number;
}

export async function fetchGpuSample(): Promise<RawGpuSample | null> {
  const reply = await ipcCall<GpuSampleReply>("gpu.sample", {});
  if (!reply.ok) return null;
  return reply.value.sample ?? null;
}

export interface LiveTelemetryStream extends TelemetryStream {
  stop(): void;
  /** True when the last poll produced no sample. */
  isUnavailable(): boolean;
  /** True when the newest sample is older than the staleness threshold. */
  isStale(): boolean;
}

export async function fetchSchedulerForWidget(): Promise<SchedulerSnapshotForWidget> {
  try {
    const snapshot = await fetchSchedulerSnapshot();
    return {
      active: snapshot?.active ?? null,
      queued: (snapshot?.queued ?? []).map((job) => ({
        id: job.id,
        moduleId: job.moduleId,
        jobType: job.jobType,
        modelId: job.modelId,
        estimatedVramGB: job.estimatedVramGB,
      })),
    };
  } catch {
    return { active: null, queued: [] };
  }
}

/**
 * Build a polling telemetry stream. Polling starts on first subscribe and
 * stops when the last subscriber leaves, so a route that never renders the
 * widget never shells out to `nvidia-smi`.
 */
export function createLiveTelemetryStream(
  options: LiveTelemetryOptions = {},
): LiveTelemetryStream {
  const {
    intervalMs = DEFAULT_POLL_MS,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
    fetchSample = fetchGpuSample,
    fetchScheduler = fetchSchedulerForWidget,
    now = () => Date.now(),
  } = options;

  let unavailable = true;
  let lastSampleAt: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let latestScheduler: SchedulerSnapshotForWidget = {
    active: null,
    queued: [],
  };

  const inner = createTelemetryStream({
    scheduler: () => latestScheduler,
    source: (emit) => {
      let cancelled = false;
      const poll = async (): Promise<void> => {
        const [sample, snap] = await Promise.all([
          fetchSample(),
          fetchScheduler(),
        ]);
        if (cancelled) return;
        latestScheduler = snap;
        if (sample === null) {
          unavailable = true;
          return;
        }
        unavailable = false;
        lastSampleAt = now();
        emit(sample);
      };
      void poll();
      timer = setInterval(() => void poll(), intervalMs);
      return () => {
        cancelled = true;
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  });

  return {
    subscribe: inner.subscribe,
    stop: inner.stop,
    isUnavailable: () => unavailable,
    isStale: () => lastSampleAt !== null && now() - lastSampleAt > staleAfterMs,
  };
}

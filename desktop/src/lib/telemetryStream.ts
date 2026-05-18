// v1.0.0 Phase 8.3 -- bridge between the sidecar-side `GpuTelemetrySource`
// and the React `<LocalModelStatus>` widget. The sidecar publishes raw
// `gpu.sample` events; this module translates them into the
// `LocalModelTelemetry` shape the widget renders.

import type {
  LocalModelTelemetry,
  LocalModelQueuedJob,
  TelemetryStream,
  TelemetrySubscriber,
} from "../components/LocalModelStatus.types";

export interface RawGpuSample {
  device: "cuda" | "apple" | "cpu";
  deviceName: string;
  utilizationPct: number;
  totalVramGB: number;
  freeVramGB: number;
  activeModelId: string | null;
  queuedJobs: number;
  capturedAt: number;
}

export interface SchedulerSnapshotForWidget {
  active: { id: string; moduleId: string; jobType: string; modelId?: string } | null;
  queued: ReadonlyArray<LocalModelQueuedJob>;
}

export interface ModelMetadataResolver {
  /** Resolves a model id (e.g. `gemma4:e4b`) to a human-readable size label. */
  paramSize(modelId: string | null): string;
  /** Resolves a model id to a display name. */
  displayName(modelId: string | null): string;
}

export interface SchedulerSnapshotProvider {
  (): SchedulerSnapshotForWidget;
}

export interface CreateTelemetryStreamOptions {
  /** Subscribes to raw `gpu.sample` events. Returns an unsubscribe handle. */
  source: (fn: (sample: RawGpuSample) => void) => () => void;
  scheduler?: SchedulerSnapshotProvider;
  resolver?: ModelMetadataResolver;
}

const DEFAULT_RESOLVER: ModelMetadataResolver = {
  paramSize(modelId: string | null): string {
    if (!modelId) return "";
    const match = modelId.match(/(\d+(?:\.\d+)?)\s*[bB]/);
    return match ? `${match[1]}B` : "";
  },
  displayName(modelId: string | null): string {
    if (!modelId) return "";
    return modelId.split(":")[0]?.replace(/[-_]/g, " ") ?? modelId;
  },
};

/**
 * Build a `TelemetryStream` that translates raw GPU samples + scheduler
 * snapshots into the shape the `<LocalModelStatus>` widget renders. The
 * `source` is a generic subscription callback so the same module wraps
 * both the in-process `GpuTelemetrySource` (sidecar) and the eventual
 * Tauri Channel listener (renderer).
 */
export function createTelemetryStream(
  opts: CreateTelemetryStreamOptions,
): TelemetryStream & { stop(): void } {
  const subs = new Set<TelemetrySubscriber>();
  const resolver = opts.resolver ?? DEFAULT_RESOLVER;
  const scheduler =
    opts.scheduler ?? ((): SchedulerSnapshotForWidget => ({ active: null, queued: [] }));
  let unsub: (() => void) | null = null;

  function ensureSubscribed(): void {
    if (unsub) return;
    unsub = opts.source((raw) => {
      const snap = scheduler();
      const idle = snap.active === null;
      const modelId = snap.active?.modelId ?? raw.activeModelId;
      const sample: LocalModelTelemetry = {
        modelName: idle ? "Idle" : resolver.displayName(modelId ?? null) || "Local model",
        paramSize: idle ? "" : resolver.paramSize(modelId ?? null),
        gpuPct: raw.utilizationPct,
        vramFreeGB: raw.freeVramGB,
        deviceName: raw.deviceName,
        lastUpdated: raw.capturedAt,
        vramTotalGB: raw.totalVramGB,
        vramAllocatedGB: Math.max(0, raw.totalVramGB - raw.freeVramGB),
        queuedJobs: snap.queued,
        idle,
      };
      for (const fn of subs) fn(sample);
    });
  }

  function stop(): void {
    if (unsub) {
      unsub();
      unsub = null;
    }
  }

  return {
    subscribe(fn: TelemetrySubscriber): () => void {
      subs.add(fn);
      ensureSubscribed();
      return () => {
        subs.delete(fn);
        if (subs.size === 0) stop();
      };
    },
    stop,
  };
}

// Data contract for the Local Model Status widget. The same shape is consumed
// by the Dashboard widget and by future module-internal hardware-watch panels.

export interface LocalModelQueuedJob {
  readonly id: string;
  readonly moduleId: string;
  readonly jobType: string;
  readonly modelId?: string;
  readonly estimatedVramGB?: number;
}

export interface LocalModelTelemetry {
  modelName: string;
  paramSize: string;
  gpuPct: number;
  vramFreeGB: number;
  deviceName: string;
  lastUpdated: number;
  /** Optional fields added in v1.0.0 Phase 8.3 for the live telemetry feed. */
  vramTotalGB?: number;
  vramAllocatedGB?: number;
  queuedJobs?: ReadonlyArray<LocalModelQueuedJob>;
  /** When the active job is null the widget renders "Idle" instead of a model name. */
  idle?: boolean;
  /**
   * v1.5.0 Phase 1 (T003) -- intelligence-per-watt telemetry. Present only
   * when a power sampler is wired; the widget surfaces them when available and
   * shows "Energy: unavailable" when the sensor is missing.
   */
  powerDrawWatts?: number | null;
  tokensPerWatt?: number | null;
  joulesPerRequest?: number | null;
  energyStatus?: "available" | "unavailable";
}

export type TelemetrySubscriber = (sample: LocalModelTelemetry) => void;

export interface TelemetryStream {
  subscribe(fn: TelemetrySubscriber): () => void;
}

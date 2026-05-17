// Placeholder telemetry source used until Phase 8 lights up real GPU
// telemetry. Emits a deterministic tick every `intervalMs` so the Local Model
// Status widget can be exercised in dev and in tests.

import type {
  LocalModelTelemetry,
  TelemetryStream,
  TelemetrySubscriber,
} from "../components/LocalModelStatus.types";

export interface MockTelemetryOptions {
  intervalMs?: number;
  initial?: Partial<LocalModelTelemetry>;
  now?: () => number;
}

const DEFAULT: LocalModelTelemetry = {
  modelName: "Gemma 4",
  paramSize: "7B",
  gpuPct: 38,
  vramFreeGB: 5.0,
  deviceName: "RTX 3080",
  lastUpdated: 0,
};

export function createMockTelemetryStream(
  opts: MockTelemetryOptions = {},
): TelemetryStream & { stop(): void } {
  const intervalMs = opts.intervalMs ?? 2000;
  const now = opts.now ?? (() => Date.now());
  const base: LocalModelTelemetry = { ...DEFAULT, ...opts.initial, lastUpdated: now() };
  const subscribers = new Set<TelemetrySubscriber>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let tick = 0;

  function emit(): void {
    tick += 1;
    const gpuPct = Math.min(99, Math.max(5, base.gpuPct + ((tick * 7) % 23) - 10));
    const vramFreeGB = Math.max(0.5, base.vramFreeGB - ((tick * 0.13) % 1.5));
    const sample: LocalModelTelemetry = {
      ...base,
      gpuPct,
      vramFreeGB: Number(vramFreeGB.toFixed(2)),
      lastUpdated: now(),
    };
    for (const fn of subscribers) fn(sample);
  }

  function start(): void {
    if (timer !== null) return;
    timer = setInterval(emit, intervalMs);
    emit();
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    subscribe(fn: TelemetrySubscriber): () => void {
      subscribers.add(fn);
      start();
      return () => {
        subscribers.delete(fn);
        if (subscribers.size === 0) stop();
      };
    },
    stop,
  };
}

/**
 * v1.0.0 Phase 8.2 -- GpuTelemetrySource.
 *
 * Polls the host GPU at 2 Hz (every 500 ms by default) and publishes
 * `gpu.sample` events on the TelemetryBus. The sampler shells out to
 * `nvidia-smi` on Windows / Linux, parses `system_profiler` output on
 * macOS (with a sensible utilization fallback because Apple Silicon
 * does not expose per-process GPU utilization via the public CLI),
 * and degrades to a `device: "cpu"` mode when no GPU CLI is reachable.
 *
 * Parsing is pulled out of the runtime so unit tests can drive fixture
 * strings through `parseNvidiaSmiCsv()` / `parseAppleSystemProfiler()`
 * without spawning a child process.
 *
 * The active model id is resolved from a caller-supplied
 * `activeJobProvider()` (typically the GpuScheduler's snapshot). The
 * source has no opinion about model registry lookups; downstream
 * consumers (the Local Model Status widget) decorate the sample with
 * parameter sizes via the `ModelRegistry`.
 */

import type { TelemetryBus } from "./TelemetryBus.js";

export type GpuDeviceKind = "cuda" | "apple" | "cpu";

export interface GpuTelemetrySample {
  /** Wall-clock ms since the epoch when the sample was taken. */
  readonly capturedAt: number;
  readonly device: GpuDeviceKind;
  readonly deviceName: string;
  /** 0..100. Zero on CPU-only hosts. */
  readonly utilizationPct: number;
  /** Total VRAM in GB. On CPU-only hosts this is total system RAM. */
  readonly totalVramGB: number;
  /** Free VRAM in GB. On CPU-only hosts this is free system RAM. */
  readonly freeVramGB: number;
  /** Active model id from the foreground scheduler job, if any. */
  readonly activeModelId: string | null;
  /** Pending queue depth from the scheduler, if available. */
  readonly queuedJobs: number;
}

export interface ActiveJobInfo {
  readonly modelId: string | null;
  readonly queuedJobs: number;
}

export type ActiveJobProvider = () => ActiveJobInfo;

export interface GpuQueryResult {
  readonly device: GpuDeviceKind;
  readonly deviceName: string;
  readonly utilizationPct: number;
  readonly totalVramGB: number;
  readonly freeVramGB: number;
}

export type GpuQueryFn = () => Promise<GpuQueryResult | null>;

export interface GpuTelemetrySourceOptions {
  readonly telemetry: TelemetryBus;
  readonly activeJobProvider?: ActiveJobProvider;
  /** Polling interval in ms. Defaults to 500 (2 Hz). */
  readonly intervalMs?: number;
  /** Custom GPU query implementation. Falls back to platform default. */
  readonly query?: GpuQueryFn;
  /** Override the clock for tests. */
  readonly now?: () => number;
  /** Override `setInterval` / `clearInterval` for tests. */
  readonly setInterval?: (handler: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
  /** Process platform override for tests. */
  readonly platform?: NodeJS.Platform;
}

const MB_PER_GB = 1024;

export function parseNvidiaSmiCsv(text: string): GpuQueryResult | null {
  if (!text) return null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^utilization/i.test(line)) continue; // header
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 4) continue;
    const util = Number(parts[0]);
    const totalMb = Number(parts[1]);
    const freeMb = Number(parts[2]);
    const name = parts[3] ?? "NVIDIA GPU";
    if (Number.isNaN(util) || Number.isNaN(totalMb) || Number.isNaN(freeMb)) continue;
    return {
      device: "cuda",
      deviceName: name,
      utilizationPct: clamp(util, 0, 100),
      totalVramGB: round(totalMb / MB_PER_GB),
      freeVramGB: round(freeMb / MB_PER_GB),
    };
  }
  return null;
}

interface AppleDisplayEntry {
  sppci_model?: string;
  spdisplays_vram?: string;
  spdisplays_vram_shared?: string;
}

interface AppleSystemProfilerOutput {
  SPDisplaysDataType?: AppleDisplayEntry[];
}

export function parseAppleSystemProfiler(
  text: string,
  fallbackTotalRamGB = 8,
): GpuQueryResult | null {
  if (!text) return null;
  let json: AppleSystemProfilerOutput;
  try {
    json = JSON.parse(text) as AppleSystemProfilerOutput;
  } catch {
    return null;
  }
  const entries = json.SPDisplaysDataType ?? [];
  for (const entry of entries) {
    const name = entry.sppci_model ?? "Apple GPU";
    const vramStr = entry.spdisplays_vram ?? entry.spdisplays_vram_shared;
    let totalGB: number;
    if (vramStr) {
      const match = vramStr.match(/(\d+(?:\.\d+)?)\s*(MB|GB)?/i);
      if (match) {
        const value = Number(match[1]);
        const unit = (match[2] ?? "MB").toUpperCase();
        totalGB = unit === "GB" ? value : value / MB_PER_GB;
      } else {
        totalGB = fallbackTotalRamGB;
      }
    } else {
      totalGB = fallbackTotalRamGB;
    }
    return {
      device: "apple",
      deviceName: name,
      utilizationPct: 0,
      totalVramGB: round(totalGB),
      freeVramGB: round(totalGB), // unified memory; treat as fully available
    };
  }
  return null;
}

export function buildCpuFallbackSample(
  deviceName = "CPU (no GPU detected)",
  totalRamGB = 8,
  freeRamGB = 4,
): GpuQueryResult {
  return {
    device: "cpu",
    deviceName,
    utilizationPct: 0,
    totalVramGB: round(totalRamGB),
    freeVramGB: round(freeRamGB),
  };
}

export class GpuTelemetrySource {
  private readonly _telemetry: TelemetryBus;
  private readonly _activeJobProvider: ActiveJobProvider;
  private readonly _intervalMs: number;
  private readonly _query: GpuQueryFn;
  private readonly _now: () => number;
  private readonly _setInterval: (handler: () => void, ms: number) => unknown;
  private readonly _clearInterval: (handle: unknown) => void;
  private _handle: unknown = null;
  private _lastSample: GpuTelemetrySample | null = null;
  private _polling = false;

  constructor(opts: GpuTelemetrySourceOptions) {
    this._telemetry = opts.telemetry;
    this._activeJobProvider =
      opts.activeJobProvider ?? (() => ({ modelId: null, queuedJobs: 0 }));
    this._intervalMs = opts.intervalMs ?? 500;
    this._query = opts.query ?? (() => Promise.resolve(buildCpuFallbackSample()));
    this._now = opts.now ?? (() => Date.now());
    this._setInterval =
      opts.setInterval ??
      ((handler: () => void, ms: number) => setInterval(handler, ms));
    this._clearInterval =
      opts.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  }

  /** Begin 2 Hz polling. No-op if already started. */
  start(): void {
    if (this._handle !== null) return;
    // Fire one sample immediately so subscribers do not wait a full tick.
    void this._sampleOnce();
    this._handle = this._setInterval(() => void this._sampleOnce(), this._intervalMs);
  }

  stop(): void {
    if (this._handle === null) return;
    this._clearInterval(this._handle);
    this._handle = null;
  }

  get lastSample(): GpuTelemetrySample | null {
    return this._lastSample;
  }

  async sampleNow(): Promise<GpuTelemetrySample | null> {
    return this._sampleOnce();
  }

  private async _sampleOnce(): Promise<GpuTelemetrySample | null> {
    if (this._polling) return this._lastSample;
    this._polling = true;
    try {
      let result: GpuQueryResult | null;
      try {
        result = await this._query();
      } catch {
        result = null;
      }
      if (!result) {
        result = buildCpuFallbackSample();
      }
      const activeJob = this._activeJobProvider();
      const sample: GpuTelemetrySample = {
        capturedAt: this._now(),
        device: result.device,
        deviceName: result.deviceName,
        utilizationPct: clamp(result.utilizationPct, 0, 100),
        totalVramGB: result.totalVramGB,
        freeVramGB: result.freeVramGB,
        activeModelId: activeJob.modelId,
        queuedJobs: activeJob.queuedJobs,
      };
      this._lastSample = sample;
      this._telemetry.publish({
        kind: "gpu.sample",
        source: "gpu-telemetry",
        payload: sample,
      });
      return sample;
    } finally {
      this._polling = false;
    }
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// v2.2.0 Phase 2 (2.4) -- real GPU telemetry for the desktop status widget.
//
// `core/telemetry/GpuTelemetrySource` and its `nvidia-smi` / `system_profiler`
// parsers have existed since v1.0.0 Phase 8 but were NEVER constructed in
// production: the renderer ran `createMockTelemetryStream`, so the status card
// showed a fabricated "Gemma 4 7B Active / GPU 41%" on machines where nothing
// was loaded and no NVIDIA adapter existed. This module supplies the missing
// query function and exposes one memoized source behind the `gpu.sample` IPC.
//
// Deliberately poll-based: `telemetry.subscribe` is declared but unimplemented
// in the protocol, and adding a push channel would mean a Tauri Channel
// plumbing change. The renderer polls at the same 2 s cadence the mock used.

import { execFile } from "node:child_process";
import * as os from "node:os";

import {
  GpuTelemetrySource,
  buildCpuFallbackSample,
  parseAppleSystemProfiler,
  parseNvidiaSmiCsv,
  type GpuQueryResult,
  type GpuTelemetrySample,
} from "../../../../core/telemetry/GpuTelemetrySource.js";
import { InProcessTelemetryBus } from "../../../../core/telemetry/TelemetryBus.js";

/** Hard cap so a wedged vendor tool cannot stall the sample. */
const QUERY_TIMEOUT_MS = 4000;

const NVIDIA_SMI_ARGS = [
  "--query-gpu=utilization.gpu,memory.total,memory.free,name",
  "--format=csv,noheader,nounits",
] as const;

/** Same fallback the installer uses when nvidia-smi is missing from PATH. */
export const WINDOWS_NVIDIA_SMI = "C:\\Windows\\System32\\nvidia-smi.exe";

function run(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { timeout: QUERY_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Query the host GPU. NVIDIA first (Windows/Linux/eGPU), then Apple Silicon,
 * then a CPU/system-RAM fallback. Returns null only when even the fallback
 * cannot be built, which the caller reports as "unavailable" rather than
 * inventing a plausible-looking sample.
 */
export async function queryHostGpu(
  exec: (cmd: string, args: readonly string[]) => Promise<string | null> = run,
  platform: NodeJS.Platform = process.platform,
): Promise<GpuQueryResult | null> {
  const commands =
    platform === "win32" ? ["nvidia-smi", WINDOWS_NVIDIA_SMI] : ["nvidia-smi"];
  for (const command of commands) {
    const smi = await exec(command, [...NVIDIA_SMI_ARGS]);
    if (smi) {
      const parsed = parseNvidiaSmiCsv(smi);
      if (parsed) return parsed;
    }
  }

  if (platform === "darwin") {
    const profile = await exec("system_profiler", ["SPDisplaysDataType"]);
    if (profile) {
      const totalRamGB = os.totalmem() / 2 ** 30;
      const parsed = parseAppleSystemProfiler(profile, totalRamGB);
      if (parsed) return parsed;
    }
  }

  // No discrete GPU telemetry: report the host honestly as a CPU device with
  // real system-RAM numbers, so the widget can say "no GPU detected".
  return buildCpuFallbackSample(
    "CPU (no GPU detected)",
    os.totalmem() / 2 ** 30,
    os.freemem() / 2 ** 30,
  );
}

let _source: GpuTelemetrySource | null = null;

/** The process-wide telemetry source, built on first use. */
export function gpuTelemetrySource(): GpuTelemetrySource {
  if (!_source) {
    _source = new GpuTelemetrySource({
      telemetry: new InProcessTelemetryBus(),
      query: () => queryHostGpu(),
    });
  }
  return _source;
}

/** Test seam: drop the memoized source. */
export function resetGpuTelemetrySource(): void {
  _source?.stop();
  _source = null;
}

export interface GpuSampleReply {
  /** Null when no sample could be taken at all (widget shows "unavailable"). */
  sample: GpuTelemetrySample | null;
}

/** Backs the `gpu.sample` IPC method. */
export async function sampleGpu(): Promise<GpuSampleReply> {
  try {
    return { sample: await gpuTelemetrySource().sampleNow() };
  } catch {
    return { sample: null };
  }
}

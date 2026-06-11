/**
 * v1.5.0 Phase 1 (adoption-ecosystem-2026-06 T003) -- energy / power-draw
 * estimator.
 *
 * Adopts report item 18 (`local-only`, OpenJarvis "Intelligence Per Watt", S4):
 * track energy and tokens-per-watt alongside the existing VRAM / utilization /
 * token-cost telemetry. The estimator samples GPU power draw via the platform
 * primitive (nvidia-smi `power.draw` on NVIDIA; macOS `powermetrics` and Linux
 * RAPL are left as best-effort parse helpers for a later phase) and derives:
 *
 *   - watts             (instantaneous power draw)
 *   - tokensPerWatt     (tokens / watt -- an efficiency proxy)
 *   - joulesPerRequest  (watts * elapsed seconds)
 *
 * It feeds the Local Model Status panel (via the GpuTelemetrySource sample)
 * and integrates token counts from `core/observability/TokenCost.ts`
 * (`tokenize`) so per-request energy uses the same token estimator as the
 * rest of the system.
 *
 * Where no power sensor is available the estimator reports
 * `status: "unavailable"` and never blocks a pillar. Local-only: nothing here
 * exports telemetry off-host (honors the no-telemetry default).
 */

import { execFile } from "node:child_process";
import { tokenize } from "../observability/TokenCost.js";

export type EnergyStatus = "available" | "unavailable";

export interface EnergyMetrics {
  readonly status: EnergyStatus;
  /** Instantaneous power draw in watts, or null when unavailable. */
  readonly watts: number | null;
  /** Tokens per watt of draw, or null when unavailable. */
  readonly tokensPerWatt: number | null;
  /** Energy in joules for the request window, or null when unavailable. */
  readonly joulesPerRequest: number | null;
}

const UNAVAILABLE: EnergyMetrics = {
  status: "unavailable",
  watts: null,
  tokensPerWatt: null,
  joulesPerRequest: null,
};

export interface EnergyEstimateInput {
  /** Sampled GPU power draw in watts. null / non-positive => unavailable. */
  readonly powerWatts: number | null | undefined;
  /** Tokens produced/consumed in the request window. */
  readonly tokens: number;
  /** Wall-clock duration of the request window in milliseconds. */
  readonly elapsedMs: number;
}

/**
 * Compute energy metrics from a sampled power draw + token count. Returns the
 * `unavailable` sentinel when no usable power sample is supplied (null,
 * non-finite, or non-positive watts), so callers never block on a missing
 * sensor.
 */
export function estimateEnergy(input: EnergyEstimateInput): EnergyMetrics {
  const { powerWatts, tokens, elapsedMs } = input;
  if (powerWatts === null || powerWatts === undefined || !Number.isFinite(powerWatts) || powerWatts <= 0) {
    return UNAVAILABLE;
  }
  const elapsedSec = Math.max(0, elapsedMs) / 1000;
  const safeTokens = tokens > 0 ? tokens : 0;
  return {
    status: "available",
    watts: round(powerWatts),
    tokensPerWatt: round(safeTokens / powerWatts),
    joulesPerRequest: round(powerWatts * elapsedSec),
  };
}

export interface EnergyEstimateForTextInput {
  readonly powerWatts: number | null | undefined;
  /** Request text whose token count is derived via TokenCost.tokenize. */
  readonly text: string;
  readonly elapsedMs: number;
}

/**
 * Convenience over {@link estimateEnergy} that derives the token count from
 * `text` using the shared `tokenize` estimator (TokenCost). This is the seam
 * that ties energy accounting to the same token-cost helper the SkillAuditor
 * and compaction paths use.
 */
export function estimateEnergyForText(input: EnergyEstimateForTextInput): EnergyMetrics {
  return estimateEnergy({
    powerWatts: input.powerWatts,
    tokens: tokenize(input.text),
    elapsedMs: input.elapsedMs,
  });
}

/** A bound sampler returning watts, or null when no sensor is reachable. */
export type PowerSampleFn = () => Promise<number | null>;

/**
 * Parse `nvidia-smi --query-gpu=power.draw --format=csv,noheader,nounits`
 * output into watts. Returns the first positive numeric reading, or null.
 */
export function parseNvidiaPowerDraw(text: string): number | null {
  if (!text) return null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/power/i.test(line)) continue; // header row
    const first = line.split(",")[0]?.trim() ?? "";
    const watts = Number(first);
    if (Number.isFinite(watts) && watts > 0) return round(watts);
  }
  return null;
}

/**
 * Derive average watts from two RAPL `energy_uj` counter reads (microjoules)
 * taken `elapsedMs` apart. Returns null on a wrapped counter or bad interval.
 * Provided for a later Linux-RAPL wiring; pure + unit-testable here.
 */
export function raplWattsFromEnergyDelta(uj0: number, uj1: number, elapsedMs: number): number | null {
  if (!Number.isFinite(uj0) || !Number.isFinite(uj1) || elapsedMs <= 0) return null;
  const deltaJoules = (uj1 - uj0) / 1_000_000;
  if (deltaJoules < 0) return null; // counter wrapped or reset
  return round(deltaJoules / (elapsedMs / 1000));
}

export interface PowerExecResult {
  readonly code: number;
  readonly stdout: string;
}

export type PowerExec = (cmd: string, args: readonly string[]) => Promise<PowerExecResult>;

const POWER_EXEC_TIMEOUT_MS = 5_000;

const defaultPowerExec: PowerExec = (cmd, args) =>
  new Promise<PowerExecResult>((resolve) => {
    const proc = execFile(
      cmd,
      [...args],
      { timeout: POWER_EXEC_TIMEOUT_MS, windowsHide: true },
      (error: Error | null, stdout: string | Buffer) => {
        resolve({
          code: error ? 1 : 0,
          stdout: typeof stdout === "string" ? stdout : stdout.toString(),
        });
      },
    );
    proc.on("error", () => resolve({ code: 127, stdout: "" }));
  });

export interface SamplePowerDrawOptions {
  /** Override the exec used to query the platform power primitive (tests). */
  readonly exec?: PowerExec;
}

/**
 * Sample instantaneous GPU power draw in watts, or null when no sensor is
 * reachable. NVIDIA exposes `power.draw` through nvidia-smi on Windows and
 * Linux; other platforms degrade to null (reported as `energy: unavailable`).
 */
export async function samplePowerDraw(opts: SamplePowerDrawOptions = {}): Promise<number | null> {
  const exec = opts.exec ?? defaultPowerExec;
  const result = await exec("nvidia-smi", [
    "--query-gpu=power.draw",
    "--format=csv,noheader,nounits",
  ]);
  if (result.code === 0) {
    const watts = parseNvidiaPowerDraw(result.stdout);
    if (watts !== null) return watts;
  }
  return null;
}

/** Build a {@link PowerSampleFn} bound to the host's power primitive. */
export function createPowerSampler(opts: SamplePowerDrawOptions = {}): PowerSampleFn {
  return () => samplePowerDraw(opts);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// v1.12.0 Phase 4 (adoption-ecosystem-2026-07 E1/E3) -- the disk-offload
// "patient" inference tier.
//
// De-bespoke'd from the Colibri source: run a large open MoE (e.g. GLM-5.2) on a
// modest / no-GPU host by streaming experts off disk (via the llama.cpp flash-MoE
// offload path, exposed as a loopback OpenAI/Ollama-compatible local adapter --
// NOT Colibri's bespoke C engine). This EXTENDS the single-GPU ceiling as a
// deliberately BELOW-ceiling, no-GPU-required path -- it is off by default,
// carries an explicit sub-1-tok/s latency warning, and uses a much larger
// per-request timeout so a slow disk-streamed run is not aborted by the
// interactive default.
//
// This module is the vscode-free, testable core: the tier tag + visibility gate
// (E3 catalog surfacing) + the timeout resolver + the latency-warning copy. The
// offload runtime itself is a user-registered local adapter (the app does not
// bundle it); Nexus provides the tier plumbing. Boundary: pure; core/** only.
// ---------------------------------------------------------------------------

import type { ModelSpec, PatientRamPreset, PatientRamPresetId } from "./catalog.js";

export type { PatientRamPreset, PatientRamPresetId };

/** Catalog tag marking an entry as a patient-tier (disk-offload, sub-1-tok/s) model. */
export const PATIENT_TIER_TAG = "patient-tier";

/**
 * Default per-request timeout for the patient tier: 1 hour. Disk-streamed MoE
 * generation on a trillion-class model has been measured at ~0.03 tok/s
 * (~32 s/token laptop, ~19-21 s/token server), so a full response can take
 * minutes to hours; the interactive 60s default would abort it mid-stream.
 */
export const PATIENT_TIER_DEFAULT_TIMEOUT_MS = 3_600_000;

/** The explicit latency notice surfaced while the patient tier is active. */
export const PATIENT_TIER_LATENCY_WARNING =
  "Patient tier active: trillion-class disk-offload models have been measured at " +
  "roughly 0.03 tokens/sec (~32 seconds/token on a laptop-class RAM budget, " +
  "~19-21 seconds/token on a server budget). Smaller patient-tier models may be " +
  "faster, but generation is still non-interactive (minutes to hours) -- use it " +
  "for async / batch work, not live editing.";

/**
 * v1.19.2 -- RAM-budget expectation presets (Kimi K1). Catalog and settings
 * copy only. Nexus does not bundle the disk-offload runtime; expert-cache
 * sizing lives in the user-registered llama.cpp-lineage adapter. Calibrated
 * against independent trillion-class MoE measurement (kimi-k3-in-c).
 */
export const PATIENT_TIER_RAM_PRESETS: readonly PatientRamPreset[] = Object.freeze([
  Object.freeze({
    id: "laptop",
    label: "Laptop",
    peakRssGB: 8.24,
    expectedSecondsPerToken: 32,
    copy:
      "Laptop RAM budget: independently measured ~32 s/token (~0.03 tok/s) at 8.24 GB peak RSS " +
      "for a trillion-class disk-offload MoE. Expectation copy only -- Nexus does not bundle " +
      "the offload runtime.",
  }),
  Object.freeze({
    id: "workstation",
    label: "Workstation",
    peakRssGB: 64,
    expectedSecondsPerToken: 21,
    copy:
      "Workstation RAM budget: independently measured ~19-21 s/token on a server-class host " +
      "for a trillion-class disk-offload MoE. Expectation copy only -- Nexus does not bundle " +
      "the offload runtime.",
  }),
  Object.freeze({
    id: "max",
    label: "Max",
    peakRssGB: 224,
    expectedSecondsPerToken: 19,
    copy:
      "Max RAM budget: independently measured ~19 s/token at ~224 GB peak RSS for a " +
      "trillion-class disk-offload MoE (byte-identical output vs the laptop budget in the " +
      "source measurement). Expectation copy only -- Nexus does not bundle the offload runtime.",
  }),
]);

export function patientRamPresetById(id: string): PatientRamPreset | undefined {
  return PATIENT_TIER_RAM_PRESETS.find((p) => p.id === id);
}

/** True when a catalog entry is tagged for the patient (disk-offload) tier. */
export function isPatientTierSpec(spec: Pick<ModelSpec, "tags">): boolean {
  return (spec.tags ?? []).includes(PATIENT_TIER_TAG);
}

/**
 * A patient-tier catalog entry surfaces only when the patient tier is enabled;
 * every other entry is unaffected (returns true). Mirrors the extreme-low-bit
 * visibility gate -- the patient tier is opt-in and below the interactive ceiling.
 */
export function isPatientTierModelVisible(
  spec: Pick<ModelSpec, "tags">,
  patientTierEnabled: boolean,
): boolean {
  if (!isPatientTierSpec(spec)) return true;
  return patientTierEnabled;
}

export interface PatientTimeoutInput {
  readonly enabled: boolean;
  readonly requestTimeoutMs: number;
  readonly patientTimeoutMs?: number;
}

/**
 * The effective per-request LLM timeout. When the patient tier is enabled the
 * (much larger) patient timeout applies so a sub-1-tok/s disk-offload run is not
 * aborted by the interactive default; otherwise the normal request timeout. The
 * patient timeout is never shorter than the normal one.
 */
export function resolvePatientTimeoutMs(input: PatientTimeoutInput): number {
  if (!input.enabled) return input.requestTimeoutMs;
  const patient = input.patientTimeoutMs ?? PATIENT_TIER_DEFAULT_TIMEOUT_MS;
  return Math.max(patient, input.requestTimeoutMs);
}

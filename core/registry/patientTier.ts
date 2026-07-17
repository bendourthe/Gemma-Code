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

import type { ModelSpec } from "./catalog.js";

/** Catalog tag marking an entry as a patient-tier (disk-offload, sub-1-tok/s) model. */
export const PATIENT_TIER_TAG = "patient-tier";

/**
 * Default per-request timeout for the patient tier: 1 hour. Disk-streamed MoE
 * generation runs at ~0.05-2 tok/s, so a full response can take minutes to
 * hours; the interactive 60s default would abort it mid-stream.
 */
export const PATIENT_TIER_DEFAULT_TIMEOUT_MS = 3_600_000;

/** The explicit latency notice surfaced while the patient tier is active. */
export const PATIENT_TIER_LATENCY_WARNING =
  "Patient tier active: this model streams weights from disk at roughly 0.05-2 tokens/sec. " +
  "Generation is non-interactive (minutes to hours) -- use it for async / batch work, not live editing.";

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

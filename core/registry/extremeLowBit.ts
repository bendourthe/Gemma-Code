// ---------------------------------------------------------------------------
// v1.12.0 Phase 3 (adoption-ecosystem-2026-07 Q1) -- the extreme-low-bit
// (BitNet-class ternary / 1-bit) model tier: a runtime-capability probe (EM007)
// + a benchmark/vendor rejection gate (EM008).
//
// De-hyped from the "Bonsai 27B" source: the ON-BRAND idea is a tier BELOW the
// usual 4-bit GGUF -- ternary / 1-bit weights that fit a larger-capability model
// into far less VRAM. But sub-4-bit quality retention is model-specific and,
// unless independently benchmarked, a vendor claim. So the tier is HARD-GATED:
//
//   (a) runtime support -- the bundled Ollama/llama.cpp must expose the quant
//       format (probed from the Ollama version; fail-closed on unknown), and
//   (b) an INDEPENDENT third-party benchmark on the specific weights,
//
// and it NEVER surfaces the uncorroborated "Bonsai"/"PrismML" vendor. Default
// HIDDEN: with the threshold unconfirmed (below) the probe returns false, so the
// tier cleanly no-ops until enabled. Boundary: pure; core/** (no modules/**).
// ---------------------------------------------------------------------------

import type { ModelSpec } from "./catalog.js";

/** GGUF quant labels for BitNet-class ternary / 1-bit (sub-4-bit) weights. */
export const EXTREME_LOW_BIT_QUANTS: readonly string[] = [
  "Q1_0",
  "Q2_0",
  "TQ1_0",
  "TQ2_0",
  "I2_S",
  "1bit",
  "ternary",
];

/** True when `quant` names a BitNet-class ternary / 1-bit type. */
export function isExtremeLowBitQuant(quant: string | undefined): boolean {
  if (!quant) return false;
  const q = quant.toLowerCase();
  return EXTREME_LOW_BIT_QUANTS.some((known) => known.toLowerCase() === q);
}

/**
 * The minimum Ollama version whose bundled llama.cpp exposes BitNet-class
 * ternary/1-bit GGUF quant types.
 *
 * NOTE (EM.P3.A): this is a deliberately-high PLACEHOLDER. The exact
 * llama.cpp/Ollama support point is not confirmed here, so the probe is
 * FAIL-CLOSED -- it never claims support until this constant is confirmed and
 * lowered to the real version. Until then the extreme-low-bit tier stays hidden
 * (the plan's "default HIDDEN / clean no-op" gate).
 */
export const EXTREME_LOW_BIT_MIN_OLLAMA_VERSION = "999.0.0";

/** Parse a semver-ish version string to a [major, minor, patch] triple, or null. */
export function parseOllamaVersion(raw: string | null | undefined): readonly [number, number, number] | null {
  if (!raw) return null;
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gte(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

/**
 * The EM007 runtime-capability probe: whether the running Ollama (its bundled
 * llama.cpp) can load BitNet-class ternary/1-bit GGUF. Fail-closed -- returns
 * false on an unparseable/absent version. Callers pass the string from Ollama's
 * `/api/version` (which the app already fetches but currently discards).
 */
export function runtimeSupportsExtremeLowBit(ollamaVersion: string | null | undefined): boolean {
  const v = parseOllamaVersion(ollamaVersion);
  const min = parseOllamaVersion(EXTREME_LOW_BIT_MIN_OLLAMA_VERSION);
  if (!v || !min) return false;
  return gte(v, min);
}

// Uncorroborated vendors that must never be surfaced in the tier (the Bonsai /
// PrismML source whose retention claims lack an independent benchmark).
const BLOCKED_VENDORS: readonly string[] = ["bonsai", "prismml", "prism-ml"];

function hasIndependentBenchmark(spec: ModelSpec): boolean {
  return typeof spec.benchmark === "string" && spec.benchmark.trim().length > 0;
}

function isBlockedVendor(spec: ModelSpec): boolean {
  const hay = `${spec.id} ${spec.family} ${spec.provenance ?? ""} ${spec.origin ?? ""}`.toLowerCase();
  return BLOCKED_VENDORS.some((vendor) => hay.includes(vendor));
}

/** True when a catalog entry is a BitNet-class extreme-low-bit model. */
export function isExtremeLowBitSpec(spec: ModelSpec): boolean {
  return isExtremeLowBitQuant(spec.quant);
}

/**
 * Whether an extreme-low-bit model may be surfaced. Non extreme-low-bit specs
 * are unaffected (returns true -- this gate governs only the sub-4-bit tier).
 * An extreme-low-bit spec surfaces ONLY when the runtime supports the format,
 * the weights carry an independent benchmark, and the vendor is not blocked.
 */
export function isExtremeLowBitModelVisible(spec: ModelSpec, runtimeSupported: boolean): boolean {
  if (!isExtremeLowBitSpec(spec)) return true;
  if (!runtimeSupported) return false;
  if (isBlockedVendor(spec)) return false;
  return hasIndependentBenchmark(spec);
}

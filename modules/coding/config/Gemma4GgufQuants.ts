/**
 * v1.5.0 Phase 1 (adoption-ecosystem-2026-06 T001) -- Gemma 4 12B-IT GGUF
 * quant ladder + hardware-aware quant picker.
 *
 * Adopts report item 32 (`local-only`) from
 * `docs/versions/v1/v1.5.0/comparison-ecosystem-2026-06.md`. Source: the
 * Unsloth `gemma-4-12b-it-GGUF` model card (Dynamic-2.0 GGUF quants).
 *
 * The model itself is registered in `core/registry/catalog.json`
 * (id `gemma-4-12b-it-gguf`, 256K context, native multimodal flag for
 * Phase 5 consumption). This module captures the per-quant disk / VRAM
 * sizing and maps each quant to a Nexus hardware tier via the shared
 * `classifyTier` so the hardware-aware picker can choose the largest
 * quant that fits a host's VRAM. Lives under `modules/coding/config/`
 * (not `core/registry/`) because the tier classification is a
 * Coding-pillar config concern -- `core/**` must not depend on
 * `modules/**` (see configs/dependency-cruiser.cjs `no-core-from-modules`).
 *
 * Local-only: nothing here makes an outbound call. The installer pulls a
 * chosen quant via `ollama run hf.co/unsloth/gemma-4-12b-it-GGUF:<QUANT>`.
 */

import { classifyTier } from "./HardwareTier.js";
import type { HardwareTierId } from "./HardwareTier.types.js";

/** Canonical catalog id for the GGUF entry (matches core/registry/catalog.json). */
export const GEMMA4_GGUF_MODEL_ID = "gemma-4-12b-it-gguf";

/** Ollama HF base reference; a quant is appended as `:<QUANT>`. */
export const GEMMA4_GGUF_OLLAMA_BASE = "hf.co/unsloth/gemma-4-12b-it-GGUF";

/** Context window of Gemma 4 12B-IT: 256K tokens (256 * 1024). */
export const GEMMA4_GGUF_CONTEXT_WINDOW = 262_144;

/** Gemma 4 12B-IT accepts native text / image / audio input (Phase 5 gate). */
export const GEMMA4_GGUF_MULTIMODAL = true;

/** One Unsloth Dynamic-2.0 GGUF quant of Gemma 4 12B-IT. */
export interface Gemma4GgufQuant {
  /** Quant label as published by Unsloth (e.g. `Q4_K_XL`). */
  readonly quant: string;
  /** On-disk / download footprint in GB. */
  readonly diskSizeGB: number;
  /** Approximate VRAM (MB) needed to serve the quant at a modest context. */
  readonly minVramMb: number;
  /** Full Ollama reference, e.g. `hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL`. */
  readonly ollamaRef: string;
  /** Nexus hardware tier this quant maps to, derived from `minVramMb`. */
  readonly hardwareTier: HardwareTierId;
}

function quant(quantName: string, diskSizeGB: number, minVramMb: number): Gemma4GgufQuant {
  return {
    quant: quantName,
    diskSizeGB,
    minVramMb,
    ollamaRef: `${GEMMA4_GGUF_OLLAMA_BASE}:${quantName}`,
    hardwareTier: classifyTier(minVramMb),
  };
}

/**
 * The Gemma 4 12B-IT GGUF quant ladder, smallest first. Disk sizes are the
 * Unsloth Dynamic-2.0 published footprints; VRAM figures are the weights
 * plus a modest KV-cache headroom used only for tier classification.
 *
 *   IQ2_M  ~4.21 GB  -> Tier 1 (constrained)
 *   Q3_K   ~6.0  GB  -> Tier 1
 *   Q4_K_XL ~7.37 GB -> Tier 2 (balanced; recommended default)
 *   Q5_K   ~8.8  GB  -> Tier 2
 *   Q6_K   ~10.7 GB  -> Tier 2
 *   BF16   ~23.8 GB  -> Tier 3 (full)
 */
export const GEMMA4_GGUF_QUANTS: readonly Gemma4GgufQuant[] = [
  quant("IQ2_M", 4.21, 6_144),
  quant("Q3_K", 6.0, 8_192),
  quant("Q4_K_XL", 7.37, 10_240),
  quant("Q5_K", 8.8, 12_288),
  quant("Q6_K", 10.7, 14_336),
  quant("BF16", 23.8, 26_624),
];

/** The recommended default quant (best quality that still fits a balanced tier). */
export const GEMMA4_GGUF_DEFAULT_QUANT = "Q4_K_XL";

/**
 * Pick the largest GGUF quant whose `minVramMb` fits within `vramMb`.
 *
 * When nothing fits the VRAM budget, returns the smallest quant (IQ2_M) so
 * the picker always yields a runnable option -- Ollama can offload the
 * overflow to system RAM rather than refusing to launch.
 */
export function selectGemma4GgufQuant(vramMb: number): Gemma4GgufQuant {
  // Quants are smallest-first; walk from largest to find the biggest that fits.
  for (let i = GEMMA4_GGUF_QUANTS.length - 1; i >= 0; i--) {
    const candidate = GEMMA4_GGUF_QUANTS[i];
    if (candidate && candidate.minVramMb <= vramMb) {
      return candidate;
    }
  }
  const smallest = GEMMA4_GGUF_QUANTS[0];
  if (!smallest) {
    throw new Error("Gemma4GgufQuants: quant ladder is empty");
  }
  return smallest;
}

/** Return every quant that maps to the given hardware tier. */
export function gemma4GgufQuantsForTier(tier: HardwareTierId): readonly Gemma4GgufQuant[] {
  return GEMMA4_GGUF_QUANTS.filter((q) => q.hardwareTier === tier);
}

/**
 * v1.0.0 Phase 8.4 -- DiffusionTier.
 *
 * Sibling enum to `src/config/HardwareTier.ts` that classifies the host
 * GPU's VRAM into a diffusion-suited tier and emits the default form
 * values that Image Studio and Video Lab pick up at first render. The
 * LLM-side `HardwareTier` (constrained / balanced / full) governs token
 * window + agent-iteration budgets; this tier governs image resolution,
 * sampler steps, video clip length, and which model families the user
 * can pick from out-of-the-box.
 *
 * Auto-detection happens at first launch and the resolved id is
 * persisted via `SettingsStore` (`nexus.diffusion.tierOverride`); the
 * Hardware page in Settings exposes an override dropdown.
 */

export type DiffusionTierId =
  | "diffusion-low"
  | "diffusion-mid"
  | "diffusion-high"
  | "diffusion-pro";

export interface DiffusionTierImageDefaults {
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly sampler: string;
  readonly model: string;
  readonly allowControlNet: boolean;
  readonly allowControlNetStacking: boolean;
  readonly allowLoRA: boolean;
}

export interface DiffusionTierVideoDefaults {
  /** `null` indicates video disabled on this tier. */
  readonly model: string | null;
  /** Clip length in seconds. */
  readonly clipSeconds: number;
  readonly fps: number;
  readonly height: number;
  readonly width: number;
  readonly enabled: boolean;
}

export interface DiffusionTierConfig {
  readonly id: DiffusionTierId;
  readonly label: string;
  /** VRAM ceiling in GB; `Infinity` for the top tier. */
  readonly vramRangeGB: { readonly min: number; readonly max: number };
  readonly image: DiffusionTierImageDefaults;
  readonly video: DiffusionTierVideoDefaults;
  /** Whether multiple jobs may run in parallel on this tier. */
  readonly parallelJobs: boolean;
}

export const DIFFUSION_TIER_CONFIGS: Record<DiffusionTierId, DiffusionTierConfig> = {
  "diffusion-low": {
    id: "diffusion-low",
    label: "Diffusion Low (4-8 GB VRAM)",
    vramRangeGB: { min: 4, max: 8 },
    image: {
      width: 512,
      height: 512,
      steps: 20,
      sampler: "Euler a",
      model: "sd_1_5",
      allowControlNet: false,
      allowControlNetStacking: false,
      allowLoRA: true,
    },
    video: {
      model: null,
      clipSeconds: 0,
      fps: 0,
      height: 0,
      width: 0,
      enabled: false,
    },
    parallelJobs: false,
  },
  "diffusion-mid": {
    id: "diffusion-mid",
    label: "Diffusion Mid (8-12 GB VRAM)",
    vramRangeGB: { min: 8, max: 12 },
    image: {
      width: 1024,
      height: 1024,
      steps: 8,
      sampler: "DPM++ SDE Karras",
      model: "sdxl_turbo",
      allowControlNet: true,
      allowControlNetStacking: false,
      allowLoRA: true,
    },
    video: {
      model: "ltx_video",
      clipSeconds: 4,
      fps: 24,
      height: 480,
      width: 720,
      enabled: true,
    },
    parallelJobs: false,
  },
  "diffusion-high": {
    id: "diffusion-high",
    label: "Diffusion High (12-20 GB VRAM)",
    vramRangeGB: { min: 12, max: 20 },
    image: {
      width: 1024,
      height: 1024,
      steps: 30,
      sampler: "DPM++ 2M Karras",
      model: "sdxl",
      allowControlNet: true,
      allowControlNetStacking: true,
      allowLoRA: true,
    },
    video: {
      model: "ltx_video",
      clipSeconds: 8,
      fps: 24,
      height: 720,
      width: 1280,
      enabled: true,
    },
    parallelJobs: false,
  },
  "diffusion-pro": {
    id: "diffusion-pro",
    label: "Diffusion Pro (24 GB+ VRAM)",
    vramRangeGB: { min: 20, max: Infinity },
    image: {
      width: 1024,
      height: 1024,
      steps: 30,
      sampler: "DPM++ 2M Karras",
      model: "flux",
      allowControlNet: true,
      allowControlNetStacking: true,
      allowLoRA: true,
    },
    video: {
      model: "cogvideox_5b",
      clipSeconds: 8,
      fps: 24,
      height: 720,
      width: 1280,
      enabled: true,
    },
    parallelJobs: true,
  },
};

/**
 * Classify free / total VRAM into a diffusion tier. The input must be
 * expressed in GB (not MB). Values <= 0 fall through to `diffusion-low`
 * so a CPU-only host still gets a coherent default profile.
 */
export function classifyDiffusionTier(vramGB: number): DiffusionTierId {
  if (vramGB >= 20) return "diffusion-pro";
  if (vramGB >= 12) return "diffusion-high";
  if (vramGB >= 8) return "diffusion-mid";
  return "diffusion-low";
}

export function getDiffusionTierConfig(id: DiffusionTierId): DiffusionTierConfig {
  const config = DIFFUSION_TIER_CONFIGS[id];
  if (!config) {
    throw new Error(`Invalid diffusion tier id: ${String(id)}`);
  }
  return config;
}

export interface ResolvedDiffusionTier {
  readonly detected: DiffusionTierId;
  readonly effective: DiffusionTierId;
  readonly overridden: boolean;
}

/**
 * Combine an auto-detected tier with an optional user override into the
 * single tier the rest of the app reads from.
 */
export function resolveDiffusionTier(
  vramGB: number,
  override: DiffusionTierId | null | undefined,
): ResolvedDiffusionTier {
  const detected = classifyDiffusionTier(vramGB);
  if (override && DIFFUSION_TIER_CONFIGS[override]) {
    return { detected, effective: override, overridden: detected !== override };
  }
  return { detected, effective: detected, overridden: false };
}

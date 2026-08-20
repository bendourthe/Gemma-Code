/**
 * v2.0.0 Phase 3 -- gate the talking-head (`audio2video`) mode.
 *
 * Avatar-1.5 INT8 is `diffusion-pro` only, needs an explicit user action,
 * and only the official `meituan-longcat` org is eligible. Community
 * re-quantizations are rejected here and again in the Python adapter.
 */

import type { DiffusionTierId } from "../config/DiffusionTier.js";

export const AVATAR_MIN_VRAM_GB = 20;
export const AVATAR_REQUIRED_TIER: DiffusionTierId = "diffusion-pro";
export const OFFICIAL_AVATAR_ORG = "meituan-longcat";
export const OFFICIAL_AVATAR_REPO = "meituan-longcat/LongCat-Video-Avatar-1.5";
export const OFFICIAL_AVATAR_MODEL_ID = "longcat-video-avatar-1.5";

export type AvatarGateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

export function assertAvatarAllowed(input: {
  readonly tierId: DiffusionTierId;
  readonly vramGB: number;
  readonly confirmed: boolean;
  readonly weightRepo?: string;
  readonly modelId?: string;
}): AvatarGateResult {
  if (!input.confirmed) {
    return {
      ok: false,
      code: "avatar-unconfirmed",
      message:
        "Avatar mode needs an explicit confirmation that the talking-head video is generated locally and never leaves this device.",
    };
  }
  if (input.tierId !== AVATAR_REQUIRED_TIER) {
    return {
      ok: false,
      code: "avatar-tier",
      message:
        "Avatar mode is gated to diffusion-pro (about 20 GB+ VRAM). This host's video tier cannot run LongCat-Video-Avatar-1.5 INT8.",
    };
  }
  if (!(input.vramGB >= AVATAR_MIN_VRAM_GB)) {
    return {
      ok: false,
      code: "avatar-vram",
      message: `Avatar mode needs at least ${AVATAR_MIN_VRAM_GB} GB VRAM. Detected ${input.vramGB} GB.`,
    };
  }
  if (input.modelId && input.modelId !== OFFICIAL_AVATAR_MODEL_ID) {
    return {
      ok: false,
      code: "avatar-model",
      message: "Avatar mode only runs the official longcat-video-avatar-1.5 catalog entry.",
    };
  }
  if (input.weightRepo && !input.weightRepo.startsWith(`${OFFICIAL_AVATAR_ORG}/`)) {
    return {
      ok: false,
      code: "avatar-unofficial",
      message:
        "Only official meituan-longcat weights are eligible. Community re-quantizations are rejected.",
    };
  }
  return { ok: true };
}

export function avatarAvailable(tierId: DiffusionTierId, vramGB: number): boolean {
  return tierId === AVATAR_REQUIRED_TIER && vramGB >= AVATAR_MIN_VRAM_GB;
}

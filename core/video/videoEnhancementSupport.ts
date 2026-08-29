/**
 * v2.3.0 Phase 5 -- packaging and setup copy for optional video enhancement.
 *
 * Backend-neutral math lives beside the preset registry. This module owns the
 * user-facing setup strings, configuration key names, and platform labels so
 * installer, Settings, capability copy, and packaging tests cannot drift.
 */

import supportJson from "./video-enhancement-support.json";
import {
  VIDEO_ENHANCEMENT_PRESETS,
  type RationalFrameRate,
  type VideoEnhancementCapabilityReason,
  type VideoEnhancementInterpolationPresetId,
  type VideoEnhancementUpscalePresetId,
} from "./VideoEnhancement.js";

export const VIDEO_ENHANCEMENT_SUPPORT = supportJson;

export const VIDEO2X_ENV_KEY = VIDEO_ENHANCEMENT_SUPPORT.envKey;
export const VIDEO2X_SETTING_KEY = VIDEO_ENHANCEMENT_SUPPORT.settingKey;

export function videoEnhancementCapabilityCopy(
  reason: VideoEnhancementCapabilityReason | string,
): string {
  const copy = VIDEO_ENHANCEMENT_SUPPORT.capabilityCopy;
  if (reason in copy) {
    return copy[reason as VideoEnhancementCapabilityReason];
  }
  return "Video enhancement is unavailable on this host.";
}

export interface VideoEnhancementGeometrySource {
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
  readonly durationSeconds: number;
  readonly frameCount?: number;
}

export interface VideoEnhancementGeometry {
  readonly width: number;
  readonly height: number;
  readonly frameRate: RationalFrameRate;
  readonly durationSeconds: number;
  readonly frameCount: number;
}

export function expectedVideoEnhancementGeometry(
  source: VideoEnhancementGeometrySource,
  input: {
    readonly upscalePreset?: VideoEnhancementUpscalePresetId | null;
    readonly interpolationPreset?: VideoEnhancementInterpolationPresetId | null;
  },
): VideoEnhancementGeometry {
  const scale =
    input.upscalePreset &&
    VIDEO_ENHANCEMENT_PRESETS[input.upscalePreset].kind === "upscale"
      ? VIDEO_ENHANCEMENT_PRESETS[input.upscalePreset].scaleFactor
      : 1;
  const multiplier =
    input.interpolationPreset &&
    VIDEO_ENHANCEMENT_PRESETS[input.interpolationPreset].kind === "interpolate"
      ? VIDEO_ENHANCEMENT_PRESETS[input.interpolationPreset].frameRateMultiplier
      : 1;
  const fps = source.frameRate.numerator / source.frameRate.denominator;
  const sourceFrames =
    source.frameCount ??
    Math.max(1, Math.round(source.durationSeconds * fps));
  return {
    width: source.width * scale,
    height: source.height * scale,
    frameRate: {
      numerator: source.frameRate.numerator * multiplier,
      denominator: source.frameRate.denominator,
    },
    durationSeconds: source.durationSeconds,
    frameCount: sourceFrames * multiplier,
  };
}

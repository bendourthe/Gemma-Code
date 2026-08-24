/**
 * v1.0.0 Phase 7.1 -- video job dispatcher.
 *
 * Translates validated IPC requests into Python-runtime calls and
 * produces a deterministic `jobId` so the UI can correlate progress
 * events with the originating request.
 *
 * Mirrors `dispatcher.ts` (image side); split into its own module so
 * the video pipeline can ship without re-shaping the image dispatcher
 * tests.
 */

import { type DiffusionRuntimeClient } from "./runtimeClient.js";
import { foldRequestModelId, resolveVideoMethod } from "./route.js";
import { requireUsableVideoPath } from "./resultGuard.js";
import { assertAvatarAllowed } from "../../../../core/video/avatarGate.js";
import {
  buildAvatarProvenance,
  type AvatarProvenance,
} from "../../../../core/video/avatarProvenance.js";

export type VideoDispatcherMode = "text2video" | "image2video" | "audio2video";

export interface VideoDispatcherResult {
  readonly jobId: string;
  readonly mode: VideoDispatcherMode;
  readonly offloadStrategy?: string;
  readonly estimatedSeconds?: number;
  readonly frameCount?: number;
  readonly provenance?: AvatarProvenance;
  readonly mp4Path?: string;
  readonly workflow?: Record<string, unknown>;
}

let _counter = 0;
let _jobIdFactory: () => string = () => {
  _counter += 1;
  return `video-${Date.now().toString(36)}-${_counter.toString(36)}`;
};

/** Allocate the next video job id without talking to the runtime. */
export function nextVideoJobId(): string {
  return _jobIdFactory();
}

/** Test seam: deterministic ids in unit tests. */
export function setVideoJobIdFactory(fn: () => string): void {
  _jobIdFactory = fn;
}

/** Reset to the default counter-based factory. */
export function resetVideoJobIdFactory(): void {
  _counter = 0;
  _jobIdFactory = () => {
    _counter += 1;
    return `video-${Date.now().toString(36)}-${_counter.toString(36)}`;
  };
}

/** Fail closed before enqueue so a talking-head job never sits in the queue un-gated. */
export function gateAudio2VideoRequest(request: Record<string, unknown>): void {
  const gate = assertAvatarAllowed({
    tierId: (typeof request.diffusionTier === "string"
      ? request.diffusionTier
      : "diffusion-low") as
      | "diffusion-low"
      | "diffusion-mid"
      | "diffusion-high"
      | "diffusion-pro",
    vramGB: typeof request.vramGB === "number" ? request.vramGB : 0,
    confirmed: request.confirmLocalAvatar === true,
    weightRepo: typeof request.weightRepo === "string" ? request.weightRepo : undefined,
    modelId: typeof request.modelId === "string" ? request.modelId : undefined,
  });
  if (!gate.ok) {
    throw new Error(`${gate.code}: ${gate.message}`);
  }
}

export function audio2videoProvenance(
  request: Record<string, unknown>,
): AvatarProvenance | undefined {
  if (typeof request.sourceImage !== "string" || typeof request.sourceAudio !== "string") {
    return undefined;
  }
  return buildAvatarProvenance({
    sourceImage: request.sourceImage,
    sourceAudio: request.sourceAudio,
    weightRepo: typeof request.weightRepo === "string" ? request.weightRepo : undefined,
    modelId: typeof request.modelId === "string" ? request.modelId : undefined,
  });
}

export async function buildVideoJobRequest(
  mode: VideoDispatcherMode,
  request: Record<string, unknown>,
  client: DiffusionRuntimeClient,
  jobId: string = _jobIdFactory(),
): Promise<VideoDispatcherResult> {
  if (mode === "audio2video") {
    gateAudio2VideoRequest(request);
  }
  const folded = foldRequestModelId(request);
  const payload = { jobId, mode, request: folded };
  const method = resolveVideoMethod(mode, folded["modelId"]);
  const accepted = (await client.call(method, payload)) as
    | (Partial<VideoDispatcherResult> & {
        extra?: { frameCount?: number };
        workflow?: { provenance?: Record<string, unknown> };
        mp4Path?: string;
        ok?: unknown;
        error?: unknown;
        message?: unknown;
      })
    | null;
  const mp4Path = requireUsableVideoPath(accepted, client.lastStderr?.() ?? "", (line) => {
    process.stderr.write(line);
  });
  const provenance = mode === "audio2video" ? audio2videoProvenance(folded) : undefined;
  return {
    jobId,
    mode,
    offloadStrategy: accepted?.offloadStrategy,
    estimatedSeconds: accepted?.estimatedSeconds,
    frameCount: accepted?.frameCount ?? accepted?.extra?.frameCount,
    mp4Path,
    workflow: accepted?.workflow as Record<string, unknown> | undefined,
    ...(provenance ? { provenance } : {}),
  };
}

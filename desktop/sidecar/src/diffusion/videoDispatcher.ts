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

export type VideoDispatcherMode = "text2video" | "image2video";

export interface VideoDispatcherResult {
  readonly jobId: string;
  readonly mode: VideoDispatcherMode;
  readonly offloadStrategy?: string;
  readonly estimatedSeconds?: number;
  readonly frameCount?: number;
}

let _counter = 0;
let _jobIdFactory: () => string = () => {
  _counter += 1;
  return `video-${Date.now().toString(36)}-${_counter.toString(36)}`;
};

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

const METHOD_FOR_MODE: Record<VideoDispatcherMode, string> = {
  text2video: "diffusion.video.text2video",
  image2video: "diffusion.video.image2video",
};

export async function buildVideoJobRequest(
  mode: VideoDispatcherMode,
  request: Record<string, unknown>,
  client: DiffusionRuntimeClient,
): Promise<VideoDispatcherResult> {
  const jobId = _jobIdFactory();
  const payload = { jobId, mode, request };
  const method = METHOD_FOR_MODE[mode];
  const accepted = (await client.call(method, payload)) as
    | (Partial<VideoDispatcherResult> & { extra?: { frameCount?: number } })
    | null;
  return {
    jobId,
    mode,
    offloadStrategy: accepted?.offloadStrategy,
    estimatedSeconds: accepted?.estimatedSeconds,
    frameCount: accepted?.frameCount ?? accepted?.extra?.frameCount,
  };
}

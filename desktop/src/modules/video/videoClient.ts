/**
 * v1.0.0 Phase 7.2 -- IPC client used by `VideoLabPage`.
 *
 * Wraps the three video IPC methods plus the progress-drain channel
 * behind a tiny interface so the page can be tested with an in-memory
 * client that emits scripted progress events. Mirrors
 * `modules/image/diffusionClient.ts` to keep the consumer API uniform
 * across pillars.
 */

import { ipc, type IpcReply } from "../../lib/ipc";

export type VideoMode = "text2video" | "image2video" | "audio2video";

export interface VideoContinueFrom {
  readonly priorJobId: string;
  readonly lastFramePath?: string;
  readonly segmentIndex: number;
  readonly segmentCount: number;
}

export interface VideoBaseRequest {
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: 854 | 1280;
  readonly height: 480 | 720;
  readonly durationSeconds: number;
  readonly fps: 12 | 16 | 24;
  readonly steps: number;
  readonly cfgScale: number;
  readonly sampler: string;
  readonly seed: number;
  readonly latentPreview?: boolean;
  readonly continueFrom?: VideoContinueFrom;
  readonly maxCacheVramGB?: number;
  readonly maxCacheRamGB?: number;
  readonly workingMemReserveGB?: number;
  readonly layerStreaming?: boolean;
}

export interface Text2VideoRequest extends VideoBaseRequest {}
export interface Image2VideoRequest extends VideoBaseRequest {
  readonly sourceImage: string;
}

export interface Audio2VideoRequest extends VideoBaseRequest {
  readonly sourceImage: string;
  readonly sourceAudio: string;
  readonly confirmLocalAvatar: true;
  readonly diffusionTier?: string;
  readonly vramGB?: number;
  readonly weightRepo?: string;
}

export interface VideoJobAccepted {
  readonly jobId: string;
  readonly mode: VideoMode;
  readonly offloadStrategy?: string;
  readonly frameCount?: number;
}

export interface VideoProgressEvent {
  readonly kind: "progress" | "complete" | "error";
  readonly jobId: string;
  readonly stage?: string;
  readonly step?: number;
  readonly totalSteps?: number;
  /** Base64-encoded JPEG thumbnail for the current second. */
  readonly preview?: string;
  /** Which "second bucket" this preview belongs to (0-indexed). */
  readonly secondIndex?: number;
  readonly mp4Path?: string;
  readonly message?: string;
}

export interface VideoClient {
  text2video(req: Text2VideoRequest): Promise<VideoJobAccepted>;
  image2video(req: Image2VideoRequest): Promise<VideoJobAccepted>;
  audio2video(req: Audio2VideoRequest): Promise<VideoJobAccepted>;
  drainEvents(jobId: string): Promise<readonly VideoProgressEvent[]>;
  extractWorkflow(mp4Path: string): Promise<unknown | null>;
}

function unwrap<T>(reply: IpcReply<T>): T {
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.value;
}

export function createIpcVideoClient(): VideoClient {
  return {
    async text2video(req) {
      return unwrap(
        await ipc.call<VideoJobAccepted>(
          "diffusion.video.text2video",
          req as unknown as Record<string, unknown>,
        ),
      );
    },
    async image2video(req) {
      return unwrap(
        await ipc.call<VideoJobAccepted>(
          "diffusion.video.image2video",
          req as unknown as Record<string, unknown>,
        ),
      );
    },
    async audio2video(req) {
      return unwrap(
        await ipc.call<VideoJobAccepted>(
          "diffusion.video.audio2video",
          req as unknown as Record<string, unknown>,
        ),
      );
    },
    async drainEvents(jobId) {
      const value = unwrap(
        await ipc.call<{ events: VideoProgressEvent[] }>(
          "diffusion.job.drainEvents",
          { jobId },
        ),
      );
      return value.events;
    },
    async extractWorkflow(mp4Path) {
      const value = unwrap(
        await ipc.call<{ workflow: unknown | null }>(
          "diffusion.video.workflow.extract",
          { mp4Path },
        ),
      );
      return value.workflow;
    },
  };
}

/**
 * In-memory client used by tests. `scriptEvents` queues synthetic
 * progress / complete / error events so the UI's thumbnail strip,
 * timeline previewer, and gallery flows can be verified end-to-end
 * without a running Python sidecar.
 */
export class InMemoryVideoClient implements VideoClient {
  private nextId = 1;
  private readonly scripts = new Map<string, VideoProgressEvent[]>();
  public lastRequest: {
    mode: VideoMode;
    request: Record<string, unknown>;
  } | null = null;
  public readonly requests: Array<{ mode: VideoMode; request: Record<string, unknown> }> = [];
  public lastExtractInput: string | null = null;
  public extractResult: unknown | null = null;

  scriptEvents(jobId: string, events: VideoProgressEvent[]): void {
    this.scripts.set(jobId, [...events]);
  }

  private accept(mode: VideoMode, req: Record<string, unknown>): VideoJobAccepted {
    const jobId = `mem-video-${this.nextId++}`;
    this.lastRequest = { mode, request: req };
    this.requests.push({ mode, request: req });
    return {
      jobId,
      mode,
      offloadStrategy: "stub",
      frameCount: numberOr(req.durationSeconds, 0) * numberOr(req.fps, 0),
    };
  }

  async text2video(req: Text2VideoRequest): Promise<VideoJobAccepted> {
    return this.accept("text2video", req as unknown as Record<string, unknown>);
  }

  async image2video(req: Image2VideoRequest): Promise<VideoJobAccepted> {
    return this.accept("image2video", req as unknown as Record<string, unknown>);
  }

  async audio2video(req: Audio2VideoRequest): Promise<VideoJobAccepted> {
    return this.accept("audio2video", req as unknown as Record<string, unknown>);
  }

  async drainEvents(jobId: string): Promise<readonly VideoProgressEvent[]> {
    const queue = this.scripts.get(jobId) ?? [];
    this.scripts.delete(jobId);
    return queue;
  }

  async extractWorkflow(mp4Path: string): Promise<unknown | null> {
    this.lastExtractInput = mp4Path;
    return this.extractResult;
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

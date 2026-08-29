import type {
  VideoEnhancementCapabilityT,
  VideoEnhancementJobT,
} from "../../../sidecar/src/protocol";
import type {
  VideoEnhancementInterpolationPresetId,
  VideoEnhancementUpscalePresetId,
} from "../../../../core/video/VideoEnhancement";

import { ipc, type IpcReply } from "../../lib/ipc";

export type VideoEnhancementCapabilityDto = VideoEnhancementCapabilityT;
export type VideoEnhancementJobDto = VideoEnhancementJobT;
export type VideoEnhancementRuntimeErrorDto = NonNullable<
  VideoEnhancementJobDto["error"]
>;

interface VideoEnhancementEnqueueCommon {
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly timeoutMs?: number;
  readonly priority?: "interactive" | "batch";
  readonly idempotencyKey?: string;
  readonly retryOfChildJobId?: string;
}

export type VideoEnhancementEnqueueInput =
  | (VideoEnhancementEnqueueCommon & {
      readonly mode: "upscale";
      readonly upscalePreset: VideoEnhancementUpscalePresetId;
    })
  | (VideoEnhancementEnqueueCommon & {
      readonly mode: "interpolate";
      readonly interpolationPreset: VideoEnhancementInterpolationPresetId;
    })
  | (VideoEnhancementEnqueueCommon & {
      readonly mode: "upscale_interpolate";
      readonly upscalePreset: VideoEnhancementUpscalePresetId;
      readonly interpolationPreset: VideoEnhancementInterpolationPresetId;
    });

export interface VideoEnhancementEnqueueResult {
  readonly created: boolean;
  readonly job: VideoEnhancementJobDto;
}

export interface VideoEnhancementClient {
  capability(): Promise<VideoEnhancementCapabilityDto>;
  enqueue(input: VideoEnhancementEnqueueInput): Promise<VideoEnhancementEnqueueResult>;
  list(parentJobId: string): Promise<readonly VideoEnhancementJobDto[]>;
  cancel(childJobId: string): Promise<VideoEnhancementJobDto | null>;
}

export class VideoEnhancementClientError extends Error {
  readonly detail: VideoEnhancementRuntimeErrorDto | null;

  constructor(message: string, detail: VideoEnhancementRuntimeErrorDto | null = null) {
    super(message);
    this.name = "VideoEnhancementClientError";
    this.detail = detail;
  }
}

function unwrap<T>(reply: IpcReply<T>): T {
  if (!reply.ok) {
    throw new VideoEnhancementClientError(reply.message);
  }
  return reply.value;
}

export function createIpcVideoEnhancementClient(): VideoEnhancementClient {
  return {
    async capability() {
      const value = unwrap(
        await ipc.call<{ capability: VideoEnhancementCapabilityDto }>(
          "video.enhancement.capability",
          {},
        ),
      );
      return value.capability;
    },
    async enqueue(input) {
      const value = unwrap(
        await ipc.call<
          | {
              ok: true;
              created: boolean;
              job: VideoEnhancementJobDto;
            }
          | { ok: false; error: VideoEnhancementRuntimeErrorDto }
        >(
          "video.enhancement.enqueue",
          input as unknown as Record<string, unknown>,
        ),
      );
      if (!value.ok) {
        throw new VideoEnhancementClientError(value.error.message, value.error);
      }
      return { created: value.created, job: value.job };
    },
    async list(parentJobId) {
      const value = unwrap(
        await ipc.call<{ jobs: VideoEnhancementJobDto[] }>(
          "video.enhancement.list",
          { parentJobId },
        ),
      );
      return value.jobs;
    },
    async cancel(childJobId) {
      const value = unwrap(
        await ipc.call<{ job: VideoEnhancementJobDto | null }>(
          "video.enhancement.cancel",
          { childJobId },
        ),
      );
      return value.job;
    },
  };
}

export function isActiveVideoEnhancementJob(job: VideoEnhancementJobDto): boolean {
  return job.state === "queued" || job.state === "running";
}

const IN_MEMORY_HASH = "a".repeat(64);
const IN_MEMORY_ISO = "2026-08-28T12:00:00.000Z";

function availablePreset(): VideoEnhancementCapabilityDto["presets"]["smooth-2x"] {
  return { state: "available", reason: null };
}

export function inMemoryVideoEnhancementCapability(): VideoEnhancementCapabilityDto {
  return {
    status: "ready",
    reason: null,
    backend: {
      id: "video2x",
      compatibilityId: "video2x-cli-6.4.0",
      version: "6.4.0",
      executableSha256: IN_MEMORY_HASH,
      provenance: "user-supplied-unverified",
      configurationSource: "setting",
    },
    platform: { os: "win32", architecture: "x64", avx2: "available" },
    devices: [{ id: 0, type: "discrete_gpu", name: "Local GPU", selected: true }],
    presets: {
      "animation-upscale-2x": availablePreset(),
      "animation-upscale-4x": availablePreset(),
      "general-upscale-4x": availablePreset(),
      "smooth-2x": availablePreset(),
    },
    probedAt: IN_MEMORY_ISO,
    diagnostic: null,
  };
}

function inMemorySource() {
  return {
    path: "C:/videos/source.mp4",
    sha256: IN_MEMORY_HASH,
    sizeBytes: 1_024,
    durationSeconds: 4,
    width: 854,
    height: 480,
    frameRate: { numerator: 24, denominator: 1 },
  } as const;
}

function requestFromEnqueue(
  input: VideoEnhancementEnqueueInput,
): VideoEnhancementJobDto["request"] {
  const common = {
    requestId: `request-${input.parentJobId}`,
    parentJobId: input.parentJobId,
    source: inMemorySource(),
    requestedAt: IN_MEMORY_ISO,
    timeoutMs: input.timeoutMs ?? 60_000,
  };
  if (input.mode === "upscale") {
    return { ...common, mode: "upscale", upscalePreset: input.upscalePreset };
  }
  if (input.mode === "interpolate") {
    return {
      ...common,
      mode: "interpolate",
      interpolationPreset: input.interpolationPreset,
    };
  }
  return {
    ...common,
    mode: "upscale_interpolate",
    upscalePreset: input.upscalePreset,
    interpolationPreset: input.interpolationPreset,
  };
}

function upsertJob(
  jobs: readonly VideoEnhancementJobDto[],
  incoming: VideoEnhancementJobDto,
): VideoEnhancementJobDto[] {
  const found = jobs.some((job) => job.childJobId === incoming.childJobId);
  if (!found) return [incoming, ...jobs];
  return jobs.map((job) =>
    job.childJobId === incoming.childJobId ? incoming : job,
  );
}

/**
 * In-memory enhancement client used by Video Lab tests. Capability, jobs,
 * and terminal outcomes are scripted so the page can be verified without IPC.
 */
export class InMemoryVideoEnhancementClient implements VideoEnhancementClient {
  public capabilityValue: VideoEnhancementCapabilityDto =
    inMemoryVideoEnhancementCapability();
  public capabilityError: Error | null = null;
  public listError: Error | null = null;
  public jobs: VideoEnhancementJobDto[] = [];
  public readonly enqueued: VideoEnhancementEnqueueInput[] = [];
  public readonly cancelled: string[] = [];
  private nextChild = 1;

  async capability(): Promise<VideoEnhancementCapabilityDto> {
    if (this.capabilityError) throw this.capabilityError;
    return this.capabilityValue;
  }

  async enqueue(
    input: VideoEnhancementEnqueueInput,
  ): Promise<VideoEnhancementEnqueueResult> {
    this.enqueued.push(input);
    const childJobId = `mem-enhance-${this.nextChild++}`;
    const job: VideoEnhancementJobDto = {
      childJobId,
      parentJobId: input.parentJobId,
      sourceOutputId: input.sourceOutputId,
      backendId: "video2x",
      state: "queued",
      priority: input.priority ?? "interactive",
      estimatedVramGB: 8,
      request: requestFromEnqueue(input),
      idempotencyKey: input.idempotencyKey ?? null,
      attempt: 1,
      retryOfChildJobId: input.retryOfChildJobId ?? null,
      cancelRequested: false,
      progress: null,
      error: null,
      output: null,
      createdAt: IN_MEMORY_ISO,
      startedAt: null,
      finishedAt: null,
    };
    this.jobs = upsertJob(this.jobs, job);
    return { created: true, job };
  }

  async list(parentJobId: string): Promise<readonly VideoEnhancementJobDto[]> {
    if (this.listError) throw this.listError;
    return this.jobs.filter((job) => job.parentJobId === parentJobId);
  }

  async cancel(childJobId: string): Promise<VideoEnhancementJobDto | null> {
    this.cancelled.push(childJobId);
    const existing = this.jobs.find((job) => job.childJobId === childJobId);
    if (!existing) return null;
    const cancelled: VideoEnhancementJobDto = {
      ...existing,
      state: "cancelled",
      cancelRequested: true,
      finishedAt: IN_MEMORY_ISO,
      error: {
        code: "cancelled",
        message: "Enhancement cancelled.",
        retryable: true,
        stage: "preflight",
        diagnostics: null,
        terminationConfirmed: true,
      },
    };
    this.jobs = upsertJob(this.jobs, cancelled);
    return cancelled;
  }

  setJob(job: VideoEnhancementJobDto): void {
    this.jobs = upsertJob(this.jobs, job);
  }
}

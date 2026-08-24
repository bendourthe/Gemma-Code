/**
 * v1.0.0 Phase 6.5 -- IPC client used by `ImageStudioPage`.
 *
 * Wraps the four diffusion IPC methods plus the progress-drain channel
 * behind a tiny interface so the page can be tested with an in-memory
 * client that emits scripted progress events. The production client
 * forwards to `ipc.call` -- this module never imports the Tauri APIs
 * directly so vitest can build it under jsdom.
 */

import { ipc, type IpcReply } from "../../lib/ipc";

export type ImageMode = "txt2img" | "img2img" | "inpaint" | "outpaint";

export interface LoraRef {
  readonly id: string;
  readonly weight: number;
}

export interface ControlNetRef {
  readonly modelId: string;
  readonly conditionImage: string;
  readonly weight: number;
  readonly preprocessor: "pose" | "depth" | "canny" | "none";
}

export interface BaseRequest {
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly cfgScale: number;
  readonly sampler: string;
  readonly seed: number;
  readonly batchSize?: number;
  readonly latentPreview?: boolean;
  readonly loras?: readonly LoraRef[];
  readonly controlNet?: ControlNetRef;
}

export interface Txt2ImgRequest extends BaseRequest {}
export interface Img2ImgRequest extends BaseRequest {
  readonly sourceImage: string;
  readonly strength?: number;
}
export interface InpaintRequest extends BaseRequest {
  readonly sourceImage: string;
  readonly mask: string;
  readonly strength?: number;
}
export interface OutpaintRequest extends BaseRequest {
  readonly sourceImage: string;
  readonly direction: "left" | "right" | "top" | "bottom";
  readonly pixels: number;
}

export interface JobAccepted {
  readonly jobId: string;
  readonly mode: ImageMode;
  readonly offloadStrategy?: string;
}

export interface ProgressEvent {
  readonly kind: "progress" | "complete" | "error";
  readonly jobId: string;
  readonly stage?: string;
  readonly step?: number;
  readonly totalSteps?: number;
  readonly preview?: string;
  readonly outputPath?: string;
  readonly png?: string;
  readonly message?: string;
  readonly conditioningPreview?: string;
}

export interface SegmentCandidate {
  readonly id: string;
  readonly maskPngBase64: string;
  readonly score: number;
  readonly label: string;
}

export interface SegmentRequest {
  readonly sourceImage: string;
  readonly phrase: string;
  readonly hint?: { text?: string; x?: number; y?: number };
  readonly stub?: boolean;
}

export interface SegmentResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly candidates?: readonly SegmentCandidate[];
}

export interface DiffusionClient {
  txt2img(req: Txt2ImgRequest): Promise<JobAccepted>;
  img2img(req: Img2ImgRequest): Promise<JobAccepted>;
  inpaint(req: InpaintRequest): Promise<JobAccepted>;
  outpaint(req: OutpaintRequest): Promise<JobAccepted>;
  segment(req: SegmentRequest): Promise<SegmentResult>;
  drainEvents(jobId: string): Promise<readonly ProgressEvent[]>;
  extractWorkflow(pngBase64: string): Promise<unknown | null>;
}

function unwrap<T>(reply: IpcReply<T>): T {
  if (!reply.ok) {
    throw new Error(reply.message);
  }
  return reply.value;
}

export function createIpcDiffusionClient(): DiffusionClient {
  return {
    async txt2img(req) {
      return unwrap(
        await ipc.call<JobAccepted>("diffusion.txt2img", req as unknown as Record<string, unknown>),
      );
    },
    async img2img(req) {
      return unwrap(
        await ipc.call<JobAccepted>("diffusion.img2img", req as unknown as Record<string, unknown>),
      );
    },
    async inpaint(req) {
      return unwrap(
        await ipc.call<JobAccepted>("diffusion.inpaint", req as unknown as Record<string, unknown>),
      );
    },
    async outpaint(req) {
      return unwrap(
        await ipc.call<JobAccepted>("diffusion.outpaint", req as unknown as Record<string, unknown>),
      );
    },
    async segment(req) {
      return unwrap(
        await ipc.call<SegmentResult>("diffusion.segment", req as unknown as Record<string, unknown>),
      );
    },
    async drainEvents(jobId) {
      const value = unwrap(
        await ipc.call<{ events: ProgressEvent[] }>("diffusion.job.drainEvents", { jobId }),
      );
      return value.events;
    },
    async extractWorkflow(pngBase64) {
      const value = unwrap(
        await ipc.call<{ workflow: unknown | null }>("diffusion.workflow.extract", { pngBase64 }),
      );
      return value.workflow;
    },
  };
}

/**
 * In-memory client used by tests. The `script` function gates the
 * progression of synthetic events so a test can verify the UI updates
 * step-by-step.
 */
export class InMemoryDiffusionClient implements DiffusionClient {
  private nextId = 1;
  private readonly scripts = new Map<string, ProgressEvent[]>();
  public lastRequest: {
    mode: ImageMode;
    request: Record<string, unknown>;
  } | null = null;
  public lastExtractInput: string | null = null;
  public extractResult: unknown | null = null;

  scriptEvents(jobId: string, events: ProgressEvent[]): void {
    this.scripts.set(jobId, [...events]);
  }

  private accept(mode: ImageMode, req: Record<string, unknown>): JobAccepted {
    const jobId = `mem-job-${this.nextId++}`;
    this.lastRequest = { mode, request: req };
    return { jobId, mode, offloadStrategy: "stub" };
  }

  async txt2img(req: Txt2ImgRequest): Promise<JobAccepted> {
    return this.accept("txt2img", req as unknown as Record<string, unknown>);
  }
  async img2img(req: Img2ImgRequest): Promise<JobAccepted> {
    return this.accept("img2img", req as unknown as Record<string, unknown>);
  }
  async inpaint(req: InpaintRequest): Promise<JobAccepted> {
    return this.accept("inpaint", req as unknown as Record<string, unknown>);
  }
  async outpaint(req: OutpaintRequest): Promise<JobAccepted> {
    return this.accept("outpaint", req as unknown as Record<string, unknown>);
  }

  public lastSegment: SegmentRequest | null = null;
  public segmentResult: SegmentResult = {
    ok: true,
    candidates: [{ id: "c0", maskPngBase64: "mask", score: 0.9, label: "object" }],
  };

  async segment(req: SegmentRequest): Promise<SegmentResult> {
    this.lastSegment = req;
    return this.segmentResult;
  }

  async drainEvents(jobId: string): Promise<readonly ProgressEvent[]> {
    const queue = this.scripts.get(jobId) ?? [];
    this.scripts.delete(jobId);
    return queue;
  }

  async extractWorkflow(pngBase64: string): Promise<unknown | null> {
    this.lastExtractInput = pngBase64;
    return this.extractResult;
  }
}

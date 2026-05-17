// Method handlers for the Node sidecar.
//
// Phase 1 implemented `ping`. Phase 3 (v1.0.0) wired the coding-module
// surface (sessions, memory, trace). Phase 6 adds the diffusion runtime
// proxy: `diffusion.health` / `diffusion.version` and the four pipeline
// dispatchers (`txt2img` / `img2img` / `inpaint` / `outpaint`), plus the
// PNG workflow extractor that backs the Image Studio "Copy Workflow"
// action.

import {
  CodingMemorySnapshotRequest,
  CodingSessionCancelRequest,
  CodingSessionListRequest,
  CodingSessionResumeRequest,
  CodingSessionSendMessageRequest,
  CodingSessionStartRequest,
  CodingTraceSubscribeRequest,
  DiffusionDrainEventsRequest,
  DiffusionEmptyRequest,
  DiffusionImg2ImgRequest,
  DiffusionInpaintRequest,
  DiffusionOutpaintRequest,
  DiffusionTxt2ImgRequest,
  DiffusionVideoImage2VideoRequest,
  DiffusionVideoText2VideoRequest,
  DiffusionVideoWorkflowExtractRequest,
  DiffusionWorkflowExtractRequest,
  IPC_METHODS,
  METHOD_SCHEMAS,
  NotImplementedError,
  PingResponse,
  PingResponseT,
  isMethod,
  type Method,
} from "./protocol.js";
import { CodingSessionManager } from "./coding/sessionManager.js";
import { memorySnapshot, traceSubscribe } from "./coding/panelData.js";
import {
  type DiffusionRuntimeClient,
  InMemoryDiffusionRuntime,
} from "./diffusion/runtimeClient.js";
import {
  buildJobRequest,
  extractWorkflowFromBase64Png,
} from "./diffusion/dispatcher.js";
import { buildVideoJobRequest } from "./diffusion/videoDispatcher.js";
import {
  type FfmpegContext,
  extractWorkflow as extractVideoWorkflow,
} from "../../../core/video/WorkflowMetadata.js";

export const SIDECAR_VERSION = "1.0.0-alpha.0";

export interface HandlerContext {
  pid: number;
  platform: NodeJS.Platform;
  sessions: CodingSessionManager;
  diffusion: DiffusionRuntimeClient;
  ffmpeg: FfmpegContext;
}

export type HandlerFn = (params: unknown, ctx: HandlerContext) => Promise<unknown>;

export const DEFAULT_FFMPEG_CONTEXT: FfmpegContext = {
  ffmpegPath: process.env.NEXUS_FFMPEG_PATH ?? "ffmpeg",
  ffprobePath: process.env.NEXUS_FFPROBE_PATH ?? "ffprobe",
};

export function createHandlerContext(
  base: { pid: number; platform: NodeJS.Platform },
  sessions: CodingSessionManager = new CodingSessionManager(),
  diffusion: DiffusionRuntimeClient = new InMemoryDiffusionRuntime(),
  ffmpeg: FfmpegContext = DEFAULT_FFMPEG_CONTEXT,
): HandlerContext {
  return { ...base, sessions, diffusion, ffmpeg };
}

export const handlers: Record<Method, HandlerFn> = {
  ping: async (_params, ctx): Promise<PingResponseT> => {
    const response: PingResponseT = {
      ok: true,
      pid: ctx.pid,
      version: SIDECAR_VERSION,
      platform: ctx.platform,
    };
    PingResponse.parse(response);
    return response;
  },
  "models.list": async () => {
    throw new NotImplementedError("models.list");
  },
  "models.install": async () => {
    throw new NotImplementedError("models.install");
  },
  "coding.startTask": async () => {
    throw new NotImplementedError("coding.startTask");
  },
  "coding.session.start": async (params, ctx) => {
    const req = CodingSessionStartRequest.parse(params ?? {});
    return ctx.sessions.start(req);
  },
  "coding.session.sendMessage": async (params, ctx) => {
    const req = CodingSessionSendMessageRequest.parse(params ?? {});
    const events = ctx.sessions.sendMessage(req.sessionId, req.message);
    return { sessionId: req.sessionId, events };
  },
  "coding.session.cancel": async (params, ctx) => {
    const req = CodingSessionCancelRequest.parse(params ?? {});
    return ctx.sessions.cancel(req.sessionId);
  },
  "coding.session.list": async (params, ctx) => {
    CodingSessionListRequest.parse(params ?? {});
    return ctx.sessions.list();
  },
  "coding.session.resume": async (params, ctx) => {
    const req = CodingSessionResumeRequest.parse(params ?? {});
    return ctx.sessions.resume(req.sessionId);
  },
  "coding.memory.snapshot": async (params) => {
    CodingMemorySnapshotRequest.parse(params ?? {});
    return memorySnapshot();
  },
  "coding.trace.subscribe": async (params) => {
    CodingTraceSubscribeRequest.parse(params ?? {});
    return traceSubscribe();
  },
  "coding.sessions.list": async (params, ctx) => {
    CodingSessionListRequest.parse(params ?? {});
    return ctx.sessions.list();
  },
  "image.generate": async () => {
    throw new NotImplementedError("image.generate");
  },
  "video.generate": async () => {
    throw new NotImplementedError("video.generate");
  },
  "skills.sync": async () => {
    throw new NotImplementedError("skills.sync");
  },
  "telemetry.subscribe": async () => {
    throw new NotImplementedError("telemetry.subscribe");
  },
  "diffusion.health": async (params, ctx) => {
    DiffusionEmptyRequest.parse(params ?? {});
    return ctx.diffusion.call("health", {});
  },
  "diffusion.version": async (params, ctx) => {
    DiffusionEmptyRequest.parse(params ?? {});
    return ctx.diffusion.call("version", {});
  },
  "diffusion.txt2img": async (params, ctx) => {
    const req = DiffusionTxt2ImgRequest.parse(params ?? {});
    return buildJobRequest("txt2img", req, ctx.diffusion);
  },
  "diffusion.img2img": async (params, ctx) => {
    const req = DiffusionImg2ImgRequest.parse(params ?? {});
    return buildJobRequest("img2img", req, ctx.diffusion);
  },
  "diffusion.inpaint": async (params, ctx) => {
    const req = DiffusionInpaintRequest.parse(params ?? {});
    return buildJobRequest("inpaint", req, ctx.diffusion);
  },
  "diffusion.outpaint": async (params, ctx) => {
    const req = DiffusionOutpaintRequest.parse(params ?? {});
    return buildJobRequest("outpaint", req, ctx.diffusion);
  },
  "diffusion.job.drainEvents": async (params, ctx) => {
    const req = DiffusionDrainEventsRequest.parse(params ?? {});
    return { events: ctx.diffusion.drainEvents(req.jobId) };
  },
  "diffusion.workflow.extract": async (params) => {
    const req = DiffusionWorkflowExtractRequest.parse(params ?? {});
    const workflow = extractWorkflowFromBase64Png(req.pngBase64);
    return { workflow };
  },
  "diffusion.video.text2video": async (params, ctx) => {
    const req = DiffusionVideoText2VideoRequest.parse(params ?? {});
    return buildVideoJobRequest("text2video", req, ctx.diffusion);
  },
  "diffusion.video.image2video": async (params, ctx) => {
    const req = DiffusionVideoImage2VideoRequest.parse(params ?? {});
    return buildVideoJobRequest("image2video", req, ctx.diffusion);
  },
  "diffusion.video.workflow.extract": async (params, ctx) => {
    const req = DiffusionVideoWorkflowExtractRequest.parse(params ?? {});
    const workflow = await extractVideoWorkflow(req.mp4Path, ctx.ffmpeg);
    return { workflow };
  },
};

export async function dispatch(method: string, params: unknown, ctx: HandlerContext): Promise<unknown> {
  if (!isMethod(method)) {
    throw new Error(`UnknownMethod: ${method}`);
  }
  const schema = METHOD_SCHEMAS[method];
  schema.request.parse(params ?? {});
  const handler = handlers[method];
  return handler(params, ctx);
}

export const SUPPORTED_METHODS: readonly Method[] = IPC_METHODS;

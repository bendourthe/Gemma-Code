// Method handlers for the Node sidecar.
//
// Phase 1 implemented `ping`. Phase 3 (v1.0.0) wired the coding-module
// surface (sessions, memory, trace). Phase 6 adds the diffusion runtime
// proxy: `diffusion.health` / `diffusion.version` and the four pipeline
// dispatchers (`txt2img` / `img2img` / `inpaint` / `outpaint`), plus the
// PNG workflow extractor that backs the Image Studio "Copy Workflow"
// action.

import {
  ChatSessionSendMessageRequest,
  ChatSessionStartRequest,
  CodingMemorySnapshotRequest,
  CodingSessionCancelRequest,
  CodingSessionListRequest,
  CodingSessionResumeRequest,
  CodingSessionSendMessageRequest,
  CodingSessionStartRequest,
  CodingTraceSubscribeRequest,
  CredentialsDeleteRequest,
  CredentialsListRequest,
  CredentialsSetRequest,
  CredentialsStatusRequest,
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
  SkillsSyncRequest,
  SkillsOptimizePreviewRequest,
  SkillsOptimizeApplyRequest,
  type SkillsStatusResponseT,
  type SkillsSyncResponseT,
  type SkillsUpstreamLatestResponseT,
  type SkillsOptimizePreviewResponseT,
  type SkillsOptimizeApplyResponseT,
  IPC_METHODS,
  METHOD_SCHEMAS,
  NotImplementedError,
  PingResponse,
  PingResponseT,
  isMethod,
  type Method,
} from "./protocol.js";
import { existsSync } from "node:fs";
import {
  NexusHubSyncer,
  defaultDependencies,
  summarizeDiff,
} from "../../../core/skills/NexusHubSyncer.js";
import { catalogRoot, hubLayoutDir } from "../../../core/storage/paths.js";
import {
  readHubVersionManifest,
  resolveHubLayout,
  DEFAULT_HUB_SOURCE_REPO,
} from "../../../core/storage/hubVersionManifest.js";
import { CodingSessionManager } from "./coding/sessionManager.js";
import { SkillOptimizerManager } from "./coding/skillOptimizerManager.js";
import { ChatSessionManager } from "./chat/sessionManager.js";
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
import {
  type CredentialVault,
  createCredentialVault,
} from "../../../core/security/CredentialVault.js";

export const SIDECAR_VERSION = "1.0.0-alpha.0";

export interface HandlerContext {
  pid: number;
  platform: NodeJS.Platform;
  sessions: CodingSessionManager;
  /** v1.7.0 -- Local Chatbot Explorer session manager. */
  chat: ChatSessionManager;
  diffusion: DiffusionRuntimeClient;
  ffmpeg: FfmpegContext;
  /**
   * v1.5.0 Phase 5 (item 25) -- OS-keychain credential vault. The credential
   * IPC methods route here ONLY; there is no config-file write path, so a
   * credential set via the desktop UI lands in the keychain, never a plaintext
   * file.
   */
  credentials: CredentialVault;
  /** v1.12.0 EM.P2.A -- the two-call skill-optimizer preview/apply manager. */
  skillOptimizer: SkillOptimizerManager;
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
  credentials: CredentialVault = createCredentialVault(),
  chat: ChatSessionManager = new ChatSessionManager(),
  skillOptimizer: SkillOptimizerManager = new SkillOptimizerManager(),
): HandlerContext {
  return { ...base, sessions, chat, diffusion, ffmpeg, credentials, skillOptimizer };
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
    const events = await ctx.sessions.sendMessage(req.sessionId, req.message);
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
  // v1.1.0 Phase 11 (nexus VS Code extension surface) -- declared in the IPC
  // contract so the shell can compile against it, but not yet wired. These
  // throw NotImplementedError until Phase 11 lands the autocomplete / MCP /
  // settings backends; see METHOD_SCHEMAS (implemented: false) in protocol.ts.
  "chat.session.start": async (params, ctx) => {
    const req = ChatSessionStartRequest.parse(params ?? {});
    return ctx.chat.start(req);
  },
  "chat.session.sendMessage": async (params, ctx) => {
    const req = ChatSessionSendMessageRequest.parse(params ?? {});
    const events = await ctx.chat.sendMessage(req.sessionId, req.message);
    return { sessionId: req.sessionId, events };
  },
  "coding.chat.autocomplete": async () => {
    throw new NotImplementedError("coding.chat.autocomplete");
  },
  "mcp.list": async () => {
    throw new NotImplementedError("mcp.list");
  },
  "mcp.invoke": async () => {
    throw new NotImplementedError("mcp.invoke");
  },
  "settings.get": async () => {
    throw new NotImplementedError("settings.get");
  },
  "settings.set": async () => {
    throw new NotImplementedError("settings.set");
  },
  // v1.5.0 Phase 5 (item 25) -- credential management over the OS-keychain
  // vault. These route to `ctx.credentials` ONLY; no config file is touched.
  "credentials.status": async (params, ctx) => {
    CredentialsStatusRequest.parse(params ?? {});
    return { available: await ctx.credentials.isAvailable() };
  },
  "credentials.list": async (params, ctx) => {
    const req = CredentialsListRequest.parse(params ?? {});
    return { keys: await ctx.credentials.list(req.integration) };
  },
  "credentials.set": async (params, ctx) => {
    const req = CredentialsSetRequest.parse(params ?? {});
    await ctx.credentials.set(req.integration, req.key, req.value);
    return { ok: true as const };
  },
  "credentials.delete": async (params, ctx) => {
    const req = CredentialsDeleteRequest.parse(params ?? {});
    return { removed: await ctx.credentials.delete(req.integration, req.key) };
  },
  "image.generate": async () => {
    throw new NotImplementedError("image.generate");
  },
  "video.generate": async () => {
    throw new NotImplementedError("video.generate");
  },
  "skills.sync": async (params): Promise<SkillsSyncResponseT> => {
    const req = SkillsSyncRequest.parse(params ?? {});
    const result = await new NexusHubSyncer({}).sync({ tag: req.tag, apply: true });
    return {
      tag: result.tag,
      applied: result.applied,
      alreadyUpToDate: result.alreadyUpToDate,
      blocked: result.scan.decision === "block",
      summary: summarizeDiff(result.diff),
    };
  },
  "skills.status": async (): Promise<SkillsStatusResponseT> => {
    const root = catalogRoot();
    const manifest = readHubVersionManifest(root);
    const skillsDir = hubLayoutDir(root, "skills", resolveHubLayout(root));
    return {
      installedVersion: manifest?.version ?? null,
      catalogPresent: existsSync(skillsDir),
      sourceRepo: manifest?.source_repo ?? DEFAULT_HUB_SOURCE_REPO,
    };
  },
  "skills.upstreamLatest": async (): Promise<SkillsUpstreamLatestResponseT> => {
    try {
      const latestTag = await defaultDependencies().resolveLatestTag();
      return { latestTag };
    } catch {
      // Offline / rate-limited: report "unknown" rather than throwing.
      return { latestTag: null };
    }
  },
  "skills.optimize.preview": async (params, ctx): Promise<SkillsOptimizePreviewResponseT> => {
    const req = SkillsOptimizePreviewRequest.parse(params ?? {});
    const res = await ctx.skillOptimizer.preview(req);
    return { token: res.token, proposals: res.proposals.map((p) => ({ ...p })) };
  },
  "skills.optimize.apply": async (params, ctx): Promise<SkillsOptimizeApplyResponseT> => {
    const req = SkillsOptimizeApplyRequest.parse(params ?? {});
    return ctx.skillOptimizer.apply(req);
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

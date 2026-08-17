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
  ModelsInstallRequest,
  ModelsRemoveRequest,
  ModelsInstallDrainRequest,
  ModelsInstallCancelRequest,
  ServingSetEnabledRequest,
  type ServingStatusResponseT,
  MetricsEmptyRequest,
  type MetricsInferenceResponseT,
  OcrEmptyRequest,
  OcrParseDocumentRequest,
  OcrJobDrainRequest,
  OcrJobCancelRequest,
  type OcrHealthResponseT,
  type OcrJobDrainResponseT,
  SkillsSyncRequest,
  SkillsOptimizePreviewRequest,
  SkillsOptimizeApplyRequest,
  type SkillsStatusResponseT,
  type SkillsSyncResponseT,
  type SkillsUpstreamLatestResponseT,
  type SkillsOptimizePreviewResponseT,
  type SkillsOptimizeApplyResponseT,
  McpRegistryListRequest,
  McpRegistrySetToolDeniedRequest,
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
import { createModelsRuntime, type ModelsRuntime } from "./models/modelsService.js";
import { createServingRuntime, type ServingRuntime } from "./serving/servingRuntime.js";
import {
  type InferenceMetricsRegistry,
  sharedInferenceMetrics,
} from "../../../core/observability/InferenceMetrics.js";
import { createOcrRuntimeBundle, type OcrRuntime } from "../../../core/documents/ocrRuntimeFactory.js";
import {
  listMcpRegistrySettings,
  setMcpRegistryToolDenied,
} from "../../../modules/coding/mcp/McpRegistrySettings.js";

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
  /**
   * v1.15.0 Phase 4 (Issue 3) -- Settings > Models registry runtime (reflect +
   * install). Optional so tests inject a fake; production lazily builds the
   * real disk-backed runtime on first `models.*` call.
   */
  models?: ModelsRuntime;
  /**
   * v1.16.0 Phase 1 (adoption item A1) -- local serving-gateway runtime. Same
   * seam as `models`: optional so tests inject a fake, production lazily builds
   * the real settings-backed runtime on first `serving.*` call.
   */
  serving?: ServingRuntime;
  /**
   * v1.16.0 Phase 2 (adoption item A2) -- per-model inference metrics. Optional
   * so tests inject a populated registry; production reads the process-wide one
   * the instrumented LLM clients write to.
   */
  metrics?: InferenceMetricsRegistry;
  /**
   * v1.16.0 Phase 3 (adoption item A5) -- document-OCR runtime (Python client +
   * parse-job manager). Optional so tests inject the in-memory pair; production
   * lazily builds the real one on first `ocr.*` call, so a sidecar that never
   * parses a document never spawns Python.
   */
  ocr?: OcrRuntime;
  /**
   * v1.18.0 Phase 3 (OW-A5) -- project root for per-project MCP tool deny.
   * Production uses `NEXUS_WORKSPACE` or `process.cwd()`; tests inject a temp dir.
   */
  workspacePath?: string;
}

/** How many individual request records the Traces panel receives per poll. */
const RECENT_METRIC_LIMIT = 50;

/**
 * Lazily resolve the models runtime: the test-injected `ctx.models` when
 * present, else a memoized real runtime (built once per process on first use so
 * activation stays cheap and a missing Ollama / catalog never blocks startup).
 */
let _modelsRuntime: Promise<ModelsRuntime> | null = null;
async function resolveModelsRuntime(ctx: HandlerContext): Promise<ModelsRuntime> {
  if (ctx.models) return ctx.models;
  if (!_modelsRuntime) _modelsRuntime = createModelsRuntime();
  return _modelsRuntime;
}

/**
 * Lazily resolve the serving runtime, memoized per process. Unlike the models
 * runtime this is synchronous to build (no catalog load), but it stays lazy so a
 * sidecar that never touches `serving.*` opens no settings file.
 */
let _servingRuntime: ServingRuntime | null = null;
function resolveServingRuntime(ctx: HandlerContext): ServingRuntime {
  if (ctx.serving) return ctx.serving;
  if (!_servingRuntime) _servingRuntime = createServingRuntime();
  return _servingRuntime;
}

/**
 * Lazily resolve the OCR runtime, memoized per process. Kept lazy so a session
 * that never parses a document never spawns the Python child.
 */
let _ocrRuntime: OcrRuntime | null = null;
function resolveOcrRuntime(ctx: HandlerContext): OcrRuntime {
  if (ctx.ocr) return ctx.ocr;
  if (!_ocrRuntime) _ocrRuntime = createOcrRuntimeBundle();
  return _ocrRuntime;
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
  /**
   * v1.16.0 Phase 1 -- left undefined by default so the serving runtime stays
   * lazy (a sidecar that never calls `serving.*` binds nothing and touches no
   * settings file); tests pass a fake.
   */
  serving?: ServingRuntime,
  /** v1.16.0 Phase 2 -- left undefined so production reads the shared registry. */
  metrics?: InferenceMetricsRegistry,
  /** v1.16.0 Phase 3 -- left undefined so the Python child stays unspawned. */
  ocr?: OcrRuntime,
  workspacePath?: string,
): HandlerContext {
  return {
    ...base,
    sessions,
    chat,
    diffusion,
    ffmpeg,
    credentials,
    skillOptimizer,
    serving,
    metrics,
    ocr,
    workspacePath,
  };
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
  "models.list": async (_params, ctx) => {
    const { service } = await resolveModelsRuntime(ctx);
    return { models: await service.list() };
  },
  "models.install": async (params, ctx) => {
    const req = ModelsInstallRequest.parse(params ?? {});
    const { installer } = await resolveModelsRuntime(ctx);
    return { jobId: installer.start(req.id) };
  },
  "models.remove": async (params, ctx) => {
    const req = ModelsRemoveRequest.parse(params ?? {});
    const { service } = await resolveModelsRuntime(ctx);
    await service.remove(req.id);
    return { ok: true as const };
  },
  "models.diskUsage": async (_params, ctx) => {
    const { service } = await resolveModelsRuntime(ctx);
    return service.diskUsage();
  },
  "models.install.drainEvents": async (params, ctx) => {
    const req = ModelsInstallDrainRequest.parse(params ?? {});
    const { installer } = await resolveModelsRuntime(ctx);
    return installer.drain(req.jobId);
  },
  "models.install.cancel": async (params, ctx) => {
    const req = ModelsInstallCancelRequest.parse(params ?? {});
    const { installer } = await resolveModelsRuntime(ctx);
    installer.cancel(req.jobId);
    return { ok: true as const };
  },
  // v1.16.0 Phase 1 (adoption item A1) -- local serving gateway control.
  "serving.status": async (_params, ctx): Promise<ServingStatusResponseT> => {
    return resolveServingRuntime(ctx).status();
  },
  "serving.setEnabled": async (params, ctx): Promise<ServingStatusResponseT> => {
    const req = ServingSetEnabledRequest.parse(params ?? {});
    return resolveServingRuntime(ctx).setEnabled(req.enabled);
  },
  // v1.16.0 Phase 2 (adoption item A2) -- per-model inference analytics. Reads
  // the in-process registry the instrumented LLM clients write to; purely local,
  // no disk and no network.
  "metrics.inference": async (params, ctx): Promise<MetricsInferenceResponseT> => {
    MetricsEmptyRequest.parse(params ?? {});
    const registry = ctx.metrics ?? sharedInferenceMetrics();
    return {
      perModel: registry.perModel().map((m) => ({ ...m })),
      recent: registry.recent(RECENT_METRIC_LIMIT).map((r) => ({ ...r })),
    };
  },
  // v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing.
  "ocr.health": async (params, ctx): Promise<OcrHealthResponseT> => {
    OcrEmptyRequest.parse(params ?? {});
    const { client } = resolveOcrRuntime(ctx);
    try {
      const raw = (await client.call("health", {})) as Record<string, unknown>;
      return {
        ok: raw.ok === true,
        device: typeof raw.device === "string" ? raw.device : "unknown",
        platform: typeof raw.platform === "string" ? raw.platform : "unknown",
        vramTotalGB: typeof raw.vramTotalGB === "number" ? raw.vramTotalGB : null,
        engines: (raw.engines ?? {}) as OcrHealthResponseT["engines"],
      };
    } catch (err) {
      // A missing Python runtime is an EXPECTED state on a fresh install, not an
      // IPC failure: report it as unhealthy with a reason so the UI can explain.
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        device: "unknown",
        platform: "unknown",
        vramTotalGB: null,
        engines: {
          rapidocr: { available: false, reason: `document runtime unavailable: ${message}` },
        },
      };
    }
  },
  "ocr.parseDocument": async (params, ctx) => {
    const req = OcrParseDocumentRequest.parse(params ?? {});
    const { parser } = resolveOcrRuntime(ctx);
    return { jobId: parser.start(req) };
  },
  "ocr.job.drainEvents": async (params, ctx): Promise<OcrJobDrainResponseT> => {
    const req = OcrJobDrainRequest.parse(params ?? {});
    const { parser } = resolveOcrRuntime(ctx);
    const drained = parser.drain(req.jobId);
    return {
      events: drained.events.map((e) => ({ ...e })),
      done: drained.done,
      result: drained.result ? { ...drained.result, pages: [...drained.result.pages] } : null,
    };
  },
  "ocr.job.cancel": async (params, ctx) => {
    const req = OcrJobCancelRequest.parse(params ?? {});
    resolveOcrRuntime(ctx).parser.cancel(req.jobId);
    return { ok: true as const };
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
  "mcp.registry.list": async (_params, ctx) => {
    McpRegistryListRequest.parse(_params ?? {});
    const workspacePath = ctx.workspacePath ?? process.env.NEXUS_WORKSPACE ?? process.cwd();
    return listMcpRegistrySettings({ workspacePath });
  },
  "mcp.registry.setToolDenied": async (params, ctx) => {
    const req = McpRegistrySetToolDeniedRequest.parse(params ?? {});
    const workspacePath = ctx.workspacePath ?? process.env.NEXUS_WORKSPACE ?? process.cwd();
    const result = setMcpRegistryToolDenied({
      workspacePath,
      serverName: req.serverName,
      toolName: req.toolName,
      denied: req.denied,
    });
    return { ok: result.ok, reason: result.reason, servers: result.list.servers };
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

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
  DiffusionSegmentRequest,
  DiffusionTxt2ImgRequest,
  DiffusionVideoAudio2VideoRequest,
  DiffusionVideoImage2VideoRequest,
  DiffusionVideoText2VideoRequest,
  DiffusionVideoWorkflowExtractRequest,
  DiffusionWorkflowExtractRequest,
  GenerationQueueCancelRequest,
  GenerationQueueEnqueueRequest,
  GenerationQueueListRequest,
  GenerationQueuePendingCountRequest,
  GenerationQueueReorderRequest,
  TuningEmptyRequest,
  TuningDatasetBuildRequest,
  TuningJobStartRequest,
  TuningJobListRequest,
  TuningJobCancelRequest,
  TuningModelsListRequest,
  ModelsInstallRequest,
  ModelsRemoveRequest,
  ModelsInstallDrainRequest,
  ModelsInstallCancelRequest,
  ServingSetEnabledRequest,
  type ServingStatusResponseT,
  AcpSetEnabledRequest,
  type AcpStatusResponseT,
  MetricsEmptyRequest,
  type MetricsInferenceResponseT,
  OcrEmptyRequest,
  OcrParseDocumentRequest,
  OcrJobDrainRequest,
  OcrJobCancelRequest,
  type OcrHealthResponseT,
  type OcrJobDrainResponseT,
  AudioEmptyRequest,
  AudioTranscribeRequest,
  AudioSpeakRequest,
  type AudioHealthResponseT,
  type AudioTranscribeResponseT,
  type AudioSpeakResponseT,
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
  AskInboxListRequest,
  AskInboxIdRequest,
  AskInboxPendingCountRequest,
  AskSchedulerListRequest,
  AskSchedulerSetEnabledRequest,
  IPC_METHODS,
  METHOD_SCHEMAS,
  NotImplementedError,
  PingResponse,
  PingResponseT,
  isMethod,
  type Method,
} from "./protocol.js";
import { existsSync, readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
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
  embedWorkflow as embedVideoWorkflow,
  type VideoWorkflowMetadata,
} from "../../../core/video/WorkflowMetadata.js";
import { extractWorkflow as extractImageWorkflow } from "../../../core/image/WorkflowMetadata.js";
import { pumpOnce } from "../../../core/generations/queuePump.js";
import {
  createStudioRuntime,
  recordCompletion,
  takeCompletions,
  type StudioRuntime,
} from "./generations/studioRuntime.js";
import { createTuningRuntime, type TuningRuntime } from "./tuning/runtime.js";
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
import type { OcrRuntime } from "../../../core/documents/ocrRuntimeFactory.js";
import { getSharedOcrRuntime } from "./ocr/sharedRuntime.js";
import type { AudioRuntime } from "../../../core/audio/audioRuntimeFactory.js";
import { getSharedAudioRuntime } from "./audio/sharedRuntime.js";
import {
  listMcpRegistrySettings,
  setMcpRegistryToolDenied,
} from "../../../modules/coding/mcp/McpRegistrySettings.js";
import type { AskInbox } from "../../../modules/coding/autonomy/AskInbox.js";
import type { AgentRunScheduler } from "../../../modules/coding/autonomy/AgentRunScheduler.js";
import type { ParkedAsk } from "../../../modules/coding/autonomy/types.js";

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
   * v2.0.0 Phase 1 -- local STT/TTS runtime. Optional so tests inject the
   * in-memory client; production lazily builds on first `audio.*` call.
   */
  audio?: AudioRuntime;
  /**
   * v1.18.0 Phase 3 (OW-A5) -- project root for per-project MCP tool deny.
   * Production uses `NEXUS_WORKSPACE` or `process.cwd()`; tests inject a temp dir.
   */
  workspacePath?: string;
  /** v1.18.0 Phase 4 -- persistent approval queue. Tests inject a memory inbox. */
  askInbox?: AskInbox;
  /** v1.18.0 Phase 4 -- local cron-style agent-run scheduler. */
  scheduler?: AgentRunScheduler;
  /** v2.1.0 Phase 3 -- generation index + persistent queue. */
  studio?: StudioRuntime;
  /** v2.1.0 Phase 5 -- Unsloth Core fine-tuning. */
  tuning?: TuningRuntime;
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
 * that never parses a document never spawns the Python child. Shared with the
 * `parse_document` agent tool so Chat IPC and the coding host use one child.
 */
function resolveOcrRuntime(ctx: HandlerContext): OcrRuntime {
  return getSharedOcrRuntime(ctx.ocr);
}

function resolveAudioRuntime(ctx: HandlerContext): AudioRuntime {
  return getSharedAudioRuntime(ctx.audio);
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
  /** v2.0.0 Phase 1 -- left undefined so the STT/TTS child stays unspawned. */
  audio?: AudioRuntime,
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
    audio,
  };
}

function resolveStudio(ctx: HandlerContext): StudioRuntime {
  if (!ctx.studio) {
    ctx.studio = createStudioRuntime({ dbPath: ":memory:" });
  }
  return ctx.studio;
}

function resolveTuning(ctx: HandlerContext): TuningRuntime {
  if (!ctx.tuning) {
    ctx.tuning = createTuningRuntime();
  }
  return ctx.tuning;
}

function jobDto(job: {
  id: string;
  pillar: "image" | "video";
  jobType: string;
  parameters: Record<string, unknown>;
  state: string;
  priority: string;
  sortOrder: number;
  error: string | null;
  threadId: string | null;
}) {
  return {
    id: job.id,
    pillar: job.pillar,
    jobType: job.jobType,
    parameters: job.parameters,
    state: job.state,
    priority: job.priority,
    sortOrder: job.sortOrder,
    error: job.error,
    threadId: job.threadId,
  };
}

function publicJobResult<T extends { pngBase64?: string; workflow?: unknown; mp4Path?: string }>(
  result: T,
): Omit<T, "pngBase64" | "workflow" | "mp4Path"> & { jobId: string } {
  const { pngBase64: _p, workflow: _w, mp4Path: _m, ...rest } = result;
  return rest as Omit<T, "pngBase64" | "workflow" | "mp4Path"> & { jobId: string };
}

function afterImageJob(ctx: HandlerContext, result: {
  jobId: string;
  mode: string;
  pngBase64?: string;
  workflow?: Record<string, unknown>;
}): void {
  const studio = resolveStudio(ctx);
  if (result.pngBase64) {
    recordCompletion(studio, {
      kind: "complete",
      jobId: result.jobId,
      png: result.pngBase64,
    });
    const bytes = Buffer.from(result.pngBase64, "base64");
    const wf =
      result.workflow ??
      (extractImageWorkflow(bytes) as Record<string, unknown> | null) ??
      undefined;
    if (wf) studio.index.put(bytes, "image", wf);
  }
  const existing = studio.queue.get(result.jobId);
  if (!existing) {
    studio.queue.enqueue({
      id: result.jobId,
      pillar: "image",
      jobType: result.mode,
      parameters: result.workflow ?? {},
      priority: "interactive",
    });
  }
  const current = studio.queue.get(result.jobId);
  if (current?.state === "done" || current?.state === "failed") return;
  if (result.pngBase64) studio.queue.markDone(result.jobId);
  else studio.queue.markRunning(result.jobId);
}

async function afterVideoJob(
  ctx: HandlerContext,
  result: {
    jobId: string;
    mode: string;
    mp4Path?: string;
    workflow?: Record<string, unknown>;
  },
): Promise<void> {
  const studio = resolveStudio(ctx);
  if (result.mp4Path && result.workflow) {
    try {
      await embedVideoWorkflow(
        result.mp4Path,
        result.workflow as unknown as VideoWorkflowMetadata,
        ctx.ffmpeg,
      );
    } catch {
      /* index still records even if ffmpeg embed fails */
    }
    try {
      const bytes = readFileSync(result.mp4Path);
      studio.index.put(bytes, "video", result.workflow);
    } catch {
      studio.index.put(result.mp4Path, "video", result.workflow);
    }
    recordCompletion(studio, {
      kind: "complete",
      jobId: result.jobId,
      outputPath: result.mp4Path,
    });
  }
  if (!studio.queue.get(result.jobId)) {
    studio.queue.enqueue({
      id: result.jobId,
      pillar: "video",
      jobType: result.mode,
      parameters: result.workflow ?? {},
      priority: "interactive",
    });
  }
  const current = studio.queue.get(result.jobId);
  if (current?.state === "done" || current?.state === "failed") return;
  if (result.mp4Path) studio.queue.markDone(result.jobId);
  else studio.queue.markRunning(result.jobId);
}

let _studioPumping = false;
async function pumpStudio(ctx: HandlerContext): Promise<void> {
  if (_studioPumping) return;
  _studioPumping = true;
  const studio = resolveStudio(ctx);
  try {
    for (;;) {
      const ran = await pumpOnce(studio.queue, {
        scheduler: studio.scheduler,
        index: studio.index,
        run: async (job) => {
          if (job.pillar === "video") {
            const result = await buildVideoJobRequest(
              job.jobType as "text2video" | "image2video" | "audio2video",
              job.parameters,
              ctx.diffusion,
            );
            if (result.mp4Path && result.workflow) {
              try {
                await embedVideoWorkflow(
                  result.mp4Path,
                  result.workflow as unknown as VideoWorkflowMetadata,
                  ctx.ffmpeg,
                );
              } catch {
                /* index still records */
              }
              recordCompletion(studio, {
                kind: "complete",
                jobId: result.jobId,
                outputPath: result.mp4Path,
              });
              return { outputPath: result.mp4Path, workflow: result.workflow };
            }
            return {};
          }
          const result = await buildJobRequest(
            job.jobType as "txt2img" | "img2img" | "inpaint" | "outpaint",
            job.parameters,
            ctx.diffusion,
          );
          if (result.pngBase64) {
            recordCompletion(studio, {
              kind: "complete",
              jobId: result.jobId,
              png: result.pngBase64,
            });
          }
          return {
            pngBase64: result.pngBase64,
            workflow: result.workflow as Record<string, unknown> | undefined,
          };
        },
      });
      if (!ran) break;
    }
  } finally {
    _studioPumping = false;
  }
}

function parkedAskDto(ask: ParkedAsk) {
  return {
    id: ask.id,
    state: ask.state,
    runMode: ask.runMode,
    createdAt: ask.createdAt,
    expiresAt: ask.expiresAt,
    decidedAt: ask.decidedAt,
    decisionReason: ask.decisionReason,
    toolName: ask.toolName,
    summary: ask.summary,
    detail: ask.detail,
    args: ask.args,
    risk: ask.risk,
    classificationReason: ask.classificationReason,
    parkedTier: ask.parkedTier,
    sessionId: ask.sessionId,
    runId: ask.runId,
  };
}

function requireAskInbox(ctx: HandlerContext): AskInbox {
  if (!ctx.askInbox) throw new Error("Ask inbox is not configured");
  return ctx.askInbox;
}

function requireScheduler(ctx: HandlerContext): AgentRunScheduler {
  if (!ctx.scheduler) throw new Error("Agent-run scheduler is not configured");
  return ctx.scheduler;
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
  // v1.18.0 Phase 5 (OI-A3) -- ACP mount on the shared control surface.
  "acp.status": async (_params, ctx): Promise<AcpStatusResponseT> => {
    return resolveServingRuntime(ctx).acpStatus();
  },
  "acp.setEnabled": async (params, ctx): Promise<AcpStatusResponseT> => {
    const req = AcpSetEnabledRequest.parse(params ?? {});
    return resolveServingRuntime(ctx).setAcpEnabled(req.enabled);
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
  "audio.health": async (params, ctx): Promise<AudioHealthResponseT> => {
    AudioEmptyRequest.parse(params ?? {});
    const client = resolveAudioRuntime(ctx);
    return client.health();
  },
  "audio.transcribe": async (params, ctx): Promise<AudioTranscribeResponseT> => {
    const req = AudioTranscribeRequest.parse(params ?? {});
    const client = resolveAudioRuntime(ctx);
    return client.transcribe({
      audioBase64: req.audioBase64,
      ...(req.mimeType ? { mimeType: req.mimeType } : {}),
    });
  },
  "audio.speak": async (params, ctx): Promise<AudioSpeakResponseT> => {
    const req = AudioSpeakRequest.parse(params ?? {});
    const client = resolveAudioRuntime(ctx);
    return client.speak({ text: req.text });
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
    const events = await ctx.chat.sendMessage(req.sessionId, req.message, req.images);
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
  "ask.inbox.list": async (params, ctx) => {
    const req = AskInboxListRequest.parse(params ?? {});
    const asks = await requireAskInbox(ctx).list(req.state);
    return { asks: asks.map(parkedAskDto) };
  },
  "ask.inbox.approve": async (params, ctx) => {
    const req = AskInboxIdRequest.parse(params ?? {});
    return requireAskInbox(ctx).approve(req.id);
  },
  "ask.inbox.deny": async (params, ctx) => {
    const req = AskInboxIdRequest.parse(params ?? {});
    return requireAskInbox(ctx).deny(req.id);
  },
  "ask.inbox.pendingCount": async (params, ctx) => {
    AskInboxPendingCountRequest.parse(params ?? {});
    return { pending: await requireAskInbox(ctx).pendingCount() };
  },
  "ask.scheduler.list": async (params, ctx) => {
    AskSchedulerListRequest.parse(params ?? {});
    return { schedules: requireScheduler(ctx).list() };
  },
  "ask.scheduler.setEnabled": async (params, ctx) => {
    const req = AskSchedulerSetEnabledRequest.parse(params ?? {});
    const schedule = await requireScheduler(ctx).setEnabled(req.id, req.enabled);
    return { ok: Boolean(schedule), schedule };
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
    const result = await buildJobRequest("txt2img", req, ctx.diffusion);
    afterImageJob(ctx, result);
    return publicJobResult(result);
  },
  "diffusion.img2img": async (params, ctx) => {
    const req = DiffusionImg2ImgRequest.parse(params ?? {});
    const result = await buildJobRequest("img2img", req, ctx.diffusion);
    afterImageJob(ctx, result);
    return publicJobResult(result);
  },
  "diffusion.inpaint": async (params, ctx) => {
    const req = DiffusionInpaintRequest.parse(params ?? {});
    const result = await buildJobRequest("inpaint", req, ctx.diffusion);
    afterImageJob(ctx, result);
    return publicJobResult(result);
  },
  "diffusion.outpaint": async (params, ctx) => {
    const req = DiffusionOutpaintRequest.parse(params ?? {});
    const result = await buildJobRequest("outpaint", req, ctx.diffusion);
    afterImageJob(ctx, result);
    return publicJobResult(result);
  },
  "diffusion.segment": async (params, ctx) => {
    const req = DiffusionSegmentRequest.parse(params ?? {});
    const run = async () => ctx.diffusion.call("segment", req);
    const studio = ctx.studio;
    if (studio) {
      const queued = await studio.scheduler.enqueue({
        moduleId: "image",
        jobType: "segment",
        estimatedVramGB: 2,
        priority: "foreground",
        run,
      });
      return queued.completion;
    }
    return run();
  },
  "diffusion.job.drainEvents": async (params, ctx) => {
    const req = DiffusionDrainEventsRequest.parse(params ?? {});
    const runtimeEvents = ctx.diffusion.drainEvents(req.jobId);
    const extras = ctx.studio ? takeCompletions(ctx.studio, req.jobId) : [];
    return { events: [...runtimeEvents, ...extras] };
  },
  "diffusion.workflow.extract": async (params, ctx) => {
    const req = DiffusionWorkflowExtractRequest.parse(params ?? {});
    let workflow = extractWorkflowFromBase64Png(req.pngBase64);
    if (!workflow) {
      const hit = resolveStudio(ctx).index.getByBytes(Buffer.from(req.pngBase64, "base64"));
      workflow = (hit?.workflow as typeof workflow) ?? null;
    }
    return { workflow };
  },
  "diffusion.video.text2video": async (params, ctx) => {
    const req = DiffusionVideoText2VideoRequest.parse(params ?? {});
    const result = await buildVideoJobRequest("text2video", req, ctx.diffusion);
    await afterVideoJob(ctx, result);
    return publicJobResult(result);
  },
  "diffusion.video.image2video": async (params, ctx) => {
    const req = DiffusionVideoImage2VideoRequest.parse(params ?? {});
    const result = await buildVideoJobRequest("image2video", req, ctx.diffusion);
    await afterVideoJob(ctx, result);
    return publicJobResult(result);
  },
  "diffusion.video.audio2video": async (params, ctx) => {
    const req = DiffusionVideoAudio2VideoRequest.parse(params ?? {});
    const result = await buildVideoJobRequest("audio2video", req, ctx.diffusion);
    await afterVideoJob(ctx, result);
    return publicJobResult(result);
  },
  "diffusion.video.workflow.extract": async (params, ctx) => {
    const req = DiffusionVideoWorkflowExtractRequest.parse(params ?? {});
    let workflow = await extractVideoWorkflow(req.mp4Path, ctx.ffmpeg);
    if (!workflow) {
      try {
        const bytes = readFileSync(req.mp4Path);
        const hit = resolveStudio(ctx).index.getByBytes(bytes);
        workflow = (hit?.workflow as typeof workflow) ?? null;
      } catch {
        const hit = resolveStudio(ctx).index.getByBytes(req.mp4Path);
        workflow = (hit?.workflow as typeof workflow) ?? null;
      }
    }
    return { workflow };
  },
  "generation.queue.list": async (params, ctx) => {
    const req = GenerationQueueListRequest.parse(params ?? {});
    const jobs = resolveStudio(ctx).queue.list(req.states);
    return { jobs: jobs.map(jobDto) };
  },
  "generation.queue.enqueue": async (params, ctx) => {
    const req = GenerationQueueEnqueueRequest.parse(params ?? {});
    const studio = resolveStudio(ctx);
    const id = req.id ?? `gen-${Date.now().toString(36)}`;
    const jobs = req.batchSpec
      ? studio.queue.enqueueBatch({
          id,
          pillar: req.pillar,
          jobType: req.jobType,
          parameters: req.parameters,
          priority: req.priority ?? "batch",
          threadId: req.threadId,
          batchSpec: req.batchSpec,
        })
      : [studio.queue.enqueue({
          id,
          pillar: req.pillar,
          jobType: req.jobType,
          parameters: req.parameters,
          priority: req.priority ?? "interactive",
          threadId: req.threadId,
        })];
    void pumpStudio(ctx);
    return { jobs: jobs.map(jobDto) };
  },
  "generation.queue.cancel": async (params, ctx) => {
    const req = GenerationQueueCancelRequest.parse(params ?? {});
    const job = resolveStudio(ctx).queue.cancel(req.id);
    return { job: job ? jobDto(job) : null };
  },
  "generation.queue.reorder": async (params, ctx) => {
    const req = GenerationQueueReorderRequest.parse(params ?? {});
    resolveStudio(ctx).queue.reorder(req.ids);
    return { ok: true as const };
  },
  "generation.queue.pendingCount": async (params, ctx) => {
    GenerationQueuePendingCountRequest.parse(params ?? {});
    return { count: resolveStudio(ctx).queue.pendingCount() };
  },
  "tuning.status": async (params, ctx) => {
    TuningEmptyRequest.parse(params ?? {});
    return resolveTuning(ctx).status();
  },
  "tuning.provision": async (params, ctx) => {
    TuningEmptyRequest.parse(params ?? {});
    return resolveTuning(ctx).provision();
  },
  "tuning.preflight": async (params, ctx) => {
    TuningEmptyRequest.parse(params ?? {});
    return resolveTuning(ctx).preflight();
  },
  "tuning.dataset.build": async (params, ctx) => {
    const req = TuningDatasetBuildRequest.parse(params ?? {});
    return resolveTuning(ctx).buildDataset(req);
  },
  "tuning.job.start": async (params, ctx) => {
    const req = TuningJobStartRequest.parse(params ?? {});
    const job = await resolveTuning(ctx).startJob(req);
    return { job };
  },
  "tuning.job.list": async (params, ctx) => {
    const req = TuningJobListRequest.parse(params ?? {});
    return { jobs: resolveTuning(ctx).listJobs(req.states) };
  },
  "tuning.job.cancel": async (params, ctx) => {
    const req = TuningJobCancelRequest.parse(params ?? {});
    const job = resolveTuning(ctx).cancelJob(req.id);
    return { job: job ?? null };
  },
  "tuning.models.list": async (params, ctx) => {
    const req = TuningModelsListRequest.parse(params ?? {});
    const models = await resolveTuning(ctx).listBaseModels(req.hostVramGB);
    return { models };
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

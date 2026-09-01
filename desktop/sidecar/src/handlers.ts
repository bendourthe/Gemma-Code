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
  EpisodicMemoryRecordRequest,
  EpisodicMemorySearchRequest,
  CodingMemorySnapshotRequest,
  CodingSessionCancelRequest,
  CodingSessionDeleteRequest,
  CodingSessionListRequest,
  CodingSessionRenameRequest,
  CodingSessionResumeRequest,
  CodingSessionSendMessageRequest,
  CodingSessionStartRequest,
  SessionDispositionRequest,
  SessionsListArchivedRequest,
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
  GenerationSchedulerSnapshotRequest,
  VideoEnhancementCapabilityRequest,
  VideoEnhancementCancelRequest,
  VideoEnhancementEnqueueRequest,
  VideoEnhancementListRequest,
  VideoVideo2xPathGetRequest,
  VideoVideo2xPathSetRequest,
  TuningEmptyRequest,
  TuningHardwareRequest,
  TuningDatasetBuildRequest,
  TuningJobStartRequest,
  TuningJobListRequest,
  TuningJobCancelRequest,
  TuningModelsListRequest,
  AuditListRequest,
  AuditStatusRequest,
  MediaSampleVideoFramesRequest,
  CodingParseDocumentStatusRequest,
  CodingParseDocumentSetEnabledRequest,
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
  ChatExplorerCreateChatRequest,
  ChatExplorerCreateFolderRequest,
  ChatExplorerIdRequest,
  ChatExplorerListMessagesRequest,
  ChatExplorerMoveChatRequest,
  ChatExplorerMoveFolderRequest,
  ChatExplorerRenameChatRequest,
  ChatExplorerRenameFolderRequest,
  ChatExplorerSearchRequest,
  ChatExplorerSetPersonaRequest,
  ChatExplorerAppendMessageRequest,
  ChatGenerateTitleRequest,
  StudioSessionCreateFolderRequest,
  StudioSessionCreateSessionRequest,
  StudioSessionIdRequest,
  StudioSessionListTurnsRequest,
  StudioSessionMoveFolderRequest,
  StudioSessionMoveSessionRequest,
  StudioSessionRenameFolderRequest,
  StudioSessionRenameSessionRequest,
  StudioSessionAppendTurnRequest,
  StudioSessionTreeRequest,
  DataExportRequest,
  DataImportRequest,
  SkillsSyncRequest,
  SkillsAutoSyncGetRequest,
  SkillsAutoSyncSetRequest,
  SkillsOptimizePreviewRequest,
  SkillsOptimizeApplyRequest,
  type SkillsStatusResponseT,
  type SkillsSyncResponseT,
  type SkillsUpstreamLatestResponseT,
  type SkillsOptimizePreviewResponseT,
  type SkillsOptimizeApplyResponseT,
  McpInvokeRequest,
  McpListRequest,
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
import * as path from "node:path";
import { Buffer } from "node:buffer";
import {
  NexusHubSyncer,
  defaultDependencies,
  summarizeSyncResult,
} from "../../../core/skills/NexusHubSyncer.js";
import {
  catalogRoot,
  hubLayoutDir,
  nexusHome,
} from "../../../core/storage/paths.js";
import { createWorkspaceScope } from "../../../core/project/WorkspaceScope.js";
import { WorkspaceScopeStore } from "../../../core/project/WorkspaceScopeStore.js";
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
import type { MediaRuntimeService } from "./diffusion/runtimeFactory.js";
import {
  buildJobRequest,
  extractWorkflowFromBase64Png,
  nextJobId,
} from "./diffusion/dispatcher.js";
import { foldRequestModelId } from "./diffusion/route.js";
import {
  IMAGE_RUNTIME_NOT_READY,
  VIDEO_RUNTIME_NOT_READY,
} from "./diffusion/resultGuard.js";
import {
  audio2videoProvenance,
  buildVideoJobRequest,
  gateAudio2VideoRequest,
  nextVideoJobId,
} from "./diffusion/videoDispatcher.js";
import {
  type FfmpegContext,
  extractWorkflow as extractVideoWorkflow,
  embedWorkflow as embedVideoWorkflow,
  type VideoWorkflowMetadata,
} from "../../../core/video/WorkflowMetadata.js";
import { sampleVideoFramesFromDataUrl } from "../../../core/chat/sampleVideoFrames.js";
import { createHeadlessOcrParser } from "../../../core/documents/headlessOcrParser.js";
import {
  PARSE_DOCUMENT_SETTING_KEY,
  isParseDocumentEnabled,
} from "../../../core/documents/parseDocumentEnabled.js";
import {
  VIDEO2X_ENV_KEY,
  VIDEO2X_SETTING_KEY,
} from "../../../core/video/videoEnhancementSupport.js";
import {
  InMemorySettingsStore,
  JsonFileSettingsStore,
  type SettingsStore,
} from "../../../core/storage/SettingsStore.js";
import type { GenerationEnhancementMetadata } from "../../../core/generations/GenerationDatabase.js";
import { contentHashFile } from "../../../core/generations/contentHash.js";
import { pumpOnce } from "../../../core/generations/queuePump.js";
import {
  createStudioRuntime,
  recordCompletion,
  takeCompletions,
  type StudioRuntime,
} from "./generations/studioRuntime.js";
import {
  createVideoEnhancementRuntimeBundle,
  type VideoEnhancementRuntimeBundle,
} from "./video/VideoEnhancementRuntimeFactory.js";
import type {
  StoredVideoEnhancementJob,
  VideoEnhancementRuntimeIssue,
} from "./video/VideoEnhancementRuntime.js";
import { createTuningRuntime, type TuningRuntime } from "./tuning/runtime.js";
import { createAuditRuntime } from "./audit/runtime.js";
import type { AuditLog } from "../../../core/audit/index.js";
import type { TelemetryBus } from "../../../core/telemetry/TelemetryBus.js";
import {
  type CredentialVault,
  createCredentialVault,
} from "../../../core/security/CredentialVault.js";
import {
  createModelsRuntime,
  type ModelsRuntime,
} from "./models/modelsService.js";
import { sampleGpu } from "./telemetry/gpuRuntime.js";
import { readHubCatalog, readHubCommands } from "./skills/hubSkillReader.js";
import { generateChatTitle } from "./chat/titleGenerator.js";
import type { ChatExplorerOps } from "./chat/explorerRuntime.js";
import type { StudioSessionOps } from "./studio/sessionRuntime.js";
import type { ChatMemoryOps } from "./chat/memoryRuntime.js";
import { NEXUS_HUB_AUTO_SYNC_SETTING_KEY } from "../../../core/skills/NexusHubAutoSync.js";
import {
  createServingRuntime,
  type ServingRuntime,
} from "./serving/servingRuntime.js";
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
import { buildMcpHandlers } from "../../../core/coding/McpBridge.js";
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
  /** v2.4.1 -- shared media readiness and bounded repair coordinator. */
  mediaRuntime?: MediaRuntimeService;
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
  /** v2.4.1 -- durable workspace registry used before coding session allocation. */
  workspaceStore?: WorkspaceScopeStore;
  /** v1.18.0 Phase 4 -- persistent approval queue. Tests inject a memory inbox. */
  askInbox?: AskInbox;
  /** v1.18.0 Phase 4 -- local cron-style agent-run scheduler. */
  scheduler?: AgentRunScheduler;
  /** v2.1.0 Phase 3 -- generation index + persistent queue. */
  studio?: StudioRuntime;
  /** v2.3.0 Phase 3 -- optional local post-generation video enhancement. */
  videoEnhancement?: VideoEnhancementRuntimeBundle;
  /** v2.1.0 Phase 5 -- Unsloth Core fine-tuning. */
  tuning?: TuningRuntime;
  /** v2.1.0 Phase 6 -- signed local audit log. */
  audit?: AuditLog;
  /** v2.1.0 Phase 6 -- shared telemetry bus for audit attribution. */
  telemetry?: TelemetryBus;
  /** v2.2.3 Phase 4 -- durable Local Chat episodic memory. */
  chatMemory?: ChatMemoryOps;
  /** Optional settings store (parse_document toggle, tests). */
  settings?: SettingsStore;
}

/** How many individual request records the Traces panel receives per poll. */
const RECENT_METRIC_LIMIT = 50;

/**
 * Lazily resolve the models runtime: the test-injected `ctx.models` when
 * present, else a memoized real runtime (built once per process on first use so
 * activation stays cheap and a missing Ollama / catalog never blocks startup).
 */
let _modelsRuntime: Promise<ModelsRuntime> | null = null;
async function resolveModelsRuntime(
  ctx: HandlerContext,
): Promise<ModelsRuntime> {
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

let _workspaceStore: WorkspaceScopeStore | null = null;
function resolveWorkspaceStore(ctx: HandlerContext): WorkspaceScopeStore {
  if (ctx.workspaceStore) return ctx.workspaceStore;
  if (!_workspaceStore) _workspaceStore = new WorkspaceScopeStore();
  return _workspaceStore;
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

export type HandlerFn = (
  params: unknown,
  ctx: HandlerContext,
) => Promise<unknown>;

export function defaultFfmpegContext(
  env: NodeJS.ProcessEnv = process.env,
): FfmpegContext {
  return {
    ffmpegPath: env.NEXUS_FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: env.NEXUS_FFPROBE_PATH ?? "ffprobe",
  };
}

export function createHandlerContext(
  base: { pid: number; platform: NodeJS.Platform },
  sessions: CodingSessionManager = new CodingSessionManager(),
  diffusion: DiffusionRuntimeClient = new InMemoryDiffusionRuntime(),
  ffmpeg?: FfmpegContext,
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
    ffmpeg: ffmpeg ?? defaultFfmpegContext(),
    credentials,
    skillOptimizer,
    serving,
    metrics,
    ocr,
    workspacePath,
    audio,
  };
}

function isAbsoluteConfiguredPath(
  value: string,
  platform: NodeJS.Platform,
): boolean {
  const implementation = platform === "win32" ? path.win32 : path.posix;
  return (
    !value.includes("\0") &&
    !value.includes("\r") &&
    !value.includes("\n") &&
    implementation.isAbsolute(value)
  );
}

function video2xPathSnapshot(
  settingValue: string | undefined,
  env: NodeJS.ProcessEnv,
): {
  settingPath: string | null;
  envPath: string | null;
  configurationSource: "environment" | "setting" | null;
} {
  const envPath = env[VIDEO2X_ENV_KEY]?.trim() || null;
  const settingPath =
    typeof settingValue === "string" && settingValue.trim().length > 0
      ? settingValue.trim()
      : null;
  if (envPath) {
    return { settingPath, envPath, configurationSource: "environment" };
  }
  if (settingPath) {
    return { settingPath, envPath: null, configurationSource: "setting" };
  }
  return { settingPath: null, envPath: null, configurationSource: null };
}

function resolveStudio(ctx: HandlerContext): StudioRuntime {
  if (!ctx.studio) {
    ctx.studio = createStudioRuntime({
      dbPath: ":memory:",
      telemetry: ctx.telemetry,
    });
  }
  return ctx.studio;
}

function resolveVideoEnhancement(
  ctx: HandlerContext,
): VideoEnhancementRuntimeBundle {
  if (!ctx.videoEnhancement) {
    ctx.videoEnhancement = createVideoEnhancementRuntimeBundle({
      studio: resolveStudio(ctx),
      settings: resolveSettings(ctx),
      ffmpeg: ctx.ffmpeg,
      platform: ctx.platform,
      workspaceRoot: ctx.workspacePath ?? process.cwd(),
    });
  }
  return ctx.videoEnhancement;
}

function resolveTuning(ctx: HandlerContext): TuningRuntime {
  if (!ctx.tuning) {
    ctx.tuning = createTuningRuntime({
      telemetry: ctx.telemetry,
      extractPdf: async (file) => {
        try {
          const bytes = readFileSync(file);
          const result = await createHeadlessOcrParser(
            getSharedOcrRuntime(ctx.ocr).parser,
          ).parse(bytes.toString("base64"));
          const text = result.text.trim();
          return text.length > 0 ? text : null;
        } catch {
          return null;
        }
      },
    });
  }
  return ctx.tuning;
}

let _settingsStore: SettingsStore | null = null;
function resolveSettings(ctx: HandlerContext): SettingsStore {
  if (ctx.settings) return ctx.settings;
  if (!_settingsStore) {
    _settingsStore =
      process.env.VITEST === "true"
        ? new InMemorySettingsStore()
        : new JsonFileSettingsStore({
            filePath: path.join(nexusHome(), "settings.json"),
          });
  }
  return _settingsStore;
}

let _explorerOps: ChatExplorerOps | null = null;
/**
 * Lazily build the chat-explorer ops.
 *
 * The import is dynamic on purpose: `ChatExplorerStore` pulls in
 * `better-sqlite3` (a native module) and, through `src/storage/dbPermissions`,
 * a vscode-coupled logger. Importing it statically here would drag both into
 * every consumer of this module -- which broke ~30 handler test files at
 * collection time. Deferring it also means a session that never opens the chat
 * tab never loads the native binding or creates a database file.
 */
async function explorerOps(): Promise<ChatExplorerOps> {
  if (!_explorerOps) {
    const mod = await import("./chat/explorerRuntime.js");
    _explorerOps = mod.createChatExplorerOps();
  }
  return _explorerOps;
}

/** Test seam: drop the memoized explorer ops. */
export function resetExplorerOps(): void {
  _explorerOps = null;
}

let _studioSessionOps: StudioSessionOps | null = null;

async function studioSessionOps(): Promise<StudioSessionOps> {
  if (!_studioSessionOps) {
    const mod = await import("./studio/sessionRuntime.js");
    _studioSessionOps = mod.createStudioSessionOps();
  }
  return _studioSessionOps;
}

/** Test seam: drop the memoized studio-session ops. */
export function resetStudioSessionOps(): void {
  _studioSessionOps = null;
}

async function memoryOps(ctx: HandlerContext): Promise<ChatMemoryOps> {
  if (ctx.chatMemory) return ctx.chatMemory;
  const mod = await import("./chat/memoryRuntime.js");
  return mod.chatMemoryRuntime();
}

function resolveAudit(ctx: HandlerContext): AuditLog {
  if (!ctx.audit) {
    ctx.audit = createAuditRuntime({
      credentials: ctx.credentials,
      telemetry: ctx.telemetry,
      dbPath: ":memory:",
    }).log;
  }
  return ctx.audit;
}

function jobDto(job: {
  id: string;
  pillar: "image" | "video";
  jobType: string;
  parameters: Record<string, unknown>;
  parentId: string | null;
  enhancement: GenerationEnhancementMetadata | null;
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
    parentId: job.parentId,
    enhancement: job.enhancement,
    state: job.state,
    priority: job.priority,
    sortOrder: job.sortOrder,
    error: job.error,
    threadId: job.threadId,
  };
}

function enhancementJobDto(job: StoredVideoEnhancementJob) {
  return {
    childJobId: job.childJobId,
    parentJobId: job.parentJobId,
    sourceOutputId: job.sourceOutputId,
    backendId: job.backendId,
    state: job.state,
    priority: job.priority,
    estimatedVramGB: job.estimatedVramGB,
    request: job.request,
    idempotencyKey: job.idempotencyKey,
    attempt: job.attempt,
    retryOfChildJobId: job.retryOfChildJobId,
    cancelRequested: job.cancelRequested,
    progress: job.progress,
    error: job.error,
    output: job.output
      ? {
          outputId: job.output.outputId,
          path: job.output.path,
          contentHash: job.output.contentHash,
          sizeBytes: job.output.sizeBytes,
          durationSeconds: job.output.durationSeconds,
          width: job.output.width,
          height: job.output.height,
          frameRate: job.output.frameRate,
          provenanceRecordId: job.output.provenanceRecordId,
          preProvenanceContainerSha256: job.output.preProvenanceContainerSha256,
          publishedContainerSha256: job.output.publishedContainerSha256,
          workflow: job.output.workflow,
          durableProvenance: job.output.durableProvenance,
        }
      : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  };
}

function capabilityIssue(
  status: "unavailable" | "unsupported",
  diagnostic: string | null,
): VideoEnhancementRuntimeIssue {
  return {
    code:
      status === "unsupported" ? "unsupported_platform" : "backend_unavailable",
    message:
      status === "unsupported"
        ? "Video enhancement is unsupported on this platform."
        : "The optional local video enhancement pipeline is unavailable.",
    retryable: status !== "unsupported",
    stage: "preflight",
    diagnostics: diagnostic,
    terminationConfirmed: null,
  };
}

function publishPendingEnhancementCompletions(
  studio: StudioRuntime,
  bundle: VideoEnhancementRuntimeBundle,
  childJobId?: string,
): void {
  for (const event of bundle.persistence.listPendingCompletions()) {
    if (
      event.eventType !== "video.enhancement.completed" ||
      (childJobId !== undefined && event.jobId !== childJobId)
    ) {
      continue;
    }
    const job = studio.queue.get(event.jobId);
    const output = studio.index.getOutputForJob(event.jobId);
    if (!job || job.state !== "done" || !output) continue;
    recordCompletion(studio, {
      kind: "complete",
      jobId: event.jobId,
      outputPath: output.outputPath,
      outputId: output.id,
      outputHash: output.contentHash,
    });
    bundle.persistence.markCompletionDelivered(event.id);
  }
}

async function pumpStudio(ctx: HandlerContext): Promise<void> {
  const studio = resolveStudio(ctx);
  if (studio.pump.closing) return;
  studio.pump.requested = true;
  if (studio.pump.active) return studio.pump.active;

  const drain = (async (): Promise<void> => {
    do {
      studio.pump.requested = false;
      for (;;) {
        if (studio.pump.closing) break;
        const next = studio.queue.nextQueued();
        if (!next) break;
        if (next.enhancement) {
          const bundle = resolveVideoEnhancement(ctx);
          await bundle.initialize();
          const claimed = studio.queue.claimNext();
          if (!claimed || claimed.id !== next.id) {
            throw new Error("Enhancement queue claim lost its selected child.");
          }
          try {
            const outcome = await bundle.runtime.runClaimed(claimed.id);
            if (outcome.ok) {
              publishPendingEnhancementCompletions(studio, bundle, claimed.id);
            } else {
              recordCompletion(studio, {
                kind: "error",
                jobId: claimed.id,
                message: outcome.error.message,
              });
            }
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            studio.queue.markEnhancementInterrupted(claimed.id, message);
            recordCompletion(studio, {
              kind: "error",
              jobId: claimed.id,
              message,
            });
          }
          continue;
        }
        const ran = await pumpOnce(studio.queue, {
          scheduler: studio.scheduler,
          index: studio.index,
          onHandle: (handle, job) => {
            studio.activeHandles.set(job.id, handle);
            const current = studio.queue.get(job.id);
            if (current?.state === "failed" && current.error === "cancelled") {
              handle.cancel();
            }
          },
          onHandleSettled: (handle, job) => {
            if (studio.activeHandles.get(job.id) === handle) {
              studio.activeHandles.delete(job.id);
            }
          },
          onSuccess: (result, job) => {
            if (result.outputPath) {
              recordCompletion(studio, {
                kind: "complete",
                jobId: job.id,
                outputPath: result.outputPath,
                outputId: result.outputId,
                outputHash: result.outputHash,
              });
            } else if (result.pngBase64) {
              recordCompletion(studio, {
                kind: "complete",
                jobId: job.id,
                png: result.pngBase64,
              });
            }
          },
          onError: (event) => recordCompletion(studio, event),
          run: async (job) => {
            if (job.pillar === "video") {
              const result = await buildVideoJobRequest(
                job.jobType as "text2video" | "image2video" | "audio2video",
                job.parameters,
                ctx.diffusion,
                job.id,
              );
              if (!result.mp4Path) {
                throw new Error(VIDEO_RUNTIME_NOT_READY);
              }
              if (result.workflow) {
                try {
                  await embedVideoWorkflow(
                    result.mp4Path,
                    result.workflow as unknown as VideoWorkflowMetadata,
                    ctx.ffmpeg,
                  );
                } catch {
                  /* The playable clip remains valid even when metadata embedding fails. */
                }
              }
              return { outputPath: result.mp4Path, workflow: result.workflow };
            }
            const result = await buildJobRequest(
              job.jobType as "txt2img" | "img2img" | "inpaint" | "outpaint",
              job.parameters,
              ctx.diffusion,
              job.id,
            );
            if (!result.pngBase64) {
              throw new Error(IMAGE_RUNTIME_NOT_READY);
            }
            return {
              pngBase64: result.pngBase64,
              workflow: result.workflow as Record<string, unknown> | undefined,
            };
          },
        });
        if (!ran) break;
      }
    } while (studio.pump.requested && !studio.pump.closing);
  })();
  studio.pump.active = drain;
  try {
    await drain;
  } finally {
    if (studio.pump.active === drain) studio.pump.active = null;
    if (studio.pump.requested && !studio.pump.closing) void pumpStudio(ctx);
  }
}

async function enqueueInteractive(
  ctx: HandlerContext,
  pillar: "image" | "video",
  jobType: string,
  parameters: Record<string, unknown>,
): Promise<{
  jobId: string;
  mode: string;
  provenance?: ReturnType<typeof audio2videoProvenance>;
}> {
  if (pillar === "video" && jobType === "audio2video") {
    gateAudio2VideoRequest(foldRequestModelId(parameters));
  }
  const folded = foldRequestModelId(parameters);
  const studio = resolveStudio(ctx);
  const id = pillar === "video" ? nextVideoJobId() : nextJobId();
  studio.queue.enqueue({
    id,
    pillar,
    jobType,
    parameters: folded,
    priority: "interactive",
  });
  // Return immediately so the UI can poll drainEvents. pumpOnce still owns
  // the GPU slot (interactive jobs share the queue with batches).
  void pumpStudio(ctx).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[nexus-sidecar] studio-pump-failed job=${id}: ${message}\n`,
    );
    recordCompletion(studio, { kind: "error", jobId: id, message });
  });
  const provenance =
    pillar === "video" && jobType === "audio2video"
      ? audio2videoProvenance(folded)
      : undefined;
  return { jobId: id, mode: jobType, ...(provenance ? { provenance } : {}) };
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

function mcpHarnessFor(ctx: HandlerContext) {
  const workspacePath =
    ctx.workspacePath ?? process.env.NEXUS_WORKSPACE ?? process.cwd();
  return {
    async listTools() {
      const listed = listMcpRegistrySettings({ workspacePath });
      return listed.servers.flatMap((s) =>
        s.tools
          .filter((t) => t.exposed)
          .map((t) => ({
            name: `${s.name}/${t.name}`,
            description: t.reason,
            inputSchema: "{}",
            serverId: s.name,
          })),
      );
    },
    async invokeTool(name: string, _args: Record<string, unknown>) {
      return {
        ok: false,
        toolName: name,
        error:
          "mcp.invoke has no stdio harness in the sidecar. Deny tools via mcp.registry.setToolDenied.",
      };
    },
  };
}

function unavailableMediaRepairState() {
  return {
    state: "failed" as const,
    code: "REPAIR_SERVICE_UNAVAILABLE",
    message: "The media repair service is unavailable.",
    retryable: false,
    progress: 0,
    logPath: "",
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
    const runtime = await resolveModelsRuntime(ctx);
    const models = await runtime.service.list();
    const { loadSnapshot } = await import("./models/selectionSnapshot.js");
    const selection = await loadSnapshot();
    return { models, catalogStatus: runtime.catalogStatus, catalogHash: runtime.service.catalogHash, selection };
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
  "serving.setEnabled": async (
    params,
    ctx,
  ): Promise<ServingStatusResponseT> => {
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
  "metrics.inference": async (
    params,
    ctx,
  ): Promise<MetricsInferenceResponseT> => {
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
        vramTotalGB:
          typeof raw.vramTotalGB === "number" ? raw.vramTotalGB : null,
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
          rapidocr: {
            available: false,
            reason: `document runtime unavailable: ${message}`,
          },
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
      result: drained.result
        ? { ...drained.result, pages: [...drained.result.pages] }
        : null,
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
  "audio.transcribe": async (
    params,
    ctx,
  ): Promise<AudioTranscribeResponseT> => {
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
    const previous = req.workspaceId ? resolveWorkspaceStore(ctx).get(req.workspaceId) : undefined;
    const scope = await createWorkspaceScope(req, { previous });
    const stored = resolveWorkspaceStore(ctx).upsert(scope);
    return ctx.sessions.startWithScope(req, stored);
  },
  "coding.session.sendMessage": async (params, ctx) => {
    const req = CodingSessionSendMessageRequest.parse(params ?? {});
    ctx.telemetry?.publish({
      kind: "chat.turn",
      source: "coding",
      payload: { role: "worker", sessionId: req.sessionId },
    });
    const events = await ctx.sessions.sendMessage(req.sessionId, req.message);
    for (const event of events) {
      if (event.kind === "toolCallHeader") {
        ctx.telemetry?.publish({
          kind: "tool.call",
          source: "coding",
          payload: {
            role: "worker",
            sessionId: req.sessionId,
            name: event.name,
            callId: event.callId,
          },
        });
      }
    }
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
  "coding.session.rename": async (params, ctx) => {
    const req = CodingSessionRenameRequest.parse(params ?? {});
    return ctx.sessions.rename(req.sessionId, req.title);
  },
  "coding.session.delete": async (params, ctx) => {
    const req = CodingSessionDeleteRequest.parse(params ?? {});
    return ctx.sessions.delete(req.sessionId);
  },
  "sessions.archive": async (params, ctx) => {
    const req = SessionDispositionRequest.parse(params ?? {});
    if (req.pillar === "agents") {
      const result = ctx.sessions.archive(req.id);
      return { pillar: req.pillar, id: req.id, archivedAt: result.archivedAt };
    }
    if (req.pillar === "chatbot") {
      const chat = (await explorerOps()).archiveChat({ id: req.id });
      return { pillar: req.pillar, id: req.id, archivedAt: new Date(chat.archivedAt ?? Date.now()).toISOString() };
    }
    const session = (await studioSessionOps()).archiveSession({ id: req.id });
    return { pillar: req.pillar, id: req.id, archivedAt: new Date(session.archivedAt ?? Date.now()).toISOString() };
  },
  "sessions.listArchived": async (params, ctx) => {
    SessionsListArchivedRequest.parse(params ?? {});
    const sessions: Array<{ pillar: "chatbot" | "agents" | "images" | "videos"; id: string; title: string; archivedAt: string; originalParent: string | null }> = [];
    const errors: Array<{ pillar: "chatbot" | "agents" | "images" | "videos"; message: string }> = [];
    try {
      for (const chat of (await explorerOps()).listArchived().chats) {
        sessions.push({ pillar: "chatbot", id: chat.id, title: chat.title, archivedAt: new Date(chat.archivedAt).toISOString(), originalParent: chat.archivedFolderId ?? chat.folderId });
      }
    } catch (error) {
      errors.push({ pillar: "chatbot", message: error instanceof Error ? error.message : String(error) });
    }
    try {
      for (const session of ctx.sessions.listArchived()) {
        sessions.push({ pillar: "agents", id: session.id, title: session.title, archivedAt: session.archivedAt ?? session.createdAt, originalParent: null });
      }
    } catch (error) {
      errors.push({ pillar: "agents", message: error instanceof Error ? error.message : String(error) });
    }
    for (const [pillar, studioPillar] of [["images", "image"], ["videos", "video"]] as const) {
      try {
        for (const session of (await studioSessionOps()).listArchived({ pillar: studioPillar }).sessions) {
          sessions.push({ pillar, id: session.id, title: session.title, archivedAt: new Date(session.archivedAt).toISOString(), originalParent: session.archivedFolderId ?? session.folderId });
        }
      } catch (error) {
        errors.push({ pillar, message: error instanceof Error ? error.message : String(error) });
      }
    }
    return { sessions, errors };
  },
  "sessions.restore": async (params, ctx) => {
    const req = SessionDispositionRequest.parse(params ?? {});
    if (req.pillar === "agents") {
      const restored = ctx.sessions.restore(req.id);
      return { pillar: req.pillar, id: req.id, parentFallback: restored.parentFallback };
    }
    if (req.pillar === "chatbot") {
      const restored = (await explorerOps()).restoreChat({ id: req.id });
      return { pillar: req.pillar, id: req.id, parentFallback: restored.parentFallback };
    }
    const restored = (await studioSessionOps()).restoreSession({ id: req.id });
    return { pillar: req.pillar, id: req.id, parentFallback: restored.parentFallback };
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
    ctx.telemetry?.publish({
      kind: "chat.turn",
      source: "chat",
      payload: { role: "app", sessionId: req.sessionId },
    });
    const events = await ctx.chat.sendMessage(
      req.sessionId,
      req.message,
      req.images,
    );
    return { sessionId: req.sessionId, events };
  },
  "memory.episodic.record": async (params, ctx) =>
    (await memoryOps(ctx)).record(
      EpisodicMemoryRecordRequest.parse(params ?? {}),
    ),
  "memory.episodic.search": async (params, ctx) =>
    (await memoryOps(ctx)).search(
      EpisodicMemorySearchRequest.parse(params ?? {}),
    ),
  "coding.chat.autocomplete": async () => {
    throw new NotImplementedError("coding.chat.autocomplete");
  },
  "mcp.list": async (params, ctx) => {
    McpListRequest.parse(params ?? {});
    return buildMcpHandlers(mcpHarnessFor(ctx)).list();
  },
  "mcp.invoke": async (params, ctx) => {
    const req = McpInvokeRequest.parse(params ?? {});
    return buildMcpHandlers(mcpHarnessFor(ctx)).invoke(req);
  },
  "mcp.registry.list": async (_params, ctx) => {
    McpRegistryListRequest.parse(_params ?? {});
    const workspacePath =
      ctx.workspacePath ?? process.env.NEXUS_WORKSPACE ?? process.cwd();
    return listMcpRegistrySettings({ workspacePath });
  },
  "mcp.registry.setToolDenied": async (params, ctx) => {
    const req = McpRegistrySetToolDeniedRequest.parse(params ?? {});
    const workspacePath =
      ctx.workspacePath ?? process.env.NEXUS_WORKSPACE ?? process.cwd();
    const result = setMcpRegistryToolDenied({
      workspacePath,
      serverName: req.serverName,
      toolName: req.toolName,
      denied: req.denied,
    });
    return {
      ok: result.ok,
      reason: result.reason,
      servers: result.list.servers,
    };
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
    const schedule = await requireScheduler(ctx).setEnabled(
      req.id,
      req.enabled,
    );
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
    const result = await new NexusHubSyncer({}).sync({
      tag: req.tag,
      apply: true,
    });
    return {
      tag: result.tag,
      applied: result.applied,
      alreadyUpToDate: result.alreadyUpToDate,
      blocked: !result.applied && !result.alreadyUpToDate,
      quarantinedCount: result.quarantined.length,
      summary: summarizeSyncResult(result),
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
  // v2.2.0 Phase 3 (3.2): the real listing. `ipcSkillsClient.list()` returned a
  // hardcoded [] (NHC.P6.B), so the page showed (0) in every section no matter
  // what was on disk.
  "skills.list": async () => {
    const root = catalogRoot();
    const manifest = readHubVersionManifest(root);
    const listing = await readHubCatalog({
      catalogDir: root,
      tag: manifest?.version ?? null,
    });
    return { skills: listing.rows, error: listing.error };
  },
  "skills.autoSync.get": async (params, ctx) => {
    SkillsAutoSyncGetRequest.parse(params ?? {});
    const stored = await resolveSettings(ctx).get<boolean>(
      NEXUS_HUB_AUTO_SYNC_SETTING_KEY,
    );
    // v2.2.4 Phase 6: missing key defaults ON. An explicit false stays off.
    return { enabled: stored !== false };
  },
  "skills.autoSync.set": async (params, ctx) => {
    const req = SkillsAutoSyncSetRequest.parse(params ?? {});
    await resolveSettings(ctx).set(
      NEXUS_HUB_AUTO_SYNC_SETTING_KEY,
      req.enabled,
    );
    return { enabled: req.enabled };
  },
  // v2.2.0 Phase 3 (3.3): hub command discovery for the Agentic composer. The
  // desktop app previously had NO harness discovery at all -- only the VS Code
  // extension constructed the loader.
  "commands.list": async () => {
    const root = catalogRoot();
    let commandsDir: string | null = null;
    try {
      commandsDir = hubLayoutDir(root, "commands", resolveHubLayout(root));
    } catch {
      commandsDir = null;
    }
    const present = commandsDir !== null && existsSync(commandsDir);
    return {
      commands: present ? await readHubCommands(root) : [],
      catalogPresent: present,
    };
  },
  // v2.2.0 Phase 5 (5.1): persistent chat explorer. Every op resolves the
  // store lazily, so a session that never opens the chat tab never creates a
  // database file.
  "chat.explorer.tree": async () => (await explorerOps()).tree(),
  "chat.explorer.createFolder": async (params) =>
    (await explorerOps()).createFolder(
      ChatExplorerCreateFolderRequest.parse(params ?? {}),
    ),
  "chat.explorer.renameFolder": async (params) =>
    (await explorerOps()).renameFolder(
      ChatExplorerRenameFolderRequest.parse(params ?? {}),
    ),
  "chat.explorer.moveFolder": async (params) =>
    (await explorerOps()).moveFolder(
      ChatExplorerMoveFolderRequest.parse(params ?? {}),
    ),
  "chat.explorer.deleteFolder": async (params) =>
    (await explorerOps()).deleteFolder(
      ChatExplorerIdRequest.parse(params ?? {}),
    ),
  "chat.explorer.createChat": async (params) =>
    (await explorerOps()).createChat(
      ChatExplorerCreateChatRequest.parse(params ?? {}),
    ),
  "chat.explorer.renameChat": async (params) =>
    (await explorerOps()).renameChat(
      ChatExplorerRenameChatRequest.parse(params ?? {}),
    ),
  "chat.explorer.moveChat": async (params) =>
    (await explorerOps()).moveChat(
      ChatExplorerMoveChatRequest.parse(params ?? {}),
    ),
  "chat.explorer.deleteChat": async (params) =>
    (await explorerOps()).deleteChat(ChatExplorerIdRequest.parse(params ?? {})),
  "chat.explorer.setPersona": async (params) =>
    (await explorerOps()).setPersona(
      ChatExplorerSetPersonaRequest.parse(params ?? {}),
    ),
  "chat.explorer.appendMessage": async (params) =>
    (await explorerOps()).appendMessage(
      ChatExplorerAppendMessageRequest.parse(params ?? {}),
    ),
  "chat.explorer.listMessages": async (params) =>
    (await explorerOps()).listMessages(
      ChatExplorerListMessagesRequest.parse(params ?? {}),
    ),
  "chat.explorer.search": async (params) =>
    (await explorerOps()).search(ChatExplorerSearchRequest.parse(params ?? {})),
  // v2.2.0 Phase 5 (5.3): name a chat from its first message.
  // v2.2.9 Phase 1.5 (T005): the generated title now PERSISTS through the
  // explorer rename (machine path, never byUser), so the rail survives a
  // reload instead of relying on the caller's setActiveChat. A title the user
  // pinned (userRenamed) is never overwritten.
  "chat.generateTitle": async (params, ctx) => {
    const req = ChatGenerateTitleRequest.parse(params ?? {});
    const result = await generateChatTitle(req, ctx);
    try {
      const ops = await explorerOps();
      const chat = ops.getChat({ id: req.chatId });
      if (chat && chat.userRenamed !== true && chat.title !== result.title) {
        ops.renameChat({ id: req.chatId, title: result.title });
      }
    } catch {
      // Titling is a convenience; a persistence failure must not fail the RPC.
    }
    return result;
  },
  // v2.2.6 Phase 1: named Image/Video studio sessions.
  "studio.session.tree": async (params) =>
    (await studioSessionOps()).tree(
      StudioSessionTreeRequest.parse(params ?? {}),
    ),
  "studio.session.createFolder": async (params) =>
    (await studioSessionOps()).createFolder(
      StudioSessionCreateFolderRequest.parse(params ?? {}),
    ),
  "studio.session.renameFolder": async (params) =>
    (await studioSessionOps()).renameFolder(
      StudioSessionRenameFolderRequest.parse(params ?? {}),
    ),
  "studio.session.moveFolder": async (params) =>
    (await studioSessionOps()).moveFolder(
      StudioSessionMoveFolderRequest.parse(params ?? {}),
    ),
  "studio.session.deleteFolder": async (params) =>
    (await studioSessionOps()).deleteFolder(
      StudioSessionIdRequest.parse(params ?? {}),
    ),
  "studio.session.createSession": async (params) =>
    (await studioSessionOps()).createSession(
      StudioSessionCreateSessionRequest.parse(params ?? {}),
    ),
  "studio.session.renameSession": async (params) =>
    (await studioSessionOps()).renameSession(
      StudioSessionRenameSessionRequest.parse(params ?? {}),
    ),
  "studio.session.moveSession": async (params) =>
    (await studioSessionOps()).moveSession(
      StudioSessionMoveSessionRequest.parse(params ?? {}),
    ),
  "studio.session.deleteSession": async (params) =>
    (await studioSessionOps()).deleteSession(
      StudioSessionIdRequest.parse(params ?? {}),
    ),
  "studio.session.appendTurn": async (params) =>
    (await studioSessionOps()).appendTurn(
      StudioSessionAppendTurnRequest.parse(params ?? {}),
    ),
  "studio.session.listTurns": async (params) =>
    (await studioSessionOps()).listTurns(
      StudioSessionListTurnsRequest.parse(params ?? {}),
    ),
  // v2.2.0 Phase 8 (DF-16): local data export / import.
  //
  // These load the runtime lazily. transferRuntime reaches into the storage
  // paths module at call time, and a static import would pull that graph into
  // every handler test that only wanted an unrelated method.
  "data.categories": async () => {
    const { CATEGORIES } = await import("./data/transferRuntime.js");
    return {
      categories: CATEGORIES.map((c) => ({
        id: c.id,
        label: c.label,
        description: c.description,
        ...(c.sensitive ? { sensitive: true } : {}),
      })),
    };
  },
  "data.export": async (params) => {
    const req = DataExportRequest.parse(params ?? {});
    const { exportData } = await import("./data/transferRuntime.js");
    const result = await exportData({
      categories: req.categories,
      outPath: req.outPath,
      includeCredentials: req.includeCredentials === true,
    });
    return { path: result.path, bytes: result.bytes, empty: result.empty };
  },
  "data.import": async (params) => {
    const req = DataImportRequest.parse(params ?? {});
    const { importData } = await import("./data/transferRuntime.js");
    const result = await importData({
      archivePath: req.archivePath,
      dryRun: req.dryRun === true,
      ...(req.categories ? { categories: req.categories } : {}),
    });
    return {
      applied: result.applied,
      skipped: result.skipped,
      dryRun: result.dryRun,
      backupPath: result.backupPath,
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
  "skills.optimize.preview": async (
    params,
    ctx,
  ): Promise<SkillsOptimizePreviewResponseT> => {
    const req = SkillsOptimizePreviewRequest.parse(params ?? {});
    const res = await ctx.skillOptimizer.preview(req);
    return {
      token: res.token,
      proposals: res.proposals.map((p) => ({ ...p })),
    };
  },
  "skills.optimize.apply": async (
    params,
    ctx,
  ): Promise<SkillsOptimizeApplyResponseT> => {
    const req = SkillsOptimizeApplyRequest.parse(params ?? {});
    return ctx.skillOptimizer.apply(req);
  },
  // v2.2.0 Phase 2 (2.4): real GPU telemetry. The renderer polls this at the
  // cadence the mock stream used to tick at.
  "gpu.sample": async () => sampleGpu(),
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
  "diffusion.runtime.status": async (params, ctx) => {
    DiffusionEmptyRequest.parse(params ?? {});
    return ctx.mediaRuntime?.status() ?? unavailableMediaRepairState();
  },
  "diffusion.runtime.repair": async (params, ctx) => {
    DiffusionEmptyRequest.parse(params ?? {});
    return ctx.mediaRuntime?.startRepair() ?? unavailableMediaRepairState();
  },
  "diffusion.runtime.cancelRepair": async (params, ctx) => {
    DiffusionEmptyRequest.parse(params ?? {});
    return ctx.mediaRuntime?.cancelRepair() ?? unavailableMediaRepairState();
  },
  "diffusion.runtime.openLogLocation": async (params, ctx) => {
    DiffusionEmptyRequest.parse(params ?? {});
    return ctx.mediaRuntime?.openLogLocation() ?? { opened: false };
  },
  "diffusion.txt2img": async (params, ctx) => {
    const req = DiffusionTxt2ImgRequest.parse(params ?? {});
    return enqueueInteractive(
      ctx,
      "image",
      "txt2img",
      req as Record<string, unknown>,
    );
  },
  "diffusion.img2img": async (params, ctx) => {
    const req = DiffusionImg2ImgRequest.parse(params ?? {});
    return enqueueInteractive(
      ctx,
      "image",
      "img2img",
      req as Record<string, unknown>,
    );
  },
  "diffusion.inpaint": async (params, ctx) => {
    const req = DiffusionInpaintRequest.parse(params ?? {});
    return enqueueInteractive(
      ctx,
      "image",
      "inpaint",
      req as Record<string, unknown>,
    );
  },
  "diffusion.outpaint": async (params, ctx) => {
    const req = DiffusionOutpaintRequest.parse(params ?? {});
    return enqueueInteractive(
      ctx,
      "image",
      "outpaint",
      req as Record<string, unknown>,
    );
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
      const hit = resolveStudio(ctx).index.getByBytes(
        Buffer.from(req.pngBase64, "base64"),
      );
      workflow = hit?.workflow
        ? (hit.workflow as NonNullable<typeof workflow>)
        : null;
    }
    return { workflow };
  },
  "diffusion.video.text2video": async (params, ctx) => {
    const req = DiffusionVideoText2VideoRequest.parse(params ?? {});
    return enqueueInteractive(
      ctx,
      "video",
      "text2video",
      req as Record<string, unknown>,
    );
  },
  "diffusion.video.image2video": async (params, ctx) => {
    const req = DiffusionVideoImage2VideoRequest.parse(params ?? {});
    return enqueueInteractive(
      ctx,
      "video",
      "image2video",
      req as Record<string, unknown>,
    );
  },
  "diffusion.video.audio2video": async (params, ctx) => {
    const req = DiffusionVideoAudio2VideoRequest.parse(params ?? {});
    return enqueueInteractive(
      ctx,
      "video",
      "audio2video",
      req as Record<string, unknown>,
    );
  },
  "diffusion.video.workflow.extract": async (params, ctx) => {
    const req = DiffusionVideoWorkflowExtractRequest.parse(params ?? {});
    let workflow: VideoWorkflowMetadata | null = null;
    try {
      workflow = await extractVideoWorkflow(req.mp4Path, ctx.ffmpeg);
    } catch {
      // A durable index entry remains authoritative when ffprobe is unavailable.
    }
    if (!workflow) {
      try {
        const hash = await contentHashFile(req.mp4Path);
        const hit = resolveStudio(ctx).index.listOutputsByHash(hash)[0];
        workflow = hit?.workflow
          ? (hit.workflow as NonNullable<typeof workflow>)
          : null;
      } catch {
        workflow = null;
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
      : [
          studio.queue.enqueue({
            id,
            pillar: req.pillar,
            jobType: req.jobType,
            parameters: req.parameters,
            priority: req.priority ?? "interactive",
            threadId: req.threadId,
          }),
        ];
    void pumpStudio(ctx);
    return { jobs: jobs.map(jobDto) };
  },
  "generation.queue.cancel": async (params, ctx) => {
    const req = GenerationQueueCancelRequest.parse(params ?? {});
    const studio = resolveStudio(ctx);
    if (studio.queue.getEnhancementRun(req.id)) {
      const bundle = resolveVideoEnhancement(ctx);
      await bundle.initialize();
      await bundle.runtime.cancel(req.id);
      const enhancementJob = studio.queue.get(req.id);
      return { job: enhancementJob ? jobDto(enhancementJob) : null };
    }
    const job = studio.queue.cancel(req.id);
    studio.activeHandles.get(req.id)?.cancel();
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
  "video.enhancement.capability": async (params, ctx) => {
    VideoEnhancementCapabilityRequest.parse(params ?? {});
    const bundle = resolveVideoEnhancement(ctx);
    publishPendingEnhancementCompletions(resolveStudio(ctx), bundle);
    return { capability: await bundle.probe() };
  },
  "video.enhancement.enqueue": async (params, ctx) => {
    const req = VideoEnhancementEnqueueRequest.parse(params ?? {});
    const bundle = resolveVideoEnhancement(ctx);
    const capability = await bundle.probe();
    if (capability.status !== "ready") {
      return {
        ok: false as const,
        error: capabilityIssue(capability.status, capability.diagnostic),
      };
    }
    const result = await bundle.runtime.enqueue(req);
    if (!result.ok) return result;
    void pumpStudio(ctx);
    return {
      ok: true as const,
      created: result.created,
      job: enhancementJobDto(result.job),
    };
  },
  "video.enhancement.list": async (params, ctx) => {
    const req = VideoEnhancementListRequest.parse(params ?? {});
    const bundle = resolveVideoEnhancement(ctx);
    await bundle.initialize();
    publishPendingEnhancementCompletions(resolveStudio(ctx), bundle);
    const jobs = await bundle.persistence.listEnhancementsForParent(
      req.parentJobId,
    );
    return { jobs: jobs.map(enhancementJobDto) };
  },
  "video.enhancement.cancel": async (params, ctx) => {
    const req = VideoEnhancementCancelRequest.parse(params ?? {});
    const bundle = resolveVideoEnhancement(ctx);
    await bundle.initialize();
    await bundle.runtime.cancel(req.childJobId);
    const job = await bundle.persistence.getEnhancement(req.childJobId);
    return { job: job ? enhancementJobDto(job) : null };
  },
  "video.video2xPath.get": async (_params, ctx) => {
    VideoVideo2xPathGetRequest.parse(_params ?? {});
    const stored = await resolveSettings(ctx).get<string>(VIDEO2X_SETTING_KEY);
    return video2xPathSnapshot(stored, process.env);
  },
  "video.video2xPath.set": async (params, ctx) => {
    const req = VideoVideo2xPathSetRequest.parse(params ?? {});
    const trimmed = req.path.trim();
    if (trimmed && !isAbsoluteConfiguredPath(trimmed, ctx.platform)) {
      throw new Error(
        "The Video2X path must be empty or an absolute local file path.",
      );
    }
    const settings = resolveSettings(ctx);
    if (trimmed) await settings.set(VIDEO2X_SETTING_KEY, trimmed);
    else await settings.delete(VIDEO2X_SETTING_KEY);
    const stored = await settings.get<string>(VIDEO2X_SETTING_KEY);
    return video2xPathSnapshot(stored, process.env);
  },
  "generation.scheduler.snapshot": async (params, ctx) => {
    GenerationSchedulerSnapshotRequest.parse(params ?? {});
    return resolveStudio(ctx).scheduler.snapshot();
  },
  "tuning.status": async (params, ctx) => {
    const req = TuningHardwareRequest.parse(params ?? {});
    return resolveTuning(ctx).status(req);
  },
  "tuning.provision": async (params, ctx) => {
    const req = TuningHardwareRequest.parse(params ?? {});
    return resolveTuning(ctx).provision(req);
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
  "audit.list": async (params, ctx) => {
    const req = AuditListRequest.parse(params ?? {});
    return { events: resolveAudit(ctx).list(req) };
  },
  "audit.status": async (params, ctx) => {
    AuditStatusRequest.parse(params ?? {});
    const log = resolveAudit(ctx);
    const vaultAvailable = ctx.credentials
      ? await ctx.credentials.isAvailable()
      : false;
    return {
      eventCount: log.eventCount(),
      droppedCount: log.droppedCount(),
      vaultAvailable,
    };
  },
  "media.sampleVideoFrames": async (params, ctx) => {
    const req = MediaSampleVideoFramesRequest.parse(params ?? {});
    return sampleVideoFramesFromDataUrl(req.dataUrl, ctx.ffmpeg, {
      maxFrames: req.maxFrames,
    });
  },
  "coding.parseDocument.status": async (params, ctx) => {
    CodingParseDocumentStatusRequest.parse(params ?? {});
    const stored = await resolveSettings(ctx).get<boolean>(
      PARSE_DOCUMENT_SETTING_KEY,
    );
    return { enabled: isParseDocumentEnabled({ settingsValue: stored }) };
  },
  "coding.parseDocument.setEnabled": async (params, ctx) => {
    const req = CodingParseDocumentSetEnabledRequest.parse(params ?? {});
    await resolveSettings(ctx).set(PARSE_DOCUMENT_SETTING_KEY, req.enabled);
    return { enabled: req.enabled };
  },
};

export async function dispatch(
  method: string,
  params: unknown,
  ctx: HandlerContext,
): Promise<unknown> {
  if (!isMethod(method)) {
    throw new Error(`UnknownMethod: ${method}`);
  }
  const schema = METHOD_SCHEMAS[method];
  schema.request.parse(params ?? {});
  const handler = handlers[method];
  return handler(params, ctx);
}

export const SUPPORTED_METHODS: readonly Method[] = IPC_METHODS;

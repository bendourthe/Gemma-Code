// JSON-RPC 2.0 IPC contract shared between the Tauri shell and the Node
// sidecar.
//
// Phase 1 implemented only `ping`. Phase 3 (v1.0.0) extends the contract with
// the Coding-module surface: session lifecycle methods, the streaming-event
// protocol union mirrored from `src/panels/webview/render/protocol.ts`, and
// the Memory / Trace / Sessions panel queries that the desktop module routes
// consume. Later phases drop schemas in without re-shaping the union.

import { z } from "zod";

export const IPC_METHODS = [
  "ping",
  "models.list",
  "models.install",
  // v1.15.0 Phase 4 (Issue 3) -- Settings > Models registry management.
  "models.remove",
  "models.diskUsage",
  "models.install.drainEvents",
  "models.install.cancel",
  // v1.16.0 Phase 1 (adoption item A1) -- local serving gateway control surface.
  "serving.status",
  "serving.setEnabled",
  // v1.18.0 Phase 5 (OI-A3) -- ACP mount on the shared control surface.
  "acp.status",
  "acp.setEnabled",
  // v1.16.0 Phase 2 (adoption item A2) -- per-model inference analytics.
  "metrics.inference",
  // v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing.
  "ocr.health",
  "ocr.parseDocument",
  "ocr.job.drainEvents",
  "ocr.job.cancel",
  "coding.startTask",
  "coding.session.start",
  "coding.session.sendMessage",
  "coding.session.cancel",
  "coding.session.list",
  "coding.session.resume",
  "coding.memory.snapshot",
  "coding.trace.subscribe",
  "coding.sessions.list",
  // v1.7.0 -- Local Chatbot Explorer (non-agentic chat pillar).
  "chat.session.start",
  "chat.session.sendMessage",
  // v1.1.0 Phase 11 -- nexus VS Code extension surface.
  "coding.chat.autocomplete",
  "mcp.list",
  "mcp.invoke",
  "mcp.registry.list",
  "mcp.registry.setToolDenied",
  // v1.18.0 Phase 4 (OW-A1, OW-A2) -- ask inbox + local agent-run scheduler.
  "ask.inbox.list",
  "ask.inbox.approve",
  "ask.inbox.deny",
  "ask.inbox.pendingCount",
  "ask.scheduler.list",
  "ask.scheduler.setEnabled",
  "settings.get",
  "settings.set",
  // v1.5.0 Phase 5 (item 25) -- credential management over the OS-keychain vault.
  "credentials.status",
  "credentials.list",
  "credentials.set",
  "credentials.delete",
  "image.generate",
  "video.generate",
  "skills.sync",
  "skills.status",
  "skills.upstreamLatest",
  "skills.optimize.preview",
  "skills.optimize.apply",
  "telemetry.subscribe",
  "diffusion.health",
  "diffusion.version",
  "diffusion.txt2img",
  "diffusion.img2img",
  "diffusion.inpaint",
  "diffusion.outpaint",
  "diffusion.job.drainEvents",
  "diffusion.workflow.extract",
  "diffusion.video.text2video",
  "diffusion.video.image2video",
  "diffusion.video.workflow.extract",
] as const;

export type Method = (typeof IPC_METHODS)[number];

export const PingRequest = z.object({}).strict();
export const PingResponse = z.object({
  ok: z.literal(true),
  pid: z.number().int().nonnegative(),
  version: z.string().min(1),
  platform: z.string().min(1),
});
export type PingResponseT = z.infer<typeof PingResponse>;

// ---- Coding session lifecycle ------------------------------------------------

export const ModelFamily = z.enum(["gemma", "llama", "qwen", "deepseek", "lfm2.5"]);
export type ModelFamilyT = z.infer<typeof ModelFamily>;

export const CodingSessionStartRequest = z
  .object({
    modelId: z.string().min(1),
    title: z.string().max(200).optional(),
    // v1.7.0 -- optional project root the headless agent's file/terminal tools
    // are scoped to. When omitted, the sidecar falls back to NEXUS_WORKSPACE or
    // its cwd. Additive + optional, so existing callers are unaffected.
    workspacePath: z.string().min(1).optional(),
  })
  .strict();
export type CodingSessionStartRequestT = z.infer<typeof CodingSessionStartRequest>;

export const CodingSessionStartResponse = z
  .object({
    sessionId: z.string().min(1),
    modelId: z.string().min(1),
    family: ModelFamily,
    createdAt: z.string().min(1),
  })
  .strict();
export type CodingSessionStartResponseT = z.infer<typeof CodingSessionStartResponse>;

export const CodingSessionSendMessageRequest = z
  .object({
    sessionId: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type CodingSessionSendMessageRequestT = z.infer<
  typeof CodingSessionSendMessageRequest
>;

// The streaming event protocol mirrors the existing webview protocol union
// from `src/panels/webview/render/protocol.ts` so the desktop frontend can
// reuse the same tool-call card render code. Phase 3 ships the four event
// shapes; later phases will widen them as new agent surfaces are added.
export const CodingSessionEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("token"), text: z.string() }),
  z.object({
    kind: z.literal("toolCallHeader"),
    callId: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("toolCallArgDelta"),
    callId: z.string(),
    delta: z.string(),
  }),
  z.object({
    kind: z.literal("toolCallComplete"),
    callId: z.string(),
    result: z.string(),
  }),
  z.object({ kind: z.literal("done"), finishReason: z.string().optional() }),
]);
export type CodingSessionEventT = z.infer<typeof CodingSessionEvent>;

export const CodingSessionSendMessageResponse = z
  .object({
    sessionId: z.string().min(1),
    events: z.array(CodingSessionEvent),
  })
  .strict();
export type CodingSessionSendMessageResponseT = z.infer<
  typeof CodingSessionSendMessageResponse
>;

// ---- Chat session lifecycle (Local Chatbot Explorer) -------------------------
//
// v1.7.0 -- a non-agentic chat pillar: send a message, stream a local-model
// reply. Mirrors the coding session shape but the event union is just
// token/done (no tool-call cards).

export const ChatSessionStartRequest = z
  .object({
    modelId: z.string().min(1),
    title: z.string().max(200).optional(),
  })
  .strict();
export type ChatSessionStartRequestT = z.infer<typeof ChatSessionStartRequest>;

export const ChatSessionStartResponse = z
  .object({
    sessionId: z.string().min(1),
    modelId: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();
export type ChatSessionStartResponseT = z.infer<typeof ChatSessionStartResponse>;

export const ChatSessionSendMessageRequest = z
  .object({
    sessionId: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
export type ChatSessionSendMessageRequestT = z.infer<typeof ChatSessionSendMessageRequest>;

export const ChatSessionEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("token"), text: z.string() }),
  z.object({ kind: z.literal("done"), finishReason: z.string().optional() }),
]);
export type ChatSessionEventT = z.infer<typeof ChatSessionEvent>;

export const ChatSessionSendMessageResponse = z
  .object({
    sessionId: z.string().min(1),
    events: z.array(ChatSessionEvent),
  })
  .strict();
export type ChatSessionSendMessageResponseT = z.infer<
  typeof ChatSessionSendMessageResponse
>;

export const CodingSessionCancelRequest = z
  .object({ sessionId: z.string().min(1) })
  .strict();
export type CodingSessionCancelRequestT = z.infer<typeof CodingSessionCancelRequest>;

export const CodingSessionCancelResponse = z
  .object({ sessionId: z.string().min(1), cancelled: z.boolean() })
  .strict();
export type CodingSessionCancelResponseT = z.infer<typeof CodingSessionCancelResponse>;

export const CodingSessionSummary = z
  .object({
    sessionId: z.string().min(1),
    modelId: z.string().min(1),
    family: ModelFamily,
    title: z.string(),
    createdAt: z.string(),
    messageCount: z.number().int().nonnegative(),
  })
  .strict();
export type CodingSessionSummaryT = z.infer<typeof CodingSessionSummary>;

export const CodingSessionListRequest = z.object({}).strict();
export const CodingSessionListResponse = z
  .object({ sessions: z.array(CodingSessionSummary) })
  .strict();
export type CodingSessionListResponseT = z.infer<typeof CodingSessionListResponse>;

export const CodingSessionResumeRequest = z
  .object({ sessionId: z.string().min(1) })
  .strict();
export const CodingSessionResumeResponse = z
  .object({
    session: CodingSessionSummary,
    // v1.5.0 Phase 5 (item 26) -- the full message history so a session started
    // in one surface resumes with intact state in another (cross-surface resume).
    messages: z.array(z.string()),
  })
  .strict();
export type CodingSessionResumeResponseT = z.infer<typeof CodingSessionResumeResponse>;

// ---- Panel data (Memory / Trace / Sessions) ---------------------------------

/**
 * v1.1.0 Phase 4.5 -- optional per-entry lifecycle provenance.
 *
 * The Memory panel renders chips for `hookKind` + `toolName` when the
 * "Show provenance" toggle is on. Keyed by layer + entry index so the
 * existing `layers.<layer>: string[]` shape can remain backward
 * compatible (older sidecars omit the field entirely).
 */
export const MemoryEntryProvenance = z
  .object({
    hookKind: z.string(),
    toolName: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .strict();
export type MemoryEntryProvenanceT = z.infer<typeof MemoryEntryProvenance>;

export const LayerProvenanceMap = z.record(
  z.string(),
  z.array(MemoryEntryProvenance.nullable()),
);
export type LayerProvenanceMapT = z.infer<typeof LayerProvenanceMap>;

export const MemorySnapshot = z
  .object({
    layers: z.object({
      core: z.array(z.string()),
      recent: z.array(z.string()),
      working: z.array(z.string()),
      project: z.array(z.string()),
    }),
    anticipated: z.array(z.string()),
    proposedSkills: z.array(z.string()),
    /**
     * v1.1.0 Phase 4.5 -- optional provenance map. Each layer key maps
     * to a `LifecycleProvenance | null` array aligned by index with the
     * corresponding `layers.<layer>` string array. Omit the field to
     * keep legacy clients working unchanged.
     */
    provenance: LayerProvenanceMap.optional(),
  })
  .strict();
export type MemorySnapshotT = z.infer<typeof MemorySnapshot>;

export const CodingMemorySnapshotRequest = z
  .object({ sessionId: z.string().min(1).optional() })
  .strict();
export const CodingMemorySnapshotResponse = z
  .object({ snapshot: MemorySnapshot })
  .strict();
export type CodingMemorySnapshotResponseT = z.infer<
  typeof CodingMemorySnapshotResponse
>;

export const TraceEvent = z
  .object({
    id: z.string(),
    timestamp: z.string(),
    kind: z.enum(["tool", "model", "scheduler", "skill"]),
    summary: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
    /**
     * v1.1.0 Phase 4.5 -- optional `HookBus` lifecycle hookKind
     * attribution. Populated by the sidecar when the event was sourced
     * from a `lifecycle.*` event. The TraceDashboard's hookKind filter
     * dropdown narrows visible events by this field; events without a
     * hookKind are always visible.
     */
    hookKind: z.string().optional(),
  })
  .strict();
export type TraceEventT = z.infer<typeof TraceEvent>;

export const CodingTraceSubscribeRequest = z
  .object({ sessionId: z.string().min(1).optional() })
  .strict();
export const CodingTraceSubscribeResponse = z
  .object({ events: z.array(TraceEvent) })
  .strict();
export type CodingTraceSubscribeResponseT = z.infer<
  typeof CodingTraceSubscribeResponse
>;

// ---- Diffusion runtime (Phase 6) --------------------------------------------

export const DiffusionMode = z.enum(["txt2img", "img2img", "inpaint", "outpaint"]);
export type DiffusionModeT = z.infer<typeof DiffusionMode>;

export const DiffusionSampler = z.enum([
  "euler",
  "euler_a",
  "dpmpp_2m",
  "dpmpp_sde",
  "ddim",
  "lms",
]);
export type DiffusionSamplerT = z.infer<typeof DiffusionSampler>;

export const DiffusionLoRA = z
  .object({
    id: z.string().min(1),
    weight: z.number().min(-2).max(2),
  })
  .strict();
export type DiffusionLoRAT = z.infer<typeof DiffusionLoRA>;

export const ControlNetPreprocessor = z.enum(["pose", "depth", "canny", "none"]);
export type ControlNetPreprocessorT = z.infer<typeof ControlNetPreprocessor>;

export const DiffusionControlNet = z
  .object({
    modelId: z.string().min(1),
    conditionImage: z.string().min(1),
    weight: z.number().min(0).max(2),
    preprocessor: ControlNetPreprocessor.default("none"),
  })
  .strict();
export type DiffusionControlNetT = z.infer<typeof DiffusionControlNet>;

const Txt2ImgBase = z.object({
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional(),
  width: z.number().int().min(64).max(2048),
  height: z.number().int().min(64).max(2048),
  steps: z.number().int().min(1).max(150),
  cfgScale: z.number().min(0).max(30),
  sampler: DiffusionSampler.default("euler_a"),
  seed: z.number().int().nonnegative(),
  batchSize: z.number().int().min(1).max(4).default(1),
  latentPreview: z.boolean().default(true),
  loras: z.array(DiffusionLoRA).max(8).default([]),
  controlNet: DiffusionControlNet.optional(),
});

export const DiffusionTxt2ImgRequest = Txt2ImgBase.strict();
export type DiffusionTxt2ImgRequestT = z.infer<typeof DiffusionTxt2ImgRequest>;

export const DiffusionJobAccepted = z
  .object({
    jobId: z.string().min(1),
    mode: DiffusionMode,
    offloadStrategy: z.string().optional(),
    estimatedSeconds: z.number().nonnegative().optional(),
  })
  .strict();
export type DiffusionJobAcceptedT = z.infer<typeof DiffusionJobAccepted>;

export const DiffusionImg2ImgRequest = Txt2ImgBase.extend({
  sourceImage: z.string().min(1),
  strength: z.number().min(0).max(1).default(0.75),
}).strict();
export type DiffusionImg2ImgRequestT = z.infer<typeof DiffusionImg2ImgRequest>;

export const DiffusionInpaintRequest = Txt2ImgBase.extend({
  sourceImage: z.string().min(1),
  mask: z.string().min(1),
  strength: z.number().min(0).max(1).default(0.85),
}).strict();
export type DiffusionInpaintRequestT = z.infer<typeof DiffusionInpaintRequest>;

export const OutpaintDirection = z.enum(["left", "right", "top", "bottom"]);
export type OutpaintDirectionT = z.infer<typeof OutpaintDirection>;

export const DiffusionOutpaintRequest = Txt2ImgBase.extend({
  sourceImage: z.string().min(1),
  direction: OutpaintDirection,
  pixels: z.number().int().min(8).max(1024),
}).strict();
export type DiffusionOutpaintRequestT = z.infer<typeof DiffusionOutpaintRequest>;

export const DiffusionHealthResponse = z
  .object({
    ok: z.boolean(),
    torch: z.string(),
    cuda: z.string(),
    device: z.string(),
    vramTotalGB: z.number().nullable().optional(),
    vramFreeGB: z.number().nullable().optional(),
  })
  .strict();
export type DiffusionHealthResponseT = z.infer<typeof DiffusionHealthResponse>;

export const DiffusionVersionResponse = z
  .object({
    name: z.string(),
    version: z.string(),
    protocol: z.string(),
  })
  .strict();
export type DiffusionVersionResponseT = z.infer<typeof DiffusionVersionResponse>;

export const DiffusionEventEnvelope = z
  .object({
    kind: z.enum(["progress", "complete", "error"]),
    jobId: z.string().min(1),
    stage: z.string().optional(),
    step: z.number().int().optional(),
    totalSteps: z.number().int().optional(),
    preview: z.string().optional(),
    conditioningPreview: z.string().optional(),
    offloadStrategy: z.string().optional(),
    outputPath: z.string().optional(),
    png: z.string().optional(),
    message: z.string().optional(),
  })
  .strict();
export type DiffusionEventEnvelopeT = z.infer<typeof DiffusionEventEnvelope>;

export const DiffusionDrainEventsRequest = z
  .object({ jobId: z.string().min(1) })
  .strict();
export const DiffusionDrainEventsResponse = z
  .object({ events: z.array(DiffusionEventEnvelope) })
  .strict();
export type DiffusionDrainEventsResponseT = z.infer<
  typeof DiffusionDrainEventsResponse
>;

export const DiffusionEmptyRequest = z.object({}).strict();

export const DiffusionWorkflowExtractRequest = z
  .object({ pngBase64: z.string().min(1) })
  .strict();
export const DiffusionWorkflowExtractResponse = z
  .object({
    workflow: z
      .object({
        tool: z.string(),
        version: z.string(),
        mode: DiffusionMode,
        prompt: z.string(),
        negativePrompt: z.string().optional(),
        modelId: z.string(),
        width: z.number(),
        height: z.number(),
        steps: z.number(),
        cfgScale: z.number(),
        sampler: z.string(),
        seed: z.number(),
        timestamp: z.string(),
        loras: z.array(DiffusionLoRA).optional(),
        controlNet: DiffusionControlNet.optional(),
      })
      .passthrough()
      .nullable(),
  })
  .strict();
export type DiffusionWorkflowExtractResponseT = z.infer<
  typeof DiffusionWorkflowExtractResponse
>;

// ---- Video pipeline (Phase 7) -----------------------------------------------

export const VideoMode = z.enum(["text2video", "image2video"]);
export type VideoModeT = z.infer<typeof VideoMode>;

export const VideoFps = z.union([z.literal(12), z.literal(16), z.literal(24)]);
export type VideoFpsT = z.infer<typeof VideoFps>;

const VideoResolutionTuple = z.union([
  z.tuple([z.literal(854), z.literal(480)]),
  z.tuple([z.literal(1280), z.literal(720)]),
]);
export type VideoResolutionTupleT = z.infer<typeof VideoResolutionTuple>;

const VideoBase = z.object({
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(4000).optional(),
  width: z.union([z.literal(854), z.literal(1280)]),
  height: z.union([z.literal(480), z.literal(720)]),
  durationSeconds: z.number().int().min(1).max(10),
  fps: VideoFps,
  steps: z.number().int().min(1).max(150),
  cfgScale: z.number().min(0).max(30),
  sampler: DiffusionSampler.default("euler_a"),
  seed: z.number().int().nonnegative(),
  latentPreview: z.boolean().default(true),
});

export const DiffusionVideoText2VideoRequest = VideoBase.strict();
export type DiffusionVideoText2VideoRequestT = z.infer<
  typeof DiffusionVideoText2VideoRequest
>;

export const DiffusionVideoImage2VideoRequest = VideoBase.extend({
  sourceImage: z.string().min(1),
}).strict();
export type DiffusionVideoImage2VideoRequestT = z.infer<
  typeof DiffusionVideoImage2VideoRequest
>;

export const DiffusionVideoJobAccepted = z
  .object({
    jobId: z.string().min(1),
    mode: VideoMode,
    offloadStrategy: z.string().optional(),
    estimatedSeconds: z.number().nonnegative().optional(),
    frameCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DiffusionVideoJobAcceptedT = z.infer<typeof DiffusionVideoJobAccepted>;

export const DiffusionVideoWorkflow = z
  .object({
    tool: z.string(),
    version: z.string(),
    kind: z.literal("video"),
    mode: VideoMode,
    modelId: z.string(),
    prompt: z.string(),
    negativePrompt: z.string().optional(),
    width: z.number(),
    height: z.number(),
    durationSeconds: z.number(),
    fps: z.number(),
    frameCount: z.number(),
    steps: z.number(),
    cfgScale: z.number(),
    sampler: z.string(),
    seed: z.number(),
    timestamp: z.string(),
    sourceImageHash: z.string().optional(),
  })
  .passthrough();
export type DiffusionVideoWorkflowT = z.infer<typeof DiffusionVideoWorkflow>;

export const DiffusionVideoWorkflowExtractRequest = z
  .object({ mp4Path: z.string().min(1) })
  .strict();

export const DiffusionVideoWorkflowExtractResponse = z
  .object({ workflow: DiffusionVideoWorkflow.nullable() })
  .strict();
export type DiffusionVideoWorkflowExtractResponseT = z.infer<
  typeof DiffusionVideoWorkflowExtractResponse
>;

// ---- v1.1.0 Phase 11 -- VS Code extension surface ---------------------------

export const ModelCapability = z.enum(["chat", "tool-use", "coding"]);
export type ModelCapabilityT = z.infer<typeof ModelCapability>;

export const ModelsListRequest = z
  .object({
    type: z.literal("text").optional(),
    capability: ModelCapability.optional(),
  })
  .strict();
export type ModelsListRequestT = z.infer<typeof ModelsListRequest>;

export const ModelDropdownEntry = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    family: ModelFamily,
    capabilities: z.array(ModelCapability),
    recommended: z.boolean(),
  })
  .strict();
export type ModelDropdownEntryT = z.infer<typeof ModelDropdownEntry>;

export const ModelsListResponse = z
  .object({ models: z.array(ModelDropdownEntry) })
  .strict();
export type ModelsListResponseT = z.infer<typeof ModelsListResponse>;

// v1.15.0 Phase 4 (Issue 3) -- Settings > Models registry surface. Returns the
// rich `ListedModelDto` shape (installed / source / sizeBytes / ...), NOT the
// chat-picker `ModelDropdownEntry`. `models.list` reflects the real installed
// set (registry manifests reconciled with Ollama's store + the installer's
// weights tree); install is a streaming job (accept -> drain -> cancel).
export const ModelsEmptyRequest = z.object({}).strict();
export type ModelsEmptyRequestT = z.infer<typeof ModelsEmptyRequest>;

export const ModelListedEntry = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    family: z.string().optional(),
    tag: z.string().optional(),
    type: z
      .enum([
        "llm",
        "embed",
        "image",
        "video",
        "audio",
        "controlnet",
        "vae",
        // v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing.
        "document",
      ])
      .optional(),
    installed: z.boolean(),
    source: z.enum(["registry", "catalog-only", "external"]),
    sizeBytes: z.number().optional(),
    vramGB: z.number().optional(),
    license: z.string().optional(),
    task: z.string().optional(),
    licenseUrl: z.string().optional(),
    licenseNote: z.string().optional(),
    tags: z.array(z.string()).optional(),
    absPath: z.string().optional(),
    toolCallingVerified: z.boolean().optional(),
    toolCallingBenchmark: z
      .object({
        suite: z.string(),
        date: z.string(),
        result: z.string(),
      })
      .strict()
      .optional(),
    activeParams: z.number().optional(),
    totalParams: z.number().optional(),
  })
  .strict();
export type ModelListedEntryT = z.infer<typeof ModelListedEntry>;

export const ModelsRegistryListResponse = z
  .object({ models: z.array(ModelListedEntry) })
  .strict();
export type ModelsRegistryListResponseT = z.infer<typeof ModelsRegistryListResponse>;

export const ModelsRemoveRequest = z.object({ id: z.string().min(1) }).strict();
export type ModelsRemoveRequestT = z.infer<typeof ModelsRemoveRequest>;

export const ModelsOkResponse = z.object({ ok: z.literal(true) }).strict();
export type ModelsOkResponseT = z.infer<typeof ModelsOkResponse>;

export const ModelsDiskUsageResponse = z
  .object({ usedBytes: z.number(), freeBytes: z.number().nullable() })
  .strict();
export type ModelsDiskUsageResponseT = z.infer<typeof ModelsDiskUsageResponse>;

export const ModelsInstallRequest = z.object({ id: z.string().min(1) }).strict();
export type ModelsInstallRequestT = z.infer<typeof ModelsInstallRequest>;

export const ModelsInstallAccepted = z.object({ jobId: z.string().min(1) }).strict();
export type ModelsInstallAcceptedT = z.infer<typeof ModelsInstallAccepted>;

export const ModelsInstallEvent = z
  .object({
    kind: z.enum(["progress", "complete", "error"]),
    id: z.string(),
    bytes: z.number().optional(),
    total: z.number().nullable().optional(),
    message: z.string().optional(),
  })
  .strict();
export type ModelsInstallEventT = z.infer<typeof ModelsInstallEvent>;

export const ModelsInstallDrainRequest = z.object({ jobId: z.string().min(1) }).strict();
export type ModelsInstallDrainRequestT = z.infer<typeof ModelsInstallDrainRequest>;

export const ModelsInstallDrainResponse = z
  .object({ events: z.array(ModelsInstallEvent), done: z.boolean() })
  .strict();
export type ModelsInstallDrainResponseT = z.infer<typeof ModelsInstallDrainResponse>;

export const ModelsInstallCancelRequest = z.object({ jobId: z.string().min(1) }).strict();
export type ModelsInstallCancelRequestT = z.infer<typeof ModelsInstallCancelRequest>;

// v1.16.0 Phase 1 (adoption item A1) -- local serving gateway. `serving.status`
// reports whether the loopback OpenAI/Anthropic API is enabled and listening,
// plus the base URL + local token the Settings section lets the user copy into
// another tool. `serving.setEnabled` persists the opt-in and reconciles the
// listener (enable -> bind, disable -> close; with it off NO port is bound).
export const ServingEmptyRequest = z.object({}).strict();
export type ServingEmptyRequestT = z.infer<typeof ServingEmptyRequest>;

export const ServingStatusResponse = z
  .object({
    enabled: z.boolean(),
    running: z.boolean(),
    host: z.string().min(1),
    port: z.number().int().positive(),
    baseUrl: z.string().min(1),
    /** The local bearer token. Masked in the UI by default; never logged. */
    token: z.string(),
  })
  .strict();
export type ServingStatusResponseT = z.infer<typeof ServingStatusResponse>;

export const ServingSetEnabledRequest = z.object({ enabled: z.boolean() }).strict();
export type ServingSetEnabledRequestT = z.infer<typeof ServingSetEnabledRequest>;

// v1.18.0 Phase 5 (OI-A3) -- ACP agent on the shared loopback listener.
export const AcpEmptyRequest = z.object({}).strict();
export type AcpEmptyRequestT = z.infer<typeof AcpEmptyRequest>;

export const AcpStatusResponse = z
  .object({
    enabled: z.boolean(),
    running: z.boolean(),
    host: z.string().min(1),
    port: z.number().int().positive(),
    /** `http://<host>:<port>/acp` -- JSON-RPC endpoint. */
    endpoint: z.string().min(1),
    token: z.string(),
  })
  .strict();
export type AcpStatusResponseT = z.infer<typeof AcpStatusResponse>;

export const AcpSetEnabledRequest = z.object({ enabled: z.boolean() }).strict();
export type AcpSetEnabledRequestT = z.infer<typeof AcpSetEnabledRequest>;

// v1.16.0 Phase 2 (adoption item A2) -- per-model inference analytics for the
// Traces panel. Every metric is nullable on purpose: a backend that reports no
// token counts yields null, never a zero that would silently skew an average.
// `tokenSource` says whether counts were backend-reported, locally estimated, or
// unavailable -- the same "sensor missing" discriminator convention as
// `energyStatus`.
export const MetricsEmptyRequest = z.object({}).strict();
export type MetricsEmptyRequestT = z.infer<typeof MetricsEmptyRequest>;

export const TokenSourceSchema = z.enum(["reported", "estimated", "unavailable"]);

export const InferenceMetricEntry = z
  .object({
    model: z.string(),
    adapter: z.string().nullable(),
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
    tokenSource: TokenSourceSchema,
    ttftMs: z.number().nullable(),
    totalMs: z.number(),
    tokensPerSec: z.number().nullable(),
    memoryBytes: z.number().nullable(),
    at: z.number(),
  })
  .strict();
export type InferenceMetricEntryT = z.infer<typeof InferenceMetricEntry>;

export const PerModelMetricSummary = z
  .object({
    model: z.string(),
    requestCount: z.number(),
    totalTokens: z.number(),
    avgTokensPerSec: z.number().nullable(),
    medianTtftMs: z.number().nullable(),
    lastMemoryBytes: z.number().nullable(),
    lastAt: z.number(),
    allCountsReported: z.boolean(),
  })
  .strict();
export type PerModelMetricSummaryT = z.infer<typeof PerModelMetricSummary>;

export const MetricsInferenceResponse = z
  .object({
    perModel: z.array(PerModelMetricSummary),
    recent: z.array(InferenceMetricEntry),
  })
  .strict();
export type MetricsInferenceResponseT = z.infer<typeof MetricsInferenceResponse>;

// v1.16.0 Phase 3 (adoption item A5) -- document OCR / parsing. A parse is a
// long-running job: accept (-> jobId) -> drain (progress + terminal result) ->
// cancel, following the models-install pattern rather than the diffusion one,
// so the IPC channel never blocks for the length of a multi-page parse.
export const OcrEmptyRequest = z.object({}).strict();
export type OcrEmptyRequestT = z.infer<typeof OcrEmptyRequest>;

/** Which backend serves a request. Absent means "the portable default". */
export const OcrEngineName = z.enum(["rapidocr", "unlimited-ocr", "stub"]);
export type OcrEngineNameT = z.infer<typeof OcrEngineName>;

export const OcrEngineAvailability = z
  .object({ available: z.boolean(), reason: z.string() })
  .strict();

/**
 * Per-engine availability with a REASON, so the desktop can explain why a model
 * is unusable on this host ("needs an NVIDIA GPU", "not installed") instead of
 * failing opaquely.
 */
export const OcrHealthResponse = z
  .object({
    ok: z.boolean(),
    device: z.string(),
    platform: z.string(),
    vramTotalGB: z.number().nullable(),
    engines: z.record(z.string(), OcrEngineAvailability),
  })
  .strict();
export type OcrHealthResponseT = z.infer<typeof OcrHealthResponse>;

export const OcrParseDocumentRequest = z
  .object({
    /** Base64 payload; a `data:` URL prefix is accepted and stripped. */
    documentBase64: z.string().min(1),
    engine: OcrEngineName.optional(),
    dpi: z.number().int().positive().optional(),
    maxPages: z.number().int().positive().optional(),
  })
  .strict();
export type OcrParseDocumentRequestT = z.infer<typeof OcrParseDocumentRequest>;

export const OcrJobAccepted = z.object({ jobId: z.string().min(1) }).strict();
export type OcrJobAcceptedT = z.infer<typeof OcrJobAccepted>;

export const OcrJobEventEnvelope = z
  .object({
    kind: z.enum(["progress", "complete", "error"]),
    jobId: z.string().min(1),
    page: z.number().int().nonnegative().optional(),
    totalPages: z.number().int().nonnegative().optional(),
    stage: z.string().optional(),
    message: z.string().optional(),
  })
  .strict();
export type OcrJobEventEnvelopeT = z.infer<typeof OcrJobEventEnvelope>;

export const OcrParsedPage = z
  .object({ index: z.number().int().nonnegative(), text: z.string() })
  .strict();

export const OcrParseResult = z
  .object({
    engine: z.string(),
    text: z.string(),
    /** Layout-preserving markdown when the engine produces it. */
    markdown: z.string().nullable(),
    pageCount: z.number().int().nonnegative(),
    pages: z.array(OcrParsedPage),
  })
  .strict();
export type OcrParseResultT = z.infer<typeof OcrParseResult>;

export const OcrJobDrainRequest = z.object({ jobId: z.string().min(1) }).strict();
export type OcrJobDrainRequestT = z.infer<typeof OcrJobDrainRequest>;

export const OcrJobDrainResponse = z
  .object({
    events: z.array(OcrJobEventEnvelope),
    done: z.boolean(),
    result: OcrParseResult.nullable(),
  })
  .strict();
export type OcrJobDrainResponseT = z.infer<typeof OcrJobDrainResponse>;

export const OcrJobCancelRequest = z.object({ jobId: z.string().min(1) }).strict();
export type OcrJobCancelRequestT = z.infer<typeof OcrJobCancelRequest>;

export const OcrOkResponse = z.object({ ok: z.literal(true) }).strict();
export type OcrOkResponseT = z.infer<typeof OcrOkResponse>;

export const SlashSuggestion = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    template: z.string(),
    namespace: z.enum(["builtin", "user", "nexus-hub"]).optional(),
    skillId: z.string().optional(),
  })
  .strict();
export type SlashSuggestionT = z.infer<typeof SlashSuggestion>;

export const CodingChatAutocompleteRequest = z
  .object({
    input: z.string(),
    preferUpstream: z.boolean().optional(),
  })
  .strict();
export type CodingChatAutocompleteRequestT = z.infer<
  typeof CodingChatAutocompleteRequest
>;

export const CodingChatAutocompleteResponse = z
  .object({ suggestions: z.array(SlashSuggestion) })
  .strict();
export type CodingChatAutocompleteResponseT = z.infer<
  typeof CodingChatAutocompleteResponse
>;

export const McpToolDescriptor = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.string(),
    serverId: z.string(),
  })
  .strict();
export type McpToolDescriptorT = z.infer<typeof McpToolDescriptor>;

export const McpListRequest = z.object({}).strict();
export const McpListResponse = z
  .object({ tools: z.array(McpToolDescriptor) })
  .strict();
export type McpListResponseT = z.infer<typeof McpListResponse>;

export const McpInvokeRequest = z
  .object({
    name: z.string().min(1),
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type McpInvokeRequestT = z.infer<typeof McpInvokeRequest>;

export const McpInvokeResponse = z
  .object({
    ok: z.boolean(),
    toolName: z.string(),
    result: z.string().nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type McpInvokeResponseT = z.infer<typeof McpInvokeResponse>;

export const McpRegistryTool = z
  .object({
    name: z.string().min(1),
    exposed: z.boolean(),
    reason: z.enum(["allowed", "user-denied", "policy-denied"]),
    toggleable: z.boolean(),
  })
  .strict();
export type McpRegistryToolT = z.infer<typeof McpRegistryTool>;

export const McpRegistryServer = z
  .object({
    name: z.string().min(1),
    source: z.enum(["user", "hub"]),
    policyVerdict: z.enum(["allow", "drop"]),
    policyReason: z.string(),
    tools: z.array(McpRegistryTool),
  })
  .strict();
export type McpRegistryServerT = z.infer<typeof McpRegistryServer>;

export const McpRegistryListRequest = z.object({}).strict();
export const McpRegistryListResponse = z
  .object({ servers: z.array(McpRegistryServer) })
  .strict();
export type McpRegistryListResponseT = z.infer<typeof McpRegistryListResponse>;

export const McpRegistrySetToolDeniedRequest = z
  .object({
    serverName: z.string().min(1),
    toolName: z.string().min(1),
    denied: z.boolean(),
  })
  .strict();
export type McpRegistrySetToolDeniedRequestT = z.infer<typeof McpRegistrySetToolDeniedRequest>;

export const McpRegistrySetToolDeniedResponse = z
  .object({
    ok: z.boolean(),
    reason: z.string(),
    servers: z.array(McpRegistryServer),
  })
  .strict();
export type McpRegistrySetToolDeniedResponseT = z.infer<typeof McpRegistrySetToolDeniedResponse>;

export const AskInboxState = z.enum(["pending", "approved", "denied", "expired"]);
export const AskInboxRunMode = z.enum(["headless", "scheduled"]);

export const ParkedAskDto = z
  .object({
    id: z.string().min(1),
    state: AskInboxState,
    runMode: AskInboxRunMode,
    createdAt: z.number(),
    expiresAt: z.number(),
    decidedAt: z.number().optional(),
    decisionReason: z.string().optional(),
    toolName: z.string().min(1),
    summary: z.string(),
    detail: z.string(),
    args: z.record(z.unknown()),
    risk: z.string().min(1),
    classificationReason: z.string(),
    parkedTier: z.number().int(),
    sessionId: z.string().optional(),
    runId: z.string().min(1),
  })
  .strict();
export type ParkedAskDtoT = z.infer<typeof ParkedAskDto>;

export const AskInboxListRequest = z
  .object({
    state: AskInboxState.optional(),
  })
  .strict();
export const AskInboxListResponse = z
  .object({
    asks: z.array(ParkedAskDto),
  })
  .strict();
export type AskInboxListResponseT = z.infer<typeof AskInboxListResponse>;

export const AskInboxIdRequest = z.object({ id: z.string().min(1) }).strict();
export const AskInboxApproveResponse = z
  .object({
    ok: z.boolean(),
    reason: z.string(),
    replay: z
      .object({
        allowed: z.boolean(),
        reason: z.string(),
        currentTier: z.number().int(),
        floorClamped: z.boolean(),
      })
      .optional(),
    executed: z.literal(false),
  })
  .strict();
export type AskInboxApproveResponseT = z.infer<typeof AskInboxApproveResponse>;

export const AskInboxDenyResponse = z
  .object({
    ok: z.boolean(),
    reason: z.string(),
  })
  .strict();
export const AskInboxPendingCountRequest = z.object({}).strict();
export const AskInboxPendingCountResponse = z
  .object({
    pending: z.number().int().nonnegative(),
  })
  .strict();
export type AskInboxPendingCountResponseT = z.infer<typeof AskInboxPendingCountResponse>;

export const AskSchedulerListRequest = z.object({}).strict();
export const ScheduledRunDto = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    kind: z.enum(["daily", "interval"]),
    hour: z.number().int().optional(),
    minute: z.number().int().optional(),
    intervalMs: z.number().int().optional(),
    prompt: z.string(),
    promptSource: z.string().optional(),
    workspacePath: z.string().optional(),
  })
  .strict();
export const AskSchedulerListResponse = z
  .object({
    schedules: z.array(ScheduledRunDto),
  })
  .strict();
export type AskSchedulerListResponseT = z.infer<typeof AskSchedulerListResponse>;

export const AskSchedulerSetEnabledRequest = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();
export const AskSchedulerSetEnabledResponse = z
  .object({
    ok: z.boolean(),
    schedule: ScheduledRunDto.optional(),
  })
  .strict();

export const SettingsGetRequest = z
  .object({ key: z.string().min(1) })
  .strict();
export type SettingsGetRequestT = z.infer<typeof SettingsGetRequest>;

export const SettingsGetResponse = z
  .object({ key: z.string().min(1), value: z.unknown() })
  .strict();
export type SettingsGetResponseT = z.infer<typeof SettingsGetResponse>;

export const SettingsSetRequest = z
  .object({ key: z.string().min(1), value: z.unknown() })
  .strict();
export type SettingsSetRequestT = z.infer<typeof SettingsSetRequest>;

export const SettingsSetResponse = z
  .object({ key: z.string().min(1), value: z.unknown() })
  .strict();
export type SettingsSetResponseT = z.infer<typeof SettingsSetResponse>;

// ---- Credential vault (Phase 5, item 25) ------------------------------------
//
// The desktop credential-management surface reaches the OS-keychain
// `CredentialVault` (core/security) ONLY through these methods. There is no
// config-file write path: `credentials.set` routes straight to the vault, so a
// credential set via the UI lands in the keychain, never in a plaintext file.

export const CredentialsStatusRequest = z.object({}).strict();
export const CredentialsStatusResponse = z
  .object({ available: z.boolean() })
  .strict();
export type CredentialsStatusResponseT = z.infer<typeof CredentialsStatusResponse>;

export const CredentialsListRequest = z
  .object({ integration: z.string().min(1) })
  .strict();
export const CredentialsListResponse = z
  .object({ keys: z.array(z.string()) })
  .strict();
export type CredentialsListResponseT = z.infer<typeof CredentialsListResponse>;

export const CredentialsSetRequest = z
  .object({
    integration: z.string().min(1),
    key: z.string().min(1),
    value: z.string().min(1),
  })
  .strict();
export const CredentialsSetResponse = z.object({ ok: z.literal(true) }).strict();
export type CredentialsSetResponseT = z.infer<typeof CredentialsSetResponse>;

export const CredentialsDeleteRequest = z
  .object({ integration: z.string().min(1), key: z.string().min(1) })
  .strict();
export const CredentialsDeleteResponse = z
  .object({ removed: z.boolean() })
  .strict();
export type CredentialsDeleteResponseT = z.infer<typeof CredentialsDeleteResponse>;

// v1.10.0 Phase 6 -- Nexus-Hub catalog sync + update detection.
export const SkillsSyncRequest = z.object({ tag: z.string().optional() }).strict();
export const SkillsSyncResponse = z
  .object({
    tag: z.string(),
    applied: z.boolean(),
    alreadyUpToDate: z.boolean(),
    blocked: z.boolean(),
    summary: z.string(),
  })
  .strict();
export type SkillsSyncResponseT = z.infer<typeof SkillsSyncResponse>;

export const SkillsStatusRequest = z.object({}).strict();
export const SkillsStatusResponse = z
  .object({
    installedVersion: z.string().nullable(),
    catalogPresent: z.boolean(),
    sourceRepo: z.string(),
  })
  .strict();
export type SkillsStatusResponseT = z.infer<typeof SkillsStatusResponse>;

export const SkillsUpstreamLatestRequest = z.object({}).strict();
export const SkillsUpstreamLatestResponse = z
  .object({ latestTag: z.string().nullable() })
  .strict();
export type SkillsUpstreamLatestResponseT = z.infer<typeof SkillsUpstreamLatestResponse>;

// v1.12.0 Phase 2 (adoption-ecosystem-2026-07 EM.P2.A) -- the two-call skill
// optimizer preview/apply flow. `preview` runs the optimizer with a capturing
// deny gate (proposes + gate-clears edits, writes NOTHING) and returns proposed
// edits + a session token; `apply` writes the exact previewed edit for one
// proposal id after the human approves it in the app. Approval binds to the
// precise previewed bytes (the app never re-runs the optimizer to apply).
export const SkillsOptimizePreviewRequest = z
  .object({
    skillId: z.string().min(1),
    model: z.string().optional(),
    maxRounds: z.number().int().positive().optional(),
  })
  .strict();
export const SkillsOptimizePreviewResponse = z
  .object({
    token: z.string(),
    proposals: z.array(
      z
        .object({
          id: z.string(),
          skillId: z.string(),
          skillPath: z.string(),
          diff: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type SkillsOptimizePreviewResponseT = z.infer<typeof SkillsOptimizePreviewResponse>;

export const SkillsOptimizeApplyRequest = z
  .object({ token: z.string().min(1), proposalId: z.string().min(1) })
  .strict();
export const SkillsOptimizeApplyResponse = z
  .object({ applied: z.boolean(), skillId: z.string(), skillPath: z.string() })
  .strict();
export type SkillsOptimizeApplyResponseT = z.infer<typeof SkillsOptimizeApplyResponse>;

const NotImplementedAny = z.unknown();

interface MethodSchema {
  request: z.ZodTypeAny;
  response: z.ZodTypeAny;
  implemented: boolean;
}

export const METHOD_SCHEMAS: Record<Method, MethodSchema> = {
  ping: { request: PingRequest, response: PingResponse, implemented: true },
  "models.list": {
    request: ModelsListRequest,
    response: ModelsRegistryListResponse,
    implemented: true,
  },
  "models.install": {
    request: ModelsInstallRequest,
    response: ModelsInstallAccepted,
    implemented: true,
  },
  "models.remove": {
    request: ModelsRemoveRequest,
    response: ModelsOkResponse,
    implemented: true,
  },
  "models.diskUsage": {
    request: ModelsEmptyRequest,
    response: ModelsDiskUsageResponse,
    implemented: true,
  },
  "models.install.drainEvents": {
    request: ModelsInstallDrainRequest,
    response: ModelsInstallDrainResponse,
    implemented: true,
  },
  "models.install.cancel": {
    request: ModelsInstallCancelRequest,
    response: ModelsOkResponse,
    implemented: true,
  },
  "serving.status": {
    request: ServingEmptyRequest,
    response: ServingStatusResponse,
    implemented: true,
  },
  "serving.setEnabled": {
    request: ServingSetEnabledRequest,
    response: ServingStatusResponse,
    implemented: true,
  },
  "acp.status": {
    request: AcpEmptyRequest,
    response: AcpStatusResponse,
    implemented: true,
  },
  "acp.setEnabled": {
    request: AcpSetEnabledRequest,
    response: AcpStatusResponse,
    implemented: true,
  },
  "metrics.inference": {
    request: MetricsEmptyRequest,
    response: MetricsInferenceResponse,
    implemented: true,
  },
  "ocr.health": {
    request: OcrEmptyRequest,
    response: OcrHealthResponse,
    implemented: true,
  },
  "ocr.parseDocument": {
    request: OcrParseDocumentRequest,
    response: OcrJobAccepted,
    implemented: true,
  },
  "ocr.job.drainEvents": {
    request: OcrJobDrainRequest,
    response: OcrJobDrainResponse,
    implemented: true,
  },
  "ocr.job.cancel": {
    request: OcrJobCancelRequest,
    response: OcrOkResponse,
    implemented: true,
  },
  "coding.startTask": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "coding.session.start": {
    request: CodingSessionStartRequest,
    response: CodingSessionStartResponse,
    implemented: true,
  },
  "coding.session.sendMessage": {
    request: CodingSessionSendMessageRequest,
    response: CodingSessionSendMessageResponse,
    implemented: true,
  },
  "coding.session.cancel": {
    request: CodingSessionCancelRequest,
    response: CodingSessionCancelResponse,
    implemented: true,
  },
  "coding.session.list": {
    request: CodingSessionListRequest,
    response: CodingSessionListResponse,
    implemented: true,
  },
  "coding.session.resume": {
    request: CodingSessionResumeRequest,
    response: CodingSessionResumeResponse,
    implemented: true,
  },
  "coding.memory.snapshot": {
    request: CodingMemorySnapshotRequest,
    response: CodingMemorySnapshotResponse,
    implemented: true,
  },
  "coding.trace.subscribe": {
    request: CodingTraceSubscribeRequest,
    response: CodingTraceSubscribeResponse,
    implemented: true,
  },
  "coding.sessions.list": {
    request: CodingSessionListRequest,
    response: CodingSessionListResponse,
    implemented: true,
  },
  // v1.1.0 Phase 11 (nexus VS Code extension surface) -- declared but not yet
  // wired. The request/response schemas above (CodingChatAutocompleteRequest,
  // McpListRequest, McpInvokeRequest, SettingsGet/SetRequest, and their
  // responses) remain exported for Phase 11 to adopt; until then these are
  // marked unimplemented so `dispatch` reaches the NotImplementedError stub in
  // handlers.ts instead of failing the strict request schema on empty params.
  "chat.session.start": {
    request: ChatSessionStartRequest,
    response: ChatSessionStartResponse,
    implemented: true,
  },
  "chat.session.sendMessage": {
    request: ChatSessionSendMessageRequest,
    response: ChatSessionSendMessageResponse,
    implemented: true,
  },
  "coding.chat.autocomplete": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "mcp.list": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "mcp.invoke": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "mcp.registry.list": {
    request: McpRegistryListRequest,
    response: McpRegistryListResponse,
    implemented: true,
  },
  "mcp.registry.setToolDenied": {
    request: McpRegistrySetToolDeniedRequest,
    response: McpRegistrySetToolDeniedResponse,
    implemented: true,
  },
  "ask.inbox.list": {
    request: AskInboxListRequest,
    response: AskInboxListResponse,
    implemented: true,
  },
  "ask.inbox.approve": {
    request: AskInboxIdRequest,
    response: AskInboxApproveResponse,
    implemented: true,
  },
  "ask.inbox.deny": {
    request: AskInboxIdRequest,
    response: AskInboxDenyResponse,
    implemented: true,
  },
  "ask.inbox.pendingCount": {
    request: AskInboxPendingCountRequest,
    response: AskInboxPendingCountResponse,
    implemented: true,
  },
  "ask.scheduler.list": {
    request: AskSchedulerListRequest,
    response: AskSchedulerListResponse,
    implemented: true,
  },
  "ask.scheduler.setEnabled": {
    request: AskSchedulerSetEnabledRequest,
    response: AskSchedulerSetEnabledResponse,
    implemented: true,
  },
  "settings.get": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "settings.set": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "credentials.status": {
    request: CredentialsStatusRequest,
    response: CredentialsStatusResponse,
    implemented: true,
  },
  "credentials.list": {
    request: CredentialsListRequest,
    response: CredentialsListResponse,
    implemented: true,
  },
  "credentials.set": {
    request: CredentialsSetRequest,
    response: CredentialsSetResponse,
    implemented: true,
  },
  "credentials.delete": {
    request: CredentialsDeleteRequest,
    response: CredentialsDeleteResponse,
    implemented: true,
  },
  "image.generate": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "video.generate": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "skills.sync": { request: SkillsSyncRequest, response: SkillsSyncResponse, implemented: true },
  "skills.status": { request: SkillsStatusRequest, response: SkillsStatusResponse, implemented: true },
  "skills.upstreamLatest": {
    request: SkillsUpstreamLatestRequest,
    response: SkillsUpstreamLatestResponse,
    implemented: true,
  },
  "skills.optimize.preview": {
    request: SkillsOptimizePreviewRequest,
    response: SkillsOptimizePreviewResponse,
    implemented: true,
  },
  "skills.optimize.apply": {
    request: SkillsOptimizeApplyRequest,
    response: SkillsOptimizeApplyResponse,
    implemented: true,
  },
  "telemetry.subscribe": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "diffusion.health": {
    request: DiffusionEmptyRequest,
    response: DiffusionHealthResponse,
    implemented: true,
  },
  "diffusion.version": {
    request: DiffusionEmptyRequest,
    response: DiffusionVersionResponse,
    implemented: true,
  },
  "diffusion.txt2img": {
    request: DiffusionTxt2ImgRequest,
    response: DiffusionJobAccepted,
    implemented: true,
  },
  "diffusion.img2img": {
    request: DiffusionImg2ImgRequest,
    response: DiffusionJobAccepted,
    implemented: true,
  },
  "diffusion.inpaint": {
    request: DiffusionInpaintRequest,
    response: DiffusionJobAccepted,
    implemented: true,
  },
  "diffusion.outpaint": {
    request: DiffusionOutpaintRequest,
    response: DiffusionJobAccepted,
    implemented: true,
  },
  "diffusion.job.drainEvents": {
    request: DiffusionDrainEventsRequest,
    response: DiffusionDrainEventsResponse,
    implemented: true,
  },
  "diffusion.workflow.extract": {
    request: DiffusionWorkflowExtractRequest,
    response: DiffusionWorkflowExtractResponse,
    implemented: true,
  },
  "diffusion.video.text2video": {
    request: DiffusionVideoText2VideoRequest,
    response: DiffusionVideoJobAccepted,
    implemented: true,
  },
  "diffusion.video.image2video": {
    request: DiffusionVideoImage2VideoRequest,
    response: DiffusionVideoJobAccepted,
    implemented: true,
  },
  "diffusion.video.workflow.extract": {
    request: DiffusionVideoWorkflowExtractRequest,
    response: DiffusionVideoWorkflowExtractResponse,
    implemented: true,
  },
};

export const NOT_IMPLEMENTED_CODE = -32601;

export class NotImplementedError extends Error {
  readonly code = NOT_IMPLEMENTED_CODE;
  constructor(method: Method) {
    super(`NotImplemented: ${method} is declared in the IPC contract but not yet wired.`);
  }
}

export class IpcMethodError extends Error {
  constructor(public readonly method: Method, message: string) {
    super(`${method}: ${message}`);
  }
}

export function isMethod(value: string): value is Method {
  return (IPC_METHODS as readonly string[]).includes(value);
}

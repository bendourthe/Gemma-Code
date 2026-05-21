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
  "coding.startTask",
  "coding.session.start",
  "coding.session.sendMessage",
  "coding.session.cancel",
  "coding.session.list",
  "coding.session.resume",
  "coding.memory.snapshot",
  "coding.trace.subscribe",
  "coding.sessions.list",
  // v1.1.0 Phase 11 -- nexus VS Code extension surface.
  "coding.chat.autocomplete",
  "mcp.list",
  "mcp.invoke",
  "settings.get",
  "settings.set",
  "image.generate",
  "video.generate",
  "skills.sync",
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

export const ModelFamily = z.enum(["gemma", "llama", "qwen", "deepseek"]);
export type ModelFamilyT = z.infer<typeof ModelFamily>;

export const CodingSessionStartRequest = z
  .object({
    modelId: z.string().min(1),
    title: z.string().max(200).optional(),
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
  .object({ session: CodingSessionSummary })
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

export const SlashSuggestion = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    template: z.string(),
    namespace: z.enum(["builtin", "user", "devai-hub"]).optional(),
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
    response: ModelsListResponse,
    implemented: true,
  },
  "models.install": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
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
  "coding.chat.autocomplete": {
    request: CodingChatAutocompleteRequest,
    response: CodingChatAutocompleteResponse,
    implemented: true,
  },
  "mcp.list": {
    request: McpListRequest,
    response: McpListResponse,
    implemented: true,
  },
  "mcp.invoke": {
    request: McpInvokeRequest,
    response: McpInvokeResponse,
    implemented: true,
  },
  "settings.get": {
    request: SettingsGetRequest,
    response: SettingsGetResponse,
    implemented: true,
  },
  "settings.set": {
    request: SettingsSetRequest,
    response: SettingsSetResponse,
    implemented: true,
  },
  "image.generate": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "video.generate": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "skills.sync": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
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

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
  "image.generate",
  "video.generate",
  "skills.sync",
  "telemetry.subscribe",
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

const NotImplementedAny = z.unknown();

interface MethodSchema {
  request: z.ZodTypeAny;
  response: z.ZodTypeAny;
  implemented: boolean;
}

export const METHOD_SCHEMAS: Record<Method, MethodSchema> = {
  ping: { request: PingRequest, response: PingResponse, implemented: true },
  "models.list": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
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
  "image.generate": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "video.generate": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "skills.sync": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
  "telemetry.subscribe": { request: NotImplementedAny, response: NotImplementedAny, implemented: false },
};

export const NOT_IMPLEMENTED_CODE = -32601;

export class NotImplementedError extends Error {
  readonly code = NOT_IMPLEMENTED_CODE;
  constructor(method: Method) {
    super(`NotImplemented: ${method} is declared in the IPC contract but not implemented in Phase 1.`);
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

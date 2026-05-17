// Method handlers for the Node sidecar.
//
// Phase 1 implemented `ping` only. Phase 3 (v1.0.0) wires the
// `coding.session.*`, `coding.memory.snapshot`, `coding.trace.subscribe`, and
// `coding.sessions.list` surfaces against the in-memory
// `CodingSessionManager` + placeholder panel data. All remaining declared
// methods throw `NotImplementedError`; later phases add handlers without
// re-shaping the dispatcher.

import {
  CodingMemorySnapshotRequest,
  CodingSessionCancelRequest,
  CodingSessionListRequest,
  CodingSessionResumeRequest,
  CodingSessionSendMessageRequest,
  CodingSessionStartRequest,
  CodingTraceSubscribeRequest,
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

export const SIDECAR_VERSION = "1.0.0-alpha.0";

export interface HandlerContext {
  pid: number;
  platform: NodeJS.Platform;
  sessions: CodingSessionManager;
}

export type HandlerFn = (params: unknown, ctx: HandlerContext) => Promise<unknown>;

export function createHandlerContext(
  base: { pid: number; platform: NodeJS.Platform },
  sessions: CodingSessionManager = new CodingSessionManager(),
): HandlerContext {
  return { ...base, sessions };
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

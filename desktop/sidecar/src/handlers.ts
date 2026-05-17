// Method handlers for the Node sidecar. Phase 1 implements `ping` only; all
// other methods throw NotImplementedError. Later phases add their handlers
// here without changing the dispatcher.

import {
  IPC_METHODS,
  METHOD_SCHEMAS,
  NotImplementedError,
  PingResponse,
  PingResponseT,
  isMethod,
  type Method,
} from "./protocol.js";

export const SIDECAR_VERSION = "1.0.0-alpha.0";

export interface HandlerContext {
  pid: number;
  platform: NodeJS.Platform;
}

export type HandlerFn = (params: unknown, ctx: HandlerContext) => Promise<unknown>;

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

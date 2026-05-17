// JSON-RPC 2.0 IPC contract shared between the Tauri shell and the Node
// sidecar. Phase 1 implements only `ping`; every other method is declared so
// later phases drop schemas in without re-shaping the union.

import { z } from "zod";

export const IPC_METHODS = [
  "ping",
  "models.list",
  "models.install",
  "coding.startTask",
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

export function isMethod(value: string): value is Method {
  return (IPC_METHODS as readonly string[]).includes(value);
}

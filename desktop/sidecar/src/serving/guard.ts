/**
 * v1.16.0 Phase 1.2 (adoption item A1) -- serving-gateway security guard.
 *
 * Three independent controls, each a pure/testable unit:
 *
 *   1. `assertLoopbackHost` -- the gateway REFUSES TO START on any bind address
 *      outside `127.0.0.0/8`, `::1`, or a loopback hostname. It reuses
 *      `isLoopbackEndpoint` from `modules/coding/llm/LocalAdapterRegistry.ts`,
 *      the same predicate that guards outbound local-adapter endpoints, so the
 *      inbound and outbound loopback rules cannot drift apart.
 *   2. `checkBearerToken` -- constant-time bearer comparison. Both the OpenAI
 *      (`Authorization: Bearer`) and Anthropic (`x-api-key`) conventions are
 *      accepted so an unmodified SDK client works either way.
 *   3. `readLimitedBody` + `ConcurrencyLimiter` -- a runaway or buggy client
 *      cannot exhaust host memory or the local model runtime.
 *
 * The gateway exposes model inference ONLY. There is no route in this module or
 * its callers that touches the filesystem, spawns a process, or reaches a Nexus
 * tool -- see the route tables in `openaiRoutes.ts` / `anthropicRoutes.ts`.
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isLoopbackHost } from "../../../../modules/coding/llm/loopback.js";
import { badRequest, payloadTooLarge, tooManyRequests, unauthorized } from "./errors.js";

/** Default 1 MiB request cap. Generous for a chat payload, far below OOM. */
export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

/** Default in-flight completion cap. Local runtimes serialize anyway. */
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;

/** Thrown when the configured bind address is not loopback. */
export class ServingBindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServingBindError";
  }
}

function nonLoopbackRejection(host: string): string {
  return (
    `Local serving gateway refused to start: bind host "${host}" is not a ` +
    `loopback address. The Nexus local-first policy (AGENTS.md MCP Registry ` +
    `Policy) restricts the serving gateway to loopback endpoints ` +
    `(127.0.0.0/8, ::1, localhost); binding a routable address would expose ` +
    `local models to the network and is rejected. Set nexus.serving.host to ` +
    `127.0.0.1.`
  );
}

/**
 * Re-exported so the bind check and its callers share one import surface. The
 * predicate itself lives in the vscode-free `modules/coding/llm/loopback.ts`,
 * alongside the `isLoopbackEndpoint` rule that guards OUTBOUND local-adapter
 * endpoints -- inbound and outbound must never drift apart.
 */
export { isLoopbackHost };

/** Throws `ServingBindError` unless `host` is loopback. Called before `listen`. */
export function assertLoopbackHost(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new ServingBindError(nonLoopbackRejection(host));
  }
}

/** Constant-time string compare that does not leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal lengths; compare a fixed-size digest-like
  // padding instead of returning early on a length mismatch.
  if (ab.length !== bb.length) {
    // Still burn a comparison so the timing profile does not distinguish
    // "wrong length" from "wrong bytes".
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/**
 * Extract the presented credential from either supported header convention.
 * Returns `null` when no credential is present.
 */
export function presentedToken(headers: IncomingMessage["headers"]): string | null {
  const auth = headers.authorization;
  if (typeof auth === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim().length > 0) return apiKey.trim();
  return null;
}

/**
 * Reject the request unless it presents the configured token. Throws
 * `ServingHttpError` (401) so the caller renders it in the right wire shape.
 */
export function checkBearerToken(headers: IncomingMessage["headers"], expected: string): void {
  const presented = presentedToken(headers);
  if (presented === null) {
    throw unauthorized("Missing API key. Send it as 'Authorization: Bearer <token>' or 'x-api-key'.");
  }
  if (!safeEqual(presented, expected)) {
    throw unauthorized();
  }
}

/**
 * Read a request body, aborting once `maxBytes` is exceeded. The connection is
 * destroyed on overflow so a client streaming an unbounded body cannot keep
 * buffering into the process.
 */
export async function readLimitedBody(
  req: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  const declared = Number.parseInt(String(req.headers["content-length"] ?? ""), 10);
  if (Number.isInteger(declared) && declared > maxBytes) {
    throw payloadTooLarge(`Request body exceeds the ${maxBytes}-byte limit.`);
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(err);
    };

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail(payloadTooLarge(`Request body exceeds the ${maxBytes}-byte limit.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
  });
}

/** Parse a JSON body, mapping malformed input to a 400 rather than a 500. */
export function parseJsonBody(raw: string): unknown {
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw badRequest("Request body is not valid JSON.", "invalid_json");
  }
}

/**
 * Bounded in-flight request counter. `acquire()` throws 429 rather than queuing:
 * an agent tool waiting on a local model would rather get a fast, explicit
 * backpressure signal than an unbounded stall.
 */
export class ConcurrencyLimiter {
  private _inFlight = 0;

  constructor(private readonly _max: number = DEFAULT_MAX_CONCURRENT_REQUESTS) {}

  get inFlight(): number {
    return this._inFlight;
  }

  /** Reserve a slot, returning the release function. Throws 429 when saturated. */
  acquire(): () => void {
    if (this._inFlight >= this._max) {
      throw tooManyRequests(
        `Too many concurrent requests (limit ${this._max}). Retry when a request completes.`,
      );
    }
    this._inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._inFlight -= 1;
    };
  }
}

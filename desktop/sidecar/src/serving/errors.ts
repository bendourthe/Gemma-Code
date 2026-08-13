/**
 * v1.16.0 Phase 1.2/1.3 (adoption item A1) -- serving-gateway error surface.
 *
 * The gateway speaks to third-party clients (Claude Code, Codex, Cursor, curl),
 * so its errors must be shaped like the APIs those clients expect AND must leak
 * nothing about the host. Every outbound message passes through
 * `sanitizeMessage`, which strips absolute paths, `file://` URLs, and stack
 * frames -- an upstream Ollama/LM Studio failure must never hand a remote-ish
 * caller a filesystem layout.
 */

/** OpenAI error `type` values the gateway emits. */
export type ServingErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "not_found_error"
  | "rate_limit_error"
  | "api_error";

/** An error carrying the HTTP status and wire shape to return. */
export class ServingHttpError extends Error {
  readonly status: number;
  readonly type: ServingErrorType;
  readonly code: string | null;

  constructor(status: number, type: ServingErrorType, message: string, code: string | null = null) {
    super(message);
    this.name = "ServingHttpError";
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

export const badRequest = (message: string, code: string | null = null): ServingHttpError =>
  new ServingHttpError(400, "invalid_request_error", message, code);

export const unauthorized = (message = "Invalid or missing API key."): ServingHttpError =>
  new ServingHttpError(401, "authentication_error", message, "invalid_api_key");

export const notFound = (message: string, code: string | null = null): ServingHttpError =>
  new ServingHttpError(404, "not_found_error", message, code);

export const payloadTooLarge = (message: string): ServingHttpError =>
  new ServingHttpError(413, "invalid_request_error", message, "request_too_large");

export const tooManyRequests = (message: string): ServingHttpError =>
  new ServingHttpError(429, "rate_limit_error", message, "concurrency_limit_reached");

export const upstreamError = (message: string): ServingHttpError =>
  new ServingHttpError(502, "api_error", message, "upstream_error");

const WINDOWS_PATH = /[A-Za-z]:[\\/][^\s"']*/g;
const POSIX_PATH = /(?:^|[\s"'(])\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]*/g;
const FILE_URL = /file:\/\/\S*/g;
const STACK_FRAME = /\n\s*at\s+\S.*/g;

/**
 * Strip host-revealing detail from an error message. Applied to EVERY message
 * the gateway writes to the wire, including ones the gateway itself authored, so
 * a future message that interpolates a path cannot regress into a leak.
 */
export function sanitizeMessage(raw: string): string {
  return raw
    .replace(STACK_FRAME, "")
    .replace(FILE_URL, "[redacted]")
    .replace(WINDOWS_PATH, "[redacted]")
    .replace(POSIX_PATH, (m) => {
      // Keep the leading delimiter the match consumed so words stay separated.
      const lead = /^[\s"'(]/.test(m) ? m[0] : "";
      return `${lead}[redacted]`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize any thrown value into a `ServingHttpError`. Non-`ServingHttpError`
 * causes (an unreachable Ollama, a socket reset, a zod failure inside a client)
 * become a 502 with a sanitized message rather than a 500 with a stack.
 */
export function toServingError(err: unknown): ServingHttpError {
  if (err instanceof ServingHttpError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  return upstreamError(sanitizeMessage(raw) || "Upstream local model request failed.");
}

/** OpenAI-shaped error body (`POST /v1/chat/completions`, `GET /v1/models`). */
export function openAiErrorBody(err: ServingHttpError): string {
  return JSON.stringify({
    error: {
      message: sanitizeMessage(err.message),
      type: err.type,
      param: null,
      code: err.code,
    },
  });
}

/** Anthropic-shaped error body (`POST /v1/messages`). */
export function anthropicErrorBody(err: ServingHttpError): string {
  return JSON.stringify({
    type: "error",
    error: {
      type: anthropicErrorType(err),
      message: sanitizeMessage(err.message),
    },
  });
}

function anthropicErrorType(err: ServingHttpError): string {
  switch (err.status) {
    case 400:
      return "invalid_request_error";
    case 401:
      return "authentication_error";
    case 404:
      return "not_found_error";
    case 413:
      return "request_too_large";
    case 429:
      return "rate_limit_error";
    default:
      return "api_error";
  }
}

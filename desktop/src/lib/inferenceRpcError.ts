/**
 * v2.2.8 Phase 1 -- typed copy for slow local inference vs a dead sidecar.
 *
 * `sidecar response timeout` is reserved for short RPCs (ping/list) when the
 * sidecar is hung. Chat/coding/image/video generate use a minutes-class cap
 * and must never surface that string for a slow first token.
 */

export const LOCAL_INFERENCE_TIMEOUT_COPY =
  "Local model did not finish in time. Check Ollama is running and the weights are loaded.";

const SIDECAR_TIMEOUT_RE = /sidecar response timeout/i;
const TYPED_INFERENCE_CAP_RE = /did not finish in time/i;
const OLLAMA_RUNTIME_RE =
  /ollama|econnrefused|enotfound|etimedout|fetch failed|socket hang up|weights/i;

export function isSidecarTimeoutCopy(message: string): boolean {
  return SIDECAR_TIMEOUT_RE.test(message);
}

export function formatInferenceError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (isSidecarTimeoutCopy(raw) || TYPED_INFERENCE_CAP_RE.test(raw)) {
    return LOCAL_INFERENCE_TIMEOUT_COPY;
  }
  return raw;
}

/** Chat bubble copy: never `(chat unavailable) sidecar response timeout`. */
export function formatChatTurnError(err: unknown): string {
  const formatted = formatInferenceError(err);
  if (formatted === LOCAL_INFERENCE_TIMEOUT_COPY) return formatted;
  const raw = err instanceof Error ? err.message : String(err);
  if (OLLAMA_RUNTIME_RE.test(raw)) return formatted;
  return `(chat unavailable) ${formatted}`;
}

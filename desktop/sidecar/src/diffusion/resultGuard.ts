/**
 * v2.2.5 Phase 2 -- classify a Python diffusion result before the studio
 * pump emits `complete`. Empty, 1x1, or ok:false payloads are typed
 * pre-complete errors, never a successful generate.
 *
 * v2.2.9 T009 -- the Python runtime now raises three DISTINCT typed
 * reasons (no CUDA torch in the diffusion venv / weights missing for the
 * named model id / GPU not available). Any `ok: false` message from the
 * runtime MUST pass through to the UI verbatim; the combined constants
 * below are last-resort fallbacks used only when the runtime returned no
 * message at all (empty or 1x1 payloads with no envelope). Never collapse
 * a typed runtime message back into these constants.
 */

import {
  isUsableImageBase64,
  isUsableVideoPath,
} from "../../../src/shared/studio/usablePayload";

export const IMAGE_RUNTIME_NOT_READY =
  "image runtime is not ready: GPU or diffusion weights unavailable";

export const VIDEO_RUNTIME_NOT_READY =
  "video runtime is not ready: GPU or diffusion weights unavailable";

export interface DiffusionEnvelope {
  readonly ok?: unknown;
  readonly error?: unknown;
  readonly message?: unknown;
  readonly pngBase64?: unknown;
  readonly mp4Path?: unknown;
}

function failedMessage(accepted: DiffusionEnvelope | null | undefined, fallback: string): string {
  if (!accepted) return fallback;
  if (typeof accepted.message === "string" && accepted.message.trim().length > 0) {
    return accepted.message;
  }
  if (typeof accepted.error === "string" && accepted.error.trim().length > 0) {
    return String(accepted.error);
  }
  return fallback;
}

export function requireUsableImagePng(
  accepted: DiffusionEnvelope | null | undefined,
  stderr: string,
  log: (line: string) => void,
): string {
  if (accepted && accepted.ok === false) {
    throw new Error(failedMessage(accepted, IMAGE_RUNTIME_NOT_READY));
  }
  const png = typeof accepted?.pngBase64 === "string" ? accepted.pngBase64 : "";
  if (!isUsableImageBase64(png)) {
    const tail = stderr.trim();
    if (tail.length > 0) {
      log(`[nexus-sidecar] diffusion empty-complete stderr: ${tail}\n`);
    }
    throw new Error(IMAGE_RUNTIME_NOT_READY);
  }
  return png;
}

export function requireUsableVideoPath(
  accepted: DiffusionEnvelope | null | undefined,
  stderr: string,
  log: (line: string) => void,
): string {
  if (accepted && accepted.ok === false) {
    throw new Error(failedMessage(accepted, VIDEO_RUNTIME_NOT_READY));
  }
  const mp4Path = typeof accepted?.mp4Path === "string" ? accepted.mp4Path : "";
  if (!isUsableVideoPath(mp4Path)) {
    const tail = stderr.trim();
    if (tail.length > 0) {
      log(`[nexus-sidecar] diffusion empty-complete stderr: ${tail}\n`);
    }
    throw new Error(VIDEO_RUNTIME_NOT_READY);
  }
  return mp4Path;
}

/**
 * v1.20.0 Phase 1 (A1) -- process-wide OCR runtime for the sidecar.
 *
 * Chat `ocr.*` IPC and the `parse_document` agent tool must share one Python
 * child. A second `createOcrRuntimeBundle()` would spawn a second interpreter
 * and still contend on GPU/CPU. Tests inject `ctx.ocr` and never touch this.
 */

import { createOcrRuntimeBundle, type OcrRuntime } from "../../../../core/documents/ocrRuntimeFactory.js";

let _ocrRuntime: OcrRuntime | null = null;

export function getSharedOcrRuntime(override?: OcrRuntime): OcrRuntime {
  if (override) return override;
  if (!_ocrRuntime) _ocrRuntime = createOcrRuntimeBundle();
  return _ocrRuntime;
}

/** Test seam: drop the memoized bundle so the next call rebuilds. */
export function resetSharedOcrRuntime(): void {
  _ocrRuntime = null;
}

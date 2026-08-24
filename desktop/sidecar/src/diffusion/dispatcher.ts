/**
 * v1.0.0 Phase 6.2-6.4 -- diffusion job dispatcher.
 *
 * Translates validated IPC requests into Python-runtime calls and
 * produces a deterministic `jobId` so the UI can correlate progress
 * events with the originating request.
 *
 * `buildJobRequest` is the seam: tests pass an `InMemoryDiffusionRuntime`
 * with a stubbed response and verify the resulting envelope without
 * spinning up a real Python interpreter.
 */

import { Buffer } from "node:buffer";
import {
  type DiffusionRuntimeClient,
} from "./runtimeClient.js";
import {
  extractWorkflow,
  type WorkflowMetadata,
} from "../../../../core/image/WorkflowMetadata.js";
import {
  foldRequestModelId,
  requireSourceImageBytes,
  resolveImageMethod,
} from "./route.js";
import { requireUsableImagePng } from "./resultGuard.js";

export type DispatcherMode = "txt2img" | "img2img" | "inpaint" | "outpaint";

export interface DispatcherResult {
  readonly jobId: string;
  readonly mode: DispatcherMode;
  readonly offloadStrategy?: string;
  readonly estimatedSeconds?: number;
  readonly pngBase64?: string;
  readonly workflow?: WorkflowMetadata;
}

let _counter = 0;
let _jobIdFactory: () => string = () => {
  _counter += 1;
  return `job-${Date.now().toString(36)}-${_counter.toString(36)}`;
};

/** Allocate the next image job id without talking to the runtime. */
export function nextJobId(): string {
  return _jobIdFactory();
}

/** Test seam: deterministic ids in unit tests. */
export function setJobIdFactory(fn: () => string): void {
  _jobIdFactory = fn;
}

/** Reset to the default counter-based factory. */
export function resetJobIdFactory(): void {
  _counter = 0;
  _jobIdFactory = () => {
    _counter += 1;
    return `job-${Date.now().toString(36)}-${_counter.toString(36)}`;
  };
}

export async function buildJobRequest(
  mode: DispatcherMode,
  request: Record<string, unknown>,
  client: DiffusionRuntimeClient,
  jobId: string = _jobIdFactory(),
): Promise<DispatcherResult> {
  const folded = foldRequestModelId(request);
  requireSourceImageBytes(mode, folded);
  const method = resolveImageMethod(mode, folded["modelId"]);
  const payload = { jobId, mode, request: folded };
  const accepted = (await client.call(method, payload)) as
    | (Partial<DispatcherResult> & { ok?: unknown; error?: unknown; message?: unknown })
    | null;
  const pngBase64 = requireUsableImagePng(accepted, client.lastStderr?.() ?? "", (line) => {
    process.stderr.write(line);
  });
  return {
    jobId,
    mode,
    offloadStrategy: accepted?.offloadStrategy,
    estimatedSeconds: accepted?.estimatedSeconds,
    pngBase64,
    workflow: accepted?.workflow,
  };
}

/**
 * Helper used by the `diffusion.workflow.extract` handler. Decodes a
 * base64 PNG body to a Buffer and runs the shared
 * `core/image/WorkflowMetadata` extractor. Returns `null` if the PNG
 * does not embed a Nexus workflow blob.
 */
export function extractWorkflowFromBase64Png(
  base64: string,
): WorkflowMetadata | null {
  const buffer = Buffer.from(base64, "base64");
  return extractWorkflow(buffer);
}

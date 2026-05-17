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

export type DispatcherMode = "txt2img" | "img2img" | "inpaint" | "outpaint";

export interface DispatcherResult {
  readonly jobId: string;
  readonly mode: DispatcherMode;
  readonly offloadStrategy?: string;
  readonly estimatedSeconds?: number;
}

let _counter = 0;
let _jobIdFactory: () => string = () => {
  _counter += 1;
  return `job-${Date.now().toString(36)}-${_counter.toString(36)}`;
};

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
): Promise<DispatcherResult> {
  const jobId = _jobIdFactory();
  const payload = { jobId, mode, request };
  const accepted = (await client.call(mode, payload)) as Partial<DispatcherResult> | null;
  return {
    jobId,
    mode,
    offloadStrategy: accepted?.offloadStrategy,
    estimatedSeconds: accepted?.estimatedSeconds,
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

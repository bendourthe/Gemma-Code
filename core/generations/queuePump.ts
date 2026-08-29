/**
 * v2.1.0 Phase 3 -- dequeue one generation job and run it through GpuScheduler.
 *
 * Interactive jobs use foreground priority; batch uses background. Image/video
 * jobs never kill a coding occupant: they wait in the scheduler queue.
 */

import type { GpuScheduler, JobHandle } from "../scheduler/GpuScheduler.js";
import { contentHash } from "./contentHash.js";
import type { GenerationIndex } from "./GenerationIndex.js";
import type { GenerationJob, GenerationQueue } from "./GenerationQueue.js";

export interface PumpRunResult {
  readonly pngBase64?: string;
  readonly outputPath?: string;
  readonly outputId?: string;
  readonly outputHash?: string;
  readonly bytes?: Buffer;
  readonly workflow?: Record<string, unknown>;
}

export interface QueuePumpErrorEvent {
  readonly kind: "error";
  readonly jobId: string;
  readonly message: string;
}

export interface QueuePumpAdapters {
  readonly run: (
    job: GenerationJob,
    signal: AbortSignal,
  ) => Promise<PumpRunResult>;
  readonly scheduler?: Pick<GpuScheduler, "enqueue">;
  readonly index?: GenerationIndex;
  readonly estimatedVramGB?: (job: GenerationJob) => number;
  /** Retains the scheduler handle so an IPC cancellation can abort native work. */
  readonly onHandle?: (handle: JobHandle, job: GenerationJob) => void;
  /** Drops the retained handle after every terminal scheduler outcome. */
  readonly onHandleSettled?: (handle: JobHandle, job: GenerationJob) => void;
  /** Publishes a completion only after cancellation, indexing, and state gates pass. */
  readonly onSuccess?: (result: PumpRunResult, job: GenerationJob) => void;
  /** Surfaces runner failures to the owning runtime event queue. */
  readonly onError?: (event: QueuePumpErrorEvent, job: GenerationJob) => void;
}

function wasCancelled(queue: GenerationQueue, jobId: string): boolean {
  const current = queue.get(jobId);
  return current?.state === "failed" && current.error === "cancelled";
}

export async function pumpOnce(
  queue: GenerationQueue,
  adapters: QueuePumpAdapters,
): Promise<GenerationJob | null> {
  const job = queue.claimNext();
  if (!job) return null;
  const vram =
    adapters.estimatedVramGB?.(job) ?? (job.pillar === "video" ? 8 : 6);
  const localAbort = new AbortController();
  let runSignal: AbortSignal = localAbort.signal;
  const execute = async (
    signal: AbortSignal = localAbort.signal,
  ): Promise<PumpRunResult> => {
    runSignal = signal;
    return adapters.run(job, signal);
  };
  let handle: JobHandle | null = null;
  try {
    let result: PumpRunResult;
    if (adapters.scheduler) {
      handle = await adapters.scheduler.enqueue({
        moduleId: job.pillar,
        jobType: job.jobType,
        estimatedVramGB: vram,
        priority: job.priority === "interactive" ? "foreground" : "background",
        id: job.id,
        run: execute,
      });
      adapters.onHandle?.(handle, job);
      result = await handle.completion.then((value) => value as PumpRunResult);
    } else {
      result = await execute();
    }

    // Cancellation is authoritative even when a runner ignores AbortSignal and
    // resolves late. Never index or mark such an artifact successful.
    if (wasCancelled(queue, job.id)) return queue.get(job.id);
    let completedResult = result;
    let completedAtomically = false;
    if (
      adapters.index &&
      result.workflow &&
      result.outputPath &&
      job.pillar === "video"
    ) {
      const completion = await queue.completeGenerationOutput({
        jobId: job.id,
        output: {
          id: job.id,
          outputPath: result.outputPath,
          workflow: result.workflow,
        },
        signal: runSignal,
      });
      completedAtomically = true;
      completedResult = {
        ...result,
        outputId: completion.output.id,
        outputHash: completion.output.contentHash,
      };
    } else if (adapters.index && result.workflow) {
      const bytes =
        result.bytes ??
        (result.pngBase64 ? Buffer.from(result.pngBase64, "base64") : job.id);
      adapters.index.put(bytes, job.pillar, result.workflow);
    } else if (adapters.index && result.pngBase64) {
      adapters.index.put(Buffer.from(result.pngBase64, "base64"), job.pillar, {
        ...job.parameters,
        contentHash: contentHash(Buffer.from(result.pngBase64, "base64")),
      });
    }
    if (!completedAtomically) queue.markDone(job.id);
    try {
      adapters.onSuccess?.(completedResult, job);
    } catch {
      // A presentation event sink cannot rewrite the durable successful state.
    }
    return queue.get(job.id);
  } catch (err) {
    if (wasCancelled(queue, job.id)) return queue.get(job.id);
    const message = err instanceof Error ? err.message : String(err);
    queue.markFailed(job.id, message);
    adapters.onError?.({ kind: "error", jobId: job.id, message }, job);
    return queue.get(job.id);
  } finally {
    if (handle) {
      try {
        adapters.onHandleSettled?.(handle, job);
      } catch {
        // Bookkeeping must not rewrite an already authoritative job outcome.
      }
    }
  }
}

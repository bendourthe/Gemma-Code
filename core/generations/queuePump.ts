/**
 * v2.1.0 Phase 3 -- dequeue one generation job and run it through GpuScheduler.
 *
 * Interactive jobs use foreground priority; batch uses background. Image/video
 * jobs never kill a coding occupant: they wait in the scheduler queue.
 */

import type { GpuScheduler } from "../scheduler/GpuScheduler.js";
import { contentHash } from "./contentHash.js";
import type { GenerationIndex } from "./GenerationIndex.js";
import type { GenerationJob, GenerationQueue } from "./GenerationQueue.js";

export interface PumpRunResult {
  readonly pngBase64?: string;
  readonly outputPath?: string;
  readonly bytes?: Buffer;
  readonly workflow?: Record<string, unknown>;
}

export interface QueuePumpAdapters {
  readonly run: (job: GenerationJob) => Promise<PumpRunResult>;
  readonly scheduler?: Pick<GpuScheduler, "enqueue">;
  readonly index?: GenerationIndex;
  readonly estimatedVramGB?: (job: GenerationJob) => number;
}

export async function pumpOnce(
  queue: GenerationQueue,
  adapters: QueuePumpAdapters,
): Promise<GenerationJob | null> {
  const job = queue.claimNext();
  if (!job) return null;
  const vram = adapters.estimatedVramGB?.(job) ?? (job.pillar === "video" ? 8 : 6);
  const execute = async (): Promise<PumpRunResult> => adapters.run(job);
  try {
    const result = adapters.scheduler
      ? await (
          await adapters.scheduler.enqueue({
            moduleId: job.pillar,
            jobType: job.jobType,
            estimatedVramGB: vram,
            priority: job.priority === "interactive" ? "foreground" : "background",
            id: job.id,
            run: execute,
          })
        ).completion.then((value) => value as PumpRunResult)
      : await execute();
    if (adapters.index && result.workflow) {
      const bytes =
        result.bytes ??
        (result.pngBase64 ? Buffer.from(result.pngBase64, "base64") : result.outputPath ?? job.id);
      adapters.index.put(bytes, job.pillar, result.workflow);
    } else if (adapters.index && result.pngBase64) {
      adapters.index.put(Buffer.from(result.pngBase64, "base64"), job.pillar, {
        ...job.parameters,
        contentHash: contentHash(Buffer.from(result.pngBase64, "base64")),
      });
    }
    queue.markDone(job.id);
    return queue.get(job.id);
  } catch (err) {
    queue.markFailed(job.id, err instanceof Error ? err.message : String(err));
    return queue.get(job.id);
  }
}

/**
 * v1.16.0 Phase 3 (adoption item A5) -- document-parse job manager.
 *
 * A parse is long-running (a 200-page PDF on a CPU-only host is minutes), so it
 * follows `models/installManager.ts`'s accept -> drain -> cancel shape rather
 * than the diffusion runtime's fire-and-return-the-whole-result shape:
 *
 *   start()  -> a jobId, immediately; the parse runs in the background
 *   drain()  -> buffered progress events + a `done` flag + the terminal result
 *   cancel() -> abandons the job
 *
 * The IPC channel therefore never blocks for the length of a parse.
 *
 * Cancellation is cooperative and honest about its limit: the Python runtime
 * processes one `parse` call synchronously, so cancelling stops Nexus from
 * *waiting* and discards the result, but does not interrupt an in-flight page
 * inside Python. That is recorded rather than papered over -- claiming a hard
 * kill we do not perform would be worse than the real, bounded guarantee.
 */

import type { OcrEvent, OcrRuntimeClient } from "./runtimeClient.js";

/** Terminal + progress events a poller receives. */
export interface OcrJobEvent {
  readonly kind: "progress" | "complete" | "error";
  readonly jobId: string;
  readonly page?: number;
  readonly totalPages?: number;
  readonly stage?: string;
  readonly message?: string;
}

/** The parsed document, returned once with the terminal `complete` drain. */
export interface OcrParseResult {
  readonly engine: string;
  readonly text: string;
  readonly markdown: string | null;
  readonly pageCount: number;
  readonly pages: ReadonlyArray<{ readonly index: number; readonly text: string }>;
}

export interface OcrParseRequest {
  readonly documentBase64: string;
  readonly engine?: string;
  readonly dpi?: number;
  readonly maxPages?: number;
  readonly modelDir?: string;
}

/** Raw envelope the Python runtime returns from `parse`. */
interface PythonParseEnvelope {
  ok?: boolean;
  error?: string;
  message?: string;
  engine?: string;
  text?: string;
  markdown?: string | null;
  pageCount?: number;
  pages?: Array<{ index: number; text: string }>;
}

interface Job {
  readonly id: string;
  events: OcrJobEvent[];
  done: boolean;
  cancelled: boolean;
  result: OcrParseResult | null;
}

let _jobSeq = 0;
let _jobIdFactory: () => string = () => `ocr-${Date.now().toString(36)}-${++_jobSeq}`;

/** Test seam: make job ids deterministic. */
export function setOcrJobIdFactory(fn: () => string): void {
  _jobIdFactory = fn;
}

export function resetOcrJobIdFactory(): void {
  _jobSeq = 0;
  _jobIdFactory = () => `ocr-${Date.now().toString(36)}-${++_jobSeq}`;
}

export class OcrParseManager {
  private readonly _jobs = new Map<string, Job>();

  constructor(private readonly _client: OcrRuntimeClient) {}

  /** Accept a parse and return its job id immediately. */
  start(request: OcrParseRequest): string {
    const id = _jobIdFactory();
    const job: Job = { id, events: [], done: false, cancelled: false, result: null };
    this._jobs.set(id, job);
    void this._run(job, request);
    return id;
  }

  private async _run(job: Job, request: OcrParseRequest): Promise<void> {
    try {
      const envelope = (await this._client.call("parse", {
        jobId: job.id,
        request: { ...request },
      })) as PythonParseEnvelope | null;

      if (job.cancelled) return;

      if (!envelope || envelope.ok !== true) {
        // The runtime returns a failure as a RESULT with a stable code, so the
        // desktop can show a specific message ("install the model", "needs an
        // NVIDIA GPU") instead of a generic transport error.
        job.events.push({
          kind: "error",
          jobId: job.id,
          message: envelope?.message ?? envelope?.error ?? "document parse failed",
        });
      } else {
        job.result = {
          engine: envelope.engine ?? "unknown",
          text: envelope.text ?? "",
          markdown: envelope.markdown ?? null,
          pageCount: envelope.pageCount ?? 0,
          pages: envelope.pages ?? [],
        };
        job.events.push({ kind: "complete", jobId: job.id });
      }
    } catch (err) {
      if (job.cancelled) return;
      job.events.push({
        kind: "error",
        jobId: job.id,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      job.done = true;
    }
  }

  /**
   * Drain buffered events. Merges the runtime's own progress notifications with
   * this manager's terminal events, so a caller polls exactly one surface.
   */
  drain(jobId: string): {
    events: readonly OcrJobEvent[];
    done: boolean;
    result: OcrParseResult | null;
  } {
    const job = this._jobs.get(jobId);
    if (!job) {
      return {
        events: [{ kind: "error", jobId, message: `unknown job ${jobId}` }],
        done: true,
        result: null,
      };
    }
    const runtimeEvents = this._client.drainEvents(jobId).map(toJobEvent);
    const own = job.events;
    job.events = [];
    const events = [...runtimeEvents, ...own];
    const result = job.result;
    if (job.done) {
      // One-shot: the terminal drain hands the result over and forgets the job,
      // so a completed parse cannot leak its text for the process lifetime.
      this._jobs.delete(jobId);
    }
    return { events, done: job.done, result };
  }

  /** Abandon a job. Idempotent, and safe for an unknown id. */
  cancel(jobId: string): void {
    const job = this._jobs.get(jobId);
    if (!job) return;
    job.cancelled = true;
    job.done = true;
    job.result = null;
    job.events = [{ kind: "error", jobId, message: "cancelled" }];
  }

  /** Test/introspection helper: how many jobs are still tracked. */
  get activeJobs(): number {
    return this._jobs.size;
  }
}

function toJobEvent(event: OcrEvent): OcrJobEvent {
  const raw = event as unknown as Record<string, unknown>;
  return {
    kind: "progress",
    jobId: String(raw.jobId ?? ""),
    page: typeof raw.page === "number" ? raw.page : undefined,
    totalPages: typeof raw.totalPages === "number" ? raw.totalPages : undefined,
    stage: typeof raw.stage === "string" ? raw.stage : undefined,
  };
}

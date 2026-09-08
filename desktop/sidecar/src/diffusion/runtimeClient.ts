/**
 * v1.0.0 Phase 6.1 -- Node-side JSON-RPC client for the Python diffusion
 * sidecar.
 *
 * The Rust core spawns `python -m runtimes.diffusion.main` alongside the
 * Node sidecar. Node forwards `diffusion.*` IPC methods to Python over the
 * child's stdin/stdout using the same line-delimited JSON-RPC 2.0 wire
 * format that the Tauri shell uses to talk to Node.
 *
 * `DiffusionRuntimeClient` is the interface the handler table consumes;
 * the production `ChildProcessDiffusionRuntime` spawns the Python process
 * lazily on first request. Tests inject `InMemoryDiffusionRuntime` so the
 * IPC layer is exercised end-to-end without a Python interpreter.
 */

import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export interface DiffusionProgressEvent {
  readonly jobId: string;
  readonly stage?: string;
  readonly step?: number;
  readonly totalSteps?: number;
  readonly preview?: string;
  readonly message?: string;
  readonly offloadStrategy?: string;
  readonly conditioningPreview?: string;
  /** Bytes of weights read so far / to read while `stage` is `loading`. */
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
  /** Runtime estimate of seconds until the weights are loaded. */
  readonly etaS?: number | null;
  /** Module holding the GPU while `stage` is `queued` (sidecar-synthesized). */
  readonly blockedBy?: string;
}

export type DiffusionEvent =
  | ({ kind: "progress" } & DiffusionProgressEvent)
  | {
      kind: "complete";
      jobId: string;
      outputPath?: string;
      outputId?: string;
      outputHash?: string;
      png?: string;
    }
  | { kind: "error"; jobId: string; message: string };

export interface DiffusionRuntimeClient {
  call<T = unknown>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T>;
  drainEvents(jobId: string): readonly DiffusionEvent[];
  shutdown(): Promise<void>;
  lastStderr?(): string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * In-memory client used by tests and the dispatcher when the Python
 * runtime is intentionally unavailable. It stores a static response
 * table by method name and queues fake progress events per jobId.
 *
 * The dispatcher uses this in CI so the JSON-RPC contract can be
 * verified without spinning up Python.
 */
export class InMemoryDiffusionRuntime implements DiffusionRuntimeClient {
  private readonly responses = new Map<string, unknown>();
  private readonly errors = new Map<string, string>();
  private readonly events = new Map<string, DiffusionEvent[]>();
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> =
    [];

  setResponse(method: string, value: unknown): void {
    this.responses.set(method, value);
    this.errors.delete(method);
  }

  setError(method: string, message: string): void {
    this.errors.set(method, message);
    this.responses.delete(method);
  }

  emit(event: DiffusionEvent): void {
    const queue = this.events.get(event.jobId) ?? [];
    queue.push(event);
    this.events.set(event.jobId, queue);
  }

  lastStderr(): string {
    return "";
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.calls.push({ method, params });
    const err = this.errors.get(method);
    if (err) {
      throw new Error(err);
    }
    if (!this.responses.has(method)) {
      throw new Error(
        `InMemoryDiffusionRuntime: no response stubbed for ${method}`,
      );
    }
    return this.responses.get(method) as T;
  }

  drainEvents(jobId: string): readonly DiffusionEvent[] {
    const queue = this.events.get(jobId) ?? [];
    this.events.delete(jobId);
    return queue;
  }

  async shutdown(): Promise<void> {
    this.events.clear();
    this.responses.clear();
    this.errors.clear();
  }
}

export interface ChildProcessRuntimeOptions {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnFn?: typeof spawn;
  readonly readyTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

/**
 * Production client: lazily spawns `python -m runtimes.diffusion.main`,
 * pipes JSON-RPC requests to stdin, reads responses + event notifications
 * from stdout. Events whose payload includes a `jobId` are queued; the
 * dispatcher drains them at the end of the synchronous IPC reply so the
 * Tauri shell can render progress incrementally.
 */
export const DEFAULT_DIFFUSION_REQUEST_TIMEOUT_MS = 60_000;
export const GENERATION_DIFFUSION_REQUEST_TIMEOUT_MS = 1_800_000;

export function diffusionRequestTimeoutMs(
  method: string,
  overrideMs?: number,
): number {
  if (overrideMs != null) return overrideMs;
  return /txt2img|img2img|inpaint|outpaint|text2video|image2video|video\./i.test(
    method,
  )
    ? GENERATION_DIFFUSION_REQUEST_TIMEOUT_MS
    : DEFAULT_DIFFUSION_REQUEST_TIMEOUT_MS;
}

export class ChildProcessDiffusionRuntime implements DiffusionRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new Map<string, DiffusionEvent[]>();
  private nextId = 1;
  private stderrTail = "";
  /** Resolves once the freshly spawned runtime has answered `health`. */
  private warmup: Promise<void> | null = null;

  constructor(private readonly options: ChildProcessRuntimeOptions = {}) {}

  private ensureSpawned(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const spawnFn = this.options.spawnFn ?? spawn;
    const command = this.options.command ?? "python";
    const args = [...(this.options.args ?? ["-m", "runtimes.diffusion.main"])];
    const spawnOpts: SpawnOptions = {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawnFn(
      command,
      args,
      spawnOpts,
    ) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.stderrTail = "";
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        this.stderrTail = (this.stderrTail + chunk).slice(-32_768);
      });
    }
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl = rl;
    rl.on("line", (line: string) => this.handleLine(line));
    child.on("exit", () => {
      this.failPending(new Error("diffusion-runtime-exited"));
      this.child = null;
      this.rl = null;
      this.warmup = null;
    });
    child.on("error", (err: Error) => {
      this.failPending(err);
    });
    return child;
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof parsed.id === "number") {
      const id = parsed.id;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (parsed.error && typeof parsed.error === "object") {
        const errObj = parsed.error as { message?: string };
        entry.reject(new Error(errObj.message ?? "diffusion-runtime-error"));
      } else {
        entry.resolve(parsed.result ?? null);
      }
      return;
    }
    // Notification (no id) -- event for a job. The Python runtime speaks
    // JSON-RPC, so its payload sits under `params`; a bare object (in-memory
    // fixtures, older emitters) carries the fields at the top level. Reading
    // only the top level dropped every loading / generating / heartbeat event
    // the runtime sent (v2.4.8 follow-up, 2026-09-07), which is why the bubble
    // never left "Loading model..." no matter what the runtime was doing.
    const params = parsed.params;
    const event = (
      params && typeof params === "object" && !Array.isArray(params) ? params : parsed
    ) as Record<string, unknown> & { jobId?: string };
    if (typeof event.jobId === "string") {
      const queue = this.events.get(event.jobId) ?? [];
      queue.push(event as unknown as DiffusionEvent);
      this.events.set(event.jobId, queue);
    }
  }

  /**
   * v2.4.8 follow-up (2026-09-07): never let a job be the first request a
   * freshly spawned runtime sees. Job methods run on the runtime's worker
   * threads, and a first torch import from one of those does not finish on
   * Windows -- the runtime heartbeats forever without reaching a pipeline
   * stage. `health` is a control method: it runs inline on the runtime's main
   * thread, so awaiting it once imports torch where it is safe. The runtime
   * also warms itself at startup; this gate keeps an older runtime working.
   */
  private warm(): Promise<void> {
    if (!this.warmup) {
      this.warmup = this.request<unknown>(
        "health",
        {},
        // A client that configured a short request timeout gets a short
        // warm-up too, so the gate never outlives the call it guards.
        this.options.readyTimeoutMs ??
          this.options.requestTimeoutMs ??
          DEFAULT_DIFFUSION_REQUEST_TIMEOUT_MS,
      ).then(
        () => undefined,
        // A runtime that cannot answer health still gets the job: it fails
        // with its own typed error rather than being blocked here.
        () => undefined,
      );
    }
    return this.warmup;
  }

  async call<T = unknown>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    this.ensureSpawned();
    if (method !== "health" && method !== "version") await this.warm();
    return this.request<T>(
      method,
      params,
      diffusionRequestTimeoutMs(method, this.options.requestTimeoutMs),
    );
  }

  private request<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    const child = this.ensureSpawned();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(
            new Error(`diffusion.${method}: timeout after ${timeoutMs}ms`),
          );
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      child.stdin.write(payload + "\n");
    });
  }

  drainEvents(jobId: string): readonly DiffusionEvent[] {
    const queue = this.events.get(jobId) ?? [];
    this.events.delete(jobId);
    return queue;
  }

  lastStderr(): string {
    return this.stderrTail;
  }

  async shutdown(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.child) {
      const child = this.child;
      this.child = null;
      try {
        child.stdin.end();
      } catch {
        // already closed
      }
      child.kill();
    }
    this.failPending(new Error("diffusion-runtime-shutdown"));
    this.events.clear();
    this.warmup = null;
  }
}

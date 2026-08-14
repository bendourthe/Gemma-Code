/**
 * v1.16.0 Phase 3 (adoption item A5) -- Node-side JSON-RPC client for the Python
 * document-OCR runtime.
 *
 * v1.16.0 Phase 4 (adoption item A6): promoted from `desktop/sidecar/src/ocr/`
 * into `core/` so BOTH consumers share one implementation -- the sidecar's
 * `ocr.*` IPC handlers and the `parse_document` agent tool, which runs in the
 * VS Code extension host where the sidecar is unreachable. Duplicating the
 * spawn + JSON-RPC logic per host was the alternative and would have let the two
 * copies drift. Depends on node builtins only, so it satisfies the
 * `no-core-from-modules` boundary rule.
 *
 * Mirrors `diffusion/runtimeClient.ts` (same line-delimited JSON-RPC 2.0 wire
 * format, same lazy child spawn, same id-vs-notification split) with two
 * deliberate differences, both taken from `models/installManager.ts` because a
 * document parse is a long job a user may abandon:
 *
 *   1. `drain()` reports a `done` flag, so a poller knows when to stop rather
 *      than guessing from an empty queue.
 *   2. `cancel()` exists. The diffusion path has no cancel at all.
 *
 * Model weights and CUDA never enter this process: the Node side only ships
 * base64 in and text out. Everything heavy -- including the one model that runs
 * `trust_remote_code` -- stays inside the Python child.
 */

import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { createInterface, type Interface } from "node:readline";

/** Per-page progress notification emitted by the Python runtime. */
export interface OcrProgressEvent {
  readonly jobId: string;
  readonly stage?: string;
  /** Pages completed so far. */
  readonly page?: number;
  readonly totalPages?: number;
}

export type OcrEvent =
  | ({ kind: "progress" } & OcrProgressEvent)
  | { kind: "complete"; jobId: string }
  | { kind: "error"; jobId: string; message: string };

export interface OcrRuntimeClient {
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
  drainEvents(jobId: string): readonly OcrEvent[];
  shutdown(): Promise<void>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * In-memory client for tests and for hosts where the Python runtime is
 * intentionally absent. Lets the whole IPC contract -- including the progress
 * stream and the error envelopes -- be verified without a Python interpreter.
 */
export class InMemoryOcrRuntime implements OcrRuntimeClient {
  private readonly responses = new Map<string, unknown>();
  private readonly errors = new Map<string, string>();
  private readonly events = new Map<string, OcrEvent[]>();
  /** Test seam: the params of the most recent `call`. */
  lastParams: Record<string, unknown> | null = null;

  setResponse(method: string, value: unknown): void {
    this.responses.set(method, value);
    this.errors.delete(method);
  }

  setError(method: string, message: string): void {
    this.errors.set(method, message);
    this.responses.delete(method);
  }

  emit(event: OcrEvent): void {
    const queue = this.events.get(event.jobId) ?? [];
    queue.push(event);
    this.events.set(event.jobId, queue);
  }

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    this.lastParams = params;
    const err = this.errors.get(method);
    if (err) throw new Error(err);
    if (!this.responses.has(method)) {
      throw new Error(`InMemoryOcrRuntime: no response stubbed for ${method}`);
    }
    return this.responses.get(method) as T;
  }

  drainEvents(jobId: string): readonly OcrEvent[] {
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

export interface OcrChildProcessOptions {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnFn?: typeof spawn;
  readonly requestTimeoutMs?: number;
}

/**
 * Production client: lazily spawns `python -m runtimes.ocr.main`.
 *
 * The default request timeout is generous (10 minutes) because a 200-page
 * document on a CPU-only host is legitimately slow; the per-page progress stream
 * is what keeps the UI honest in the meantime.
 */
export class ChildProcessOcrRuntime implements OcrRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new Map<string, OcrEvent[]>();
  private nextId = 1;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: OcrChildProcessOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 600_000;
  }

  private ensureSpawned(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const spawnFn = this.options.spawnFn ?? spawn;
    const command = this.options.command ?? "python";
    const args = [...(this.options.args ?? ["-m", "runtimes.ocr.main"])];
    const spawnOpts: SpawnOptions = {
      cwd: this.options.cwd,
      env: this.options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawnFn(command, args, spawnOpts) as ChildProcessWithoutNullStreams;
    this.child = child;
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.rl = rl;
    rl.on("line", (line: string) => this.handleLine(line));
    child.on("exit", () => {
      this.failPending(new Error("ocr-runtime-exited"));
      this.child = null;
      this.rl = null;
    });
    child.on("error", (err: Error) => this.failPending(err));
    return child;
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
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
      const entry = this.pending.get(parsed.id);
      if (!entry) return;
      this.pending.delete(parsed.id);
      if (parsed.error && typeof parsed.error === "object") {
        const errObj = parsed.error as { message?: string };
        entry.reject(new Error(errObj.message ?? "ocr-runtime-error"));
      } else {
        entry.resolve(parsed.result ?? null);
      }
      return;
    }
    // Notification (no id) -- a per-page progress event for a job.
    const event = parsed as Record<string, unknown> & { jobId?: string };
    if (typeof event.jobId === "string") {
      const queue = this.events.get(event.jobId) ?? [];
      queue.push(event as unknown as OcrEvent);
      this.events.set(event.jobId, queue);
    }
  }

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const child = this.ensureSpawned();
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`ocr.${method}: timeout after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);
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

  drainEvents(jobId: string): readonly OcrEvent[] {
    const queue = this.events.get(jobId) ?? [];
    this.events.delete(jobId);
    return queue;
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
    this.failPending(new Error("ocr-runtime-shutdown"));
    this.events.clear();
  }
}

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
}

export type DiffusionEvent =
  | ({ kind: "progress" } & DiffusionProgressEvent)
  | { kind: "complete"; jobId: string; outputPath?: string; png?: string }
  | { kind: "error"; jobId: string; message: string };

export interface DiffusionRuntimeClient {
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
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
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];

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

  async call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    const err = this.errors.get(method);
    if (err) {
      throw new Error(err);
    }
    if (!this.responses.has(method)) {
      throw new Error(`InMemoryDiffusionRuntime: no response stubbed for ${method}`);
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
export class ChildProcessDiffusionRuntime implements DiffusionRuntimeClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rl: Interface | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new Map<string, DiffusionEvent[]>();
  private nextId = 1;
  private readonly requestTimeoutMs: number;
  private stderrTail = "";

  constructor(private readonly options: ChildProcessRuntimeOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

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
    const child = spawnFn(command, args, spawnOpts) as ChildProcessWithoutNullStreams;
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
    // Notification (no id) -- event for a job.
    const event = parsed as Record<string, unknown> & { jobId?: string };
    if (typeof event.jobId === "string") {
      const queue = this.events.get(event.jobId) ?? [];
      queue.push(event as unknown as DiffusionEvent);
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
          reject(new Error(`diffusion.${method}: timeout after ${this.requestTimeoutMs}ms`));
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
  }
}

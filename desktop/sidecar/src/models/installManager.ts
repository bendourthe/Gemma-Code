/**
 * v1.15.0 Phase 4 (Issue 3) -- in-app model install (streaming job surface).
 *
 * Mirrors the diffusion job/drain pattern: `start(id)` kicks off the install on
 * a background task and returns a job id; the client polls `drain(id)` for
 * buffered progress + a terminal event; `cancel(id)` aborts it. This keeps the
 * IPC channel non-blocking during a multi-minute download.
 *
 * Installs route through the core `NexusModelRegistry` (Ollama pull via the
 * injected `HttpOllamaPullClient`, or the HTTP downloader for weight files).
 */

import type { OllamaPullClient, InstallProgress } from "../../../../core/registry/NexusModelRegistry.js";
import type { NexusModelRegistry } from "../../../../core/registry/NexusModelRegistry.js";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

export interface InstallEvent {
  kind: "progress" | "complete" | "error";
  id: string;
  bytes?: number;
  total?: number | null;
  message?: string;
}

interface InstallJob {
  id: string;
  buffer: InstallEvent[];
  terminal: boolean;
  controller: AbortController;
}

/** Ollama `/api/pull` streaming client (NDJSON: {status, total, completed}). */
export class HttpOllamaPullClient implements OllamaPullClient {
  constructor(
    private readonly _baseUrl: string = DEFAULT_OLLAMA_URL,
    private readonly _fetch: typeof fetch = fetch,
  ) {}

  async pull(
    modelTag: string,
    opts?: { signal?: AbortSignal; onProgress?: InstallProgress },
  ): Promise<void> {
    const res = await this._fetch(`${this._baseUrl}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelTag, stream: true }),
      signal: opts?.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama pull failed (${res.status}) for ${modelTag}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
        if (!line) continue;
        let msg: { error?: string; total?: number; completed?: number };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) throw new Error(msg.error);
        if (opts?.onProgress && typeof msg.total === "number") {
          opts.onProgress(msg.completed ?? 0, msg.total);
        }
      }
    }
  }
}

export class InstallManager {
  private readonly _jobs = new Map<string, InstallJob>();

  constructor(private readonly _registry: NexusModelRegistry) {}

  /** Start (or reattach to) an install for `id`; returns the job id (== `id`). */
  start(id: string): string {
    const existing = this._jobs.get(id);
    if (existing && !existing.terminal) return id;
    const controller = new AbortController();
    const job: InstallJob = { id, buffer: [], terminal: false, controller };
    this._jobs.set(id, job);
    void this._run(job);
    return id;
  }

  private async _run(job: InstallJob): Promise<void> {
    try {
      await this._registry.installById(job.id, {
        signal: job.controller.signal,
        onProgress: (bytes, total) => {
          job.buffer.push({ kind: "progress", id: job.id, bytes, total });
        },
      });
      job.buffer.push({ kind: "complete", id: job.id });
      void import("./selectionSnapshot.js")
        .then(({ appendDownloadedId }) => appendDownloadedId(job.id))
        .catch(() => undefined);
    } catch (err) {
      const message = job.controller.signal.aborted
        ? "cancelled"
        : err instanceof Error
          ? err.message
          : String(err);
      job.buffer.push({ kind: "error", id: job.id, message });
    } finally {
      job.terminal = true;
    }
  }

  /** Drain buffered events; `done` is true once the terminal event is returned. */
  drain(id: string): { events: InstallEvent[]; done: boolean } {
    const job = this._jobs.get(id);
    if (!job) return { events: [], done: true };
    const events = job.buffer.splice(0, job.buffer.length);
    const done = job.terminal;
    if (done) this._jobs.delete(id);
    return { events, done };
  }

  cancel(id: string): void {
    this._jobs.get(id)?.controller.abort();
  }
}

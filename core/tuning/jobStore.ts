/**
 * v2.1.0 Phase 5 -- JSON job store (queued / running / interrupted / done /
 * failed / quarantined / export-failed). Mirrors generation-queue recovery:
 * leftover running rows become interrupted then queued, ids stay stable.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { nexusHome } from "../storage/paths.js";

export type TuningJobState =
  | "queued"
  | "running"
  | "interrupted"
  | "done"
  | "failed"
  | "quarantined"
  | "export-failed";

export interface TuningJob {
  readonly id: string;
  readonly baseModelId: string;
  readonly datasetId: string;
  readonly datasetPath: string;
  readonly state: TuningJobState;
  readonly error: string | null;
  readonly checkpointPath: string | null;
  readonly exportPath: string | null;
  readonly evalDelta: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TuningJobStoreOptions {
  readonly filePath?: string;
  readonly homeDirFn?: () => string;
  readonly now?: () => Date;
}

function defaultPath(homeDirFn?: () => string): string {
  return path.join(nexusHome(homeDirFn), "tuning", "jobs.json");
}

export class TuningJobStore {
  private readonly filePath: string;
  private readonly now: () => Date;
  private jobs: TuningJob[] = [];

  constructor(opts: TuningJobStoreOptions = {}) {
    this.filePath = opts.filePath ?? defaultPath(opts.homeDirFn);
    this.now = opts.now ?? (() => new Date());
    this.load();
    this.recover();
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as { jobs?: TuningJob[] };
      this.jobs = Array.isArray(raw.jobs) ? raw.jobs : [];
    } catch {
      this.jobs = [];
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ jobs: this.jobs }, null, 2));
  }

  recover(): void {
    let changed = false;
    this.jobs = this.jobs.map((job) => {
      if (job.state !== "running") return job;
      changed = true;
      return { ...job, state: "interrupted", updatedAt: this.now().toISOString() };
    });
    this.jobs = this.jobs.map((job) => {
      if (job.state !== "interrupted") return job;
      changed = true;
      return { ...job, state: "queued", updatedAt: this.now().toISOString() };
    });
    if (changed) this.persist();
  }

  enqueue(input: {
    readonly id: string;
    readonly baseModelId: string;
    readonly datasetId: string;
    readonly datasetPath: string;
  }): TuningJob {
    const existing = this.jobs.find((j) => j.id === input.id);
    if (existing) return existing;
    const stamp = this.now().toISOString();
    const job: TuningJob = {
      ...input,
      state: "queued",
      error: null,
      checkpointPath: null,
      exportPath: null,
      evalDelta: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.jobs.push(job);
    this.persist();
    return job;
  }

  list(): readonly TuningJob[] {
    return this.jobs;
  }

  get(id: string): TuningJob | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  patch(id: string, patch: Partial<TuningJob>): TuningJob | undefined {
    const idx = this.jobs.findIndex((j) => j.id === id);
    const current = this.jobs[idx];
    if (idx < 0 || !current) return undefined;
    const next: TuningJob = { ...current, ...patch, id, updatedAt: this.now().toISOString() };
    this.jobs[idx] = next;
    this.persist();
    return next;
  }

  cancel(id: string): TuningJob | undefined {
    const job = this.get(id);
    if (!job) return undefined;
    if (job.state === "done" || job.state === "quarantined" || job.state === "export-failed") {
      return job;
    }
    return this.patch(id, { state: "failed", error: "cancelled" });
  }

  claimNext(): TuningJob | undefined {
    const next = this.jobs.find((j) => j.state === "queued");
    if (!next) return undefined;
    return this.patch(next.id, { state: "running" });
  }
}

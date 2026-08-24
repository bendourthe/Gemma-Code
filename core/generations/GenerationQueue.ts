/**
 * v2.1.0 Phase 3 -- persistent generation job queue (SQLite).
 *
 * States: queued / running / interrupted / done / failed.
 * On open, running jobs become interrupted then re-queued (idempotent by id).
 * Interactive jobs sort ahead of batch. Cancel of a queued job is failed+cancelled;
 * cancel of a running job is marked failed and the caller aborts the GPU handle.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import BetterSqlite from "better-sqlite3";
import type Database from "better-sqlite3";
import { expandBatch, type BatchSpec } from "./batchExpand.js";
import { resolveStudioDbPath } from "./paths.js";

export type GenerationJobState =
  | "queued"
  | "running"
  | "interrupted"
  | "done"
  | "failed";

export type GenerationJobPriority = "interactive" | "batch";
export type GenerationPillar = "image" | "video";

export interface GenerationJob {
  readonly id: string;
  readonly pillar: GenerationPillar;
  readonly jobType: string;
  readonly parameters: Record<string, unknown>;
  readonly batchSpec: BatchSpec | null;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly state: GenerationJobState;
  readonly priority: GenerationJobPriority;
  readonly threadId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EnqueueJobInput {
  readonly id: string;
  readonly pillar: GenerationPillar;
  readonly jobType: string;
  readonly parameters: Record<string, unknown>;
  readonly priority?: GenerationJobPriority;
  readonly threadId?: string;
  readonly batchSpec?: BatchSpec;
}

export interface GenerationQueueOptions {
  readonly dbPath?: string;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    pillar TEXT NOT NULL,
    job_type TEXT NOT NULL,
    parameters_json TEXT NOT NULL,
    batch_spec_json TEXT,
    parent_id TEXT,
    sort_order INTEGER NOT NULL,
    state TEXT NOT NULL,
    priority TEXT NOT NULL,
    thread_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state, priority, sort_order)`,
];

export class GenerationQueue {
  private readonly _db: Database.Database;
  private readonly _now: () => Date;
  private readonly _idFactory: () => string;
  private _closed = false;
  private _seq = 0;

  constructor(opts: GenerationQueueOptions = {}) {
    const dbPath = opts.dbPath ?? resolveStudioDbPath();
    this._now = opts.now ?? (() => new Date());
    this._idFactory =
      opts.idFactory ??
      (() => {
        this._seq += 1;
        return `gen-${this._seq}`;
      });
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this._db = new BetterSqlite(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    for (const sql of SCHEMA) this._db.exec(sql);
    this._db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', '1')").run();
    this.recover();
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this._db.close();
    } catch {
      /* best-effort */
    }
  }

  /** running -> interrupted, then interrupted -> queued. Idempotent. */
  recover(): void {
    const ts = this._now().toISOString();
    this._db.prepare("UPDATE jobs SET state = 'interrupted', updated_at = ? WHERE state = 'running'").run(ts);
    this._db.prepare("UPDATE jobs SET state = 'queued', updated_at = ? WHERE state = 'interrupted'").run(ts);
  }

  enqueue(input: EnqueueJobInput): GenerationJob {
    if (input.batchSpec) {
      const children = this.enqueueBatch(input);
      const first = children[0];
      if (!first) throw new Error("batch expansion produced no jobs");
      return first;
    }
    return this._insert({
      ...input,
      id: input.id || this._idFactory(),
      parentId: null,
      sortOrder: this._nextSort(),
      priority: input.priority ?? "interactive",
    });
  }

  enqueueBatch(input: EnqueueJobInput): GenerationJob[] {
    const spec = input.batchSpec;
    if (!spec) return [this.enqueue(input)];
    const expanded = expandBatch(input.parameters, spec);
    const parentId = input.id;
    const jobs: GenerationJob[] = [];
    let order = this._nextSort();
    for (let i = 0; i < expanded.length; i += 1) {
      const params = expanded[i] ?? input.parameters;
      jobs.push(
        this._insert({
          id: i === 0 ? parentId : `${parentId}:${i}`,
          pillar: input.pillar,
          jobType: input.jobType,
          parameters: params,
          priority: input.priority ?? "batch",
          threadId: input.threadId,
          parentId: i === 0 ? null : parentId,
          sortOrder: order,
          batchSpec: spec,
        }),
      );
      order += 1;
    }
    return jobs;
  }

  nextQueued(): GenerationJob | null {
    const row = this._db
      .prepare(
        `SELECT * FROM jobs WHERE state = 'queued'
         ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, sort_order, created_at
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    return row ? this._fromRow(row) : null;
  }

  /** Atomically pick the next queued job and mark it running. */
  claimNext(): GenerationJob | null {
    const pick = this._db.transaction(() => {
      const row = this._db
        .prepare(
          `SELECT * FROM jobs WHERE state = 'queued'
           ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, sort_order, created_at
           LIMIT 1`,
        )
        .get() as Record<string, unknown> | undefined;
      if (!row) return null;
      const ts = this._now().toISOString();
      this._db
        .prepare("UPDATE jobs SET state = 'running', updated_at = ? WHERE id = ?")
        .run(ts, String(row.id));
      return this.get(String(row.id));
    });
    return pick();
  }

  markRunning(id: string): void {
    this._setState(id, "running");
  }

  markDone(id: string): void {
    this._setState(id, "done");
  }

  markFailed(id: string, error: string): void {
    const ts = this._now().toISOString();
    this._db
      .prepare("UPDATE jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(error, ts, id);
  }

  cancel(id: string): GenerationJob | null {
    const job = this.get(id);
    if (!job) return null;
    if (job.state === "done") return job;
    this.markFailed(id, "cancelled");
    return this.get(id);
  }

  reorder(ids: readonly string[]): void {
    const ts = this._now().toISOString();
    const stmt = this._db.prepare("UPDATE jobs SET sort_order = ?, updated_at = ? WHERE id = ?");
    const tx = this._db.transaction(() => {
      ids.forEach((id, index) => stmt.run(index, ts, id));
    });
    tx();
  }

  get(id: string): GenerationJob | null {
    const row = this._db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this._fromRow(row) : null;
  }

  list(states?: readonly GenerationJobState[]): GenerationJob[] {
    const rows = (
      states && states.length > 0
        ? this._db
            .prepare(
              `SELECT * FROM jobs WHERE state IN (${states.map(() => "?").join(",")})
               ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, sort_order, created_at`,
            )
            .all(...states)
        : this._db
            .prepare(
              `SELECT * FROM jobs
               ORDER BY CASE priority WHEN 'interactive' THEN 0 ELSE 1 END, sort_order, created_at`,
            )
            .all()
    ) as Record<string, unknown>[];
    return rows.map((row) => this._fromRow(row));
  }

  pendingCount(): number {
    const row = this._db
      .prepare("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued', 'running')")
      .get() as { n: number };
    return Number(row.n);
  }

  private _nextSort(): number {
    const row = this._db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM jobs").get() as {
      m: number;
    };
    return Number(row.m) + 1;
  }

  private _setState(id: string, state: GenerationJobState): void {
    const ts = this._now().toISOString();
    this._db.prepare("UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?").run(state, ts, id);
  }

  private _insert(input: {
    readonly id: string;
    readonly pillar: GenerationPillar;
    readonly jobType: string;
    readonly parameters: Record<string, unknown>;
    readonly priority: GenerationJobPriority;
    readonly threadId?: string;
    readonly parentId: string | null;
    readonly sortOrder: number;
    readonly batchSpec?: BatchSpec;
  }): GenerationJob {
    const existing = this.get(input.id);
    if (existing) return existing;
    const ts = this._now().toISOString();
    this._db
      .prepare(
        `INSERT INTO jobs (
          id, pillar, job_type, parameters_json, batch_spec_json, parent_id,
          sort_order, state, priority, thread_id, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, ?, ?)`,
      )
      .run(
        input.id,
        input.pillar,
        input.jobType,
        JSON.stringify(input.parameters),
        input.batchSpec ? JSON.stringify(input.batchSpec) : null,
        input.parentId,
        input.sortOrder,
        input.priority,
        input.threadId ?? null,
        ts,
        ts,
      );
    const job = this.get(input.id);
    if (!job) throw new Error("insert failed");
    return job;
  }

  private _fromRow(row: Record<string, unknown>): GenerationJob {
    let parameters: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(row.parameters_json ?? "{}")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parameters = parsed as Record<string, unknown>;
      }
    } catch {
      parameters = {};
    }
    let batchSpec: BatchSpec | null = null;
    if (typeof row.batch_spec_json === "string" && row.batch_spec_json.length > 0) {
      try {
        batchSpec = JSON.parse(row.batch_spec_json) as BatchSpec;
      } catch {
        batchSpec = null;
      }
    }
    return {
      id: String(row.id),
      pillar: row.pillar as GenerationPillar,
      jobType: String(row.job_type),
      parameters,
      batchSpec,
      parentId: row.parent_id == null ? null : String(row.parent_id),
      sortOrder: Number(row.sort_order),
      state: row.state as GenerationJobState,
      priority: row.priority as GenerationJobPriority,
      threadId: row.thread_id == null ? null : String(row.thread_id),
      error: row.error == null ? null : String(row.error),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}

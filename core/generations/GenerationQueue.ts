/**
 * v2.1.0 Phase 3 -- persistent generation job queue (SQLite).
 *
 * States: queued / running / interrupted / done / failed.
 * On open, ordinary running jobs are re-queued; native enhancement children
 * remain interrupted/retryable and require a new explicit attempt.
 * Interactive jobs sort ahead of batch. Cancel of a queued job is failed+cancelled;
 * cancel of a running job is marked failed and the caller aborts the GPU handle.
 */

import type Database from "better-sqlite3";
import {
  VIDEO_ENHANCEMENT_PROGRESS_STAGES,
  validateVideoEnhancementRequest,
  type VideoEnhancementErrorCode,
  type VideoEnhancementProgress,
  type VideoEnhancementProgressStage,
} from "../video/VideoEnhancement.js";
import { redactSecrets } from "../observability/redactSecrets.js";
import { expandBatch, type BatchSpec } from "./batchExpand.js";
import {
  GenerationDatabase,
  type AtomicEnhancementCompletion,
  type AtomicGenerationOutputCompletion,
  type CompleteEnhancementInput,
  type CompleteGenerationOutputInput,
  type EnhancementRunRecord,
  type GenerationEnhancementMetadata,
  type GenerationPillar,
} from "./GenerationDatabase.js";

/** Error recorded on interactive jobs a restart found unfinished. */
export const INTERRUPTED_BY_RESTART = "Interrupted by app restart";

export type GenerationJobState =
  "queued" | "running" | "interrupted" | "done" | "failed";

export type GenerationJobPriority = "interactive" | "batch";
export type { GenerationPillar } from "./GenerationDatabase.js";

export interface GenerationJob {
  readonly id: string;
  readonly pillar: GenerationPillar;
  readonly jobType: string;
  readonly parameters: Record<string, unknown>;
  readonly batchSpec: BatchSpec | null;
  readonly parentId: string | null;
  readonly enhancement: GenerationEnhancementMetadata | null;
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
  readonly parentId?: string | null;
  readonly enhancement?: GenerationEnhancementMetadata;
}

export interface GenerationQueueOptions {
  readonly dbPath?: string;
  readonly database?: GenerationDatabase;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

const MAX_ENHANCEMENT_ERROR_MESSAGE_LENGTH = 2_048;
const MAX_ENHANCEMENT_ERROR_DIAGNOSTICS_LENGTH = 8_192;
const UNSAFE_SINGLE_LINE_TEXT = /[\u0000-\u001f\u007f]/gu;
const UNSAFE_MULTILINE_TEXT =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const ABSOLUTE_PATH_LIKE_TEXT =
  /(?:\bfile:\/\/\S+|(?:^|[^\p{L}\p{N}_/])(?:[a-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\s]*|\/(?!\/)(?=\S)\S*))/giu;
const PROGRESS_STAGES = new Set<string>(VIDEO_ENHANCEMENT_PROGRESS_STAGES);

export class GenerationQueue {
  private readonly _database: GenerationDatabase;
  private readonly _db: Database.Database;
  private readonly _ownsDatabase: boolean;
  private readonly _now: () => Date;
  private readonly _idFactory: () => string;
  private _closed = false;
  private _seq = 0;

  constructor(opts: GenerationQueueOptions = {}) {
    if (opts.database && opts.dbPath !== undefined) {
      throw new Error("GenerationQueue accepts database or dbPath, not both");
    }
    this._now = opts.now ?? (() => new Date());
    this._idFactory =
      opts.idFactory ??
      (() => {
        this._seq += 1;
        return `gen-${this._seq}`;
      });
    this._ownsDatabase = !opts.database;
    this._database =
      opts.database ??
      new GenerationDatabase({ dbPath: opts.dbPath, now: this._now });
    this._db = this._database.connection;
    this.recover();
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this._ownsDatabase) this._database.close();
  }

  /**
   * Ordinary batch jobs are re-queued. Enhancement processes are never
   * resumed blindly: they remain interrupted and retryable.
   *
   * v2.4.8 follow-up (2026-09-07): interactive jobs do not survive a restart.
   * Nobody is polling them any more (the page that submitted them is gone), yet
   * they were re-queued first and re-run on the next launch, holding the GPU
   * slot in front of every new request. Operator report: a request from 12:44
   * was still being re-claimed at 17:05 with three newer requests queued
   * behind it. They are now failed with an explicit reason.
   */
  recover(): void {
    const ts = this._now().toISOString();
    const recover = this._db.transaction(() => {
      this._recoverEnhancements(ts);
      this._db
        .prepare(
          `UPDATE jobs SET state = 'failed', error = ?, updated_at = ?
           WHERE priority = 'interactive'
             AND state IN ('queued', 'running', 'interrupted')
             AND NOT EXISTS (
               SELECT 1 FROM enhancement_runs WHERE child_job_id = jobs.id
             )`,
        )
        .run(INTERRUPTED_BY_RESTART, ts);
      this._db
        .prepare(
          `UPDATE jobs SET state = 'interrupted', updated_at = ?
           WHERE state = 'running'
             AND NOT EXISTS (
               SELECT 1 FROM enhancement_runs WHERE child_job_id = jobs.id
             )`,
        )
        .run(ts);
      this._db
        .prepare(
          `UPDATE jobs SET state = 'queued', updated_at = ?
           WHERE state = 'interrupted'
             AND NOT EXISTS (
               SELECT 1 FROM enhancement_runs WHERE child_job_id = jobs.id
             )`,
        )
        .run(ts);
    });
    recover();
  }

  /** Mark persisted native enhancement work interrupted without auto-resume. */
  recoverEnhancements(): number {
    const ts = this._now().toISOString();
    const recover = this._db.transaction(() => this._recoverEnhancements(ts));
    return recover();
  }

  enqueue(input: EnqueueJobInput): GenerationJob {
    if (input.batchSpec) {
      if (input.enhancement || input.parentId != null) {
        throw new Error("batch jobs cannot carry enhancement lineage");
      }
      const children = this.enqueueBatch(input);
      const first = children[0];
      if (!first) throw new Error("batch expansion produced no jobs");
      return first;
    }
    return this._insert({
      ...input,
      id: input.id || this._idFactory(),
      parentId: input.parentId ?? null,
      enhancement: input.enhancement,
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
          enhancement: undefined,
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
        `SELECT jobs.* FROM jobs
         LEFT JOIN enhancement_runs AS enhancement
           ON enhancement.child_job_id = jobs.id
         WHERE jobs.state = 'queued'
           AND (
             enhancement.child_job_id IS NULL OR
             (enhancement.state = 'queued' AND enhancement.cancellation_requested = 0)
           )
         ORDER BY CASE jobs.priority WHEN 'interactive' THEN 0 ELSE 1 END,
                  jobs.sort_order, jobs.created_at
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
          `SELECT jobs.* FROM jobs
           LEFT JOIN enhancement_runs AS enhancement
             ON enhancement.child_job_id = jobs.id
           WHERE jobs.state = 'queued'
             AND (
               enhancement.child_job_id IS NULL OR
               (enhancement.state = 'queued' AND enhancement.cancellation_requested = 0)
             )
           ORDER BY CASE jobs.priority WHEN 'interactive' THEN 0 ELSE 1 END,
                    jobs.sort_order, jobs.created_at
           LIMIT 1`,
        )
        .get() as Record<string, unknown> | undefined;
      if (!row) return null;
      const ts = this._now().toISOString();
      this._db
        .prepare(
          "UPDATE jobs SET state = 'running', updated_at = ? WHERE id = ?",
        )
        .run(ts, String(row.id));
      const enhancementUpdate = this._db
        .prepare(
          `UPDATE enhancement_runs
           SET state = 'running', retryable = 0,
               started_at = COALESCE(started_at, ?), updated_at = ?
           WHERE child_job_id = ? AND state = 'queued' AND cancellation_requested = 0`,
        )
        .run(ts, ts, String(row.id));
      if (row.enhancement_json != null && enhancementUpdate.changes !== 1) {
        throw new Error("enhancement claim lost its queued state");
      }
      return this.get(String(row.id));
    });
    return pick();
  }

  markRunning(id: string): void {
    this._setState(id, "running");
  }

  markDone(id: string): void {
    if (this._database.getEnhancementRun(id)) {
      throw new Error(
        "enhancement jobs complete only through completeEnhancement()",
      );
    }
    this._setState(id, "done");
  }

  markFailed(id: string, error: string): void {
    if (this._database.getEnhancementRun(id)) {
      this.markEnhancementFailed(id, {
        code: "internal_error",
        message: error,
        retryable: false,
      });
      return;
    }
    const ts = this._now().toISOString();
    this._db
      .prepare(
        "UPDATE jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?",
      )
      .run(error, ts, id);
  }

  cancel(id: string): GenerationJob | null {
    const job = this.get(id);
    if (!job) return null;
    if (job.state === "done") return job;
    const enhancement = this._database.getEnhancementRun(id);
    if (enhancement) {
      this.requestEnhancementCancellation(id);
      if (job.state === "running") return this.get(id);
      this.markEnhancementFailed(id, {
        code: "cancelled",
        message: "cancelled",
        retryable: true,
      });
      return this.get(id);
    }
    this.markFailed(id, "cancelled");
    return this.get(id);
  }

  getEnhancementRun(id: string): EnhancementRunRecord | null {
    return this._database.getEnhancementRun(id);
  }

  listEnhancementRunsForParent(parentId: string): EnhancementRunRecord[] {
    return this._database.listEnhancementRunsForParent(parentId);
  }

  requestEnhancementCancellation(id: string): EnhancementRunRecord | null {
    const ts = this._now().toISOString();
    this._db
      .prepare(
        `UPDATE enhancement_runs
         SET cancellation_requested = 1, updated_at = ?
         WHERE child_job_id = ? AND state IN ('queued', 'running', 'interrupted')`,
      )
      .run(ts, id);
    return this._database.getEnhancementRun(id);
  }

  updateEnhancementProgress(
    id: string,
    progress: VideoEnhancementProgress,
  ): boolean {
    const ts = this._now().toISOString();
    const result = this._db
      .prepare(
        `UPDATE enhancement_runs
         SET progress_json = ?, updated_at = ?
         WHERE child_job_id = ? AND state = 'running' AND cancellation_requested = 0`,
      )
      .run(JSON.stringify(progress), ts, id);
    return result.changes === 1;
  }

  markEnhancementFailed(
    id: string,
    error: {
      readonly code: VideoEnhancementErrorCode;
      readonly message: string;
      readonly retryable: boolean;
      readonly stage?: VideoEnhancementProgressStage;
      readonly diagnostics?: string | null;
      readonly terminationConfirmed?: boolean | null;
    },
  ): EnhancementRunRecord | null {
    const ts = this._now().toISOString();
    const run = this._database.getEnhancementRun(id);
    if (!run || run.state === "completed" || run.state === "failed") return run;
    const normalized = normalizeEnhancementFailure(error);
    if (run.state === "interrupted") return run;
    if (run.state === "cancelled") {
      return this._enrichEnhancementTerminalEvidence(
        id,
        "cancelled",
        normalized,
        ts,
      );
    }
    const terminalState =
      normalized.code === "cancelled" ? "cancelled" : "failed";
    const fail = this._db.transaction(() => {
      const runUpdate = this._db
        .prepare(
          `UPDATE enhancement_runs
           SET state = CASE
                 WHEN cancellation_requested = 1 THEN 'cancelled'
                 ELSE ?
               END,
               retryable = CASE
                 WHEN cancellation_requested = 1 AND ? <> 'cancelled' THEN 1
                 ELSE ?
               END,
               error_code = CASE
                 WHEN cancellation_requested = 1 THEN 'cancelled'
                 ELSE ?
               END,
               error_message = CASE
                 WHEN cancellation_requested = 1 AND ? <> 'cancelled' THEN 'cancelled'
                 ELSE ?
               END,
               error_stage = ?, error_diagnostics = ?, error_termination_confirmed = ?,
               cancellation_requested = CASE WHEN ? = 'cancelled' THEN 1 ELSE cancellation_requested END,
               completed_at = ?, updated_at = ?
           WHERE child_job_id = ? AND state IN ('queued', 'running')`,
        )
        .run(
          terminalState,
          normalized.code,
          normalized.retryable ? 1 : 0,
          normalized.code,
          normalized.code,
          normalized.message,
          normalized.stage,
          normalized.diagnostics,
          normalized.terminationConfirmed === null
            ? null
            : normalized.terminationConfirmed
              ? 1
              : 0,
          normalized.code,
          ts,
          ts,
          id,
        );
      if (runUpdate.changes === 1) {
        this._db
          .prepare(
            `UPDATE jobs
             SET state = 'failed',
                 error = (
                   SELECT error_message FROM enhancement_runs
                   WHERE child_job_id = ?
                 ),
                 updated_at = ?
             WHERE id = ? AND state IN ('queued', 'running')`,
          )
          .run(id, ts, id);
      }
    });
    fail();
    return this._database.getEnhancementRun(id);
  }

  markEnhancementInterrupted(
    id: string,
    message = "interrupted",
    stage: VideoEnhancementProgressStage = "preflight",
    diagnostics: string | null = null,
    terminationConfirmed: boolean | null = null,
  ): EnhancementRunRecord | null {
    const ts = this._now().toISOString();
    const normalized = normalizeEnhancementFailure({
      code: "internal_error",
      message,
      retryable: true,
      stage,
      diagnostics,
      terminationConfirmed,
    });
    const run = this._database.getEnhancementRun(id);
    if (!run) return null;
    if (run.state === "interrupted") {
      return this._enrichEnhancementTerminalEvidence(
        id,
        "interrupted",
        normalized,
        ts,
      );
    }
    if (
      run.state === "completed" ||
      run.state === "failed" ||
      run.state === "cancelled"
    ) {
      return run;
    }
    const interrupt = this._db.transaction(() => {
      const runUpdate = this._db
        .prepare(
          `UPDATE enhancement_runs
           SET state = 'interrupted', retryable = 1,
               error_code = NULL, error_message = ?, error_stage = ?,
               error_diagnostics = ?, error_termination_confirmed = ?,
               completed_at = ?, updated_at = ?
           WHERE child_job_id = ? AND state IN ('queued', 'running')`,
        )
        .run(
          normalized.message,
          normalized.stage,
          normalized.diagnostics,
          normalized.terminationConfirmed === null
            ? null
            : normalized.terminationConfirmed
              ? 1
              : 0,
          ts,
          ts,
          id,
        );
      if (runUpdate.changes === 1) {
        this._db
          .prepare(
            `UPDATE jobs SET state = 'interrupted', error = ?, updated_at = ?
             WHERE id = ? AND state IN ('queued', 'running')`,
          )
          .run(normalized.message, ts, id);
      }
    });
    interrupt();
    return this._database.getEnhancementRun(id);
  }

  private _enrichEnhancementTerminalEvidence(
    id: string,
    state: "interrupted" | "cancelled",
    evidence: ReturnType<typeof normalizeEnhancementFailure>,
    ts: string,
  ): EnhancementRunRecord | null {
    const enrich = this._db.transaction(() => {
      const current = this._database.getEnhancementRun(id);
      if (!current || current.state !== state) return current;
      const nextStage = laterEnhancementStage(
        current.errorStage,
        evidence.stage,
      );
      const nextDiagnostics = mergeEnhancementDiagnostics(
        current.errorDiagnostics,
        evidence.diagnostics,
      );
      const nextTerminationConfirmed = mergeTerminationConfirmation(
        current.errorTerminationConfirmed,
        evidence.terminationConfirmed,
      );
      if (
        nextStage === current.errorStage &&
        nextDiagnostics === current.errorDiagnostics &&
        nextTerminationConfirmed === current.errorTerminationConfirmed
      ) {
        return current;
      }
      this._db
        .prepare(
          `UPDATE enhancement_runs
           SET error_stage = ?, error_diagnostics = ?,
               error_termination_confirmed = ?, updated_at = ?
           WHERE child_job_id = ? AND state = ?`,
        )
        .run(
          nextStage,
          nextDiagnostics,
          nextTerminationConfirmed === null
            ? null
            : nextTerminationConfirmed
              ? 1
              : 0,
          ts,
          id,
          state,
        );
      return this._database.getEnhancementRun(id);
    });
    return enrich();
  }

  completeEnhancement(
    input: CompleteEnhancementInput,
  ): AtomicEnhancementCompletion {
    return this._database.completeEnhancement({
      ...input,
      completedAt: input.completedAt ?? this._now().toISOString(),
    });
  }

  async completeGenerationOutput(
    input: CompleteGenerationOutputInput,
  ): Promise<AtomicGenerationOutputCompletion> {
    return this._database.completeGenerationOutput({
      ...input,
      completedAt: input.completedAt ?? this._now().toISOString(),
    });
  }

  reorder(ids: readonly string[]): void {
    const ts = this._now().toISOString();
    const stmt = this._db.prepare(
      "UPDATE jobs SET sort_order = ?, updated_at = ? WHERE id = ?",
    );
    const tx = this._db.transaction(() => {
      ids.forEach((id, index) => stmt.run(index, ts, id));
    });
    tx();
  }

  get(id: string): GenerationJob | null {
    const row = this._db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
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
      .prepare(
        "SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued', 'running')",
      )
      .get() as { n: number };
    return Number(row.n);
  }

  private _nextSort(): number {
    const row = this._db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM jobs")
      .get() as {
      m: number;
    };
    return Number(row.m) + 1;
  }

  private _setState(id: string, state: GenerationJobState): void {
    const ts = this._now().toISOString();
    const set = this._db.transaction(() => {
      if (state === "running") {
        const enhancement = this._database.getEnhancementRun(id);
        if (enhancement) {
          if (enhancement.cancellationRequested) {
            throw new Error("cancelled enhancement cannot start");
          }
          if (
            enhancement.state !== "queued" &&
            enhancement.state !== "running"
          ) {
            throw new Error("terminal or interrupted enhancement cannot start");
          }
        }
      }
      this._db
        .prepare("UPDATE jobs SET state = ?, updated_at = ? WHERE id = ?")
        .run(state, ts, id);
      if (state === "running") {
        this._db
          .prepare(
            `UPDATE enhancement_runs
             SET state = 'running', retryable = 0,
                 started_at = COALESCE(started_at, ?), updated_at = ?
             WHERE child_job_id = ? AND state = 'queued' AND cancellation_requested = 0`,
          )
          .run(ts, ts, id);
      }
    });
    set();
  }

  private _insert(input: {
    readonly id: string;
    readonly pillar: GenerationPillar;
    readonly jobType: string;
    readonly parameters: Record<string, unknown>;
    readonly priority: GenerationJobPriority;
    readonly threadId?: string;
    readonly parentId: string | null;
    readonly enhancement?: GenerationEnhancementMetadata;
    readonly sortOrder: number;
    readonly batchSpec?: BatchSpec;
  }): GenerationJob {
    const existing = this.get(input.id);
    if (existing) {
      if (
        input.enhancement &&
        JSON.stringify(existing.enhancement) !==
          JSON.stringify(input.enhancement)
      ) {
        throw new Error(
          "generation job id already has different enhancement lineage",
        );
      }
      return existing;
    }
    const enhancement = input.enhancement
      ? this._validateEnhancement(
          input.parentId,
          input.pillar,
          input.enhancement,
        )
      : null;
    const ts = this._now().toISOString();
    const insert = this._db.transaction(() => {
      this._db
        .prepare(
          `INSERT INTO jobs (
            id, pillar, job_type, parameters_json, batch_spec_json, parent_id,
            enhancement_json, sort_order, state, priority, thread_id, error,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, ?, ?)`,
        )
        .run(
          input.id,
          input.pillar,
          input.jobType,
          JSON.stringify(input.parameters),
          input.batchSpec ? JSON.stringify(input.batchSpec) : null,
          input.parentId,
          enhancement ? JSON.stringify(enhancement) : null,
          input.sortOrder,
          input.priority,
          input.threadId ?? null,
          ts,
          ts,
        );
      if (enhancement) {
        this._db
          .prepare(
            `INSERT INTO enhancement_runs (
              child_job_id, parent_job_id, source_output_id, request_id,
              metadata_json, state, retryable, cancellation_requested,
              progress_json, output_id, provenance_record_id, provenance_json,
              error_code, error_message, error_stage, error_diagnostics,
              error_termination_confirmed, started_at, completed_at,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'queued', 0, 0, NULL, NULL, NULL, NULL,
                      NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
          )
          .run(
            input.id,
            input.parentId,
            enhancement.sourceOutputId,
            enhancement.request.requestId,
            JSON.stringify(enhancement),
            ts,
            ts,
          );
      }
    });
    insert();
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
    if (
      typeof row.batch_spec_json === "string" &&
      row.batch_spec_json.length > 0
    ) {
      try {
        batchSpec = JSON.parse(row.batch_spec_json) as BatchSpec;
      } catch {
        batchSpec = null;
      }
    }
    let enhancement: GenerationEnhancementMetadata | null = null;
    if (
      typeof row.enhancement_json === "string" &&
      row.enhancement_json.length > 0
    ) {
      try {
        const parsed = JSON.parse(row.enhancement_json) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          enhancement = parsed as GenerationEnhancementMetadata;
        }
      } catch {
        enhancement = null;
      }
    }
    return {
      id: String(row.id),
      pillar: row.pillar as GenerationPillar,
      jobType: String(row.job_type),
      parameters,
      batchSpec,
      parentId: row.parent_id == null ? null : String(row.parent_id),
      enhancement,
      sortOrder: Number(row.sort_order),
      state: row.state as GenerationJobState,
      priority: row.priority as GenerationJobPriority,
      threadId: row.thread_id == null ? null : String(row.thread_id),
      error: row.error == null ? null : String(row.error),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private _recoverEnhancements(ts: string): number {
    const runUpdate = this._db
      .prepare(
        `UPDATE enhancement_runs
         SET state = 'interrupted', retryable = 1,
             error_code = NULL, error_message = 'interrupted by application restart',
             error_stage = CASE
               WHEN json_extract(progress_json, '$.stage') IN (
                 'preflight', 'upscale', 'interpolate', 'validate', 'provenance', 'publish'
               ) THEN json_extract(progress_json, '$.stage')
               ELSE 'preflight'
             END,
             error_diagnostics = NULL, error_termination_confirmed = NULL,
             completed_at = ?, updated_at = ?
         WHERE state = 'running'`,
      )
      .run(ts, ts);
    this._db
      .prepare(
        `UPDATE jobs
         SET state = 'interrupted', error = 'interrupted by application restart', updated_at = ?
         WHERE state = 'running'
           AND EXISTS (
             SELECT 1 FROM enhancement_runs WHERE child_job_id = jobs.id
           )`,
      )
      .run(ts);
    return runUpdate.changes;
  }

  private _validateEnhancement(
    parentId: string | null,
    pillar: GenerationPillar,
    metadata: GenerationEnhancementMetadata,
  ): GenerationEnhancementMetadata {
    if (!parentId) throw new Error("enhancement jobs require parentId");
    if (pillar !== "video")
      throw new Error("enhancement jobs must use the video pillar");
    const validation = validateVideoEnhancementRequest(metadata.request);
    if (!validation.ok) throw new Error(validation.error.message);
    if (validation.value.parentJobId !== parentId) {
      throw new Error("enhancement request parent does not match parentId");
    }
    const sourceOutputId = metadata.sourceOutputId.trim();
    if (sourceOutputId.length === 0 || sourceOutputId.length > 256) {
      throw new Error("enhancement sourceOutputId is invalid");
    }
    const backendId = metadata.backendId.trim();
    if (backendId.length === 0 || backendId.length > 128) {
      throw new Error("enhancement backendId is invalid");
    }
    const source = this._database.getGenerationOutput(sourceOutputId);
    if (!source || source.jobId !== parentId || source.pillar !== "video") {
      throw new Error(
        "enhancement source output does not belong to its parent",
      );
    }
    if (source.contentHash !== validation.value.source.sha256) {
      throw new Error(
        "enhancement source hash does not match the indexed output",
      );
    }
    if (source.outputPath !== validation.value.source.path) {
      throw new Error(
        "enhancement source path does not match the indexed output",
      );
    }
    return {
      request: validation.value,
      sourceOutputId,
      backendId,
    };
  }
}

function normalizeEnhancementFailure(error: {
  readonly code: VideoEnhancementErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly stage?: VideoEnhancementProgressStage;
  readonly diagnostics?: string | null;
  readonly terminationConfirmed?: boolean | null;
}): {
  readonly code: VideoEnhancementErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly stage: VideoEnhancementProgressStage;
  readonly diagnostics: string | null;
  readonly terminationConfirmed: boolean | null;
} {
  const stage = error.stage ?? "preflight";
  if (!PROGRESS_STAGES.has(stage)) {
    throw new Error("enhancement failure stage is invalid");
  }
  if (
    error.terminationConfirmed !== undefined &&
    error.terminationConfirmed !== null &&
    typeof error.terminationConfirmed !== "boolean"
  ) {
    throw new Error("enhancement termination confirmation is invalid");
  }
  return Object.freeze({
    code: error.code,
    message: normalizeEnhancementErrorText(
      error.message,
      MAX_ENHANCEMENT_ERROR_MESSAGE_LENGTH,
      false,
    ),
    retryable: error.retryable,
    stage,
    diagnostics:
      error.diagnostics == null
        ? null
        : normalizeEnhancementErrorText(
            error.diagnostics,
            MAX_ENHANCEMENT_ERROR_DIAGNOSTICS_LENGTH,
            true,
          ),
    terminationConfirmed: error.terminationConfirmed ?? null,
  });
}

function laterEnhancementStage(
  current: VideoEnhancementProgressStage | null,
  incoming: VideoEnhancementProgressStage,
): VideoEnhancementProgressStage {
  if (current === null) return incoming;
  return VIDEO_ENHANCEMENT_PROGRESS_STAGES.indexOf(incoming) >
    VIDEO_ENHANCEMENT_PROGRESS_STAGES.indexOf(current)
    ? incoming
    : current;
}

function mergeEnhancementDiagnostics(
  current: string | null,
  incoming: string | null,
): string | null {
  if (incoming === null || incoming === current) return current;
  if (current === null) return incoming;
  if (current.includes(incoming)) return current;
  return normalizeEnhancementErrorText(
    `${current}\n${incoming}`,
    MAX_ENHANCEMENT_ERROR_DIAGNOSTICS_LENGTH,
    true,
  );
}

function mergeTerminationConfirmation(
  current: boolean | null,
  incoming: boolean | null,
): boolean | null {
  if (current === true || incoming === null) return current;
  if (incoming === true) return true;
  return current ?? false;
}

function normalizeEnhancementErrorText(
  value: string,
  maxLength: number,
  multiline: boolean,
): string {
  if (typeof value !== "string") {
    throw new Error("enhancement failure text must be a string");
  }
  const withoutPaths = redactSecrets(value).replace(
    ABSOLUTE_PATH_LIKE_TEXT,
    " <redacted> ",
  );
  const withoutControls = withoutPaths.replace(
    multiline ? UNSAFE_MULTILINE_TEXT : UNSAFE_SINGLE_LINE_TEXT,
    " ",
  );
  const normalized = withoutControls.trim().slice(0, maxLength).trimEnd();
  if (normalized.length === 0) {
    throw new Error("enhancement failure text must not be empty");
  }
  return normalized;
}

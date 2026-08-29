/**
 * Shared SQLite owner for generation queue, output-index, and completion state.
 *
 * A Studio runtime owns one instance and passes it to GenerationQueue and
 * GenerationIndex. Standalone queue/index constructors create and own their
 * own instance for backwards compatibility.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import BetterSqlite from "better-sqlite3";
import type Database from "better-sqlite3";
import type {
  VideoEnhancementErrorCode,
  VideoEnhancementProgress,
  VideoEnhancementProgressStage,
  VideoEnhancementRequest,
} from "../video/VideoEnhancement.js";
import { contentHashFile } from "./contentHash.js";
import { redactWorkflow } from "./redactWorkflow.js";
import { resolveStudioDbPath } from "./paths.js";

export type GenerationPillar = "image" | "video";

export type EnhancementRunState =
  "queued" | "running" | "interrupted" | "completed" | "failed" | "cancelled";

export interface GenerationEnhancementMetadata {
  readonly request: VideoEnhancementRequest;
  readonly sourceOutputId: string;
  readonly backendId: string;
}

export interface GenerationOutputRecord {
  readonly id: string;
  readonly jobId: string;
  readonly pillar: GenerationPillar;
  readonly outputPath: string;
  readonly contentHash: string;
  readonly workflow: Record<string, unknown>;
  readonly createdAt: string;
}

export interface PutGenerationOutputInput {
  readonly id: string;
  readonly jobId: string;
  readonly pillar: GenerationPillar;
  readonly outputPath: string;
  readonly contentHash: string;
  readonly workflow: Record<string, unknown>;
  readonly createdAt?: string;
}

export interface EnhancementRunRecord {
  readonly childJobId: string;
  readonly parentJobId: string;
  readonly sourceOutputId: string;
  readonly requestId: string;
  readonly metadata: GenerationEnhancementMetadata;
  readonly state: EnhancementRunState;
  readonly retryable: boolean;
  readonly cancellationRequested: boolean;
  readonly progress: VideoEnhancementProgress | null;
  readonly outputId: string | null;
  readonly provenanceRecordId: string | null;
  readonly provenance: Record<string, unknown> | null;
  readonly errorCode: VideoEnhancementErrorCode | null;
  readonly errorMessage: string | null;
  readonly errorStage: VideoEnhancementProgressStage | null;
  readonly errorDiagnostics: string | null;
  readonly errorTerminationConfirmed: boolean | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CompletionOutboxEventType =
  "generation.completed" | "video.enhancement.completed";

export interface CompletionOutboxRecord {
  readonly id: string;
  readonly jobId: string;
  readonly eventType: CompletionOutboxEventType;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
  readonly deliveredAt: string | null;
}

export interface CompleteEnhancementInput {
  readonly childJobId: string;
  readonly output: {
    readonly id: string;
    readonly outputPath: string;
    readonly contentHash: string;
    readonly workflow: Record<string, unknown>;
  };
  readonly provenanceRecordId: string;
  readonly provenance: Record<string, unknown>;
  readonly outbox: {
    readonly id: string;
    readonly payload: Record<string, unknown>;
  };
  readonly completedAt?: string;
}

export interface CompleteGenerationOutputInput {
  readonly jobId: string;
  readonly output: {
    readonly id: string;
    readonly outputPath: string;
    readonly workflow: Record<string, unknown>;
  };
  readonly completedAt?: string;
  readonly signal?: AbortSignal;
}

export interface AtomicGenerationOutputCompletion {
  readonly jobId: string;
  readonly output: GenerationOutputRecord;
}

export interface AtomicEnhancementCompletion {
  readonly childJobId: string;
  readonly output: GenerationOutputRecord;
  readonly enhancement: EnhancementRunRecord;
  readonly outbox: CompletionOutboxRecord;
}

export interface GenerationDatabaseOptions {
  readonly dbPath?: string;
  readonly now?: () => Date;
}

interface OutputRow {
  id: string;
  job_id: string;
  pillar: GenerationPillar;
  output_path: string;
  content_hash: string;
  workflow_json: string;
  created_at: string;
}

interface EnhancementRow {
  child_job_id: string;
  parent_job_id: string;
  source_output_id: string;
  request_id: string;
  metadata_json: string;
  state: EnhancementRunState;
  retryable: number;
  cancellation_requested: number;
  progress_json: string | null;
  output_id: string | null;
  provenance_record_id: string | null;
  provenance_json: string | null;
  error_code: VideoEnhancementErrorCode | null;
  error_message: string | null;
  error_stage: VideoEnhancementProgressStage | null;
  error_diagnostics: string | null;
  error_termination_confirmed: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface OutboxRow {
  id: string;
  job_id: string;
  event_type: CompletionOutboxEventType;
  payload_json: string;
  created_at: string;
  delivered_at: string | null;
}

const BASE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    pillar TEXT NOT NULL CHECK(pillar IN ('image', 'video')),
    job_type TEXT NOT NULL,
    parameters_json TEXT NOT NULL CHECK(json_valid(parameters_json)),
    batch_spec_json TEXT CHECK(batch_spec_json IS NULL OR json_valid(batch_spec_json)),
    parent_id TEXT,
    enhancement_json TEXT CHECK(enhancement_json IS NULL OR json_valid(enhancement_json)),
    sort_order INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('queued', 'running', 'interrupted', 'done', 'failed')),
    priority TEXT NOT NULL CHECK(priority IN ('interactive', 'batch')),
    thread_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    content_hash TEXT PRIMARY KEY,
    pillar TEXT NOT NULL CHECK(pillar IN ('image', 'video')),
    workflow_json TEXT NOT NULL CHECK(json_valid(workflow_json)),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_state
     ON jobs(state, priority, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_parent
     ON jobs(parent_id) WHERE parent_id IS NOT NULL`,
];

const PHASE_3_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS generation_outputs (
    id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),
    job_id TEXT NOT NULL UNIQUE
      REFERENCES jobs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    pillar TEXT NOT NULL CHECK(pillar IN ('image', 'video')),
    output_path TEXT NOT NULL COLLATE NOCASE UNIQUE
      CHECK(length(output_path) BETWEEN 1 AND 4096),
    content_hash TEXT NOT NULL
      CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    workflow_json TEXT NOT NULL CHECK(json_valid(workflow_json)),
    created_at TEXT NOT NULL CHECK(length(created_at) > 0)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_generation_outputs_hash
     ON generation_outputs(content_hash)`,
  `CREATE TABLE IF NOT EXISTS enhancement_runs (
    child_job_id TEXT PRIMARY KEY
      REFERENCES jobs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    parent_job_id TEXT NOT NULL
      REFERENCES jobs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    source_output_id TEXT NOT NULL
      REFERENCES generation_outputs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    request_id TEXT NOT NULL UNIQUE CHECK(length(request_id) BETWEEN 1 AND 128),
    metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
    state TEXT NOT NULL
      CHECK(state IN ('queued', 'running', 'interrupted', 'completed', 'failed', 'cancelled')),
    retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0, 1)),
    cancellation_requested INTEGER NOT NULL DEFAULT 0
      CHECK(cancellation_requested IN (0, 1)),
    progress_json TEXT CHECK(progress_json IS NULL OR json_valid(progress_json)),
    output_id TEXT UNIQUE
      REFERENCES generation_outputs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    provenance_record_id TEXT UNIQUE,
    provenance_json TEXT CHECK(provenance_json IS NULL OR json_valid(provenance_json)),
    error_code TEXT CHECK(
      error_code IS NULL OR error_code IN (
        'invalid_request', 'backend_unavailable', 'unsupported_platform',
        'incompatible_backend', 'model_unavailable', 'source_changed',
        'source_invalid', 'output_conflict', 'process_timeout', 'process_failed',
        'cancelled', 'output_invalid', 'provenance_failed', 'publish_failed',
        'internal_error'
      )
    ),
    error_message TEXT,
    error_stage TEXT CHECK(
      error_stage IS NULL OR error_stage IN (
        'preflight', 'upscale', 'interpolate', 'validate', 'provenance', 'publish'
      )
    ),
    error_diagnostics TEXT CHECK(
      error_diagnostics IS NULL OR length(error_diagnostics) BETWEEN 1 AND 8192
    ),
    error_termination_confirmed INTEGER CHECK(
      error_termination_confirmed IS NULL OR error_termination_confirmed IN (0, 1)
    ),
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(child_job_id <> parent_job_id),
    CHECK(
      state <> 'completed' OR
      (output_id IS NOT NULL AND provenance_record_id IS NOT NULL AND provenance_json IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS idx_enhancement_runs_parent
     ON enhancement_runs(parent_job_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_enhancement_runs_state
     ON enhancement_runs(state, retryable)`,
  `CREATE TABLE IF NOT EXISTS completion_outbox (
    id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 256),
    job_id TEXT NOT NULL
      REFERENCES jobs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    event_type TEXT NOT NULL
      CHECK(event_type IN ('generation.completed', 'video.enhancement.completed')),
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    UNIQUE(job_id, event_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_completion_outbox_pending
     ON completion_outbox(delivered_at, created_at)`,
  `CREATE TRIGGER IF NOT EXISTS trg_generation_output_matches_job
     BEFORE INSERT ON generation_outputs
     FOR EACH ROW
     WHEN NOT EXISTS (
       SELECT 1 FROM jobs WHERE id = NEW.job_id AND pillar = NEW.pillar
     )
     BEGIN
       SELECT RAISE(ABORT, 'generation output pillar does not match its job');
     END`,
  `CREATE TRIGGER IF NOT EXISTS trg_enhancement_source_matches_parent
     BEFORE INSERT ON enhancement_runs
     FOR EACH ROW
     BEGIN
       SELECT CASE WHEN NOT EXISTS (
         SELECT 1
         FROM generation_outputs AS output
         JOIN jobs AS parent ON parent.id = output.job_id
         WHERE output.id = NEW.source_output_id
           AND output.job_id = NEW.parent_job_id
           AND parent.pillar = 'video'
           AND parent.state = 'done'
       ) THEN RAISE(ABORT, 'enhancement source output does not belong to a completed video parent') END;
       SELECT CASE WHEN NOT EXISTS (
         SELECT 1
         FROM jobs AS child
         WHERE child.id = NEW.child_job_id
           AND child.parent_id = NEW.parent_job_id
           AND child.pillar = 'video'
       ) THEN RAISE(ABORT, 'enhancement child does not belong to its video parent') END;
     END`,
  `CREATE TRIGGER IF NOT EXISTS trg_enhancement_identity_immutable
     BEFORE UPDATE OF child_job_id, parent_job_id, source_output_id, request_id, metadata_json
     ON enhancement_runs
     FOR EACH ROW
     WHEN NEW.child_job_id IS NOT OLD.child_job_id
       OR NEW.parent_job_id IS NOT OLD.parent_job_id
       OR NEW.source_output_id IS NOT OLD.source_output_id
       OR NEW.request_id IS NOT OLD.request_id
       OR NEW.metadata_json IS NOT OLD.metadata_json
     BEGIN
       SELECT RAISE(ABORT, 'enhancement lineage is immutable');
     END`,
  `CREATE TRIGGER IF NOT EXISTS trg_enhancement_output_matches_child
     BEFORE UPDATE OF output_id ON enhancement_runs
     FOR EACH ROW
     WHEN NEW.output_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM generation_outputs AS output
       WHERE output.id = NEW.output_id AND output.job_id = NEW.child_job_id
     )
     BEGIN
       SELECT RAISE(ABORT, 'enhancement output does not belong to its child job');
     END`,
  `CREATE TRIGGER IF NOT EXISTS trg_completion_outbox_requires_done_job
     BEFORE INSERT ON completion_outbox
     FOR EACH ROW
     WHEN NOT EXISTS (
       SELECT 1 FROM jobs WHERE id = NEW.job_id AND state = 'done'
     )
     BEGIN
       SELECT RAISE(ABORT, 'completion outbox requires a completed job');
     END`,
];

function requireText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) {
    throw new Error(`${name} must contain between 1 and ${max} characters`);
  }
  return normalized;
}

function requireHash(value: string, name = "contentHash"): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 value`);
  }
  return value;
}

function requireRecord(
  value: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value;
}

function parseRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function outputFromRow(row: OutputRow): GenerationOutputRecord | null {
  const workflow = parseRecord(row.workflow_json);
  if (!workflow) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    pillar: row.pillar,
    outputPath: row.output_path,
    contentHash: row.content_hash,
    workflow,
    createdAt: row.created_at,
  };
}

function enhancementFromRow(row: EnhancementRow): EnhancementRunRecord | null {
  const metadata = parseRecord(
    row.metadata_json,
  ) as unknown as GenerationEnhancementMetadata | null;
  if (!metadata) return null;
  const progress = row.progress_json
    ? (parseRecord(
        row.progress_json,
      ) as unknown as VideoEnhancementProgress | null)
    : null;
  const provenance = row.provenance_json
    ? parseRecord(row.provenance_json)
    : null;
  if (row.provenance_json && !provenance) return null;
  return {
    childJobId: row.child_job_id,
    parentJobId: row.parent_job_id,
    sourceOutputId: row.source_output_id,
    requestId: row.request_id,
    metadata,
    state: row.state,
    retryable: row.retryable === 1,
    cancellationRequested: row.cancellation_requested === 1,
    progress,
    outputId: row.output_id,
    provenanceRecordId: row.provenance_record_id,
    provenance,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    errorStage: row.error_stage,
    errorDiagnostics: row.error_diagnostics,
    errorTerminationConfirmed:
      row.error_termination_confirmed === null
        ? null
        : row.error_termination_confirmed === 1,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function outboxFromRow(row: OutboxRow): CompletionOutboxRecord | null {
  const payload = parseRecord(row.payload_json);
  if (!payload) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    eventType: row.event_type,
    payload,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}

function addEnhancementColumnIfMissing(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "enhancement_json")) {
    db.exec("ALTER TABLE jobs ADD COLUMN enhancement_json TEXT");
  }
}

function addEnhancementFailureColumnsIfMissing(db: Database.Database): void {
  const columns = db
    .prepare("PRAGMA table_info(enhancement_runs)")
    .all() as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("error_stage")) {
    db.exec(`ALTER TABLE enhancement_runs ADD COLUMN error_stage TEXT CHECK(
      error_stage IS NULL OR error_stage IN (
        'preflight', 'upscale', 'interpolate', 'validate', 'provenance', 'publish'
      )
    )`);
  }
  if (!names.has("error_diagnostics")) {
    db.exec(`ALTER TABLE enhancement_runs ADD COLUMN error_diagnostics TEXT CHECK(
      error_diagnostics IS NULL OR length(error_diagnostics) BETWEEN 1 AND 8192
    )`);
  }
  if (!names.has("error_termination_confirmed")) {
    db.exec(`ALTER TABLE enhancement_runs ADD COLUMN error_termination_confirmed INTEGER CHECK(
      error_termination_confirmed IS NULL OR error_termination_confirmed IN (0, 1)
    )`);
  }
}

export class GenerationDatabase {
  private readonly _db: Database.Database;
  private readonly _now: () => Date;
  private _closed = false;

  constructor(opts: GenerationDatabaseOptions = {}) {
    const dbPath = opts.dbPath ?? resolveStudioDbPath();
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this._now = opts.now ?? (() => new Date());
    this._db = new BetterSqlite(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    this._db.pragma("busy_timeout = 5000");
    const migrate = this._db.transaction(() => {
      for (const sql of BASE_SCHEMA) this._db.exec(sql);
      addEnhancementColumnIfMissing(this._db);
      for (const sql of PHASE_3_SCHEMA) this._db.exec(sql);
      addEnhancementFailureColumnsIfMissing(this._db);
      this._db
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('schema', '4')
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run();
      this._db.pragma("user_version = 4");
    });
    migrate();
  }

  /** Internal shared handle for GenerationQueue and GenerationIndex facades. */
  get connection(): Database.Database {
    this.assertOpen();
    return this._db;
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

  putGenerationOutput(input: PutGenerationOutputInput): GenerationOutputRecord {
    this.assertOpen();
    const createdAt = input.createdAt ?? this._now().toISOString();
    const insert = this._db.transaction(() => {
      const job = this._db
        .prepare("SELECT pillar, state FROM jobs WHERE id = ?")
        .get(input.jobId) as
        { pillar: GenerationPillar; state: string } | undefined;
      if (!job) throw new Error(`generation job not found: ${input.jobId}`);
      if (job.state !== "done")
        throw new Error("generation output requires a completed job");
      if (job.pillar !== input.pillar)
        throw new Error("generation output pillar must match its job");
      return this.insertGenerationOutput(input, createdAt);
    });
    return insert();
  }

  getGenerationOutput(id: string): GenerationOutputRecord | null {
    this.assertOpen();
    const row = this._db
      .prepare("SELECT * FROM generation_outputs WHERE id = ?")
      .get(id) as OutputRow | undefined;
    return row ? outputFromRow(row) : null;
  }

  getGenerationOutputForJob(jobId: string): GenerationOutputRecord | null {
    this.assertOpen();
    const row = this._db
      .prepare("SELECT * FROM generation_outputs WHERE job_id = ?")
      .get(jobId) as OutputRow | undefined;
    return row ? outputFromRow(row) : null;
  }

  listGenerationOutputsByHash(hash: string): GenerationOutputRecord[] {
    this.assertOpen();
    const rows = this._db
      .prepare(
        "SELECT * FROM generation_outputs WHERE content_hash = ? ORDER BY created_at, id",
      )
      .all(requireHash(hash)) as OutputRow[];
    return rows.flatMap((row) => {
      const output = outputFromRow(row);
      return output ? [output] : [];
    });
  }

  getEnhancementRun(childJobId: string): EnhancementRunRecord | null {
    this.assertOpen();
    const row = this._db
      .prepare("SELECT * FROM enhancement_runs WHERE child_job_id = ?")
      .get(childJobId) as EnhancementRow | undefined;
    return row ? enhancementFromRow(row) : null;
  }

  listEnhancementRunsForParent(parentJobId: string): EnhancementRunRecord[] {
    this.assertOpen();
    const rows = this._db
      .prepare(
        "SELECT * FROM enhancement_runs WHERE parent_job_id = ? ORDER BY created_at, child_job_id",
      )
      .all(parentJobId) as EnhancementRow[];
    return rows.flatMap((row) => {
      const run = enhancementFromRow(row);
      return run ? [run] : [];
    });
  }

  listPendingCompletionOutbox(limit = 100): CompletionOutboxRecord[] {
    this.assertOpen();
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 500);
    const rows = this._db
      .prepare(
        `SELECT * FROM completion_outbox
         WHERE delivered_at IS NULL
         ORDER BY created_at, id
         LIMIT ?`,
      )
      .all(boundedLimit) as OutboxRow[];
    return rows.flatMap((row) => {
      const event = outboxFromRow(row);
      return event ? [event] : [];
    });
  }

  markCompletionOutboxDelivered(id: string, deliveredAt?: string): boolean {
    this.assertOpen();
    const ts = deliveredAt ?? this._now().toISOString();
    const result = this._db
      .prepare(
        `UPDATE completion_outbox
         SET delivered_at = ?
         WHERE id = ? AND delivered_at IS NULL`,
      )
      .run(ts, id);
    return result.changes === 1;
  }

  async completeGenerationOutput(
    input: CompleteGenerationOutputInput,
  ): Promise<AtomicGenerationOutputCompletion> {
    this.assertOpen();
    if (!path.isAbsolute(input.output.outputPath)) {
      throw new Error("output.outputPath must be absolute");
    }
    const initial = this._db
      .prepare("SELECT pillar, state, enhancement_json FROM jobs WHERE id = ?")
      .get(input.jobId) as
      | {
          pillar: GenerationPillar;
          state: string;
          enhancement_json: string | null;
        }
      | undefined;
    if (!initial) throw new Error(`generation job not found: ${input.jobId}`);
    if (initial.enhancement_json !== null) {
      throw new Error(
        "enhancement jobs complete only through completeEnhancement()",
      );
    }
    if (initial.state !== "running") {
      throw new Error("only a running generation can complete");
    }
    const contentHash = await contentHashFile(input.output.outputPath, {
      signal: input.signal,
    });
    if (input.signal?.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error("generation completion was aborted");
    }
    this.assertOpen();
    const completedAt = input.completedAt ?? this._now().toISOString();
    const complete = this._db.transaction(() => {
      const job = this._db
        .prepare(
          "SELECT pillar, state, enhancement_json FROM jobs WHERE id = ?",
        )
        .get(input.jobId) as
        | {
            pillar: GenerationPillar;
            state: string;
            enhancement_json: string | null;
          }
        | undefined;
      if (!job) throw new Error(`generation job not found: ${input.jobId}`);
      if (job.enhancement_json !== null) {
        throw new Error(
          "enhancement jobs complete only through completeEnhancement()",
        );
      }
      if (job.state !== "running") {
        throw new Error("only a running generation can complete");
      }
      const output = this.insertGenerationOutput(
        {
          id: input.output.id,
          jobId: input.jobId,
          pillar: job.pillar,
          outputPath: input.output.outputPath,
          contentHash,
          workflow: input.output.workflow,
        },
        completedAt,
      );
      const jobUpdate = this._db
        .prepare(
          `UPDATE jobs SET state = 'done', error = NULL, updated_at = ?
           WHERE id = ? AND state = 'running'`,
        )
        .run(completedAt, input.jobId);
      if (jobUpdate.changes !== 1) {
        throw new Error("generation completion lost its running state");
      }
      return { jobId: input.jobId, output };
    });
    return complete();
  }

  completeEnhancement(
    input: CompleteEnhancementInput,
  ): AtomicEnhancementCompletion {
    this.assertOpen();
    const completedAt = input.completedAt ?? this._now().toISOString();
    const complete = this._db.transaction(() => {
      const job = this._db
        .prepare("SELECT id, pillar, state FROM jobs WHERE id = ?")
        .get(input.childJobId) as
        { id: string; pillar: GenerationPillar; state: string } | undefined;
      if (!job)
        throw new Error(`enhancement child job not found: ${input.childJobId}`);
      if (job.pillar !== "video")
        throw new Error("enhancement child job must be video");
      if (job.state !== "running") {
        throw new Error("only a running enhancement can complete");
      }
      const run = this.getEnhancementRun(input.childJobId);
      if (!run) throw new Error("enhancement run not found");
      if (run.state !== "running" || run.cancellationRequested) {
        throw new Error("cancelled or non-running enhancement cannot complete");
      }

      const output = this.insertGenerationOutput(
        {
          ...input.output,
          jobId: input.childJobId,
          pillar: "video",
        },
        completedAt,
      );
      const provenanceRecordId = requireText(
        input.provenanceRecordId,
        "provenanceRecordId",
        256,
      );
      const provenance = requireRecord(input.provenance, "provenance");
      const runUpdate = this._db
        .prepare(
          `UPDATE enhancement_runs
           SET state = 'completed', retryable = 0, output_id = ?,
               provenance_record_id = ?, provenance_json = ?,
               error_code = NULL, error_message = NULL, error_stage = NULL,
               error_diagnostics = NULL, error_termination_confirmed = NULL,
               completed_at = ?, updated_at = ?
           WHERE child_job_id = ? AND state = 'running' AND cancellation_requested = 0`,
        )
        .run(
          output.id,
          provenanceRecordId,
          JSON.stringify(provenance),
          completedAt,
          completedAt,
          input.childJobId,
        );
      if (runUpdate.changes !== 1)
        throw new Error("enhancement completion lost its running state");
      const jobUpdate = this._db
        .prepare(
          `UPDATE jobs SET state = 'done', error = NULL, updated_at = ?
           WHERE id = ? AND state = 'running'`,
        )
        .run(completedAt, input.childJobId);
      if (jobUpdate.changes !== 1)
        throw new Error("enhancement job completion lost its running state");

      const outboxId = requireText(input.outbox.id, "outbox.id", 256);
      const payload = requireRecord(input.outbox.payload, "outbox.payload");
      this._db
        .prepare(
          `INSERT INTO completion_outbox (
             id, job_id, event_type, payload_json, created_at, delivered_at
           ) VALUES (?, ?, 'video.enhancement.completed', ?, ?, NULL)`,
        )
        .run(outboxId, input.childJobId, JSON.stringify(payload), completedAt);

      const completedRun = this.getEnhancementRun(input.childJobId);
      const outboxRow = this._db
        .prepare("SELECT * FROM completion_outbox WHERE id = ?")
        .get(outboxId) as OutboxRow | undefined;
      const outbox = outboxRow ? outboxFromRow(outboxRow) : null;
      if (!completedRun || !outbox)
        throw new Error("enhancement completion could not be read back");
      return {
        childJobId: input.childJobId,
        output,
        enhancement: completedRun,
        outbox,
      };
    });
    return complete();
  }

  private insertGenerationOutput(
    input: PutGenerationOutputInput,
    createdAt: string,
  ): GenerationOutputRecord {
    const id = requireText(input.id, "output.id", 256);
    const jobId = requireText(input.jobId, "output.jobId", 256);
    const outputPath = requireText(input.outputPath, "output.outputPath", 4096);
    if (!path.isAbsolute(outputPath))
      throw new Error("output.outputPath must be absolute");
    const hash = requireHash(input.contentHash);
    const workflow = redactWorkflow(
      requireRecord(input.workflow, "output.workflow"),
    );
    this._db
      .prepare(
        `INSERT INTO generations (content_hash, pillar, workflow_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(content_hash) DO NOTHING`,
      )
      .run(hash, input.pillar, JSON.stringify(workflow), createdAt);
    this._db
      .prepare(
        `INSERT INTO generation_outputs (
           id, job_id, pillar, output_path, content_hash, workflow_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        jobId,
        input.pillar,
        outputPath,
        hash,
        JSON.stringify(workflow),
        createdAt,
      );
    const output = this.getGenerationOutput(id);
    if (!output)
      throw new Error("generation output insert could not be read back");
    return output;
  }

  private assertOpen(): void {
    if (this._closed) throw new Error("generation database is closed");
  }
}

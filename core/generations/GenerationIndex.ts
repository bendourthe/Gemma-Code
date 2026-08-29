/**
 * v2.1.0 Phase 3 -- local generation index keyed by content hash.
 *
 * Mirrors embedded PNG/MP4 workflow so recall still works when a writer
 * fails or a format cannot carry metadata. Free-text fields are redacted
 * before insert. Unknown JSON fields are stored and returned as-is.
 */

import type Database from "better-sqlite3";
import { contentHash } from "./contentHash.js";
import {
  GenerationDatabase,
  type CompletionOutboxRecord,
  type EnhancementRunRecord,
  type GenerationOutputRecord,
  type GenerationPillar,
  type PutGenerationOutputInput,
} from "./GenerationDatabase.js";
import { redactWorkflow } from "./redactWorkflow.js";

export type { GenerationPillar } from "./GenerationDatabase.js";

export interface IndexedGeneration {
  readonly contentHash: string;
  readonly pillar: GenerationPillar;
  readonly workflow: Record<string, unknown>;
  readonly createdAt: string;
}

export interface GenerationIndexOptions {
  readonly dbPath?: string;
  readonly database?: GenerationDatabase;
  readonly now?: () => Date;
}

export class GenerationIndex {
  private readonly _database: GenerationDatabase;
  private readonly _db: Database.Database;
  private readonly _ownsDatabase: boolean;
  private readonly _now: () => Date;
  private _closed = false;

  constructor(opts: GenerationIndexOptions = {}) {
    if (opts.database && opts.dbPath !== undefined) {
      throw new Error("GenerationIndex accepts database or dbPath, not both");
    }
    this._now = opts.now ?? (() => new Date());
    this._ownsDatabase = !opts.database;
    this._database =
      opts.database ??
      new GenerationDatabase({ dbPath: opts.dbPath, now: this._now });
    this._db = this._database.connection;
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    if (this._ownsDatabase) this._database.close();
  }

  put(
    bytes: Buffer | Uint8Array | string,
    pillar: GenerationPillar,
    workflow: Record<string, unknown>,
  ): IndexedGeneration {
    const hash = contentHash(bytes);
    const redacted = redactWorkflow(workflow);
    const createdAt = this._now().toISOString();
    this._db
      .prepare(
        `INSERT INTO generations (content_hash, pillar, workflow_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(content_hash) DO UPDATE SET
           pillar = excluded.pillar,
           workflow_json = excluded.workflow_json`,
      )
      .run(hash, pillar, JSON.stringify(redacted), createdAt);
    return { contentHash: hash, pillar, workflow: redacted, createdAt };
  }

  get(hash: string): IndexedGeneration | null {
    const row = this._db
      .prepare(
        "SELECT content_hash, pillar, workflow_json, created_at FROM generations WHERE content_hash = ?",
      )
      .get(hash) as
      | {
          content_hash: string;
          pillar: GenerationPillar;
          workflow_json: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    let workflow: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.workflow_json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        workflow = parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return {
      contentHash: row.content_hash,
      pillar: row.pillar,
      workflow,
      createdAt: row.created_at,
    };
  }

  getByBytes(bytes: Buffer | Uint8Array | string): IndexedGeneration | null {
    return this.get(contentHash(bytes));
  }

  putOutput(input: PutGenerationOutputInput): GenerationOutputRecord {
    return this._database.putGenerationOutput(input);
  }

  getOutput(id: string): GenerationOutputRecord | null {
    return this._database.getGenerationOutput(id);
  }

  getOutputForJob(jobId: string): GenerationOutputRecord | null {
    return this._database.getGenerationOutputForJob(jobId);
  }

  listOutputsByHash(hash: string): GenerationOutputRecord[] {
    return this._database.listGenerationOutputsByHash(hash);
  }

  getEnhancementRun(childJobId: string): EnhancementRunRecord | null {
    return this._database.getEnhancementRun(childJobId);
  }

  listEnhancementRunsForParent(parentJobId: string): EnhancementRunRecord[] {
    return this._database.listEnhancementRunsForParent(parentJobId);
  }

  listPendingCompletions(limit?: number): CompletionOutboxRecord[] {
    return this._database.listPendingCompletionOutbox(limit);
  }

  markCompletionDelivered(id: string, deliveredAt?: string): boolean {
    return this._database.markCompletionOutboxDelivered(id, deliveredAt);
  }
}

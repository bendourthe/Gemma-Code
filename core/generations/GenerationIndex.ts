/**
 * v2.1.0 Phase 3 -- local generation index keyed by content hash.
 *
 * Mirrors embedded PNG/MP4 workflow so recall still works when a writer
 * fails or a format cannot carry metadata. Free-text fields are redacted
 * before insert. Unknown JSON fields are stored and returned as-is.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import BetterSqlite from "better-sqlite3";
import type Database from "better-sqlite3";
import { contentHash } from "./contentHash.js";
import { redactWorkflow } from "./redactWorkflow.js";
import { resolveStudioDbPath } from "./paths.js";

export type GenerationPillar = "image" | "video";

export interface IndexedGeneration {
  readonly contentHash: string;
  readonly pillar: GenerationPillar;
  readonly workflow: Record<string, unknown>;
  readonly createdAt: string;
}

export interface GenerationIndexOptions {
  readonly dbPath?: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generations (
    content_hash TEXT PRIMARY KEY,
    pillar TEXT NOT NULL,
    workflow_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

export class GenerationIndex {
  private readonly _db: Database.Database;
  private _closed = false;

  constructor(opts: GenerationIndexOptions = {}) {
    const dbPath = opts.dbPath ?? resolveStudioDbPath();
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this._db = new BetterSqlite(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    for (const sql of SCHEMA) this._db.exec(sql);
    this._db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema', '1')").run();
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

  put(
    bytes: Buffer | Uint8Array | string,
    pillar: GenerationPillar,
    workflow: Record<string, unknown>,
  ): IndexedGeneration {
    const hash = contentHash(bytes);
    const redacted = redactWorkflow(workflow);
    const createdAt = new Date().toISOString();
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
      | { content_hash: string; pillar: GenerationPillar; workflow_json: string; created_at: string }
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
}

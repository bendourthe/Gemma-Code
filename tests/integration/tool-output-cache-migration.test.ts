/**
 * Integration: Phase 5 (v0.6.0) -- ToolOutputCache migration idempotency.
 *
 * Closes known-gaps section 9.7 / pen-test F-014. The schema has accumulated
 * three additive migrations on top of the v0.4.0 baseline -- `embedding`,
 * `embedding_provenance`, `excerpt`, plus the v0.6.0 `accessed_at` column for
 * true LRU eviction. The "user downgrades and re-upgrades" path (or the
 * "user opens the same SQLite file twice" path) must run every migration on
 * the first open and then no-op on every subsequent open.
 *
 * The test seeds a fresh SQLite file with the v0.4.0 schema (no embedding,
 * no embedding_provenance, no excerpt, no accessed_at), opens it through the
 * current `ToolOutputCache`, and asserts:
 *   1. all four migrations land cleanly
 *   2. closing and re-opening the same file is a no-op (idempotent)
 *   3. `accessed_at` is backfilled to `stored_at` for pre-migration rows
 *   4. read/write round-trips through the migrated schema
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { ToolOutputCache } from "../../src/storage/ToolOutputCache.js";

describe("ToolOutputCache migration ordering (integration)", () => {
  let tmpdir: string;
  let dbPath: string;
  let filePath: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "tool-output-cache-migration-"));
    dbPath = path.join(tmpdir, "tool-output-cache.sqlite");
    filePath = path.join(tmpdir, "fixture.txt");
    fs.writeFileSync(filePath, "hello v0.4.0");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch {
      /* swallow */
    }
  });

  function seedV040Schema(): void {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE tool_output_cache (
        absolute_path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        content_brotli BLOB NOT NULL,
        stored_at INTEGER NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_tool_output_cache_stored_at
        ON tool_output_cache(stored_at);
    `);
    const stat = fs.statSync(filePath);
    db.prepare(
      `INSERT INTO tool_output_cache
         (absolute_path, mtime_ms, size_bytes, content_brotli, stored_at, hits)
        VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(filePath, stat.mtimeMs, stat.size, Buffer.from([0x00, 0x01, 0x02]), 1_700_000_000_000);
    db.close();
  }

  function tableColumns(): string[] {
    const db = new Database(dbPath, { readonly: true });
    try {
      return (
        db.pragma("table_info(tool_output_cache)") as Array<{ name: string }>
      ).map((c) => c.name);
    } finally {
      db.close();
    }
  }

  function readRow(): {
    accessed_at: number;
    stored_at: number;
    embedding: Buffer | null;
    embedding_provenance: string | null;
    excerpt: string | null;
  } | undefined {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db.prepare(
        `SELECT accessed_at, stored_at, embedding, embedding_provenance, excerpt
           FROM tool_output_cache WHERE absolute_path = ?`,
      ).get(filePath) as {
        accessed_at: number;
        stored_at: number;
        embedding: Buffer | null;
        embedding_provenance: string | null;
        excerpt: string | null;
      } | undefined;
    } finally {
      db.close();
    }
  }

  it("runs every additive migration on first open of a v0.4.0-shaped DB", () => {
    seedV040Schema();
    expect(tableColumns()).not.toContain("embedding");
    expect(tableColumns()).not.toContain("excerpt");
    expect(tableColumns()).not.toContain("accessed_at");

    const cache = new ToolOutputCache({ capacity: 50 });
    cache.open(dbPath);
    cache.close();

    const cols = tableColumns();
    expect(cols).toContain("embedding");
    expect(cols).toContain("embedding_provenance");
    expect(cols).toContain("excerpt");
    expect(cols).toContain("accessed_at");
  });

  it("backfills accessed_at to stored_at for pre-migration rows", () => {
    seedV040Schema();
    const cache = new ToolOutputCache({ capacity: 50 });
    cache.open(dbPath);
    cache.close();

    const row = readRow();
    expect(row).toBeDefined();
    expect(row!.stored_at).toBe(1_700_000_000_000);
    expect(row!.accessed_at).toBe(1_700_000_000_000);
  });

  it("close + re-open of an already-migrated DB is a no-op", () => {
    seedV040Schema();

    const first = new ToolOutputCache({ capacity: 50 });
    first.open(dbPath);
    first.close();
    const colsAfterFirst = tableColumns();

    const second = new ToolOutputCache({ capacity: 50 });
    second.open(dbPath);
    second.close();
    const colsAfterSecond = tableColumns();

    expect(colsAfterSecond).toEqual(colsAfterFirst);

    const third = new ToolOutputCache({ capacity: 50 });
    third.open(dbPath);
    third.close();
    expect(tableColumns()).toEqual(colsAfterFirst);
  });

  it("round-trips a fresh write/read through the migrated schema", () => {
    seedV040Schema();

    const cache = new ToolOutputCache({ capacity: 50 });
    cache.open(dbPath);
    cache.store(filePath, "hello migrated");
    const result = cache.lookup(filePath);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("hello migrated");
    expect(result!.fresh).toBe(true);
    cache.close();

    const row = readRow();
    expect(row).toBeDefined();
    expect(row!.excerpt).toBe("hello migrated");
    expect(row!.accessed_at).toBeGreaterThan(0);
  });
});

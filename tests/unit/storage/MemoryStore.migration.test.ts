import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";

/**
 * Build a temp DB with the v0.4.0 schema (no `corroboration_count` column)
 * pre-populated with rows. Returns the path so the next call to `MemoryStore`
 * triggers the migration.
 */
function seedLegacyDb(rowCount: number): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gemma-migration-"));
  const dbPath = path.join(tmp, "memory.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE memories (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      session_id TEXT,
      content TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('decision','fact','preference','file_pattern','error_resolution')),
      embedding BLOB,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL,
      access_count INTEGER DEFAULT 0,
      relevance_decay REAL DEFAULT 1.0
    );
  `);
  db.pragma("user_version = 1");
  const insert = db.prepare(
    `INSERT INTO memories (id, session_id, content, type, embedding, created_at, accessed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  for (let i = 0; i < rowCount; i++) {
    insert.run(`legacy-${i}`, null, `legacy entry ${i}`, "fact", null, now, now);
  }
  db.close();
  return dbPath;
}

describe("MemoryStore migration", () => {
  let dbPath: string;

  afterEach(() => {
    if (dbPath) {
      try {
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("adds corroboration_count column when migrating from v1", () => {
    dbPath = seedLegacyDb(5);

    const store = new MemoryStore(dbPath);
    const rows = store.listAll(100);
    for (const row of rows) {
      expect(row.corroborationCount).toBe(1);
    }
    store.close();
  });

  it("bumps user_version to the new schema version", () => {
    dbPath = seedLegacyDb(1);

    const store = new MemoryStore(dbPath);
    const rawDb = (store as unknown as { _db: Database.Database })._db;
    const version = rawDb.pragma("user_version", { simple: true }) as number;
    expect(version).toBeGreaterThanOrEqual(2);
    store.close();
  });

  it("is idempotent: running the migration twice does not error", () => {
    dbPath = seedLegacyDb(3);

    const first = new MemoryStore(dbPath);
    first.close();
    expect(() => {
      const second = new MemoryStore(dbPath);
      second.close();
    }).not.toThrow();
  });

  it("backfills 5K rows under 1 second", () => {
    dbPath = seedLegacyDb(5000);
    const t0 = Date.now();
    const store = new MemoryStore(dbPath);
    const elapsed = Date.now() - t0;
    expect(store.count()).toBe(5000);
    expect(elapsed).toBeLessThan(1000);
    store.close();
  });
});

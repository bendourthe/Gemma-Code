import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { MemoryStore } from "../../../src/storage/MemoryStore.js";

/**
 * v1.1.0 Phase 4.1 -- provenance + scope_id migration test.
 *
 * Two scenarios:
 *   1. A v1.0.0-shaped database (no `provenance` / `scope_id` columns)
 *      is loaded; the MemoryStore constructor adds the columns, existing
 *      rows are visible with `lifecycleProvenance === null` and
 *      `scopeId === null`, and the schema version is bumped to 3.
 *   2. New writes carry the structured provenance / scope onto the row;
 *      both round-trip through SQLite.
 *
 * Also verifies that the secret-redaction filter (Phase 4.4) scrubs
 * incoming content before it reaches the row.
 */

/** Build a v1.0.0-shaped DB pre-populated with rows (no provenance/scope). */
function seedV1Db(rowCount: number): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-prov-mig-"));
  const dbPath = path.join(tmp, "memory.sqlite");
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
      relevance_decay REAL DEFAULT 1.0,
      corroboration_count INTEGER NOT NULL DEFAULT 1
    );
  `);
  db.pragma("user_version = 2");
  const insert = db.prepare(
    `INSERT INTO memories (id, session_id, content, type, embedding, created_at, accessed_at, corroboration_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const now = Date.now();
  for (let i = 0; i < rowCount; i++) {
    insert.run(`v1-row-${i}`, null, `v1.0.0 entry ${i}`, "fact", null, now, now);
  }
  db.close();
  return dbPath;
}

describe("MemoryStore provenance migration (v1.1.0 Phase 4.1)", () => {
  let dbPath = "";

  afterEach(() => {
    if (dbPath) {
      try {
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      } catch {
        // ignore
      }
      dbPath = "";
    }
  });

  it("adds provenance + scope_id columns to a v1.0.0 database (NULL backfill)", () => {
    dbPath = seedV1Db(5);
    const store = new MemoryStore(dbPath);

    const rows = store.listAll(100);
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(row.lifecycleProvenance).toBeNull();
      expect(row.scopeId).toBeNull();
    }

    // user_version should be bumped to 3.
    const rawDb = (store as unknown as { _db: Database.Database })._db;
    const version = rawDb.pragma("user_version", { simple: true }) as number;
    expect(version).toBeGreaterThanOrEqual(3);

    store.close();
  });

  it("is idempotent: running the migration twice does not error", () => {
    dbPath = seedV1Db(3);
    const first = new MemoryStore(dbPath);
    first.close();
    expect(() => {
      const second = new MemoryStore(dbPath);
      second.close();
    }).not.toThrow();
  });

  it("new writes carry the structured provenance and scope_id", async () => {
    dbPath = seedV1Db(0);
    const store = new MemoryStore(dbPath);

    const entry = await store.save(
      "Decided to standardize on TypeScript strict mode.",
      "decision",
      "sess-abc",
      {
        provenance: {
          sessionId: "sess-abc",
          hookKind: "lifecycle.tool.post",
          toolName: "write_file",
          parentSpanId: "span-42",
        },
        scopeId: "Projects/Work",
      },
    );

    expect(entry.lifecycleProvenance).toEqual({
      sessionId: "sess-abc",
      hookKind: "lifecycle.tool.post",
      toolName: "write_file",
      parentSpanId: "span-42",
    });
    expect(entry.scopeId).toBe("Projects/Work");

    const reread = store.listAll(10).find((r) => r.id === entry.id);
    expect(reread?.lifecycleProvenance?.hookKind).toBe("lifecycle.tool.post");
    expect(reread?.lifecycleProvenance?.toolName).toBe("write_file");
    expect(reread?.scopeId).toBe("Projects/Work");

    store.close();
  });

  it("redacts secrets in the saved content before insert (Phase 4.4)", async () => {
    dbPath = seedV1Db(0);
    const store = new MemoryStore(dbPath);

    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    await store.save(
      `Use aws creds ${awsKey} for the staging bucket.`,
      "preference",
      "sess-redact",
      { provenance: { sessionId: "sess-redact", hookKind: "lifecycle.user.prompt" } },
    );

    const rows = store.listAll(10);
    expect(rows.length).toBe(1);
    const r0 = rows[0]!;
    expect(r0.content).not.toContain(awsKey);
    expect(r0.content).toContain("<redacted>");

    store.close();
  });
});

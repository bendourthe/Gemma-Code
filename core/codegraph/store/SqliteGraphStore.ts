/**
 * v1.2.0 Phase 3.2 -- SQLite-backed graph persistence with FTS5.
 *
 * Three tables plus one FTS5 virtual table:
 *
 *   files(id, path UNIQUE, language, last_indexed_at, content_hash)
 *   symbols(id, file_id, name, kind, line_start, line_end, signature_text)
 *   call_edges(caller_symbol_id, callee_symbol_id, line, kind)
 *   symbols_fts(name, signature_text)   -- FTS5 virtual; rowid = symbols.id
 *
 * Storage uses WAL mode so concurrent readers (the MCP tools) do not block
 * writers (the scanner). All CRUD goes through prepared statements; FTS5
 * stays in lockstep with `symbols` via per-statement updates rather than
 * triggers so the store keeps working even if a host SQLite is built
 * without trigger support.
 *
 * The persistent file lives at `<nexus-home>/codegraph/<fingerprint>.db`
 * where `<fingerprint>` is supplied by the caller (typically a hash of the
 * repo root). Resolving paths through `nexusHome()` keeps the layer
 * portable across the v1.0.0 -> v1.1.0 storage migration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import BetterSqlite from "better-sqlite3";
import type Database from "better-sqlite3";
import { nexusHome } from "../../storage/paths.js";
import { CODEGRAPH_SCHEMA_VERSION } from "../manifest.js";
import type {
  CallEdge,
  CallEdgeKind,
  CodeGraphLanguage,
  FileNode,
  Symbol,
  SymbolKind,
  SymbolReference,
  SymbolSearchHit,
} from "../types.js";

export interface SqliteGraphStoreOptions {
  /** Absolute path to the SQLite database file. Created if missing. */
  readonly dbPath: string;
  /** Optional override for the FTS5 virtual table name (mostly for tests). */
  readonly ftsTableName?: string;
}

const DEFAULT_FTS_TABLE = "symbols_fts";

const CREATE_SCHEMA_SQL = [
  // Metadata table -- store + read the schema version so a stale DB is
  // detected on open without needing to introspect the table list.
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    language TEXT NOT NULL,
    last_indexed_at INTEGER NOT NULL,
    content_hash TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    signature_text TEXT NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id)`,
  `CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`,
  `CREATE TABLE IF NOT EXISTS call_edges (
    caller_symbol_id INTEGER NOT NULL,
    callee_symbol_id INTEGER NOT NULL,
    line INTEGER NOT NULL,
    kind TEXT NOT NULL,
    PRIMARY KEY (caller_symbol_id, callee_symbol_id, line, kind),
    FOREIGN KEY (caller_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE,
    FOREIGN KEY (callee_symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_edges_caller ON call_edges(caller_symbol_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_callee ON call_edges(callee_symbol_id)`,
];

/** Resolve the canonical on-disk DB path for a given repo fingerprint. */
export function resolveCodegraphDbPath(
  fingerprint: string,
  homeDirFn?: () => string,
): string {
  const safe = fingerprint.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(nexusHome(homeDirFn), "codegraph");
  return path.join(dir, `${safe}.db`);
}

/**
 * SQLite-backed graph store. The store is synchronous because
 * `better-sqlite3` is synchronous; consumers wrap calls in
 * `await Promise.resolve(...)` if they want to mix into async flows.
 */
type Stmt = Database.Statement<unknown[]>;

export class SqliteGraphStore {
  private readonly _db: Database.Database;
  private readonly _ftsTable: string;
  private readonly _opts: SqliteGraphStoreOptions;
  private _closed = false;

  // Prepared statements cached on first use to keep the hot path allocation-free.
  private _stmts: {
    upsertFile?: Stmt;
    findFileByPath?: Stmt;
    deleteFile?: Stmt;
    upsertSymbol?: Stmt;
    findSymbolById?: Stmt;
    findSymbolByName?: Stmt;
    deleteSymbolsForFile?: Stmt;
    upsertEdge?: Stmt;
    deleteEdgesForCaller?: Stmt;
    findCallersOf?: Stmt;
    findCalleesOf?: Stmt;
    searchSymbolsFts?: Stmt;
    upsertFts?: Stmt;
    deleteFts?: Stmt;
    listFiles?: Stmt;
  } = {};

  constructor(opts: SqliteGraphStoreOptions) {
    this._opts = opts;
    this._ftsTable = opts.ftsTableName ?? DEFAULT_FTS_TABLE;
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
    this._db = new BetterSqlite(opts.dbPath);
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    this._db.pragma("synchronous = NORMAL");
    this._ensureSchema();
  }

  /** Close the underlying database handle. Idempotent. */
  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this._db.close();
    } catch {
      // best-effort
    }
  }

  /** Absolute path to the on-disk DB file. */
  get dbPath(): string {
    return this._opts.dbPath;
  }

  /** Insert or update a file row by path. Returns the row id. */
  upsertFile(input: {
    path: string;
    language: CodeGraphLanguage;
    lastIndexedAt: number;
    contentHash: string;
  }): number {
    this._stmts.upsertFile ??= this._db.prepare(
      `INSERT INTO files (path, language, last_indexed_at, content_hash)
       VALUES (@path, @language, @lastIndexedAt, @contentHash)
       ON CONFLICT(path) DO UPDATE SET
         language = excluded.language,
         last_indexed_at = excluded.last_indexed_at,
         content_hash = excluded.content_hash`,
    );
    const info = this._stmts.upsertFile.run(input);
    if (info.changes === 0 && info.lastInsertRowid === 0) {
      throw new Error(`SqliteGraphStore.upsertFile: no row affected for ${input.path}`);
    }
    // ON CONFLICT path: lastInsertRowid is 0 -- look up the id explicitly.
    if (info.lastInsertRowid === 0 || typeof info.lastInsertRowid !== "number") {
      const row = this.findFileByPath(input.path);
      if (!row) {
        throw new Error(`SqliteGraphStore.upsertFile: missing row after upsert for ${input.path}`);
      }
      return row.id;
    }
    return Number(info.lastInsertRowid);
  }

  findFileByPath(filePath: string): FileNode | undefined {
    this._stmts.findFileByPath ??= this._db.prepare(
      `SELECT id, path, language, last_indexed_at, content_hash
         FROM files WHERE path = ?`,
    );
    const row = this._stmts.findFileByPath.get(filePath) as
      | {
          id: number;
          path: string;
          language: string;
          last_indexed_at: number;
          content_hash: string;
        }
      | undefined;
    if (!row) return undefined;
    return Object.freeze({
      id: row.id,
      path: row.path,
      language: row.language as CodeGraphLanguage,
      lastIndexedAt: row.last_indexed_at,
      contentHash: row.content_hash,
    });
  }

  /**
   * Insert a symbol. Returns the new row id. The caller is responsible
   * for calling `deleteSymbolsForFile(fileId)` before re-upserting a file
   * (the scanner does this so re-index produces a clean slate per file).
   */
  upsertSymbol(input: {
    fileId: number;
    name: string;
    kind: SymbolKind;
    lineStart: number;
    lineEnd: number;
    signatureText: string;
  }): number {
    this._stmts.upsertSymbol ??= this._db.prepare(
      `INSERT INTO symbols (file_id, name, kind, line_start, line_end, signature_text)
       VALUES (@fileId, @name, @kind, @lineStart, @lineEnd, @signatureText)`,
    );
    const info = this._stmts.upsertSymbol.run(input);
    const id = Number(info.lastInsertRowid);
    this._stmts.upsertFts ??= this._db.prepare(
      `INSERT INTO ${this._ftsTable}(rowid, name, signature_text)
       VALUES (?, ?, ?)`,
    );
    // Index both the original name AND a tokenized form (camelCase /
    // snake_case split into sub-tokens) so FTS5's default `unicode61`
    // tokenizer can match queries like `token` against `validateToken`.
    const tokenizedName = `${input.name} ${tokenizeIdentifier(input.name)}`.trim();
    this._stmts.upsertFts.run(id, tokenizedName, input.signatureText);
    return id;
  }

  findSymbolById(id: number): Symbol | undefined {
    this._stmts.findSymbolById ??= this._db.prepare(
      `SELECT id, file_id, name, kind, line_start, line_end, signature_text
         FROM symbols WHERE id = ?`,
    );
    const row = this._stmts.findSymbolById.get(id) as
      | {
          id: number;
          file_id: number;
          name: string;
          kind: string;
          line_start: number;
          line_end: number;
          signature_text: string;
        }
      | undefined;
    return row ? this._rowToSymbol(row) : undefined;
  }

  findSymbolByName(name: string): readonly Symbol[] {
    this._stmts.findSymbolByName ??= this._db.prepare(
      `SELECT id, file_id, name, kind, line_start, line_end, signature_text
         FROM symbols WHERE name = ? ORDER BY id ASC`,
    );
    const rows = this._stmts.findSymbolByName.all(name) as Array<{
      id: number;
      file_id: number;
      name: string;
      kind: string;
      line_start: number;
      line_end: number;
      signature_text: string;
    }>;
    return Object.freeze(rows.map((r) => this._rowToSymbol(r)));
  }

  /**
   * Delete a single file row by id. Symbols + edges + FTS rows must be
   * removed first via `deleteCallerEdgesForFile` and
   * `deleteSymbolsForFile`; this helper does not cascade so the call
   * sequence remains explicit at every call site (and matches the
   * transaction-grouping pattern used by `pruneRemovedFiles`).
   *
   * Returns the number of rows removed (1 if the id existed, 0 otherwise).
   */
  deleteFile(fileId: number): number {
    this._stmts.deleteFile ??= this._db.prepare(`DELETE FROM files WHERE id = ?`);
    const info = this._stmts.deleteFile.run(fileId);
    return Number(info.changes);
  }

  /** Delete every symbol (and its edges / FTS row) for a given file. */
  deleteSymbolsForFile(fileId: number): number {
    this._stmts.deleteSymbolsForFile ??= this._db.prepare(
      `SELECT id FROM symbols WHERE file_id = ?`,
    );
    this._stmts.deleteFts ??= this._db.prepare(
      `DELETE FROM ${this._ftsTable} WHERE rowid = ?`,
    );
    const ids = this._stmts.deleteSymbolsForFile.all(fileId) as Array<{ id: number }>;
    const txn = this._db.transaction((rows: Array<{ id: number }>) => {
      for (const r of rows) this._stmts.deleteFts!.run(r.id);
      this._db.prepare(`DELETE FROM symbols WHERE file_id = ?`).run(fileId);
    });
    txn(ids);
    return ids.length;
  }

  upsertCallEdge(input: CallEdge): void {
    this._stmts.upsertEdge ??= this._db.prepare(
      `INSERT OR IGNORE INTO call_edges (caller_symbol_id, callee_symbol_id, line, kind)
       VALUES (@callerSymbolId, @calleeSymbolId, @line, @kind)`,
    );
    this._stmts.upsertEdge.run(input);
  }

  /**
   * Return symbols that call `target` (i.e., edges where the callee_id
   * matches a symbol with this name).
   */
  findCallersOf(name: string): readonly SymbolReference[] {
    this._stmts.findCallersOf ??= this._db.prepare(
      `SELECT s_caller.id  AS id,
              s_caller.name AS name,
              s_caller.line_start AS line_start,
              s_caller.line_end   AS line_end,
              f.path AS path
         FROM call_edges e
         JOIN symbols s_callee ON s_callee.id = e.callee_symbol_id
         JOIN symbols s_caller ON s_caller.id = e.caller_symbol_id
         JOIN files f          ON f.id = s_caller.file_id
        WHERE s_callee.name = ?
        ORDER BY f.path ASC, s_caller.line_start ASC`,
    );
    const rows = this._stmts.findCallersOf.all(name) as Array<{
      id: number;
      name: string;
      line_start: number;
      line_end: number;
      path: string;
    }>;
    return Object.freeze(rows.map((r) => this._rowToReference(r)));
  }

  findCalleesOf(name: string): readonly SymbolReference[] {
    this._stmts.findCalleesOf ??= this._db.prepare(
      `SELECT s_callee.id  AS id,
              s_callee.name AS name,
              s_callee.line_start AS line_start,
              s_callee.line_end   AS line_end,
              f.path AS path
         FROM call_edges e
         JOIN symbols s_caller ON s_caller.id = e.caller_symbol_id
         JOIN symbols s_callee ON s_callee.id = e.callee_symbol_id
         JOIN files f          ON f.id = s_callee.file_id
        WHERE s_caller.name = ?
        ORDER BY f.path ASC, s_callee.line_start ASC`,
    );
    const rows = this._stmts.findCalleesOf.all(name) as Array<{
      id: number;
      name: string;
      line_start: number;
      line_end: number;
      path: string;
    }>;
    return Object.freeze(rows.map((r) => this._rowToReference(r)));
  }

  /** Full-text search across symbol names + signature text. */
  searchSymbols(ftsQuery: string, limit = 50): readonly SymbolSearchHit[] {
    this._stmts.searchSymbolsFts ??= this._db.prepare(
      `SELECT s.id, s.name, s.kind, s.line_start, s.line_end, s.signature_text, f.path
         FROM ${this._ftsTable} fts
         JOIN symbols s ON s.id = fts.rowid
         JOIN files   f ON f.id = s.file_id
        WHERE ${this._ftsTable} MATCH ?
        ORDER BY rank
        LIMIT ?`,
    );
    const sanitized = sanitizeFtsQuery(ftsQuery);
    const rows = this._stmts.searchSymbolsFts.all(sanitized, limit) as Array<{
      id: number;
      name: string;
      kind: string;
      line_start: number;
      line_end: number;
      signature_text: string;
      path: string;
    }>;
    return Object.freeze(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind as SymbolKind,
        filePath: r.path,
        lineStart: r.line_start,
        lineEnd: r.line_end,
        signaturePreview: r.signature_text.slice(0, 200),
      })),
    );
  }

  /** Remove a single file (cascade deletes symbols + edges + FTS rows). */
  pruneRemovedFiles(pathsStillPresent: readonly string[]): number {
    // Materialize the set in JS rather than relying on giant IN clauses; the
    // typical scan only removes a handful of files at a time.
    const present = new Set(pathsStillPresent);
    this._stmts.listFiles ??= this._db.prepare(`SELECT id, path FROM files`);
    const rows = this._stmts.listFiles.all() as Array<{ id: number; path: string }>;
    let removed = 0;
    const deleteFileStmt = this._db.prepare(`DELETE FROM files WHERE id = ?`);
    const txn = this._db.transaction((targets: Array<{ id: number }>) => {
      for (const t of targets) {
        // Delete symbol FTS rows then symbols then the file.
        this.deleteSymbolsForFile(t.id);
        deleteFileStmt.run(t.id);
        removed += 1;
      }
    });
    txn(rows.filter((r) => !present.has(r.path)));
    return removed;
  }

  listFiles(): readonly FileNode[] {
    this._stmts.listFiles ??= this._db.prepare(`SELECT id, path, language, last_indexed_at, content_hash FROM files ORDER BY path ASC`);
    const rows = this._stmts.listFiles.all() as Array<{
      id: number;
      path: string;
      language: string;
      last_indexed_at: number;
      content_hash: string;
    }>;
    return Object.freeze(
      rows.map((r) =>
        Object.freeze({
          id: r.id,
          path: r.path,
          language: r.language as CodeGraphLanguage,
          lastIndexedAt: r.last_indexed_at,
          contentHash: r.content_hash,
        }),
      ),
    );
  }

  /**
   * Delete edges whose caller_id sits inside the given file. Used by the
   * scanner before re-extracting edges for a re-parsed file so duplicates
   * do not accumulate when the file changes.
   */
  deleteCallerEdgesForFile(fileId: number): number {
    this._stmts.deleteEdgesForCaller ??= this._db.prepare(
      `DELETE FROM call_edges
         WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)`,
    );
    const info = this._stmts.deleteEdgesForCaller.run(fileId);
    return Number(info.changes);
  }

  /** Run a transaction over the store. */
  transaction<T>(fn: () => T): T {
    const wrapped = this._db.transaction(fn);
    return wrapped();
  }

  // ---------------- internals ----------------

  private _ensureSchema(): void {
    this._db.exec("BEGIN");
    try {
      for (const ddl of CREATE_SCHEMA_SQL) this._db.exec(ddl);
      this._db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${this._ftsTable}
           USING fts5(name, signature_text)`,
      );
      this._db
        .prepare(`INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)`)
        .run(CODEGRAPH_SCHEMA_VERSION);
      this._db.exec("COMMIT");
    } catch (err) {
      this._db.exec("ROLLBACK");
      throw err;
    }
  }

  private _rowToSymbol(row: {
    id: number;
    file_id: number;
    name: string;
    kind: string;
    line_start: number;
    line_end: number;
    signature_text: string;
  }): Symbol {
    return Object.freeze({
      id: row.id,
      fileId: row.file_id,
      name: row.name,
      kind: row.kind as SymbolKind,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      signatureText: row.signature_text,
    });
  }

  private _rowToReference(row: {
    id: number;
    name: string;
    line_start: number;
    line_end: number;
    path: string;
  }): SymbolReference {
    return Object.freeze({
      symbolId: row.id,
      symbolName: row.name,
      filePath: row.path,
      lineStart: row.line_start,
      lineEnd: row.line_end,
    });
  }
}

/**
 * Defensively rewrite an FTS5 query so accidental punctuation does not blow
 * up the parser. We strip everything except word chars, single quotes,
 * `*`, and spaces. Bareword tokens are passed through; an empty query
 * becomes `"*"` so callers get an explicit "no input" rather than a parse
 * error.
 */
function sanitizeFtsQuery(query: string): string {
  const cleaned = query
    .replace(/[^a-zA-Z0-9_'*\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return cleaned.length === 0 ? "*" : cleaned;
}

/**
 * Split a programming identifier into searchable sub-tokens. Splits on
 * camelCase boundaries and underscores so a query like `token` can match
 * a symbol named `validateToken` or `validate_token`. Returns the
 * space-joined tokenized form (empty when the identifier produces no
 * additional tokens).
 */
function tokenizeIdentifier(name: string): string {
  const parts = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[_\s]+/)
    .filter((p) => p.length > 0);
  const lowered = parts.map((p) => p.toLowerCase());
  // De-dupe while keeping deterministic order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of lowered) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.join(" ");
}


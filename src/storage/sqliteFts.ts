/**
 * Helper for declaring SQLite FTS5 contentless-shadow tables and the
 * INSERT / UPDATE / DELETE triggers that keep the index synchronized with
 * the content table. Consolidates schema previously duplicated across
 * MemoryStore, EpisodicMemory, and ChatHistoryStore.
 */

import type Database from "better-sqlite3";

export interface FtsTableConfig {
  /** Name of the FTS5 virtual table (e.g. "memories_fts"). */
  readonly ftsTable: string;
  /** Name of the backing content table (e.g. "memories"). */
  readonly contentTable: string;
  /** Indexed columns from the content table. */
  readonly columns: readonly string[];
  /**
   * Optional prefix for trigger names. Defaults to the FTS table name.
   * Allows callers that already chose specific trigger names (e.g. with
   * `messages_fts_` prefix) to keep them stable across migrations.
   */
  readonly triggerPrefix?: string;
}

/**
 * Emit the DDL for an FTS5 contentless-shadow table and its INSERT, DELETE,
 * and UPDATE triggers. All three triggers are emitted so updates correctly
 * remove the stale FTS row before inserting the replacement (review #3).
 */
export function createFtsTableAndTriggers(
  db: Database.Database,
  config: FtsTableConfig,
): void {
  const { ftsTable, contentTable, columns } = config;
  const prefix = config.triggerPrefix ?? ftsTable;
  const colList = columns.join(", ");
  const newCols = columns.map((c) => `new.${c}`).join(", ");
  const oldCols = columns.map((c) => `old.${c}`).join(", ");

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${ftsTable} USING fts5(
      ${colList}, content=${contentTable}, content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS ${prefix}_ai AFTER INSERT ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(rowid, ${colList}) VALUES (new.rowid, ${newCols});
    END;

    CREATE TRIGGER IF NOT EXISTS ${prefix}_ad AFTER DELETE ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${colList})
      VALUES ('delete', old.rowid, ${oldCols});
    END;

    CREATE TRIGGER IF NOT EXISTS ${prefix}_au AFTER UPDATE ON ${contentTable} BEGIN
      INSERT INTO ${ftsTable}(${ftsTable}, rowid, ${colList})
      VALUES ('delete', old.rowid, ${oldCols});
      INSERT INTO ${ftsTable}(rowid, ${colList}) VALUES (new.rowid, ${newCols});
    END;
  `);
}

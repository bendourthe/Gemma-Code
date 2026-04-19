import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Message, ConversationSession, Role } from "../chat/types.js";
import { escapeLikePattern } from "./likeEscape.js";
import { secureDbPermissions } from "./dbPermissions.js";
import { sanitizeFtsQuery } from "./embeddingUtils.js";
import { createFtsTableAndTriggers } from "./sqliteFts.js";

interface SessionRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

// Schema version persisted via PRAGMA user_version. Bump when the schema or
// FTS configuration changes so the next cold start rebuilds the FTS index
// exactly once. Rebuilds on an unchanged DB are now a no-op.
const SCHEMA_VERSION = 1;

/** Default cap on rows returned by searchSessions -- see 4.6. */
const DEFAULT_SEARCH_LIMIT = 100;

interface MessageRow {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export class ChatHistoryStore {
  private readonly _db: Database.Database;

  constructor(dbPath: string) {
    this._db = new Database(dbPath);
    secureDbPermissions(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    this._initSchema();
  }

  private _initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
    `);

    createFtsTableAndTriggers(this._db, {
      ftsTable: "messages_fts",
      contentTable: "messages",
      columns: ["content"],
      triggerPrefix: "messages_fts",
    });

    // Rebuild the FTS index only when the schema version changed. On a hot DB
    // this used to iterate every row on every cold start (review finding
    // #66); now it runs once per schema bump.
    const currentVersion = this._db.pragma("user_version", {
      simple: true,
    }) as number;
    if (currentVersion !== SCHEMA_VERSION) {
      try {
        this._db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
      } catch {
        // Ignore rebuild errors on first creation.
      }
      this._db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  }

  createSession(title: string): ConversationSession {
    const id = randomUUID();
    const now = Date.now();
    this._db
      .prepare(
        "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(id, title, now, now);
    return { id, title, messages: [], createdAt: now, updatedAt: now };
  }

  saveMessage(sessionId: string, message: Message): void {
    // Use explicit UPDATE-or-INSERT so the FTS5 AFTER UPDATE trigger fires on
    // re-saves. INSERT OR REPLACE bypasses DELETE/UPDATE triggers in SQLite,
    // which left the FTS index stale on edits (review finding #3).
    const existing = this._db
      .prepare("SELECT id FROM messages WHERE id = ?")
      .get(message.id) as { id: string } | undefined;
    if (existing) {
      this._db
        .prepare(
          "UPDATE messages SET session_id = ?, role = ?, content = ?, timestamp = ? WHERE id = ?"
        )
        .run(sessionId, message.role, message.content, message.timestamp, message.id);
    } else {
      this._db
        .prepare(
          "INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)"
        )
        .run(message.id, sessionId, message.role, message.content, message.timestamp);
    }
    this._db
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(Date.now(), sessionId);
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this._db
      .prepare("UPDATE sessions SET title = ? WHERE id = ?")
      .run(title, sessionId);
  }

  getSession(sessionId: string): ConversationSession | null {
    const row = this._db
      .prepare(
        "SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?"
      )
      .get(sessionId) as SessionRow | undefined;

    if (!row) return null;

    const msgRows = this._db
      .prepare(
        "SELECT id, role, content, timestamp FROM messages WHERE session_id = ? ORDER BY timestamp ASC"
      )
      .all(sessionId) as MessageRow[];

    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: msgRows.map((m) => ({
        id: m.id,
        role: m.role as Role,
        content: m.content,
        timestamp: m.timestamp,
      })),
    };
  }

  listSessions(limit = 50): ConversationSession[] {
    const rows = this._db
      .prepare(
        "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ?"
      )
      .all(limit) as SessionRow[];

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messages: [],
    }));
  }

  deleteSession(sessionId: string): void {
    this._db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  searchSessions(query: string, limit = DEFAULT_SEARCH_LIMIT): ConversationSession[] {
    // Prefer FTS5 (indexed, milliseconds on 10k rows). Falls back to the
    // legacy LIKE join if the FTS query is unusable (empty after sanitize,
    // or FTS5 not available on the running SQLite build).
    const ftsQuery = sanitizeFtsQuery(query);
    if (ftsQuery) {
      try {
        const rows = this._db
          .prepare(
            `SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at
             FROM sessions s
             JOIN messages m ON m.session_id = s.id
             JOIN messages_fts fts ON m.rowid = fts.rowid
             WHERE messages_fts MATCH ?
             ORDER BY s.updated_at DESC
             LIMIT ?`,
          )
          .all(ftsQuery, limit) as SessionRow[];
        return rows.map((r) => ({
          id: r.id,
          title: r.title,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          messages: [],
        }));
      } catch {
        // FTS5 unavailable -- fall through to LIKE.
      }
    }

    const likeQuery = `%${escapeLikePattern(query)}%`;
    const rows = this._db
      .prepare(
        `SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at
         FROM sessions s
         JOIN messages m ON m.session_id = s.id
         WHERE m.content LIKE ? ESCAPE '\\'
         ORDER BY s.updated_at DESC
         LIMIT ?`
      )
      .all(likeQuery, limit) as SessionRow[];

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messages: [],
    }));
  }

  /**
   * Full-text search across messages using FTS5 with BM25 ranking.
   * Falls back to LIKE search if the FTS5 query fails.
   */
  searchFts(
    query: string,
    limit = 20,
  ): Array<{ messageId: string; sessionId: string; content: string; rank: number }> {
    // Sanitize: quote each word to prevent FTS5 syntax errors.
    const ftsQuery = sanitizeFtsQuery(query);
    if (!ftsQuery) return [];

    try {
      const rows = this._db
        .prepare(
          `SELECT m.id, m.session_id, m.content, fts.rank
           FROM messages_fts fts
           JOIN messages m ON m.rowid = fts.rowid
           WHERE messages_fts MATCH ?
           ORDER BY fts.rank
           LIMIT ?`,
        )
        .all(ftsQuery, limit) as Array<{
        id: string;
        session_id: string;
        content: string;
        rank: number;
      }>;

      return rows.map((r) => ({
        messageId: r.id,
        sessionId: r.session_id,
        content: r.content,
        rank: r.rank,
      }));
    } catch {
      // Fallback to LIKE search.
      const likeQuery = `%${query}%`;
      const rows = this._db
        .prepare(
          `SELECT id, session_id, content FROM messages WHERE content LIKE ? LIMIT ?`,
        )
        .all(likeQuery, limit) as Array<{
        id: string;
        session_id: string;
        content: string;
      }>;

      return rows.map((r) => ({
        messageId: r.id,
        sessionId: r.session_id,
        content: r.content,
        rank: 0,
      }));
    }
  }

  close(): void {
    this._db.close();
  }
}

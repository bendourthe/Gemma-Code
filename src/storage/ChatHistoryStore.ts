import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Message, ConversationSession, Role } from "../chat/types.js";

interface SessionRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

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

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content, content=messages, content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;
    `);

    // Rebuild FTS index from existing data (safe no-op if already up-to-date).
    try {
      this._db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
    } catch {
      // Ignore rebuild errors on first creation.
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
    this._db
      .prepare(
        "INSERT OR REPLACE INTO messages (id, session_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)"
      )
      .run(message.id, sessionId, message.role, message.content, message.timestamp);
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

  searchSessions(query: string): ConversationSession[] {
    const likeQuery = `%${query}%`;
    const rows = this._db
      .prepare(
        `SELECT DISTINCT s.id, s.title, s.created_at, s.updated_at
         FROM sessions s
         JOIN messages m ON m.session_id = s.id
         WHERE m.content LIKE ?
         ORDER BY s.updated_at DESC`
      )
      .all(likeQuery) as SessionRow[];

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
    const words = query
      .replace(/[*"(){}[\]^~]/g, "")
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return [];
    const ftsQuery = words.map((w) => `"${w}"`).join(" ");

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

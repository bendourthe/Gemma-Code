import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { EpisodicEntry, MemoryProvenance } from "./MemoryLayers.types.js";
import type { EmbeddingClient } from "./EmbeddingClient.js";

const CHARS_PER_TOKEN = 4;

/**
 * Layer 2: session-level episodic memory.
 *
 * Records significant events (tool executions, decisions, errors, discoveries)
 * as structured JSONL entries with provenance. Backed by SQLite with FTS5
 * keyword search and optional embedding-based semantic search.
 */
export class EpisodicMemory {
  private readonly _db: Database.Database;
  private readonly _embedder: EmbeddingClient | null;

  constructor(dbPath: string, embedder?: EmbeddingClient | null) {
    this._db = new Database(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._embedder = embedder ?? null;
    this._initSchema();
  }

  private _initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_events (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT UNIQUE NOT NULL,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        context TEXT NOT NULL,
        outcome TEXT,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        source_session_id TEXT,
        source_message_id TEXT,
        confidence REAL DEFAULT 1.0,
        tags TEXT,
        embedding BLOB
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
        action, context, outcome, content=episodic_events, content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS episodic_ai AFTER INSERT ON episodic_events BEGIN
        INSERT INTO episodic_fts(rowid, action, context, outcome)
        VALUES (new.rowid, new.action, new.context, new.outcome);
      END;

      CREATE TRIGGER IF NOT EXISTS episodic_ad AFTER DELETE ON episodic_events BEGIN
        INSERT INTO episodic_fts(episodic_fts, rowid, action, context, outcome)
        VALUES ('delete', old.rowid, old.action, old.context, old.outcome);
      END;

      CREATE TRIGGER IF NOT EXISTS episodic_au AFTER UPDATE ON episodic_events BEGIN
        INSERT INTO episodic_fts(episodic_fts, rowid, action, context, outcome)
        VALUES ('delete', old.rowid, old.action, old.context, old.outcome);
        INSERT INTO episodic_fts(rowid, action, context, outcome)
        VALUES (new.rowid, new.action, new.context, new.outcome);
      END;
    `);
  }

  /** Record a new episodic event. Computes embedding if embedder is available. */
  async record(
    event: Omit<EpisodicEntry, "id">,
  ): Promise<EpisodicEntry> {
    const id = randomUUID();

    let embeddingBuf: Buffer | null = null;
    if (this._embedder) {
      const textForEmbedding = `${event.action} ${event.context} ${event.outcome ?? ""}`.trim();
      const vec = await this._embedder.embed(textForEmbedding);
      if (vec) {
        embeddingBuf = Buffer.from(new Float64Array(vec).buffer);
      }
    }

    this._db
      .prepare(
        `INSERT INTO episodic_events
         (id, session_id, action, context, outcome, timestamp, source, source_session_id, source_message_id, confidence, tags, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        event.sessionId,
        event.action,
        event.context,
        event.outcome ?? null,
        event.timestamp,
        event.provenance.source,
        event.provenance.sourceSessionId ?? null,
        event.provenance.sourceMessageId ?? null,
        event.provenance.confidence,
        JSON.stringify(event.tags),
        embeddingBuf,
      );

    return { id, ...event };
  }

  /** Keyword search using FTS5 BM25 ranking. */
  searchKeyword(query: string, limit = 10): EpisodicEntry[] {
    const sanitized = this._sanitizeFtsQuery(query);
    if (!sanitized) return [];

    try {
      const rows = this._db
        .prepare(
          `SELECT e.*
           FROM episodic_fts fts
           JOIN episodic_events e ON e.rowid = fts.rowid
           WHERE episodic_fts MATCH ?
           ORDER BY fts.rank
           LIMIT ?`,
        )
        .all(sanitized, limit) as EpisodicRow[];

      return rows.map((r) => this._rowToEntry(r));
    } catch {
      return [];
    }
  }

  /** Semantic search using embedding cosine similarity. */
  async searchSemantic(query: string, limit = 10): Promise<EpisodicEntry[]> {
    if (!this._embedder) return [];

    const queryVec = await this._embedder.embed(query);
    if (!queryVec) return [];

    const rows = this._db
      .prepare("SELECT * FROM episodic_events WHERE embedding IS NOT NULL")
      .all() as EpisodicRow[];

    if (rows.length === 0) return [];

    const scored = rows
      .map((r) => ({
        row: r,
        similarity: this._cosineSimilarity(queryVec, this._deserializeEmbedding(r.embedding!)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map((s) => this._rowToEntry(s.row));
  }

  /**
   * Retrieve episodic events relevant to a query, formatted as a string
   * packed within the token budget.
   */
  async retrieve(query: string, tokenBudget: number): Promise<string> {
    if (!query) return "";

    const keywordResults = this.searchKeyword(query, 20);
    const semanticResults = await this.searchSemantic(query, 20);

    // Merge and deduplicate.
    const seen = new Set<string>();
    const merged: EpisodicEntry[] = [];
    for (const entry of [...keywordResults, ...semanticResults]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        merged.push(entry);
      }
    }

    if (merged.length === 0) return "";

    const header = "## Past Experiences\n\n";
    let usedTokens = header.length / CHARS_PER_TOKEN;
    const lines: string[] = [];

    for (const entry of merged) {
      const outcomeStr = entry.outcome ? ` -> ${entry.outcome}` : "";
      const line = `- [${entry.action}] ${entry.context}${outcomeStr} (confidence: ${entry.provenance.confidence.toFixed(1)})`;
      const lineTokens = line.length / CHARS_PER_TOKEN;
      if (usedTokens + lineTokens > tokenBudget) break;
      lines.push(line);
      usedTokens += lineTokens;
    }

    if (lines.length === 0) return "";
    return header + lines.join("\n");
  }

  /** Get all events for a specific session, ordered by timestamp. */
  getSessionEvents(sessionId: string): EpisodicEntry[] {
    const rows = this._db
      .prepare(
        "SELECT * FROM episodic_events WHERE session_id = ? ORDER BY timestamp ASC",
      )
      .all(sessionId) as EpisodicRow[];

    return rows.map((r) => this._rowToEntry(r));
  }

  /** Remove oldest entries exceeding the limit. */
  prune(maxEntries: number): number {
    const countRow = this._db
      .prepare("SELECT COUNT(*) as count FROM episodic_events")
      .get() as { count: number };
    const excess = countRow.count - maxEntries;
    if (excess <= 0) return 0;

    const result = this._db
      .prepare(
        `DELETE FROM episodic_events WHERE rowid IN (
          SELECT rowid FROM episodic_events
          ORDER BY timestamp ASC
          LIMIT ?
        )`,
      )
      .run(excess);

    return result.changes;
  }

  close(): void {
    this._db.close();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private _rowToEntry(row: EpisodicRow): EpisodicEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      action: row.action,
      context: row.context,
      outcome: row.outcome,
      timestamp: row.timestamp,
      provenance: {
        source: row.source as MemoryProvenance["source"],
        sourceSessionId: row.source_session_id,
        sourceMessageId: row.source_message_id,
        timestamp: row.timestamp,
        confidence: row.confidence,
      },
      tags: row.tags ? JSON.parse(row.tags) : [],
    };
  }

  private _deserializeEmbedding(buf: Buffer): number[] {
    const arr = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
    return Array.from(arr);
  }

  private _cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private _sanitizeFtsQuery(query: string): string {
    const cleaned = query
      .replace(/[*"(){}[\]^~]/g, "")
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, "")
      .trim();
    if (!cleaned) return "";
    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.map((w) => `"${w}"`).join(" ");
  }
}

// -------------------------------------------------------------------------
// Event recording helpers
// -------------------------------------------------------------------------

/** Create an episodic entry from a tool execution result. */
export async function recordToolEvent(
  episodicMemory: EpisodicMemory,
  sessionId: string,
  toolName: string,
  parameters: Record<string, unknown>,
  result: { success: boolean; output?: string; error?: string },
  contextDescription: string,
): Promise<EpisodicEntry> {
  const keyParams = Object.entries(parameters)
    .filter(([k]) => k !== "_callId")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v.slice(0, 50) : String(v)}`)
    .join(", ");

  const action = `${toolName}(${keyParams})`;
  const outcome = result.success
    ? (result.output ?? "").slice(0, 200)
    : (result.error ?? "unknown error").slice(0, 200);

  return episodicMemory.record({
    sessionId,
    action,
    context: contextDescription,
    outcome,
    timestamp: Date.now(),
    provenance: {
      source: "tool_verified",
      sourceSessionId: sessionId,
      sourceMessageId: null,
      timestamp: Date.now(),
      confidence: result.success ? 0.9 : 0.5,
    },
    tags: [toolName],
  });
}

/** Create an episodic entry for an architectural decision. */
export async function recordDecisionEvent(
  episodicMemory: EpisodicMemory,
  sessionId: string,
  decision: string,
  rationale: string,
): Promise<EpisodicEntry> {
  return episodicMemory.record({
    sessionId,
    action: `decision: ${decision}`,
    context: rationale,
    outcome: null,
    timestamp: Date.now(),
    provenance: {
      source: "llm_extracted",
      sourceSessionId: sessionId,
      sourceMessageId: null,
      timestamp: Date.now(),
      confidence: 0.7,
    },
    tags: ["decision"],
  });
}

// -------------------------------------------------------------------------
// Internal row type
// -------------------------------------------------------------------------

interface EpisodicRow {
  rowid: number;
  id: string;
  session_id: string;
  action: string;
  context: string;
  outcome: string | null;
  timestamp: number;
  source: string;
  source_session_id: string | null;
  source_message_id: string | null;
  confidence: number;
  tags: string | null;
  embedding: Buffer | null;
}

import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Message } from "../chat/types.js";
import type {
  MemoryEntry,
  MemoryType,
  MemorySearchResult,
  MemoryStats,
} from "./MemoryStore.types.js";
import type { EmbeddingClient } from "./EmbeddingClient.js";

const CHARS_PER_TOKEN = 4;

/** All valid memory type values, used for stats initialization. */
const MEMORY_TYPES: readonly MemoryType[] = [
  "decision",
  "fact",
  "preference",
  "file_pattern",
  "error_resolution",
];

/**
 * Persistent cross-session memory backed by SQLite with FTS5 keyword search
 * and optional Ollama-generated embeddings for semantic search.
 */
export class MemoryStore {
  private readonly _db: Database.Database;
  private readonly _embedder: EmbeddingClient | null;

  constructor(dbPath: string, embedder?: EmbeddingClient | null) {
    this._db = new Database(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._embedder = embedder ?? null;
    this._initSchema();
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  private _initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
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

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, content=memories, content_rowid=rowid
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
  }

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  /** Save a memory entry. Computes embedding asynchronously if embedder is available. */
  async save(
    content: string,
    type: MemoryType,
    sessionId?: string,
  ): Promise<MemoryEntry> {
    const id = randomUUID();
    const now = Date.now();

    let embeddingBuf: Buffer | null = null;
    if (this._embedder) {
      const vec = await this._embedder.embed(content);
      if (vec) {
        embeddingBuf = Buffer.from(new Float64Array(vec).buffer);
      }
    }

    this._db
      .prepare(
        `INSERT INTO memories (id, session_id, content, type, embedding, created_at, accessed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId ?? null, content, type, embeddingBuf, now, now);

    return {
      id,
      sessionId: sessionId ?? null,
      content,
      type,
      embedding: embeddingBuf ? this._deserializeEmbedding(embeddingBuf) : null,
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
      relevanceDecay: 1.0,
    };
  }

  // ---------------------------------------------------------------------------
  // Keyword search (FTS5)
  // ---------------------------------------------------------------------------

  /** Search memories using FTS5 keyword matching with BM25 ranking. */
  searchKeyword(query: string, limit = 10): MemorySearchResult[] {
    const sanitized = this._sanitizeFtsQuery(query);
    if (!sanitized) return [];

    try {
      const rows = this._db
        .prepare(
          `SELECT m.*, fts.rank
           FROM memories_fts fts
           JOIN memories m ON m.rowid = fts.rowid
           WHERE memories_fts MATCH ?
           ORDER BY fts.rank
           LIMIT ?`,
        )
        .all(sanitized, limit) as MemoryRow[];

      if (rows.length === 0) return [];

      // Update access metadata for returned entries.
      const now = Date.now();
      const update = this._db.prepare(
        "UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
      );
      const updateMany = this._db.transaction((ids: string[]) => {
        for (const id of ids) update.run(now, id);
      });
      updateMany(rows.map((r) => r.id));

      // Normalize BM25 rank to 0..1 (rank is negative; more negative = more relevant).
      const lastRow = rows[rows.length - 1];
      const firstRow = rows[0];
      if (!lastRow || !firstRow) return [];
      const minRank = lastRow.rank;
      const maxRank = firstRow.rank;
      const range = maxRank - minRank || 1;

      return rows.map((r) => ({
        entry: this._rowToEntry(r),
        score: 1 - (r.rank - minRank) / range,
        matchSource: "keyword" as const,
      }));
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Semantic search (cosine similarity)
  // ---------------------------------------------------------------------------

  /** Search memories using embedding cosine similarity. Returns empty if embedder unavailable. */
  async searchSemantic(query: string, limit = 10): Promise<MemorySearchResult[]> {
    if (!this._embedder) return [];

    const queryVec = await this._embedder.embed(query);
    if (!queryVec) return [];

    const rows = this._db
      .prepare("SELECT * FROM memories WHERE embedding IS NOT NULL")
      .all() as MemoryRow[];

    if (rows.length === 0) return [];

    const scored = rows
      .map((r) => ({
        row: r,
        similarity: this._cosineSimilarity(queryVec, this._deserializeEmbedding(r.embedding!)),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    // Update access metadata.
    const now = Date.now();
    const update = this._db.prepare(
      "UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
    );
    const updateMany = this._db.transaction((ids: string[]) => {
      for (const id of ids) update.run(now, id);
    });
    updateMany(scored.map((s) => s.row.id));

    return scored.map((s) => ({
      entry: this._rowToEntry(s.row),
      score: Math.max(0, s.similarity),
      matchSource: "semantic" as const,
    }));
  }

  // ---------------------------------------------------------------------------
  // Unified retrieval
  // ---------------------------------------------------------------------------

  /**
   * Retrieve memories relevant to a query, packed within a token budget.
   * Returns a formatted string ready for injection into PromptContext.memoryContext.
   */
  async retrieve(query: string, tokenBudget: number): Promise<string> {
    if (!query) return "";

    const keywordResults = this.searchKeyword(query, 20);
    const semanticResults = await this.searchSemantic(query, 20);

    // Merge and deduplicate.
    const merged = new Map<string, MemorySearchResult>();

    for (const r of keywordResults) {
      merged.set(r.entry.id, r);
    }
    for (const r of semanticResults) {
      const existing = merged.get(r.entry.id);
      if (existing) {
        merged.set(r.entry.id, {
          entry: r.entry,
          score: 0.6 * existing.score + 0.4 * r.score,
          matchSource: "both",
        });
      } else {
        merged.set(r.entry.id, r);
      }
    }

    if (merged.size === 0) return "";

    // Sort by score descending.
    const sorted = [...merged.values()].sort((a, b) => b.score - a.score);

    // Token-budget packing.
    const header = "## Recalled Memories\n\n";
    let usedTokens = header.length / CHARS_PER_TOKEN;
    const lines: string[] = [];

    for (const r of sorted) {
      const date = new Date(r.entry.createdAt).toLocaleDateString();
      const line = `- [${r.entry.type}] ${r.entry.content} (from ${date})`;
      const lineTokens = line.length / CHARS_PER_TOKEN;
      if (usedTokens + lineTokens > tokenBudget) break;
      lines.push(line);
      usedTokens += lineTokens;
    }

    if (lines.length === 0) return "";
    return header + lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Auto-extraction from conversation
  // ---------------------------------------------------------------------------

  /** Heuristic extraction of memorable content from messages about to be compacted. */
  async extractAndSave(
    messages: readonly Message[],
    sessionId?: string,
  ): Promise<number> {
    let saved = 0;

    for (const msg of messages) {
      if (msg.role === "system") continue;

      const extractions = this._extractPatterns(msg.content, msg.role);
      for (const { content, type } of extractions) {
        if (this._isDuplicate(content)) continue;
        await this.save(content, type, sessionId);
        saved++;
      }
    }

    return saved;
  }

  /** Pattern-based extraction of memorable content from a single message. */
  private _extractPatterns(
    text: string,
    role: string,
  ): Array<{ content: string; type: MemoryType }> {
    const results: Array<{ content: string; type: MemoryType }> = [];
    const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter((s) => s.length > 10);

    for (const sentence of sentences) {
      const lower = sentence.toLowerCase();

      // Decisions
      if (
        /\b(decided to|going with|chose|let's use|we should use|switched to|opting for)\b/i.test(sentence)
      ) {
        results.push({ content: sentence, type: "decision" });
        continue;
      }

      // Preferences
      if (
        /\b(prefer|always use|never use|style guide|convention|i like to|i want)\b/i.test(sentence)
      ) {
        results.push({ content: sentence, type: "preference" });
        continue;
      }

      // Error resolutions (assistant messages containing fix language)
      if (
        role === "assistant" &&
        /\b(fix|solution|resolved|workaround|the issue was|the problem was)\b/i.test(sentence) &&
        /\b(error|exception|failed|broken|crash|bug)\b/i.test(lower)
      ) {
        results.push({ content: sentence, type: "error_resolution" });
        continue;
      }

      // Facts (user messages stating project facts)
      if (
        role === "user" &&
        /\b(the api is|our database|we use|the backend|the server|runs on port|is located at)\b/i.test(sentence)
      ) {
        results.push({ content: sentence, type: "fact" });
        continue;
      }

      // File patterns
      if (
        /\b(test files|source files|directory structure|naming convention|file pattern)\b/i.test(sentence) &&
        /[/\\]/.test(sentence)
      ) {
        results.push({ content: sentence, type: "file_pattern" });
      }
    }

    return results;
  }

  /** Check if a memory with very similar content already exists. */
  private _isDuplicate(content: string): boolean {
    // Pick the most distinctive words (longest, most likely to be unique).
    const words = content
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .sort((a, b) => b.length - a.length)
      .slice(0, 3);
    if (words.length === 0) return false;

    // Use OR logic so any matching word triggers dedup.
    const sanitized = words
      .map((w) => w.replace(/[*"(){}[\]^~]/g, ""))
      .filter(Boolean)
      .map((w) => `"${w}"`)
      .join(" OR ");
    if (!sanitized) return false;

    try {
      const row = this._db
        .prepare(
          `SELECT COUNT(*) as count FROM memories_fts WHERE memories_fts MATCH ?`,
        )
        .get(sanitized) as { count: number } | undefined;
      return (row?.count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Prune
  // ---------------------------------------------------------------------------

  /** Remove lowest-relevance entries to keep the store under maxEntries. */
  prune(maxEntries: number): number {
    const countRow = this._db.prepare("SELECT COUNT(*) as count FROM memories").get() as {
      count: number;
    };
    const excess = countRow.count - maxEntries;
    if (excess <= 0) return 0;

    const result = this._db
      .prepare(
        `DELETE FROM memories WHERE rowid IN (
          SELECT rowid FROM memories
          ORDER BY (access_count * relevance_decay) ASC, accessed_at ASC
          LIMIT ?
        )`,
      )
      .run(excess);

    return result.changes;
  }

  // ---------------------------------------------------------------------------
  // Clear / Stats / Close
  // ---------------------------------------------------------------------------

  /** Delete all memories. */
  clear(): void {
    this._db.exec("DELETE FROM memories");
  }

  /** Return aggregate statistics about the memory store. */
  getStats(): MemoryStats {
    const countRow = this._db
      .prepare("SELECT COUNT(*) as total FROM memories")
      .get() as { total: number };

    const typeRows = this._db
      .prepare("SELECT type, COUNT(*) as count FROM memories GROUP BY type")
      .all() as Array<{ type: MemoryType; count: number }>;

    const byType = Object.fromEntries(
      MEMORY_TYPES.map((t) => [t, 0]),
    ) as Record<MemoryType, number>;
    for (const row of typeRows) {
      byType[row.type] = row.count;
    }

    const dateRow = this._db
      .prepare("SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories")
      .get() as { oldest: number | null; newest: number | null };

    const embedRow = this._db
      .prepare("SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL")
      .get() as { count: number };

    return {
      totalEntries: countRow.total,
      byType,
      oldestEntryAt: dateRow.oldest,
      newestEntryAt: dateRow.newest,
      embeddingCount: embedRow.count,
    };
  }

  /** Close the database connection. */
  close(): void {
    this._db.close();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _rowToEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      sessionId: row.session_id,
      content: row.content,
      type: row.type as MemoryType,
      embedding: row.embedding ? this._deserializeEmbedding(row.embedding) : null,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
      relevanceDecay: row.relevance_decay,
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

  /** Sanitize a query string for FTS5 MATCH by quoting it. */
  private _sanitizeFtsQuery(query: string): string {
    // Remove FTS5 operators and special characters, then wrap remaining words in quotes.
    const cleaned = query
      .replace(/[*"(){}[\]^~]/g, "")
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, "")
      .trim();
    if (!cleaned) return "";
    // Quote each word individually for exact matching.
    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.map((w) => `"${w}"`).join(" ");
  }
}

// ---------------------------------------------------------------------------
// Internal row type
// ---------------------------------------------------------------------------

interface MemoryRow {
  rowid: number;
  id: string;
  session_id: string | null;
  content: string;
  type: string;
  embedding: Buffer | null;
  created_at: number;
  accessed_at: number;
  access_count: number;
  relevance_decay: number;
  rank: number;
}

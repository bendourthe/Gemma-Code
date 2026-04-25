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
import type { MemoryProvenance, MemoryTTL } from "./MemoryLayers.types.js";
import type { GraphQueryEngine } from "./GraphQueryEngine.js";
import { secureDbPermissions } from "./dbPermissions.js";
import { getLogger } from "../utils/logger.js";
import { formatForLog } from "../utils/errors.js";
import {
  cosineSimilarity,
  deserializeEmbedding,
  serializeEmbedding,
  sanitizeFtsQuery,
} from "./embeddingUtils.js";
import { createFtsTableAndTriggers } from "./sqliteFts.js";

const CHARS_PER_TOKEN = 4;

/**
 * Schema version persisted via PRAGMA user_version. Bump when the memories
 * table layout changes; the constructor runs the migration block to bring
 * an older DB up to the current version. Idempotent.
 */
const MEMORY_SCHEMA_VERSION = 2;

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
/**
 * Candidate pool size for FTS5-pre-filtered semantic search. The embedding
 * cosine scorer only runs over this many rows, bounding latency at O(N).
 */
const SEMANTIC_CANDIDATE_LIMIT = 200;

export class MemoryStore {
  private readonly _db: Database.Database;
  private readonly _embedder: EmbeddingClient | null;
  /** True when this instance opened its own Database and must close it. */
  private readonly _ownsDb: boolean;
  private _graphEngine: GraphQueryEngine | null = null;
  /** id -> deserialized Float32 vector. Invalidated on save/delete/prune/clear. */
  private readonly _embeddingCache = new Map<string, Float32Array>();

  /**
   * Construct a MemoryStore backed either by a path (self-opens and owns the
   * connection) or an existing Database (caller owns the connection -- used
   * by MemorySubsystem for connection sharing, see finding #65).
   */
  constructor(dbOrPath: string | Database.Database, embedder?: EmbeddingClient | null) {
    if (typeof dbOrPath === "string") {
      this._db = new Database(dbOrPath);
      secureDbPermissions(dbOrPath);
      this._db.pragma("journal_mode = WAL");
      this._ownsDb = true;
    } else {
      this._db = dbOrPath;
      this._ownsDb = false;
    }
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
        relevance_decay REAL DEFAULT 1.0,
        corroboration_count INTEGER NOT NULL DEFAULT 1
      );
    `);

    this._runMigrations();

    createFtsTableAndTriggers(this._db, {
      ftsTable: "memories_fts",
      contentTable: "memories",
      columns: ["content"],
    });
  }

  /**
   * Apply schema migrations idempotently. Older DBs created before
   * `corroboration_count` was introduced are upgraded in place; freshly
   * created tables already have the column and the ADD COLUMN is skipped.
   */
  private _runMigrations(): void {
    const currentVersion = this._db.pragma("user_version", {
      simple: true,
    }) as number;

    if (currentVersion >= MEMORY_SCHEMA_VERSION) return;

    // v0.5.0 Phase 7: add corroboration_count for the N-corroboration rule.
    if (currentVersion < 2) {
      const cols = this._db
        .prepare(`PRAGMA table_info(memories)`)
        .all() as Array<{ name: string }>;
      const hasCorroboration = cols.some((c) => c.name === "corroboration_count");
      if (!hasCorroboration) {
        this._db.exec(
          `ALTER TABLE memories ADD COLUMN corroboration_count INTEGER NOT NULL DEFAULT 1`,
        );
      }
      this._db.exec(
        `UPDATE memories SET corroboration_count = 1
         WHERE corroboration_count IS NULL OR corroboration_count = 0`,
      );
    }

    this._db.pragma(`user_version = ${MEMORY_SCHEMA_VERSION}`);
  }

  /** Inject a graph query engine for graph-augmented retrieval. */
  setGraphEngine(engine: GraphQueryEngine | null): void {
    this._graphEngine = engine;
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
        embeddingBuf = serializeEmbedding(vec);
      }
    }

    this._db
      .prepare(
        `INSERT INTO memories (id, session_id, content, type, embedding, created_at, accessed_at, corroboration_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(id, sessionId ?? null, content, type, embeddingBuf, now, now);
    this._invalidateEmbeddingCache(id);

    return {
      id,
      sessionId: sessionId ?? null,
      content,
      type,
      embedding: embeddingBuf ? deserializeEmbedding(embeddingBuf) : null,
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
      relevanceDecay: 1.0,
      corroborationCount: 1,
    };
  }

  /**
   * Save a memory entry with full provenance and TTL metadata.
   * Used by the consolidation pipeline for promoted memories.
   */
  async saveWithProvenance(
    content: string,
    type: MemoryType,
    provenance: MemoryProvenance,
    ttl?: MemoryTTL,
    scope?: "global" | "project" | "session",
    sessionId?: string,
  ): Promise<MemoryEntry> {
    const entry = await this.save(content, type, sessionId);
    // The provenance, ttl, and scope are returned as part of the entry
    // for consumers that need them (the base table columns are not yet
    // altered, so they are carried in-memory only).
    return {
      ...entry,
      provenance,
      ttl,
      scope,
    };
  }

  // ---------------------------------------------------------------------------
  // Keyword search (FTS5)
  // ---------------------------------------------------------------------------

  /** Search memories using FTS5 keyword matching with BM25 ranking. */
  searchKeyword(query: string, limit = 10): MemorySearchResult[] {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    try {
      // Order by FTS rank first, then by corroboration_count DESC so
      // fact-tier rows surface above candidate-tier rows when ranks tie.
      const rows = this._db
        .prepare(
          `SELECT m.*, fts.rank
           FROM memories_fts fts
           JOIN memories m ON m.rowid = fts.rowid
           WHERE memories_fts MATCH ?
           ORDER BY fts.rank, m.corroboration_count DESC
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
    } catch (err) {
      getLogger().debug(
        "[MemoryStore] searchKeyword FTS5 query failed:",
        formatForLog(err),
      );
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
    const queryVec32 = Float32Array.from(queryVec);

    // Pre-filter candidates via FTS5 so we don't scan the full embeddings table.
    // If the query has no FTS tokens (e.g., pure symbols) or the FTS query fails,
    // fall back to a bounded scan of the most recently accessed rows.
    const rows = this._getSemanticCandidates(query);
    if (rows.length === 0) return [];

    const scored = rows
      .map((r) => ({
        row: r,
        similarity: this._cosineSimilarity32(queryVec32, this._getCachedEmbedding(r)),
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
   *
   * `corroborationThreshold` tiers results into facts (count >= threshold)
   * and candidates (count < threshold). Fact-tier rows are preferred; the
   * candidate tier is only consulted when no fact-tier match is selected.
   * Default is 1, which preserves legacy behavior (every row is a fact).
   */
  async retrieve(
    query: string,
    tokenBudget: number,
    corroborationThreshold = 1,
  ): Promise<string> {
    if (!query) return "";

    const keywordResults = this.searchKeyword(query, 20);
    const semanticResults = await this.searchSemantic(query, 20);

    if (keywordResults.length === 0 && semanticResults.length === 0 && !this._graphEngine) {
      return "";
    }

    // Merge keyword + semantic into a single array, tracking seen ids via an
    // index map so we can blend scores for entries that matched both paths.
    // Avoids the previous Map<id, result> + `[...values()]` spread
    // (finding #70): one dense array, one small lookup Map, no re-allocation.
    const merged: MemorySearchResult[] = keywordResults.slice();
    const indexById = new Map<string, number>();
    for (let i = 0; i < merged.length; i++) {
      const m = merged[i];
      if (m) indexById.set(m.entry.id, i);
    }
    for (const r of semanticResults) {
      const existingIdx = indexById.get(r.entry.id);
      if (existingIdx !== undefined) {
        const existing = merged[existingIdx];
        if (existing) {
          merged[existingIdx] = {
            entry: r.entry,
            score: 0.6 * existing.score + 0.4 * r.score,
            matchSource: "both",
            corroborationTier: existing.corroborationTier,
          };
        }
      } else {
        indexById.set(r.entry.id, merged.length);
        merged.push(r);
      }
    }

    if (merged.length === 0 && !this._graphEngine) return "";

    // Annotate corroboration tier on each result.
    const annotated: MemorySearchResult[] = merged.map((r) => ({
      ...r,
      corroborationTier:
        r.entry.corroborationCount >= corroborationThreshold ? "fact" : "candidate",
    }));

    // Partition: facts always rank above candidates regardless of score; within
    // a tier sort by score descending.
    const facts = annotated.filter((r) => r.corroborationTier === "fact");
    const candidates = annotated.filter((r) => r.corroborationTier === "candidate");
    facts.sort((a, b) => b.score - a.score);
    candidates.sort((a, b) => b.score - a.score);
    // Candidates only fill the budget after every fact has been considered.
    const sorted: MemorySearchResult[] = [...facts, ...candidates];

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

    if (lines.length === 0 && !this._graphEngine) return "";

    let result = lines.length > 0 ? header + lines.join("\n") : "";

    // Append graph context if a graph engine is available (up to 25% of budget).
    if (this._graphEngine) {
      const graphBudget = Math.floor(tokenBudget * 0.25);
      const graphResult = this._graphEngine.queryContextFor(query, 10);
      const graphContext = this._graphEngine.formatAsContext(graphResult, graphBudget);
      if (graphContext) {
        result = result ? result + "\n\n" + graphContext : graphContext;
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Auto-extraction from conversation
  // ---------------------------------------------------------------------------

  /**
   * Heuristic extraction of memorable content from messages about to be
   * compacted. Batches the embedding calls and INSERTs into a single
   * transaction -- a 30-extraction compaction that used to issue 30 HTTP
   * embed calls now issues one (finding #67).
   */
  async extractAndSave(
    messages: readonly Message[],
    sessionId?: string,
  ): Promise<number> {
    // Gather extractions.
    const extractions: Array<{ content: string; type: MemoryType }> = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      for (const extraction of this._extractPatterns(msg.content, msg.role)) {
        extractions.push(extraction);
      }
    }
    if (extractions.length === 0) return 0;

    // Filter duplicates. `isDuplicate` runs a small FTS query per entry; the
    // extraction set is capped by message count so the N<<DB-size assumption
    // holds. Acceptable until a bulk version of isDuplicate is needed.
    const fresh = extractions.filter((e) => !this.isDuplicate(e.content));
    if (fresh.length === 0) return 0;

    // Embed all fresh extractions in a single batch request where possible.
    let embeddings: Array<number[] | null> = fresh.map(() => null);
    if (this._embedder) {
      embeddings = await this._embedder.embedBatch(fresh.map((e) => e.content));
    }

    // Bulk INSERT inside a transaction.
    const now = Date.now();
    const insertStmt = this._db.prepare(
      `INSERT INTO memories (id, session_id, content, type, embedding, created_at, accessed_at, corroboration_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    const tx = this._db.transaction(
      (rows: Array<{ id: string; content: string; type: MemoryType; buf: Buffer | null }>) => {
        for (const r of rows) {
          insertStmt.run(r.id, sessionId ?? null, r.content, r.type, r.buf, now, now);
        }
      },
    );
    const rows = fresh.map((e, i) => ({
      id: randomUUID(),
      content: e.content,
      type: e.type,
      buf: embeddings[i] ? serializeEmbedding(embeddings[i] as number[]) : null,
    }));
    tx(rows);

    return rows.length;
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
  isDuplicate(content: string): boolean {
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
    } catch (err) {
      getLogger().debug(
        "[MemoryStore] duplicate-check FTS5 query failed:",
        formatForLog(err),
      );
      return false;
    }
  }

  /**
   * Find an existing semantic memory entry that matches `content` either by
   * exact match or by Jaccard token-set similarity >= 0.9. Used by the
   * consolidator to attribute a new observation to an existing row before
   * deciding whether to insert a fresh candidate.
   *
   * Candidate pool: most recent 200 rows. The pool is bounded to keep this
   * O(K) regardless of total memory size; high-similarity matches surface
   * within the recency window in practice.
   */
  findMatchingEntry(content: string): MemoryEntry | null {
    if (!content) return null;
    const tokensA = this._tokenSet(content);
    if (tokensA.size === 0) return null;

    const candidates = this._db
      .prepare(
        `SELECT * FROM memories
         ORDER BY accessed_at DESC
         LIMIT 200`,
      )
      .all() as MemoryRow[];

    let best: { row: MemoryRow; sim: number } | null = null;
    for (const row of candidates) {
      if (row.content === content) {
        return this._rowToEntry(row);
      }
      const sim = this._jaccard(tokensA, this._tokenSet(row.content));
      if (sim >= 0.9 && (!best || sim > best.sim)) {
        best = { row, sim };
      }
    }
    return best ? this._rowToEntry(best.row) : null;
  }

  /**
   * Increment `corroboration_count` for a row by 1 and return the new count.
   * Returns null if the id does not exist.
   */
  incrementCorroboration(id: string): number | null {
    const result = this._db
      .prepare(
        `UPDATE memories
         SET corroboration_count = corroboration_count + 1, accessed_at = ?
         WHERE id = ?`,
      )
      .run(Date.now(), id);
    if (result.changes === 0) return null;
    const row = this._db
      .prepare("SELECT corroboration_count FROM memories WHERE id = ?")
      .get(id) as { corroboration_count: number } | undefined;
    return row?.corroboration_count ?? null;
  }

  /** Return all entries (no pagination). Intended for health-check use; bounded by `limit`. */
  listAll(limit = 1000): MemoryEntry[] {
    const rows = this._db
      .prepare(
        `SELECT * FROM memories
         ORDER BY accessed_at DESC
         LIMIT ?`,
      )
      .all(limit) as MemoryRow[];
    return rows.map((r) => this._rowToEntry(r));
  }

  /** Total row count for the memories table. */
  count(): number {
    const row = this._db
      .prepare("SELECT COUNT(*) as count FROM memories")
      .get() as { count: number };
    return row.count;
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

    // Cache is keyed by id and we don't know which ids were pruned without a
    // second query; clear wholesale. Rehydration cost is bounded by N rows.
    this._invalidateEmbeddingCache();

    return result.changes;
  }

  // ---------------------------------------------------------------------------
  // Clear / Stats / Close
  // ---------------------------------------------------------------------------

  /** Delete all memories. */
  clear(): void {
    this._db.exec("DELETE FROM memories");
    this._invalidateEmbeddingCache();
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

  /** Close the database connection if this instance owns it. */
  close(): void {
    if (this._ownsDb) this._db.close();
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
      embedding: row.embedding ? deserializeEmbedding(row.embedding) : null,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
      relevanceDecay: row.relevance_decay,
      corroborationCount: row.corroboration_count ?? 1,
    };
  }

  /** Get the Float32 embedding for a row, populating the cache on first access. */
  private _getCachedEmbedding(row: MemoryRow): Float32Array {
    const hit = this._embeddingCache.get(row.id);
    if (hit) return hit;

    // Stored as Float64 on disk; convert once to Float32 and cache.
    const buf = row.embedding!;
    const f64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
    const f32 = Float32Array.from(f64);
    this._embeddingCache.set(row.id, f32);
    return f32;
  }

  private _invalidateEmbeddingCache(id?: string): void {
    if (id === undefined) {
      this._embeddingCache.clear();
      return;
    }
    this._embeddingCache.delete(id);
  }

  /**
   * Return the candidate pool for semantic scoring: FTS5-matched rows first,
   * fallback to the most-recently-accessed rows if the query has no tokens.
   * Capped at SEMANTIC_CANDIDATE_LIMIT rows so cosine scoring is O(N).
   */
  private _getSemanticCandidates(query: string): MemoryRow[] {
    const sanitized = sanitizeFtsQuery(query);
    if (sanitized) {
      try {
        const rows = this._db
          .prepare(
            `SELECT m.*
             FROM memories_fts fts
             JOIN memories m ON m.rowid = fts.rowid
             WHERE memories_fts MATCH ? AND m.embedding IS NOT NULL
             ORDER BY fts.rank
             LIMIT ?`,
          )
          .all(sanitized, SEMANTIC_CANDIDATE_LIMIT) as MemoryRow[];
        if (rows.length > 0) return rows;
      } catch {
        // Fall through to the recency-based fallback.
      }
    }
    return this._db
      .prepare(
        `SELECT * FROM memories
         WHERE embedding IS NOT NULL
         ORDER BY accessed_at DESC
         LIMIT ?`,
      )
      .all(SEMANTIC_CANDIDATE_LIMIT) as MemoryRow[];
  }

  private _cosineSimilarity32(a: Float32Array, b: Float32Array): number {
    return cosineSimilarity(a, b);
  }

  /** Word-level token set for Jaccard similarity. Lowercased, length > 2. */
  private _tokenSet(text: string): Set<string> {
    const set = new Set<string>();
    for (const tok of text.toLowerCase().split(/\W+/)) {
      if (tok.length > 2) set.add(tok);
    }
    return set;
  }

  private _jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const t of a) {
      if (b.has(t)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
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
  corroboration_count: number;
  rank: number;
}

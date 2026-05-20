import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type { Message } from "../chat/types.js";
import { scan as scanForInjection, summarize as summarizeFindings } from "../guardrails/PromptInjectionScanner.js";
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
import { getLogger } from "../../modules/coding/utils/logger.js";
import { formatForLog } from "../../modules/coding/utils/errors.js";
import type { LifecycleProvenance } from "../../core/memory/types.js";
import {
  parseProvenance,
  serializeProvenance,
} from "../../core/memory/types.js";
import type { ScopeId } from "../../core/memory/MemoryHub.js";
import { redactSecrets } from "../../core/observability/redactSecrets.js";
import {
  cosineSimilarity,
  deserializeEmbedding,
  serializeEmbedding,
  sanitizeFtsQuery,
} from "./embeddingUtils.js";
import { createFtsTableAndTriggers } from "./sqliteFts.js";
import { MemoryHnswIndex } from "./MemoryHnswIndex.js";
import {
  HybridRanker,
  type FusionMethod,
  type LexicalCandidate,
  type VectorCandidate,
} from "./HybridRanker.js";

/**
 * v0.7.0 Phase 7 -- options for activating the optional HNSW vector index.
 * When omitted (or hnswlib-node fails to load) the store falls back to the
 * existing FTS5-pre-filtered linear cosine scan.
 */
export interface MemoryStoreOptions {
  readonly hnswThreshold?: number;
  readonly hnswIndexPath?: string;
  readonly hnswDimensions?: number;
  readonly hnswMaxElements?: number;
}

const CHARS_PER_TOKEN = 4;

/**
 * Schema version persisted via PRAGMA user_version. Bump when the memories
 * table layout changes; the constructor runs the migration block to bring
 * an older DB up to the current version. Idempotent.
 *
 * Version 3 (v1.1.0 Phase 4.1): adds `provenance TEXT NULL` (lifecycle
 * write context JSON) and `scope_id TEXT NULL` (folder-scope tag).
 */
const MEMORY_SCHEMA_VERSION = 3;

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
  /** v0.7.0 Phase 7 -- optional HNSW index. Null when disabled or load failed. */
  private _hnswIndex: MemoryHnswIndex | null = null;
  private readonly _hnswOptions: MemoryStoreOptions;
  /** Cached count for HNSW activation threshold; cleared on mutating writes. */
  private _cachedCount: number | null = null;

  /**
   * Construct a MemoryStore backed either by a path (self-opens and owns the
   * connection) or an existing Database (caller owns the connection -- used
   * by MemorySubsystem for connection sharing, see finding #65).
   */
  constructor(
    dbOrPath: string | Database.Database,
    embedder?: EmbeddingClient | null,
    options?: MemoryStoreOptions,
  ) {
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
    this._hnswOptions = options ?? {};
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
        corroboration_count INTEGER NOT NULL DEFAULT 1,
        provenance TEXT NULL,
        scope_id TEXT NULL
      );
    `);

    this._runMigrations();

    // v1.1.0 Phase 4.1: scope_id helper index for the folder-aware filter.
    this._db.exec(
      `CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope_id);`,
    );

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

    // v1.1.0 Phase 4.1: add provenance + scope_id columns (NULL backfill).
    if (currentVersion < 3) {
      const cols = this._db
        .prepare(`PRAGMA table_info(memories)`)
        .all() as Array<{ name: string }>;
      const hasProvenance = cols.some((c) => c.name === "provenance");
      const hasScopeId = cols.some((c) => c.name === "scope_id");
      if (!hasProvenance) {
        this._db.exec(`ALTER TABLE memories ADD COLUMN provenance TEXT NULL`);
      }
      if (!hasScopeId) {
        this._db.exec(`ALTER TABLE memories ADD COLUMN scope_id TEXT NULL`);
      }
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

  /**
   * Save a memory entry. Computes embedding asynchronously if embedder is
   * available.
   *
   * v0.8.0 Phase 2 (item G1): the content is scanned for prompt-injection
   * patterns at the write boundary. Anything that fires throws synchronously
   * so the caller (slash command, sub-agent return path, consolidation job)
   * sees the rejection at the source rather than at next-prompt-build time.
   */
  async save(
    content: string,
    type: MemoryType,
    sessionId?: string,
    options?: {
      readonly provenance?: LifecycleProvenance | null;
      readonly scopeId?: ScopeId;
    },
  ): Promise<MemoryEntry> {
    const scanResult = scanForInjection(content);
    if (!scanResult.ok) {
      throw new Error(
        `MemoryStore.save rejected: prompt-injection patterns detected (${summarizeFindings(scanResult.findings)})`,
      );
    }
    // v1.1.0 Phase 4.4 -- pre-index secret redaction. Every free-text
    // memory write is scrubbed for AWS keys, GitHub PATs, JWTs, SSH/PEM
    // headers, and Slack tokens BEFORE the row hits SQLite.
    const safeContent = redactSecrets(content);
    const id = randomUUID();
    const now = Date.now();

    let embeddingBuf: Buffer | null = null;
    if (this._embedder) {
      const vec = await this._embedder.embed(safeContent);
      if (vec) {
        embeddingBuf = serializeEmbedding(vec);
      }
    }

    const provenanceJson = serializeProvenance(options?.provenance);
    const scopeId = options?.scopeId === undefined ? null : options.scopeId;
    const insertResult = this._db
      .prepare(
        `INSERT INTO memories (id, session_id, content, type, embedding, created_at, accessed_at, corroboration_count, provenance, scope_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        sessionId ?? null,
        safeContent,
        type,
        embeddingBuf,
        now,
        now,
        provenanceJson,
        scopeId,
      );
    this._invalidateEmbeddingCache(id);
    this._cachedCount = null;

    // v0.7.0 Phase 7: feed the optional HNSW index with the new embedding.
    if (embeddingBuf) {
      this._hnswInsertIfActive(Number(insertResult.lastInsertRowid), embeddingBuf);
    }

    return {
      id,
      sessionId: sessionId ?? null,
      content: safeContent,
      type,
      embedding: embeddingBuf ? deserializeEmbedding(embeddingBuf) : null,
      createdAt: now,
      accessedAt: now,
      accessCount: 0,
      relevanceDecay: 1.0,
      corroborationCount: 1,
      lifecycleProvenance: parseProvenance(provenanceJson),
      scopeId,
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

    // v0.7.0 Phase 7: HNSW path -- when entry count crosses the configured
    // threshold AND hnswlib-node is loadable, use the persistent ANN index
    // instead of the FTS5-pre-filtered linear scan. Falls back automatically
    // when the index returns empty or HNSW yields fewer than `limit` results.
    const hnswResults = this._searchHnsw(queryVec32, limit);
    if (hnswResults && hnswResults.length > 0) {
      return this._finalizeSemanticResults(hnswResults);
    }

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

    return this._finalizeSemanticResults(
      scored.map((s) => ({ row: s.row, similarity: s.similarity })),
    );
  }

  /**
   * Mark the rows in `scored` as accessed and project them into the public
   * MemorySearchResult shape. Shared by both the HNSW and linear-scan paths.
   */
  private _finalizeSemanticResults(
    scored: Array<{ row: MemoryRow; similarity: number }>,
  ): MemorySearchResult[] {
    if (scored.length === 0) return [];

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
  // Hybrid scoring (v0.8.0 Phase 4 sub-task 4.6)
  // ---------------------------------------------------------------------------

  /**
   * Hybrid memory retrieval. Fuses keyword (FTS5) and semantic (HNSW or
   * linear-scan) candidate lists via `HybridRanker`. Each returned entry
   * carries a `reason` array explaining provenance ("HNSW rank #1 (cosine
   * 0.83)", "FTS5 rank #2", "Updated 3 minutes ago"). The matchSource is
   * always "hybrid" so consumers can branch on which path produced the
   * ranking.
   *
   * Falls through to an empty list cleanly when neither sub-ranker returns
   * anything. The function never throws -- internal errors degrade to
   * partial results.
   */
  async searchHybrid(
    query: string,
    limit = 10,
    method: FusionMethod = "rrf",
  ): Promise<MemorySearchResult[]> {
    if (!query) return [];
    const keywordResults = this.searchKeyword(query, Math.max(limit, 20));
    let semanticResults: MemorySearchResult[] = [];
    try {
      semanticResults = await this.searchSemantic(query, Math.max(limit, 20));
    } catch (err) {
      getLogger().debug(
        "[MemoryStore] searchHybrid semantic step failed:",
        formatForLog(err),
      );
    }

    if (keywordResults.length === 0 && semanticResults.length === 0) return [];

    const vectorCandidates: VectorCandidate[] = semanticResults.map((r) => ({
      entry: r.entry,
      similarity: r.score,
      source: "linear-scan",
    }));
    const lexicalCandidates: LexicalCandidate[] = keywordResults.map((r) => ({
      entry: r.entry,
      score: r.score,
    }));

    const ranker = new HybridRanker({ method, limit });
    const ranked = ranker.rank(vectorCandidates, lexicalCandidates);
    return ranked.map((r) => ({
      entry: r.entry,
      score: r.score,
      matchSource: "hybrid" as const,
      reason: r.reason,
    }));
  }

  // ---------------------------------------------------------------------------
  // Unified retrieval
  // ---------------------------------------------------------------------------

  /**
   * v0.9.0 Phase 2.2 (from v0.8.0 known-gaps 10.O.M) -- formatted hybrid
   * retrieval surface.
   *
   * Wraps `searchHybrid` so callers (UnifiedMemoryRetriever, PromptBuilder
   * via UnifiedMemoryRetriever.retrieve) get a budget-packed memory-context
   * string. Per-result `reason` arrays from the ranker pass through into
   * the rendered output so the operator can audit why each entry was
   * surfaced.
   */
  async retrieveHybrid(
    query: string,
    tokenBudget: number,
    method: FusionMethod = "rrf",
  ): Promise<string> {
    if (!query) return "";
    const results = await this.searchHybrid(query, 20, method);
    if (results.length === 0 && !this._graphEngine) return "";

    const header = "## Recalled Memories\n\n";
    let usedTokens = header.length / CHARS_PER_TOKEN;
    const lines: string[] = [];
    for (const r of results) {
      const date = new Date(r.entry.createdAt).toLocaleDateString();
      const reasonTail =
        r.reason && r.reason.length > 0 ? ` [${r.reason.join("; ")}]` : "";
      const line = `- [${r.entry.type}] ${r.entry.content} (from ${date})${reasonTail}`;
      const lineTokens = line.length / CHARS_PER_TOKEN;
      if (usedTokens + lineTokens > tokenBudget) break;
      lines.push(line);
      usedTokens += lineTokens;
    }
    let out = lines.length > 0 ? header + lines.join("\n") : "";
    if (this._graphEngine) {
      const graphBudget = Math.floor(tokenBudget * 0.25);
      const graphResult = this._graphEngine.queryContextFor(query, 10);
      const graphContext = this._graphEngine.formatAsContext(graphResult, graphBudget);
      if (graphContext) out = out ? `${out}\n\n${graphContext}` : graphContext;
    }
    return out;
  }

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

  /**
   * v0.7.0 Phase 5 -- delete a single memory by id. Returns true when a row
   * was removed, false when no row matched the id. Used by `/memory forget
   * --include-sql` and the MemoryPanel's "Promote to Memory.md" action.
   */
  deleteById(id: string): boolean {
    const row = this._db
      .prepare("SELECT rowid FROM memories WHERE id = ?")
      .get(id) as { rowid: number } | undefined;
    const result = this._db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    if (result.changes > 0) {
      this._invalidateEmbeddingCache(id);
      this._cachedCount = null;
      if (row && this._hnswIndex) {
        this._hnswIndex.remove(row.rowid);
        if (this._hnswIndex.needsRebuild()) this._rebuildHnswIndex(this._hnswIndex);
        this._hnswIndex.persist();
      }
      return true;
    }
    return false;
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
    this._cachedCount = null;
    if (this._hnswIndex) {
      this._rebuildHnswIndex(this._hnswIndex);
    }

    return result.changes;
  }

  // ---------------------------------------------------------------------------
  // Clear / Stats / Close
  // ---------------------------------------------------------------------------

  /** Delete all memories. */
  clear(): void {
    this._db.exec("DELETE FROM memories");
    this._invalidateEmbeddingCache();
    this._cachedCount = null;
    if (this._hnswIndex) {
      this._rebuildHnswIndex(this._hnswIndex);
    }
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
      lifecycleProvenance: parseProvenance(row.provenance ?? null),
      scopeId: row.scope_id ?? null,
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

  // ---------------------------------------------------------------------------
  // v0.7.0 Phase 7 -- HNSW vector index helpers
  // ---------------------------------------------------------------------------

  /**
   * Return true when the HNSW path should be considered: the entry count has
   * crossed the configured threshold AND a `hnswIndexPath` was supplied. The
   * native binary load is attempted lazily inside `_ensureHnswIndex`.
   */
  private _shouldUseHnsw(): boolean {
    const opts = this._hnswOptions;
    if (!opts.hnswIndexPath) return false;
    const threshold = opts.hnswThreshold ?? 1000;
    if (this._cachedCount === null) {
      this._cachedCount = this.count();
    }
    return this._cachedCount >= threshold;
  }

  /**
   * Lazily build / load the HNSW index on first access. Returns null when the
   * native dependency cannot be loaded -- callers fall back to linear scan.
   */
  private _ensureHnswIndex(): MemoryHnswIndex | null {
    if (this._hnswIndex) return this._hnswIndex;
    const opts = this._hnswOptions;
    if (!opts.hnswIndexPath) return null;

    const dimensions = opts.hnswDimensions ?? this._inferEmbeddingDimensions();
    if (!dimensions) return null;

    const maxElements = opts.hnswMaxElements ?? Math.max(1024, (this._cachedCount ?? this.count()) * 2);

    const index = MemoryHnswIndex.tryCreate({
      dimensions,
      maxElements,
      persistPath: opts.hnswIndexPath,
      fullRebuildEvery: 1000,
    });
    if (!index) return null;

    this._hnswIndex = index;

    // Hydrate the index on first activation: stream every embedding row in
    // and persist once at the end.
    this._hydrateHnswIndex(index, dimensions);
    return index;
  }

  private _inferEmbeddingDimensions(): number | null {
    const row = this._db
      .prepare(`SELECT embedding FROM memories WHERE embedding IS NOT NULL LIMIT 1`)
      .get() as { embedding: Buffer } | undefined;
    if (!row) return null;
    return row.embedding.byteLength / 8; // stored as Float64
  }

  private _hydrateHnswIndex(index: MemoryHnswIndex, dimensions: number): void {
    const rows = this._db
      .prepare(
        `SELECT rowid, embedding FROM memories WHERE embedding IS NOT NULL`,
      )
      .all() as Array<{ rowid: number; embedding: Buffer }>;

    for (const r of rows) {
      const buf = r.embedding;
      const f64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
      if (f64.length !== dimensions) continue;
      index.insert(r.rowid, Float32Array.from(f64));
    }
    index.persist();
  }

  /**
   * Incremental insert into the HNSW index when active. No-op when the index
   * has not been activated yet (it will be hydrated lazily on first search).
   */
  private _hnswInsertIfActive(rowid: number, embeddingBuf: Buffer): void {
    if (!this._shouldUseHnsw()) return;
    const index = this._ensureHnswIndex();
    if (!index) return;

    const f64 = new Float64Array(embeddingBuf.buffer, embeddingBuf.byteOffset, embeddingBuf.byteLength / 8);
    index.insert(rowid, Float32Array.from(f64));
    if (index.needsRebuild()) {
      this._rebuildHnswIndex(index);
    }
    index.persist();
  }

  private _rebuildHnswIndex(index: MemoryHnswIndex): void {
    const rows = this._db
      .prepare(`SELECT rowid, embedding FROM memories WHERE embedding IS NOT NULL`)
      .all() as Array<{ rowid: number; embedding: Buffer }>;

    function* entries(): Generator<{ label: number; vector: Float32Array }> {
      for (const r of rows) {
        const buf = r.embedding;
        const f64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
        yield { label: r.rowid, vector: Float32Array.from(f64) };
      }
    }
    index.rebuild(entries());
    index.persist();
  }

  /**
   * Query the HNSW index for top-K candidates and join back to memory rows.
   * Returns null when the index is not active; returns empty array when the
   * index is active but produced no usable results.
   */
  private _searchHnsw(
    queryVec: Float32Array,
    limit: number,
  ): Array<{ row: MemoryRow; similarity: number }> | null {
    if (!this._shouldUseHnsw()) return null;
    const index = this._ensureHnswIndex();
    if (!index || index.size() === 0) return null;

    const k = Math.max(limit, Math.min(50, limit * 5));
    const hits = index.search(queryVec, k);
    if (hits.length === 0) return [];

    const rowids = hits.map((h) => h.label);
    const placeholders = rowids.map(() => "?").join(",");
    const rows = this._db
      .prepare(
        `SELECT * FROM memories WHERE rowid IN (${placeholders}) AND embedding IS NOT NULL`,
      )
      .all(...rowids) as MemoryRow[];

    const byRowid = new Map<number, MemoryRow>();
    for (const r of rows) byRowid.set(r.rowid, r);

    const scored: Array<{ row: MemoryRow; similarity: number }> = [];
    for (const hit of hits) {
      const row = byRowid.get(hit.label);
      if (!row) continue;
      // hnswlib-node returns squared cosine distance in [0, 2]; map to
      // similarity in [-1, 1] then clamp to [0, 1] for caller compatibility.
      const similarity = 1 - hit.distance;
      scored.push({ row, similarity });
    }
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
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
  // v1.1.0 Phase 4.1 -- lifecycle provenance + folder-scope columns.
  provenance: string | null;
  scope_id: string | null;
}

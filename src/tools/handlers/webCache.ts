import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { secureDbPermissions } from "../../storage/dbPermissions.js";
import { isSsrfBlocked } from "../../utils/ssrf.js";
import { getLogger } from "../../utils/logger.js";
import { formatForLog } from "../../utils/errors.js";

/**
 * Phase 9 (v0.5.0) -- API-response cache for `web_search` (and the future
 * `fetch_page`). Keyed by full request URL with a configurable TTL; serves
 * stale-free hits by re-validating each cached row through the SSRF guard
 * before returning, so a tightening of `isSsrfBlocked` after storage cannot
 * leak.
 *
 * Invariants:
 *   - SQLite file lives at `<workspace>/.nexus/web-response-cache.sqlite`
 *     and is chmod 0o600 on POSIX via `secureDbPermissions`.
 *   - Lookup callers MUST also pass the SSRF DNS lookup hook the request path
 *     uses, so cached entries cannot bypass DNS-based blocking.
 *   - TTL is per-row; an expired row is treated as a miss without write.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CachedResponse {
  readonly url: string;
  readonly response: string;
  readonly contentType: string;
  readonly storedAt: number;
  readonly ttlSeconds: number;
  readonly hits: number;
}

export interface WebResponseCacheStats {
  readonly entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly expired: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Subdirectory under the workspace root that hosts the cache. */
export const WEB_CACHE_DIRNAME = ".nexus";

/** SQLite file name for the cache. */
export const WEB_CACHE_FILENAME = "web-response-cache.sqlite";

/** Default TTL for cached responses (6 hours, in seconds). */
export const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

// ---------------------------------------------------------------------------
// WebResponseCache
// ---------------------------------------------------------------------------

export class WebResponseCache {
  private _db: Database.Database | null = null;
  private _dbPath: string | null = null;
  private _hits = 0;
  private _misses = 0;
  private _expired = 0;

  /**
   * Open the SQLite cache. `dbPathOrWorkspaceRoot` may be either an explicit
   * `.sqlite` file path (used by tests via `:memory:`) or a workspace root
   * under which `.nexus/web-response-cache.sqlite` is created.
   */
  open(dbPathOrWorkspaceRoot: string): void {
    if (this._db) return;

    let dbPath: string;
    if (dbPathOrWorkspaceRoot === ":memory:") {
      dbPath = ":memory:";
    } else if (dbPathOrWorkspaceRoot.endsWith(".sqlite")) {
      dbPath = dbPathOrWorkspaceRoot;
      this._ensureParentDir(dbPath);
    } else {
      const dir = path.join(dbPathOrWorkspaceRoot, WEB_CACHE_DIRNAME);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        getLogger().debug(
          `[WebResponseCache] mkdir failed for "${dir}":`,
          formatForLog(err),
        );
      }
      dbPath = path.join(dir, WEB_CACHE_FILENAME);
    }

    this._db = new Database(dbPath);
    this._dbPath = dbPath;
    if (dbPath !== ":memory:") secureDbPermissions(dbPath);
    this._db.pragma("journal_mode = WAL");
    this._initSchema();
  }

  close(): void {
    if (!this._db) return;
    try {
      this._db.close();
    } catch (err) {
      getLogger().debug(`[WebResponseCache] close failed:`, formatForLog(err));
    }
    this._db = null;
    this._dbPath = null;
  }

  dbPath(): string | null {
    return this._dbPath;
  }

  private _ensureParentDir(filePath: string): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (err) {
      getLogger().debug(
        `[WebResponseCache] mkdir failed for "${path.dirname(filePath)}":`,
        formatForLog(err),
      );
    }
  }

  private _initSchema(): void {
    this._db!.exec(`
      CREATE TABLE IF NOT EXISTS web_response_cache (
        url TEXT PRIMARY KEY,
        response BLOB NOT NULL,
        content_type TEXT NOT NULL,
        ttl_seconds INTEGER NOT NULL,
        stored_at INTEGER NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_web_response_cache_stored_at
        ON web_response_cache(stored_at);
    `);
  }

  /**
   * Look up a cached response for `url`. Returns null on miss, on expired
   * TTL, or when the SSRF guard now rejects the URL (the entry is preserved
   * so a future SSRF rule loosening can resume serving from it).
   *
   * The SSRF re-validation uses `isSsrfBlocked` directly because callers want
   * the same DNS-aware logic as the request path; passing a custom DNS lookup
   * hook keeps test determinism intact.
   */
  async lookup(url: string): Promise<CachedResponse | null> {
    this._assertOpen();

    const row = this._db!
      .prepare(
        `SELECT url, response, content_type, ttl_seconds, stored_at, hits
         FROM web_response_cache WHERE url = ?`,
      )
      .get(url) as
      | {
          url: string;
          response: Buffer;
          content_type: string;
          ttl_seconds: number;
          stored_at: number;
          hits: number;
        }
      | undefined;

    if (!row) {
      this._misses += 1;
      return null;
    }

    const now = Date.now();
    if (row.stored_at + row.ttl_seconds * 1000 <= now) {
      this._expired += 1;
      return null;
    }

    // Re-validate the URL against the live SSRF guard before serving. This
    // protects against a guard rule change after the entry was stored.
    if (await isSsrfBlocked(url)) {
      this._misses += 1;
      return null;
    }

    this._db!
      .prepare(
        `UPDATE web_response_cache SET hits = hits + 1 WHERE url = ?`,
      )
      .run(url);
    this._hits += 1;

    return {
      url: row.url,
      response: row.response.toString("utf8"),
      contentType: row.content_type,
      storedAt: row.stored_at,
      ttlSeconds: row.ttl_seconds,
      hits: row.hits + 1,
    };
  }

  /**
   * Store a response for `url`. UPSERT semantics: subsequent stores for the
   * same URL refresh the row, reset `stored_at`, and reset `hits` to 0.
   */
  store(
    url: string,
    response: string,
    contentType: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): void {
    this._assertOpen();

    const now = Date.now();
    this._db!
      .prepare(
        `INSERT INTO web_response_cache (url, response, content_type, ttl_seconds, stored_at, hits)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(url) DO UPDATE SET
           response = excluded.response,
           content_type = excluded.content_type,
           ttl_seconds = excluded.ttl_seconds,
           stored_at = excluded.stored_at,
           hits = 0`,
      )
      .run(url, Buffer.from(response, "utf8"), contentType, ttlSeconds, now);
  }

  /** Drop every cached entry. Returns the number of rows removed. */
  clear(): number {
    this._assertOpen();
    const before = this.size();
    this._db!.exec(`DELETE FROM web_response_cache`);
    return before;
  }

  /** Number of cached entries. */
  size(): number {
    this._assertOpen();
    const row = this._db!
      .prepare(`SELECT COUNT(*) AS n FROM web_response_cache`)
      .get() as { n: number };
    return row.n;
  }

  /** Snapshot of cumulative hit/miss counters. */
  stats(): WebResponseCacheStats {
    return {
      entries: this._db ? this.size() : 0,
      hits: this._hits,
      misses: this._misses,
      expired: this._expired,
    };
  }

  /** Reset the in-memory counters (test-only helper). */
  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
    this._expired = 0;
  }

  private _assertOpen(): void {
    if (!this._db) {
      throw new Error("WebResponseCache is not open. Call open() first.");
    }
  }
}

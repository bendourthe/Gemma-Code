import type { MemoryEntry } from "./MemoryShared.types.js";

/**
 * v0.8.0 Phase 6.2 (item A7) -- anticipatory context cache / intuition.
 *
 * Background prefetch of likely-relevant memory entries based on the
 * currently-active editor file and recent tool history. The cache is a
 * pure in-memory LRU with a configurable warmth window; nothing is
 * persisted to disk and no network calls are made.
 *
 * Callers wire `prefetch()` to two VSCode signals:
 *
 *   - `onDidChangeActiveTextEditor` -- when the operator switches files
 *   - tool-call completion         -- after a verified tool result
 *
 * The MemoryPanel surfaces the cached entries under a faded "anticipated
 * context" section so the operator can preview what the next retrieval
 * round will see without paying the embedding cost again.
 *
 * Disabled by default. Enable via `gemma-code.memory.anticipatoryCache = true`.
 */

export interface IntuitionSignals {
  /** Path of the currently-active editor file, if any. */
  readonly currentFile?: string;
  /** Tool names invoked recently (most-recent first). Bounded by the caller. */
  readonly recentTools?: readonly string[];
}

/**
 * Pure ranker shape -- callers wire either the live HybridRanker or a
 * deterministic test stub. The ranker MUST be synchronous in spirit
 * (returns a promise so the live HNSW path can stay async); IntuitionCache
 * does not introduce any new I/O of its own.
 */
export type IntuitionRanker = (signals: IntuitionSignals) => Promise<readonly MemoryEntry[]>;

export interface IntuitionCacheOptions {
  /** Cache warmth window in milliseconds. Entries older than this are evicted. Default 30s. */
  readonly warmthWindowMs?: number;
  /** Maximum number of cached results to keep. Default 32. */
  readonly maxEntries?: number;
  /** Override `Date.now()` for deterministic tests. */
  readonly now?: () => number;
}

interface CacheRow {
  readonly key: string;
  readonly entries: readonly MemoryEntry[];
  readonly insertedAt: number;
}

const DEFAULT_WARMTH_WINDOW_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 32;

/**
 * In-memory LRU keyed by the signals tuple. The hot path is the cache
 * hit: `peek(signals)` returns the stored entries without invoking the
 * ranker. On miss `prefetch()` calls the ranker and caches the result.
 */
export class IntuitionCache {
  private readonly _rows = new Map<string, CacheRow>();
  private readonly _warmthWindowMs: number;
  private readonly _maxEntries: number;
  private readonly _now: () => number;
  private readonly _ranker: IntuitionRanker;
  private _enabled: boolean;

  constructor(ranker: IntuitionRanker, options: IntuitionCacheOptions & { enabled?: boolean } = {}) {
    this._ranker = ranker;
    this._warmthWindowMs = options.warmthWindowMs ?? DEFAULT_WARMTH_WINDOW_MS;
    this._maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._now = options.now ?? Date.now;
    this._enabled = options.enabled ?? false;
  }

  /** Toggle the cache. When disabled `prefetch()` short-circuits to []. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) this._rows.clear();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  /** Number of cached signal-tuple rows (after eviction). */
  get size(): number {
    this._evictExpired();
    return this._rows.size;
  }

  /**
   * Speculatively prefetch likely-relevant memory entries for the supplied
   * signals. Returns the same list on every call within the warmth window;
   * on cache miss it calls the ranker. Disabled caches return [] without
   * invoking the ranker.
   */
  async prefetch(signals: IntuitionSignals): Promise<readonly MemoryEntry[]> {
    if (!this._enabled) return [];
    const key = this._key(signals);
    const now = this._now();
    const existing = this._rows.get(key);
    if (existing && now - existing.insertedAt < this._warmthWindowMs) {
      // LRU touch: re-insert so the eviction order matches access order.
      this._rows.delete(key);
      this._rows.set(key, existing);
      return existing.entries;
    }
    const entries = await this._ranker(signals);
    this._rows.set(key, { key, entries, insertedAt: now });
    this._evictOverCapacity();
    return entries;
  }

  /** Cache-only lookup -- never invokes the ranker. */
  peek(signals: IntuitionSignals): readonly MemoryEntry[] | null {
    if (!this._enabled) return null;
    const key = this._key(signals);
    const row = this._rows.get(key);
    if (!row) return null;
    if (this._now() - row.insertedAt >= this._warmthWindowMs) {
      this._rows.delete(key);
      return null;
    }
    return row.entries;
  }

  /** Drop every cached row. */
  clear(): void {
    this._rows.clear();
  }

  private _key(signals: IntuitionSignals): string {
    const file = signals.currentFile ?? "";
    const tools = (signals.recentTools ?? []).slice(0, 5).join("|");
    return `${file}::${tools}`;
  }

  private _evictExpired(): void {
    const now = this._now();
    for (const [key, row] of this._rows) {
      if (now - row.insertedAt >= this._warmthWindowMs) {
        this._rows.delete(key);
      }
    }
  }

  private _evictOverCapacity(): void {
    while (this._rows.size > this._maxEntries) {
      const oldestKey = this._rows.keys().next().value;
      if (oldestKey === undefined) break;
      this._rows.delete(oldestKey);
    }
  }
}

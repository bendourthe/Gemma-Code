/**
 * v1.1.0 Phase 5.2 -- in-memory BM25 inverted index over memory entries.
 *
 * Standard Okapi BM25 implementation with the textbook defaults `k1 = 1.5`
 * and `b = 0.75`. The constants are exposed via `Bm25IndexOptions` so the
 * SettingsStore keys `nexus.memory.bm25.k1` and `nexus.memory.bm25.b`
 * (resolved by the consumer) can override them. Documents are keyed by
 * opaque `entryId` strings; the index does not retain document text.
 *
 * Tokenization defers to `core/memory/stopwords.ts::tokenize` (case-folded,
 * non-alnum-split, stop-word stripped, 1-char tokens dropped). Callers may
 * inject a custom tokenizer for non-English corpora.
 *
 * Persistence: indexes are rebuilt from SQLite rows on first launch by the
 * Phase 5.6 warm-build worker; there is no on-disk index format yet (in-RAM
 * is cheap enough at the v1.1.0 corpus sizes). Index mutation is
 * synchronous and O(tokens-per-doc + log(doc-count)).
 *
 * Adopts agentmemory A1 (see docs/v1/v1.1/comparison-agentmemory.md
 * Section 11.2 P1).
 */

import { tokenize as defaultTokenize } from "./stopwords.js";

export interface Bm25IndexOptions {
  /** BM25 term-frequency saturation. Default 1.5. */
  readonly k1?: number;
  /** BM25 length-normalization slope (0=none, 1=full). Default 0.75. */
  readonly b?: number;
  /** Custom tokenizer. Defaults to the English stop-word-aware tokenizer. */
  readonly tokenize?: (text: string) => string[];
}

interface DocumentState {
  readonly tokens: ReadonlyArray<string>;
  readonly tf: ReadonlyMap<string, number>;
  readonly length: number;
}

/**
 * In-memory BM25 index. All operations are synchronous; thread-safety is
 * the caller's responsibility (the `MemoryHub` write path is single-
 * threaded in the sidecar).
 */
export class Bm25Index {
  readonly k1: number;
  readonly b: number;
  private readonly _tokenize: (text: string) => string[];

  private readonly _docs = new Map<string, DocumentState>();
  /** token -> set of entryIds containing it (document frequency lookup). */
  private readonly _postings = new Map<string, Set<string>>();
  private _totalLength = 0;

  constructor(opts: Bm25IndexOptions = {}) {
    this.k1 = opts.k1 ?? 1.5;
    this.b = opts.b ?? 0.75;
    this._tokenize = opts.tokenize ?? defaultTokenize;
  }

  /** Total number of indexed documents. */
  get size(): number {
    return this._docs.size;
  }

  /** Average document length (used by BM25 length normalization). */
  get avgDocLength(): number {
    if (this._docs.size === 0) return 0;
    return this._totalLength / this._docs.size;
  }

  /**
   * Add or replace a document. If `entryId` already exists, its old
   * postings are removed before the new ones are added.
   */
  add(entryId: string, text: string): void {
    if (this._docs.has(entryId)) this.delete(entryId);
    const tokens = this._tokenize(text);
    if (tokens.length === 0) {
      this._docs.set(entryId, {
        tokens,
        tf: new Map(),
        length: 0,
      });
      return;
    }
    const tf = new Map<string, number>();
    for (const tok of tokens) {
      tf.set(tok, (tf.get(tok) ?? 0) + 1);
    }
    for (const tok of tf.keys()) {
      let posting = this._postings.get(tok);
      if (!posting) {
        posting = new Set();
        this._postings.set(tok, posting);
      }
      posting.add(entryId);
    }
    this._docs.set(entryId, {
      tokens,
      tf,
      length: tokens.length,
    });
    this._totalLength += tokens.length;
  }

  /** Remove a document. Returns `true` if the document existed. */
  delete(entryId: string): boolean {
    const state = this._docs.get(entryId);
    if (!state) return false;
    for (const tok of state.tf.keys()) {
      const posting = this._postings.get(tok);
      if (!posting) continue;
      posting.delete(entryId);
      if (posting.size === 0) this._postings.delete(tok);
    }
    this._totalLength -= state.length;
    this._docs.delete(entryId);
    return true;
  }

  /**
   * Rank documents by BM25 score. Returns at most `limit` hits (default
   * Infinity). Documents with score `<= 0` are omitted. Output is sorted
   * by descending score; ties broken by entryId for determinism.
   *
   * The returned `Map` preserves insertion order so callers can iterate
   * top-K without re-sorting.
   */
  search(query: string, limit = Infinity): Map<string, number> {
    const queryTokens = this._tokenize(query);
    const scores = new Map<string, number>();
    if (queryTokens.length === 0 || this._docs.size === 0) return scores;

    const avgdl = this.avgDocLength;
    const N = this._docs.size;
    const queryTermSet = new Set(queryTokens);

    for (const tok of queryTermSet) {
      const posting = this._postings.get(tok);
      if (!posting || posting.size === 0) continue;
      const df = posting.size;
      // BM25+ style IDF (smoothed, never negative); see Robertson & Zaragoza.
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const entryId of posting) {
        const state = this._docs.get(entryId)!;
        const tf = state.tf.get(tok) ?? 0;
        const norm = 1 - this.b + this.b * (state.length / (avgdl || 1));
        const tfTerm = (tf * (this.k1 + 1)) / (tf + this.k1 * norm);
        const contribution = idf * tfTerm;
        scores.set(entryId, (scores.get(entryId) ?? 0) + contribution);
      }
    }

    const ranked = [...scores.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0] < b[0] ? -1 : 1;
      });

    const top = limit === Infinity ? ranked : ranked.slice(0, limit);
    return new Map(top);
  }

  /** Drop every indexed document. */
  clear(): void {
    this._docs.clear();
    this._postings.clear();
    this._totalLength = 0;
  }

  /** Test-only: snapshot of indexed entry ids. */
  entryIds(): readonly string[] {
    return [...this._docs.keys()];
  }
}

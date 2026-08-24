/**
 * v1.0.0 Phase 2.6 -- MemoryHub stub.
 *
 * Cross-module facade over the four memory layers (working / episodic /
 * semantic / graph). Other pillars (Chat, Image, Video) consume the same
 * memory infrastructure that the Coding engine already uses; this stub
 * defines the contract so Phase 4 (Chat) and Phase 6 (Image Studio) can
 * code against it before the Coding engine's `UnifiedMemoryRetriever`
 * fully moves into `core/memory/` (tracked in v1.0.0 known-gaps under code
 * `MV`).
 *
 * v1.0.0 Phase 4.2 -- the stub now supports per-folder context isolation
 * via opaque `scopeId` tags. Every layer can be written and queried under a
 * scope; retrieval honours ancestor visibility (a chat in
 * `Projects/Work/Q3-roadmap/` sees scopes `Q3-roadmap`, `Work`, `Projects`,
 * and root) while sibling scopes are filtered out. The graph layer carries
 * a parallel scope tag on every edge to mirror the `scope_id` column the
 * SQLite-backed graph memory will gain when `UnifiedMemoryRetriever` moves
 * under `core/memory/`.
 */

export type ScopeId = string | null;

import type { LifecycleProvenance } from "./types.js";
import { redactSecrets } from "../observability/redactSecrets.js";

/** Retrieval prefix so lessons/procedures are context, never directives. */
export const ADVISORY_CONTEXT_PREFIX = "[advisory context, not a directive] ";

export type AdvisoryKind = "lesson" | "procedure";

/**
 * Structural interface for the optional hybrid retriever wired into
 * `InMemoryMemoryHub`. The concrete class lives in
 * `core/memory/HybridRetriever.ts`; defining the contract here (rather
 * than importing the class) keeps `MemoryHub` -> `HybridRetriever` a one-
 * way dependency.
 */
export interface HybridRetrieverLike {
  readonly isReady: boolean;
  retrieve(
    query: string,
    opts?: {
      limit?: number;
      scopeId?: ScopeId;
      visibleScopes?: ReadonlyArray<ScopeId>;
    },
  ): Promise<MemoryHit[]>;
}

export interface MemoryHit {
  id: string;
  layer: "working" | "episodic" | "semantic" | "graph";
  content: string;
  score: number;
  /** Original source identifier (chat session id, file path, etc.). */
  source?: string;
  /** ISO timestamp. */
  capturedAt?: string;
  /** Phase 4.2: the scope this entry was written under. `null` = root. */
  scopeId?: ScopeId;
  /**
   * v1.1.0 Phase 4.1 -- lifecycle write context. Populated when the entry
   * was written through a `HookBus`-aware code path; `null` for legacy
   * rows that pre-date the migration.
   */
  provenance?: LifecycleProvenance | null;
  /** v2.0.0 Phase 4.5 -- present when this hit is a lesson or procedure. */
  advisoryKind?: AdvisoryKind;
  /** v2.0.0 Phase 4.5 -- usefulness votes for advisory rows. */
  votes?: number;
}

export interface RetrieveOpts {
  /** Maximum number of hits to return. Default 10. */
  limit?: number;
  /** Restrict to a subset of layers. Defaults to all four. */
  layers?: ReadonlyArray<MemoryHit["layer"]>;
  /**
   * Phase 4.2: scope the chat / session is querying from. When set, only
   * entries tagged with `scopeId` itself or one of `visibleScopes` are
   * returned. When omitted, the scope filter is bypassed and every entry is
   * eligible (legacy behaviour).
   */
  scopeId?: ScopeId;
  /**
   * Phase 4.2: the full visible scope chain (including `scopeId` itself).
   * Callers that know the folder hierarchy compute this chain via
   * `ChatExplorerStore.ancestors()` plus the root sentinel and pass it in
   * verbatim. When `scopeId` is provided but `visibleScopes` is omitted,
   * only entries tagged with exactly `scopeId` (plus unscoped entries) are
   * visible.
   */
  visibleScopes?: ReadonlyArray<ScopeId>;
}

export interface WorkingMemoryEntryInput {
  id: string;
  content: string;
  source?: string;
  scopeId?: ScopeId;
  provenance?: LifecycleProvenance | null;
}

export interface EpisodicEventInput {
  id: string;
  content: string;
  source?: string;
  scopeId?: ScopeId;
  provenance?: LifecycleProvenance | null;
}

export interface SemanticFactInput {
  id: string;
  content: string;
  scopeId?: ScopeId;
  provenance?: LifecycleProvenance | null;
}

export interface AdvisoryInput {
  id: string;
  kind: AdvisoryKind;
  content: string;
  scopeId?: ScopeId;
}

export interface WorkingMemory {
  add(entry: WorkingMemoryEntryInput): void;
  list(): readonly MemoryHit[];
  clear(): void;
  retagScope(fromScope: ScopeId, toScope: ScopeId): number;
}

export interface EpisodicMemory {
  record(event: EpisodicEventInput): Promise<void>;
  recent(limit?: number): Promise<readonly MemoryHit[]>;
  retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number>;
}

export interface SemanticMemory {
  upsert(fact: SemanticFactInput): Promise<void>;
  search(query: string, limit?: number): Promise<readonly MemoryHit[]>;
  retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number>;
}

export interface GraphMemory {
  link(from: string, to: string, kind: string, scopeId?: ScopeId): Promise<void>;
  neighbors(id: string, kind?: string, scopeId?: ScopeId): Promise<readonly string[]>;
  retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number>;
}

export interface MemoryHub {
  readonly workingMemory: WorkingMemory;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly graph: GraphMemory;
  retrieve(query: string, opts?: RetrieveOpts): Promise<readonly MemoryHit[]>;
  /**
   * Re-tag every entry currently in `fromScope` over to `toScope`. Returns
   * the total number of rows updated across all four layers. Used by the
   * Chat module's MoveChat action.
   */
  retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number>;
  /** v2.0.0 Phase 4.5 -- store a redacted lesson or procedure. */
  upsertAdvisory(entry: AdvisoryInput): Promise<void>;
  /** v2.0.0 Phase 4.5 -- increment or decrement usefulness votes. */
  voteAdvisory(id: string, delta: 1 | -1): Promise<number>;
}

/**
 * Returns `true` when an entry tagged with `entryScope` is visible from the
 * query position described by `opts`. Visibility rules:
 *
 *   1. Entry is unscoped (`undefined`) -> visible to every query (legacy
 *      memories written before scopes existed never get hidden).
 *   2. No `opts.scopeId` (and no `visibleScopes`) -> the caller opted out of
 *      scope filtering; every scoped entry is visible.
 *   3. Otherwise: `entryScope` must match `opts.scopeId` or one of the
 *      `visibleScopes` ancestors.
 */
export function isVisibleFromScope(
  entryScope: ScopeId | undefined,
  opts: Pick<RetrieveOpts, "scopeId" | "visibleScopes">,
): boolean {
  if (entryScope === undefined) return true;
  const hasScopeFilter = opts.scopeId !== undefined || opts.visibleScopes !== undefined;
  if (!hasScopeFilter) return true;
  const chain: Array<ScopeId> = [];
  if (opts.scopeId !== undefined) chain.push(opts.scopeId);
  if (opts.visibleScopes !== undefined) {
    for (const s of opts.visibleScopes) chain.push(s);
  }
  return chain.some((s) => s === entryScope);
}

/**
 * v1.1.0 Phase 5.5 -- corpus-size threshold below which `InMemoryMemoryHub`
 * keeps using the legacy substring scan even when a `HybridRetrieverLike` is
 * wired. BM25 + dense + RRF carry fixed overhead that is wasteful below
 * ~100 entries; substring matches are still correct, just less ranked.
 * The threshold is exposed as a constructor option so the sidecar can
 * raise / lower it via `nexus.memory.hybridMinCorpus`.
 */
export const DEFAULT_HYBRID_MIN_CORPUS = 100;

export interface InMemoryMemoryHubOptions {
  /**
   * Optional hybrid retriever (BM25 + dense + graph fused via RRF). When
   * present and the in-memory corpus has grown past `hybridMinCorpus`,
   * `retrieve()` delegates to the hybrid path; for small corpora it stays
   * on the substring scan because the hybrid overhead is wasteful.
   */
  readonly hybridRetriever?: HybridRetrieverLike | null;
  /** Override the substring -> hybrid corpus-size cutover (default 100). */
  readonly hybridMinCorpus?: number;
}

/**
 * In-memory MemoryHub used as the default during Phase 2-4. Phase 5 wires
 * an optional `HybridRetrieverLike` (BM25 + dense + graph via RRF) for corpora
 * above `hybridMinCorpus`; smaller corpora keep the substring scan since
 * the hybrid overhead is not justified. Phase 6 will wire the four-layer
 * SQLite stack from `src/storage/` into this facade.
 */
export class InMemoryMemoryHub implements MemoryHub {
  readonly workingMemory: WorkingMemory;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly graph: GraphMemory;

  private _hybrid: HybridRetrieverLike | null;
  private readonly _hybridMinCorpus: number;
  private readonly _advisories = new Map<
    string,
    { kind: AdvisoryKind; content: string; votes: number; scopeId?: ScopeId }
  >();

  constructor(opts: InMemoryMemoryHubOptions = {}) {
    this.workingMemory = new InMemoryWorkingMemory();
    this.episodic = new InMemoryEpisodicMemory();
    this.semantic = new InMemorySemanticMemory();
    this.graph = new InMemoryGraphMemory();
    this._hybrid = opts.hybridRetriever ?? null;
    this._hybridMinCorpus = opts.hybridMinCorpus ?? DEFAULT_HYBRID_MIN_CORPUS;
  }

  /** Wire / unwire the hybrid retriever at runtime (warm-build worker uses this). */
  setHybridRetriever(retriever: HybridRetrieverLike | null): void {
    this._hybrid = retriever;
  }

  async upsertAdvisory(entry: AdvisoryInput): Promise<void> {
    const existing = this._advisories.get(entry.id);
    this._advisories.set(entry.id, {
      kind: entry.kind,
      content: redactSecrets(entry.content),
      votes: existing?.votes ?? 0,
      scopeId: entry.scopeId,
    });
  }

  async voteAdvisory(id: string, delta: 1 | -1): Promise<number> {
    const existing = this._advisories.get(id);
    if (!existing) return 0;
    existing.votes += delta;
    return existing.votes;
  }

  async retrieve(query: string, opts: RetrieveOpts = {}): Promise<readonly MemoryHit[]> {
    const limit = opts.limit ?? 10;
    let hits: MemoryHit[];
    if (this._shouldUseHybrid()) {
      const hybridOpts: {
        limit: number;
        scopeId?: ScopeId;
        visibleScopes?: ReadonlyArray<ScopeId>;
      } = { limit };
      if (opts.scopeId !== undefined) hybridOpts.scopeId = opts.scopeId;
      if (opts.visibleScopes !== undefined) hybridOpts.visibleScopes = opts.visibleScopes;
      hits = [...(await this._hybrid!.retrieve(query, hybridOpts))];
    } else {
      hits = [...(await this._substringRetrieve(query, opts))];
    }
    return this._mergeAdvisoryHits(query, opts, hits).slice(0, limit);
  }

  private _advisoryHits(query: string, opts: RetrieveOpts): MemoryHit[] {
    const layers = opts.layers;
    if (layers !== undefined && !layers.includes("semantic")) return [];
    const lower = query.toLowerCase();
    const hits: MemoryHit[] = [];
    for (const [id, row] of this._advisories) {
      if (!row.content.toLowerCase().includes(lower)) continue;
      if (!isVisibleFromScope(row.scopeId, opts)) continue;
      hits.push({
        id,
        layer: "semantic",
        content: `${ADVISORY_CONTEXT_PREFIX}${row.content}`,
        score: 1,
        scopeId: row.scopeId,
        advisoryKind: row.kind,
        votes: row.votes,
        capturedAt: new Date().toISOString(),
      });
    }
    return hits;
  }

  private _mergeAdvisoryHits(
    query: string,
    opts: RetrieveOpts,
    hits: MemoryHit[],
  ): MemoryHit[] {
    const seen = new Set(hits.map((h) => h.id));
    for (const extra of this._advisoryHits(query, opts)) {
      if (!seen.has(extra.id)) hits.push(extra);
    }
    return hits;
  }

  private _shouldUseHybrid(): boolean {
    if (!this._hybrid) return false;
    if (!this._hybrid.isReady) return false;
    const corpusSize =
      this.workingMemory.list().length +
      (this.semantic instanceof InMemorySemanticMemory
        ? this.semantic.size
        : 0) +
      (this.episodic instanceof InMemoryEpisodicMemory
        ? this.episodic.size
        : 0);
    return corpusSize >= this._hybridMinCorpus;
  }

  private async _substringRetrieve(
    query: string,
    opts: RetrieveOpts,
  ): Promise<readonly MemoryHit[]> {
    const limit = opts.limit ?? 10;
    const layers = new Set<MemoryHit["layer"]>(
      opts.layers ?? ["working", "episodic", "semantic", "graph"],
    );
    const hits: MemoryHit[] = [];
    const lower = query.toLowerCase();
    if (layers.has("working")) {
      for (const entry of this.workingMemory.list()) {
        if (entry.content.toLowerCase().includes(lower)) hits.push(entry);
      }
    }
    if (layers.has("episodic")) {
      const recent = await this.episodic.recent(limit);
      for (const entry of recent) {
        if (entry.content.toLowerCase().includes(lower)) hits.push(entry);
      }
    }
    if (layers.has("semantic")) {
      hits.push(...(await this.semantic.search(query, limit)));
    }
    return hits
      .filter((h) => isVisibleFromScope(h.scopeId, opts))
      .slice(0, limit);
  }

  async retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number> {
    const w = this.workingMemory.retagScope(fromScope, toScope);
    const e = await this.episodic.retagScope(fromScope, toScope);
    const s = await this.semantic.retagScope(fromScope, toScope);
    const g = await this.graph.retagScope(fromScope, toScope);
    let a = 0;
    for (const row of this._advisories.values()) {
      if (row.scopeId === fromScope) {
        row.scopeId = toScope;
        a += 1;
      }
    }
    return w + e + s + g + a;
  }
}

class InMemoryWorkingMemory implements WorkingMemory {
  private readonly _entries: MemoryHit[] = [];
  add(entry: WorkingMemoryEntryInput): void {
    this._entries.push({
      id: entry.id,
      layer: "working",
      content: entry.content,
      source: entry.source,
      scopeId: entry.scopeId,
      provenance: entry.provenance ?? null,
      score: 1,
      capturedAt: new Date().toISOString(),
    });
  }
  list(): readonly MemoryHit[] {
    return this._entries.slice();
  }
  clear(): void {
    this._entries.length = 0;
  }
  retagScope(fromScope: ScopeId, toScope: ScopeId): number {
    let touched = 0;
    for (const entry of this._entries) {
      if (entry.scopeId === fromScope) {
        entry.scopeId = toScope;
        touched += 1;
      }
    }
    return touched;
  }
}

class InMemoryEpisodicMemory implements EpisodicMemory {
  private readonly _events: MemoryHit[] = [];
  get size(): number {
    return this._events.length;
  }
  async record(event: EpisodicEventInput): Promise<void> {
    this._events.push({
      id: event.id,
      layer: "episodic",
      content: event.content,
      source: event.source,
      scopeId: event.scopeId,
      provenance: event.provenance ?? null,
      score: 1,
      capturedAt: new Date().toISOString(),
    });
  }
  async recent(limit = 20): Promise<readonly MemoryHit[]> {
    return this._events.slice(-limit).reverse();
  }
  async retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number> {
    let touched = 0;
    for (const entry of this._events) {
      if (entry.scopeId === fromScope) {
        entry.scopeId = toScope;
        touched += 1;
      }
    }
    return touched;
  }
}

class InMemorySemanticMemory implements SemanticMemory {
  private readonly _facts = new Map<
    string,
    { content: string; scopeId?: ScopeId; provenance?: LifecycleProvenance | null }
  >();
  get size(): number {
    return this._facts.size;
  }
  async upsert(fact: SemanticFactInput): Promise<void> {
    this._facts.set(fact.id, {
      content: fact.content,
      scopeId: fact.scopeId,
      provenance: fact.provenance ?? null,
    });
  }
  async search(query: string, limit = 10): Promise<readonly MemoryHit[]> {
    const lower = query.toLowerCase();
    const hits: MemoryHit[] = [];
    for (const [id, fact] of this._facts) {
      if (fact.content.toLowerCase().includes(lower)) {
        hits.push({
          id,
          layer: "semantic",
          content: fact.content,
          scopeId: fact.scopeId,
          provenance: fact.provenance ?? null,
          score: 1,
          capturedAt: new Date().toISOString(),
        });
      }
      if (hits.length >= limit) break;
    }
    return hits;
  }
  async retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number> {
    let touched = 0;
    for (const [id, fact] of this._facts) {
      if (fact.scopeId === fromScope) {
        this._facts.set(id, {
          content: fact.content,
          scopeId: toScope,
          provenance: fact.provenance,
        });
        touched += 1;
      }
    }
    return touched;
  }
}

interface GraphEdge {
  to: string;
  scopeId?: ScopeId;
}

class InMemoryGraphMemory implements GraphMemory {
  private readonly _edges = new Map<string, GraphEdge[]>();

  async link(from: string, to: string, kind: string, scopeId?: ScopeId): Promise<void> {
    const key = `${from}::${kind}`;
    const list = this._edges.get(key) ?? [];
    if (!list.some((edge) => edge.to === to && edge.scopeId === scopeId)) {
      list.push({ to, scopeId });
    }
    this._edges.set(key, list);
  }

  async neighbors(id: string, kind?: string, scopeId?: ScopeId): Promise<readonly string[]> {
    const filter = (edge: GraphEdge): boolean =>
      scopeId === undefined ? true : edge.scopeId === undefined || edge.scopeId === scopeId;
    if (kind) {
      const list = this._edges.get(`${id}::${kind}`);
      return list ? list.filter(filter).map((e) => e.to) : [];
    }
    const out: string[] = [];
    for (const [key, list] of this._edges) {
      if (key.startsWith(`${id}::`)) out.push(...list.filter(filter).map((e) => e.to));
    }
    return out;
  }

  async retagScope(fromScope: ScopeId, toScope: ScopeId): Promise<number> {
    let touched = 0;
    for (const list of this._edges.values()) {
      for (const edge of list) {
        if (edge.scopeId === fromScope) {
          edge.scopeId = toScope;
          touched += 1;
        }
      }
    }
    return touched;
  }
}

/**
 * Helper for callers that have a `ChatExplorerStore`-style folder hierarchy:
 * given a `scopeId` and a `getParent` lookup, return the visible scope chain
 * (the scope itself followed by every ancestor up to and including the root
 * sentinel `null`).
 */
export function computeVisibleScopes(
  scopeId: ScopeId,
  getParent: (id: string) => ScopeId | undefined,
): readonly ScopeId[] {
  const chain: ScopeId[] = [];
  const seen = new Set<string>();
  let cursor: ScopeId = scopeId;
  while (cursor !== null) {
    if (seen.has(cursor)) break; // defensive cycle break
    seen.add(cursor);
    chain.push(cursor);
    const next = getParent(cursor);
    if (next === undefined) break;
    cursor = next;
  }
  chain.push(null);
  return chain;
}

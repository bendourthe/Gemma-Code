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
 * The stub maps to in-memory data structures so unit tests can exercise the
 * contract without spinning up a SQLite database.
 */

export interface MemoryHit {
  id: string;
  layer: "working" | "episodic" | "semantic" | "graph";
  content: string;
  score: number;
  /** Original source identifier (chat session id, file path, etc.). */
  source?: string;
  /** ISO timestamp. */
  capturedAt?: string;
}

export interface RetrieveOpts {
  /** Maximum number of hits to return. Default 10. */
  limit?: number;
  /** Restrict to a subset of layers. Defaults to all four. */
  layers?: ReadonlyArray<MemoryHit["layer"]>;
}

export interface WorkingMemory {
  add(entry: Pick<MemoryHit, "id" | "content" | "source">): void;
  list(): readonly MemoryHit[];
  clear(): void;
}

export interface EpisodicMemory {
  record(event: {
    id: string;
    content: string;
    source?: string;
  }): Promise<void>;
  recent(limit?: number): Promise<readonly MemoryHit[]>;
}

export interface SemanticMemory {
  upsert(fact: { id: string; content: string }): Promise<void>;
  search(query: string, limit?: number): Promise<readonly MemoryHit[]>;
}

export interface GraphMemory {
  link(from: string, to: string, kind: string): Promise<void>;
  neighbors(id: string, kind?: string): Promise<readonly string[]>;
}

export interface MemoryHub {
  readonly workingMemory: WorkingMemory;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly graph: GraphMemory;
  retrieve(query: string, opts?: RetrieveOpts): Promise<readonly MemoryHit[]>;
}

/**
 * In-memory MemoryHub used as the default during Phase 2-3. Phase 4 wires
 * the four-layer SQLite stack from `src/storage/` into this facade.
 */
export class InMemoryMemoryHub implements MemoryHub {
  readonly workingMemory: WorkingMemory;
  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly graph: GraphMemory;

  constructor() {
    this.workingMemory = new InMemoryWorkingMemory();
    this.episodic = new InMemoryEpisodicMemory();
    this.semantic = new InMemorySemanticMemory();
    this.graph = new InMemoryGraphMemory();
  }

  async retrieve(query: string, opts: RetrieveOpts = {}): Promise<readonly MemoryHit[]> {
    const limit = opts.limit ?? 10;
    const layers = new Set<MemoryHit["layer"]>(
      opts.layers ?? ["working", "episodic", "semantic", "graph"],
    );
    const hits: MemoryHit[] = [];
    if (layers.has("working")) {
      hits.push(
        ...this.workingMemory
          .list()
          .filter((h) => h.content.toLowerCase().includes(query.toLowerCase())),
      );
    }
    if (layers.has("episodic")) {
      const recent = await this.episodic.recent(limit);
      hits.push(
        ...recent.filter((h) => h.content.toLowerCase().includes(query.toLowerCase())),
      );
    }
    if (layers.has("semantic")) {
      hits.push(...(await this.semantic.search(query, limit)));
    }
    return hits.slice(0, limit);
  }
}

class InMemoryWorkingMemory implements WorkingMemory {
  private readonly _entries: MemoryHit[] = [];
  add(entry: Pick<MemoryHit, "id" | "content" | "source">): void {
    this._entries.push({
      id: entry.id,
      layer: "working",
      content: entry.content,
      source: entry.source,
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
}

class InMemoryEpisodicMemory implements EpisodicMemory {
  private readonly _events: MemoryHit[] = [];
  async record(event: { id: string; content: string; source?: string }): Promise<void> {
    this._events.push({
      id: event.id,
      layer: "episodic",
      content: event.content,
      source: event.source,
      score: 1,
      capturedAt: new Date().toISOString(),
    });
  }
  async recent(limit = 20): Promise<readonly MemoryHit[]> {
    return this._events.slice(-limit).reverse();
  }
}

class InMemorySemanticMemory implements SemanticMemory {
  private readonly _facts = new Map<string, string>();
  async upsert(fact: { id: string; content: string }): Promise<void> {
    this._facts.set(fact.id, fact.content);
  }
  async search(query: string, limit = 10): Promise<readonly MemoryHit[]> {
    const lower = query.toLowerCase();
    const hits: MemoryHit[] = [];
    for (const [id, content] of this._facts) {
      if (content.toLowerCase().includes(lower)) {
        hits.push({
          id,
          layer: "semantic",
          content,
          score: 1,
          capturedAt: new Date().toISOString(),
        });
      }
      if (hits.length >= limit) break;
    }
    return hits;
  }
}

class InMemoryGraphMemory implements GraphMemory {
  private readonly _edges = new Map<string, Set<string>>();

  async link(from: string, to: string, kind: string): Promise<void> {
    const key = `${from}::${kind}`;
    const set = this._edges.get(key) ?? new Set<string>();
    set.add(to);
    this._edges.set(key, set);
  }
  async neighbors(id: string, kind?: string): Promise<readonly string[]> {
    if (kind) {
      const set = this._edges.get(`${id}::${kind}`);
      return set ? Array.from(set) : [];
    }
    const out: string[] = [];
    for (const [key, set] of this._edges) {
      if (key.startsWith(`${id}::`)) out.push(...set);
    }
    return out;
  }
}

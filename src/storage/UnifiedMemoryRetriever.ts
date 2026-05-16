import type {
  MemoryQuery,
  MemoryLayerId,
} from "./MemoryLayers.types.js";
import type { WorkingMemory } from "./WorkingMemory.js";
import type { EpisodicMemory } from "./EpisodicMemory.js";
import type { MemoryStore } from "./MemoryStore.js";
import type { GraphQueryEngine } from "./GraphQueryEngine.js";
import type { EmbeddingClient } from "./EmbeddingClient.js";
import type {
  ToolOutputCache,
  ToolOutputSearchResult,
} from "./ToolOutputCache.js";
import { DEFAULT_SEMANTIC_THRESHOLD } from "./ToolOutputCache.js";
import { getLogger } from "../utils/logger.js";
import { formatForLog } from "../utils/errors.js";

const CHARS_PER_TOKEN = 4;

/** Default budget distribution across layers (must sum to 1.0). */
const DEFAULT_BUDGET_WEIGHTS: Record<MemoryLayerId, number> = {
  working: 0.2,
  semantic: 0.3,
  graph: 0.25,
  episodic: 0.25,
};

/** Priority for trimming when over budget (lower = trimmed first). */
const TRIM_PRIORITY: Record<MemoryLayerId, number> = {
  episodic: 0, // trimmed first
  graph: 1,
  semantic: 2,
  working: 3, // never trimmed
};

/**
 * Phase 5 (v0.5.0) -- Options for `searchToolOutputs`. `topK` caps the result
 * count; `threshold` overrides the default 0.85 cosine similarity bar applied
 * to Ollama-provenance rows. `heuristicThreshold` (v0.6.0) overrides the
 * elevated 0.95 bar applied to heuristic-provenance rows.
 */
export interface ToolOutputSearchOptions {
  readonly topK: number;
  readonly threshold?: number;
  readonly heuristicThreshold?: number;
}

/**
 * v0.9.0 Phase 2.2 -- retrieval routing. `hybrid` (default) sends the
 * semantic-layer call to `MemoryStore.retrieveHybrid` (HNSW + FTS5 +
 * recency fusion); `legacy` preserves the keyword + cosine merge path
 * for one cycle as a fallback.
 */
export type RetrievalRoute = "legacy" | "hybrid";

/**
 * Unified memory retrieval across all four layers.
 *
 * Distributes a token budget across layers, queries each in parallel,
 * merges results into a single formatted string, and trims to fit
 * the budget (episodic first, working never).
 *
 * Each layer is optional for graceful degradation.
 */
export class UnifiedMemoryRetriever {
  private readonly _workingMemory: WorkingMemory | null;
  private readonly _episodicMemory: EpisodicMemory | null;
  private readonly _semanticMemory: MemoryStore | null;
  private readonly _graphEngine: GraphQueryEngine | null;
  private readonly _toolOutputCache: ToolOutputCache | null;
  private readonly _embedder: EmbeddingClient | null;
  private _corroborationThreshold: number;
  private _retrievalRoute: RetrievalRoute;

  constructor(
    workingMemory: WorkingMemory | null,
    episodicMemory: EpisodicMemory | null,
    semanticMemory: MemoryStore | null,
    graphEngine: GraphQueryEngine | null,
    toolOutputCache: ToolOutputCache | null = null,
    embedder: EmbeddingClient | null = null,
    corroborationThreshold = 1,
    retrievalRoute: RetrievalRoute = "hybrid",
  ) {
    this._workingMemory = workingMemory;
    this._episodicMemory = episodicMemory;
    this._semanticMemory = semanticMemory;
    this._graphEngine = graphEngine;
    this._toolOutputCache = toolOutputCache;
    this._embedder = embedder;
    this._corroborationThreshold = corroborationThreshold;
    this._retrievalRoute = retrievalRoute;
  }

  /** Update the corroboration tier threshold at runtime (settings change). */
  setCorroborationThreshold(threshold: number): void {
    this._corroborationThreshold = Math.max(1, Math.floor(threshold));
  }

  /** v0.9.0 Phase 2.2 -- switch between the hybrid and legacy retrieval paths. */
  setRetrievalRoute(route: RetrievalRoute): void {
    this._retrievalRoute = route;
  }

  /** Read the active retrieval route. */
  getRetrievalRoute(): RetrievalRoute {
    return this._retrievalRoute;
  }

  /** Read the active corroboration threshold. */
  getCorroborationThreshold(): number {
    return this._corroborationThreshold;
  }

  /**
   * Phase 5 -- semantic recall over the persistent tool-output cache. When an
   * EmbeddingClient is wired and reachable, scores cached rows by cosine
   * similarity at `threshold` (default 0.85). Falls back to FTS5 keyword
   * search whenever:
   *   1. The retriever was constructed without a ToolOutputCache (no-op),
   *   2. No EmbeddingClient is wired (skip semantic step entirely),
   *   3. The embedder returns null (Ollama offline / model unavailable),
   *   4. The semantic step returns zero results.
   * The semantic step never throws upstream -- failures degrade to keyword.
   */
  async searchToolOutputs(
    query: string,
    options: ToolOutputSearchOptions,
  ): Promise<ToolOutputSearchResult[]> {
    if (!this._toolOutputCache) return [];
    if (!query) return [];

    const threshold = options.threshold ?? DEFAULT_SEMANTIC_THRESHOLD;
    const heuristicThreshold = options.heuristicThreshold;

    if (this._embedder) {
      let queryVec: number[] | null = null;
      try {
        queryVec = await this._embedder.embed(query);
      } catch (err) {
        getLogger().debug(
          "[UnifiedMemoryRetriever] embed threw during searchToolOutputs:",
          formatForLog(err),
        );
        queryVec = null;
      }
      if (queryVec) {
        const semantic = this._toolOutputCache.searchByEmbedding(queryVec, {
          topK: options.topK,
          threshold,
          ...(heuristicThreshold !== undefined ? { heuristicThreshold } : {}),
        });
        if (semantic.length > 0) return semantic;
      }
    }

    return this._toolOutputCache.searchByKeyword(query, options.topK);
  }

  /**
   * Query all requested layers and return a single formatted string.
   * Budget is distributed proportionally across available layers.
   */
  async retrieve(query: MemoryQuery): Promise<string> {
    const requestedLayers = new Set(query.layers);

    // Determine which layers are available and requested.
    const activeLayers = new Map<MemoryLayerId, number>();
    if (requestedLayers.has("working") && this._workingMemory) {
      activeLayers.set("working", DEFAULT_BUDGET_WEIGHTS.working);
    }
    if (requestedLayers.has("semantic") && this._semanticMemory) {
      activeLayers.set("semantic", DEFAULT_BUDGET_WEIGHTS.semantic);
    }
    if (requestedLayers.has("graph") && this._graphEngine) {
      activeLayers.set("graph", DEFAULT_BUDGET_WEIGHTS.graph);
    }
    if (requestedLayers.has("episodic") && this._episodicMemory) {
      activeLayers.set("episodic", DEFAULT_BUDGET_WEIGHTS.episodic);
    }

    if (activeLayers.size === 0) return "";

    // Redistribute budget proportionally across active layers.
    const totalWeight = [...activeLayers.values()].reduce((s, w) => s + w, 0);
    const layerBudgets = new Map<MemoryLayerId, number>();
    for (const [layer, weight] of activeLayers) {
      layerBudgets.set(layer, Math.floor(query.tokenBudget * (weight / totalWeight)));
    }

    // Query each layer in parallel.
    const results = new Map<MemoryLayerId, string>();

    const promises: Array<Promise<void>> = [];

    if (layerBudgets.has("working")) {
      // Working memory is synchronous.
      const budget = layerBudgets.get("working")!;
      try {
        const content = this._workingMemory!.serialize(budget);
        if (content) results.set("working", content);
      } catch { /* non-fatal */ }
    }

    if (layerBudgets.has("semantic")) {
      const budget = layerBudgets.get("semantic")!;
      // v0.9.0 Phase 2.2: hybrid routes through `searchHybrid` (HNSW + FTS5
      // + recency fusion); legacy preserves the v0.7.0 keyword + cosine
      // merge for one cycle as a fallback.
      const fetch =
        this._retrievalRoute === "hybrid"
          ? this._semanticMemory!.retrieveHybrid(query.query, budget)
          : this._semanticMemory!.retrieve(
              query.query,
              budget,
              this._corroborationThreshold,
            );
      promises.push(
        fetch
          .then((content) => { if (content) results.set("semantic", content); })
          .catch(() => { /* non-fatal */ }),
      );
    }

    if (layerBudgets.has("graph")) {
      const budget = layerBudgets.get("graph")!;
      try {
        const graphResult = this._graphEngine!.queryContextFor(query.query, 15);
        const content = this._graphEngine!.formatAsContext(graphResult, budget);
        if (content) results.set("graph", content);
      } catch { /* non-fatal */ }
    }

    if (layerBudgets.has("episodic")) {
      const budget = layerBudgets.get("episodic")!;
      promises.push(
        this._episodicMemory!.retrieve(query.query, budget)
          .then((content) => { if (content) results.set("episodic", content); })
          .catch(() => { /* non-fatal */ }),
      );
    }

    await Promise.all(promises);

    if (results.size === 0) return "";

    // Merge into single string, ordered by trim priority (working first).
    const ordered: Array<[MemoryLayerId, string]> = [...results.entries()]
      .sort((a, b) => (TRIM_PRIORITY[b[0]] ?? 0) - (TRIM_PRIORITY[a[0]] ?? 0));

    const header = "## Memory Context\n\n";
    let merged = header;
    const maxChars = query.tokenBudget * CHARS_PER_TOKEN;

    for (const [, content] of ordered) {
      const candidate = merged + content + "\n\n";
      if (candidate.length <= maxChars) {
        merged = candidate;
      } else {
        // Trim: try to fit what we can.
        const remaining = maxChars - merged.length;
        if (remaining > 20) {
          merged += content.slice(0, remaining - 3) + "...";
        }
        break;
      }
    }

    return merged.trimEnd();
  }

  /**
   * Convenience method for PromptBuilder. Creates a MemoryQuery with all
   * layers and calls retrieve().
   */
  async retrieveForPrompt(
    currentQuery: string,
    maxTokens: number,
  ): Promise<string> {
    return this.retrieve({
      query: currentQuery,
      layers: ["working", "episodic", "semantic", "graph"],
      tokenBudget: maxTokens,
      maxResults: 20,
      includeStale: false,
    });
  }

  /** Report which layers are available and their entry counts. */
  getLayerStats(): Record<MemoryLayerId, { available: boolean; entryCount: number }> {
    return {
      working: {
        available: this._workingMemory !== null,
        entryCount: this._workingMemory ? 1 : 0, // single state object
      },
      episodic: {
        available: this._episodicMemory !== null,
        // NOTE(v0.5): expose EpisodicMemory.count() and surface it here.
        entryCount: 0,
      },
      semantic: {
        available: this._semanticMemory !== null,
        entryCount: this._semanticMemory?.getStats().totalEntries ?? 0,
      },
      graph: {
        available: this._graphEngine !== null,
        // NOTE(v0.5): expose GraphMemory.getStats() and surface it here.
        entryCount: 0,
      },
    };
  }
}

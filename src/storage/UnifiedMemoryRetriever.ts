import type {
  MemoryQuery,
  MemoryLayerId,
} from "./MemoryLayers.types.js";
import type { WorkingMemory } from "./WorkingMemory.js";
import type { EpisodicMemory } from "./EpisodicMemory.js";
import type { MemoryStore } from "./MemoryStore.js";
import type { GraphQueryEngine } from "./GraphQueryEngine.js";

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

  constructor(
    workingMemory: WorkingMemory | null,
    episodicMemory: EpisodicMemory | null,
    semanticMemory: MemoryStore | null,
    graphEngine: GraphQueryEngine | null,
  ) {
    this._workingMemory = workingMemory;
    this._episodicMemory = episodicMemory;
    this._semanticMemory = semanticMemory;
    this._graphEngine = graphEngine;
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
      promises.push(
        this._semanticMemory!.retrieve(query.query, budget)
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
        entryCount: 0, // would need a count query; kept simple
      },
      semantic: {
        available: this._semanticMemory !== null,
        entryCount: this._semanticMemory?.getStats().totalEntries ?? 0,
      },
      graph: {
        available: this._graphEngine !== null,
        entryCount: 0, // would need graph stats; kept simple
      },
    };
  }
}

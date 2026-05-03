import Database from "better-sqlite3";
import { MemoryStore } from "./MemoryStore.js";
import { secureDbPermissions } from "./dbPermissions.js";
import { EmbeddingClient } from "./EmbeddingClient.js";
import { createWorkingMemory } from "./WorkingMemory.js";
import type { WorkingMemory } from "./WorkingMemory.js";
import { EpisodicMemory } from "./EpisodicMemory.js";
import { GraphMemory } from "./GraphMemory.js";
import { EntityExtractor } from "./EntityExtractor.js";
import { GraphQueryEngine } from "./GraphQueryEngine.js";
import { MemoryConsolidator } from "./MemoryConsolidator.js";
import { UnifiedMemoryRetriever } from "./UnifiedMemoryRetriever.js";
import type { ToolOutputCache } from "./ToolOutputCache.js";
import type { LLMClient } from "../llm/types.js";

export interface MemorySubsystemOptions {
  dbPath: string;
  /**
   * Vendor-neutral LLM port used for embedding generation. The composition
   * root constructs the concrete client and passes it in; storage modules
   * never depend on a specific provider.
   */
  llmClient: LLMClient;
  embeddingModel: string | null;
  /**
   * Phase 5 (v0.5.0): optional persistent tool-output cache. When provided,
   * the subsystem wires its EmbeddingClient into the cache for async
   * embed-after-store and threads the cache through to UnifiedMemoryRetriever
   * so `searchToolOutputs(...)` can resolve.
   */
  toolOutputCache?: ToolOutputCache | null;
  /**
   * Phase 7 (v0.5.0): N-corroboration threshold. Default 2. Single-source
   * observations are kept as candidates and only retrieved when no fact-tier
   * match is available. Set to 1 to disable (legacy behavior).
   */
  corroborationThreshold?: number;
}

/**
 * Single factory that constructs the full 4-layer memory stack. Owns every
 * piece of shared state so the panel no longer has to wire it by hand.
 * On construction failure any partially-built pieces are discarded and the
 * whole subsystem is reported as unavailable via `isReady === false`.
 */
export class MemorySubsystem {
  readonly memoryStore: MemoryStore | null;
  readonly workingMemory: WorkingMemory | null;
  readonly episodicMemory: EpisodicMemory | null;
  readonly graphMemory: GraphMemory | null;
  readonly graphQueryEngine: GraphQueryEngine | null;
  readonly entityExtractor: EntityExtractor | null;
  readonly memoryConsolidator: MemoryConsolidator | null;
  readonly unifiedRetriever: UnifiedMemoryRetriever | null;
  // One shared Database backing all memory layers (finding #65). Opened
  // here, passed by reference to every layer, and closed exactly once via
  // MemorySubsystem.close(). Before this consolidation, MemoryStore,
  // EpisodicMemory, and GraphMemory each opened their own connection,
  // causing WAL-lock contention on concurrent writes.
  private readonly _sharedDb: Database.Database | null;

  constructor(options: MemorySubsystemOptions | null) {
    const built = options ? buildSubsystem(options) : EMPTY_BUILT;
    this.memoryStore = built.memoryStore;
    this.workingMemory = built.workingMemory;
    this.episodicMemory = built.episodicMemory;
    this.graphMemory = built.graphMemory;
    this.graphQueryEngine = built.graphQueryEngine;
    this.entityExtractor = built.entityExtractor;
    this.memoryConsolidator = built.memoryConsolidator;
    this.unifiedRetriever = built.unifiedRetriever;
    this._sharedDb = built.sharedDb;
  }

  static disabled(): MemorySubsystem {
    return new MemorySubsystem(null);
  }

  get isReady(): boolean {
    return this.memoryStore !== null && this.unifiedRetriever !== null;
  }

  /** Close the single shared Database connection backing every memory layer. */
  close(): void {
    this._sharedDb?.close();
  }
}

interface Built {
  memoryStore: MemoryStore | null;
  workingMemory: WorkingMemory | null;
  episodicMemory: EpisodicMemory | null;
  graphMemory: GraphMemory | null;
  graphQueryEngine: GraphQueryEngine | null;
  entityExtractor: EntityExtractor | null;
  memoryConsolidator: MemoryConsolidator | null;
  unifiedRetriever: UnifiedMemoryRetriever | null;
  sharedDb: Database.Database | null;
}

const EMPTY_BUILT: Built = {
  memoryStore: null,
  workingMemory: null,
  episodicMemory: null,
  graphMemory: null,
  graphQueryEngine: null,
  entityExtractor: null,
  memoryConsolidator: null,
  unifiedRetriever: null,
  sharedDb: null,
};

function buildSubsystem(options: MemorySubsystemOptions): Built {
  let sharedDb: Database.Database | null = null;
  try {
    const embedder = options.embeddingModel
      ? new EmbeddingClient(options.llmClient, options.embeddingModel)
      : null;

    // Single connection shared across MemoryStore, EpisodicMemory, and
    // GraphMemory. All three classes accept an already-open Database and
    // do NOT close it on their own .close() methods.
    sharedDb = new Database(options.dbPath);
    secureDbPermissions(options.dbPath);
    sharedDb.pragma("journal_mode = WAL");

    const memoryStore = new MemoryStore(sharedDb, embedder);
    const workingMemory = createWorkingMemory();
    const episodicMemory = new EpisodicMemory(sharedDb, embedder);
    const graphMemory = new GraphMemory(sharedDb);

    const graphQueryEngine = new GraphQueryEngine(graphMemory, embedder);
    memoryStore.setGraphEngine(graphQueryEngine);

    const entityExtractor = new EntityExtractor();

    const corroborationThreshold = Math.max(
      1,
      Math.floor(options.corroborationThreshold ?? 2),
    );
    const memoryConsolidator = new MemoryConsolidator(
      memoryStore,
      episodicMemory,
      graphMemory,
      entityExtractor,
      { policy: "pattern_recurring", minRecurrences: 2, requireVerification: false },
      corroborationThreshold,
    );

    // Phase 5: wire the shared embedder into the persistent tool-output
    // cache (if provided) so embed-after-store fires for cached reads.
    if (options.toolOutputCache && embedder) {
      options.toolOutputCache.setEmbedder(embedder);
    }

    const unifiedRetriever = new UnifiedMemoryRetriever(
      workingMemory,
      episodicMemory,
      memoryStore,
      graphQueryEngine,
      options.toolOutputCache ?? null,
      embedder,
      corroborationThreshold,
    );

    return {
      memoryStore,
      workingMemory,
      episodicMemory,
      graphMemory,
      graphQueryEngine,
      entityExtractor,
      memoryConsolidator,
      unifiedRetriever,
      sharedDb,
    };
  } catch {
    // On construction failure, close the shared DB so we do not leak a file
    // handle. Individual layer constructors that ran before the failure
    // were passed the shared DB and do not own it, so this is the only
    // place the connection can be reclaimed.
    sharedDb?.close();
    return EMPTY_BUILT;
  }
}

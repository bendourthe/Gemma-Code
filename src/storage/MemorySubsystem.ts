import Database from "better-sqlite3";
import { MemoryStore } from "./MemoryStore.js";
import { EmbeddingClient } from "./EmbeddingClient.js";
import { createWorkingMemory } from "./WorkingMemory.js";
import type { WorkingMemory } from "./WorkingMemory.js";
import { EpisodicMemory } from "./EpisodicMemory.js";
import { GraphMemory } from "./GraphMemory.js";
import { EntityExtractor } from "./EntityExtractor.js";
import { GraphQueryEngine } from "./GraphQueryEngine.js";
import { MemoryConsolidator } from "./MemoryConsolidator.js";
import { UnifiedMemoryRetriever } from "./UnifiedMemoryRetriever.js";

export interface MemorySubsystemOptions {
  dbPath: string;
  ollamaUrl: string;
  embeddingModel: string | null;
  requestTimeout: number;
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
  }

  static disabled(): MemorySubsystem {
    return new MemorySubsystem(null);
  }

  get isReady(): boolean {
    return this.memoryStore !== null && this.unifiedRetriever !== null;
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
};

function buildSubsystem(options: MemorySubsystemOptions): Built {
  try {
    const embedder = options.embeddingModel
      ? new EmbeddingClient(options.ollamaUrl, options.embeddingModel, options.requestTimeout)
      : null;

    const memoryStore = new MemoryStore(options.dbPath, embedder);
    const workingMemory = createWorkingMemory();
    const episodicMemory = new EpisodicMemory(options.dbPath, embedder);

    const graphDb = new Database(options.dbPath);
    graphDb.pragma("journal_mode = WAL");
    const graphMemory = new GraphMemory(graphDb);

    const graphQueryEngine = new GraphQueryEngine(graphMemory, embedder);
    memoryStore.setGraphEngine(graphQueryEngine);

    const entityExtractor = new EntityExtractor();

    const memoryConsolidator = new MemoryConsolidator(
      memoryStore,
      episodicMemory,
      graphMemory,
      entityExtractor,
      { policy: "pattern_recurring", minRecurrences: 2, requireVerification: false },
    );

    const unifiedRetriever = new UnifiedMemoryRetriever(
      workingMemory,
      episodicMemory,
      memoryStore,
      graphQueryEngine,
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
    };
  } catch {
    return EMPTY_BUILT;
  }
}

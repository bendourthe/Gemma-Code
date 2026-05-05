import type {
  EpisodicEntry,
  WriteGate,
  MemoryProvenance,
  MemoryTTL,
} from "./MemoryLayers.types.js";
import type { MemoryType } from "./MemoryStore.types.js";
import type { MemoryStore } from "./MemoryStore.js";
import type { EpisodicMemory } from "./EpisodicMemory.js";
import type { GraphMemory } from "./GraphMemory.js";
import { EntityExtractor } from "./EntityExtractor.js";

export interface DetectedPattern {
  readonly action: string;
  readonly context: string;
  readonly outcome: string | null;
  readonly occurrences: number;
  readonly sessionIds: string[];
  readonly confidence: number;
}

export interface ConsolidationReport {
  readonly entitiesAdded: number;
  readonly relationsAdded: number;
  readonly patternsDetected: number;
  readonly memoriesPromoted: number;
  readonly memoriesSkipped: number;
  readonly errors: string[];
}

/**
 * Counter snapshot exposed by `MemoryConsolidator.getCounters()` so callers
 * (panel, tests) can observe consolidation behavior without a full metrics
 * pipeline. Read-only -- counters are reset only by `resetCounters()`.
 */
export interface ConsolidationCounters {
  readonly observationAdded: number;
  readonly candidatePromoted: number;
  readonly candidateReturned: number;
}

export type CorroborationOutcome =
  | { readonly action: "inserted"; readonly id: string }
  | { readonly action: "incremented"; readonly id: string; readonly count: number }
  | { readonly action: "promoted"; readonly id: string; readonly count: number };

const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Memory consolidation pipeline. Detects recurring patterns in episodic
 * memory, extracts entities for the knowledge graph, and promotes
 * qualified patterns to semantic memory with write policy enforcement.
 */
export class MemoryConsolidator {
  private readonly _memoryStore: MemoryStore;
  private readonly _episodicMemory: EpisodicMemory;
  private readonly _graphMemory: GraphMemory;
  private readonly _entityExtractor: EntityExtractor;
  private readonly _writeGate: WriteGate;
  private _corroborationThreshold: number;
  private _counters = {
    observationAdded: 0,
    candidatePromoted: 0,
    candidateReturned: 0,
  };

  constructor(
    memoryStore: MemoryStore,
    episodicMemory: EpisodicMemory,
    graphMemory: GraphMemory,
    entityExtractor: EntityExtractor,
    writeGate: WriteGate,
    corroborationThreshold = 2,
  ) {
    this._memoryStore = memoryStore;
    this._episodicMemory = episodicMemory;
    this._graphMemory = graphMemory;
    this._entityExtractor = entityExtractor;
    this._writeGate = writeGate;
    this._corroborationThreshold = Math.max(1, Math.floor(corroborationThreshold));
  }

  /** Update the active threshold at runtime (settings change). */
  setCorroborationThreshold(threshold: number): void {
    this._corroborationThreshold = Math.max(1, Math.floor(threshold));
  }

  /** Return the active threshold. */
  getCorroborationThreshold(): number {
    return this._corroborationThreshold;
  }

  /** Read the current counter snapshot. */
  getCounters(): ConsolidationCounters {
    return { ...this._counters };
  }

  /** Reset counters to zero (used by tests). */
  resetCounters(): void {
    this._counters = {
      observationAdded: 0,
      candidatePromoted: 0,
      candidateReturned: 0,
    };
  }

  /** Record that a candidate-tier row was returned during retrieval (no fact-tier match). */
  recordCandidateReturned(): void {
    this._counters.candidateReturned += 1;
  }

  /**
   * Add a single observation. If a matching memory row already exists (by
   * identical content or Jaccard >= 0.9), increment its `corroboration_count`
   * and promote to fact tier when the threshold is crossed; otherwise insert
   * a new row at count 1.
   */
  async addObservation(
    content: string,
    type: MemoryType,
    sessionId?: string,
  ): Promise<CorroborationOutcome> {
    this._counters.observationAdded += 1;
    const existing = this._memoryStore.findMatchingEntry(content);
    if (existing) {
      const newCount = this._memoryStore.incrementCorroboration(existing.id);
      if (newCount === null) {
        // Race condition: row was deleted between the lookup and the update.
        // Fall through to a fresh insert.
      } else {
        const wasCandidate = existing.corroborationCount < this._corroborationThreshold;
        const isFact = newCount >= this._corroborationThreshold;
        if (wasCandidate && isFact) {
          this._counters.candidatePromoted += 1;
          return { action: "promoted", id: existing.id, count: newCount };
        }
        return { action: "incremented", id: existing.id, count: newCount };
      }
    }
    const entry = await this._memoryStore.save(content, type, sessionId);
    return { action: "inserted", id: entry.id };
  }

  /**
   * Run the full consolidation pipeline for a session.
   *
   * Steps:
   * 1. Gather episodic events from the session
   * 2. Extract entities and relations into the knowledge graph
   * 3. Detect recurring patterns across sessions
   * 4. Promote qualifying patterns to semantic memory
   */
  async consolidate(sessionId: string): Promise<ConsolidationReport> {
    const errors: string[] = [];
    let entitiesAdded = 0;
    let relationsAdded = 0;

    // 1. Gather session events.
    const events = this._episodicMemory.getSessionEvents(sessionId);
    if (events.length === 0) {
      return {
        entitiesAdded: 0,
        relationsAdded: 0,
        patternsDetected: 0,
        memoriesPromoted: 0,
        memoriesSkipped: 0,
        errors: [],
      };
    }

    // 2. Extract entities and relations.
    //
    // Wrap the per-event upserts in a single transaction. Without this,
    // each `upsertEntity` / `upsertRelation` call commits independently --
    // a 10K-event session triggers tens of thousands of fsyncs and can run
    // for minutes. better-sqlite3's `transaction()` only supports
    // synchronous callbacks, which is fine here: extraction and upserts
    // are both sync. Errors on individual events are still captured per
    // event so partial-pipeline progress is preserved.
    this._graphMemory.transaction(() => {
      for (const event of events) {
        try {
          const text = `${event.action} ${event.context} ${event.outcome ?? ""}`;
          const entities = this._entityExtractor.extractFromText(text);
          const relations = this._entityExtractor.extractRelationsFromText(text, entities);

          for (const entity of entities) {
            this._graphMemory.upsertEntity(entity.name, entity.type);
            entitiesAdded++;
          }

          for (const relation of relations) {
            this._graphMemory.upsertRelation(
              relation.source.name,
              relation.source.type,
              relation.target.name,
              relation.target.type,
              relation.type,
              event.provenance,
            );
            relationsAdded++;
          }
        } catch (err) {
          errors.push(`Entity extraction failed for event ${event.id}: ${String(err)}`);
        }
      }
    });

    // 3. Detect patterns.
    const patterns = this.detectPatterns(events);

    // 4. Promote qualifying patterns.
    let memoriesPromoted = 0;
    let memoriesSkipped = 0;

    for (const pattern of patterns) {
      if (!this.shouldPersist(pattern, this._writeGate)) {
        memoriesSkipped++;
        continue;
      }

      try {
        const promoted = await this.promoteToMemory(pattern);
        if (promoted) {
          memoriesPromoted++;
        } else {
          memoriesSkipped++;
        }
      } catch (err) {
        errors.push(`Promotion failed for pattern "${pattern.action}": ${String(err)}`);
        memoriesSkipped++;
      }
    }

    return {
      entitiesAdded,
      relationsAdded,
      patternsDetected: patterns.length,
      memoriesPromoted,
      memoriesSkipped,
      errors,
    };
  }

  /**
   * Group similar episodic events into patterns based on action and
   * context similarity (token overlap > 70%).
   */
  detectPatterns(events: EpisodicEntry[]): DetectedPattern[] {
    const groups: Array<{
      action: string;
      context: string;
      outcome: string | null;
      occurrences: number;
      sessionIds: Set<string>;
      confidenceSum: number;
    }> = [];

    for (const event of events) {
      let matched = false;
      for (const group of groups) {
        if (
          this._tokenOverlap(event.action, group.action) > 0.7 &&
          this._tokenOverlap(event.context, group.context) > 0.7
        ) {
          group.occurrences++;
          group.sessionIds.add(event.sessionId);
          group.confidenceSum += event.provenance.confidence;
          if (event.outcome && !group.outcome) {
            group.outcome = event.outcome;
          }
          matched = true;
          break;
        }
      }

      if (!matched) {
        groups.push({
          action: event.action,
          context: event.context,
          outcome: event.outcome,
          occurrences: 1,
          sessionIds: new Set([event.sessionId]),
          confidenceSum: event.provenance.confidence,
        });
      }
    }

    return groups
      .filter((g) => g.occurrences >= this._writeGate.minRecurrences)
      .map((g) => ({
        action: g.action,
        context: g.context,
        outcome: g.outcome,
        occurrences: g.occurrences,
        sessionIds: [...g.sessionIds],
        confidence: Math.min(0.95, 0.5 + 0.1 * g.occurrences),
      }));
  }

  /**
   * Apply write gate rules to determine if a pattern should be promoted.
   * The `user_requested` policy was removed in v0.4.0 (finding #57) because
   * the consolidation pipeline has no access to user-stated provenance.
   */
  shouldPersist(pattern: DetectedPattern, gate: WriteGate): boolean {
    switch (gate.policy) {
      case "always":
        return true;
      case "tool_verified":
        return pattern.confidence >= 0.8;
      case "pattern_recurring":
        return pattern.occurrences >= gate.minRecurrences;
      default:
        return false;
    }
  }

  /** Promote a detected pattern to a semantic memory entry. */
  async promoteToMemory(
    pattern: DetectedPattern,
  ): Promise<{ id: string } | null> {
    const outcomeStr = pattern.outcome ? ` typically results in ${pattern.outcome}` : "";
    const content = `Pattern: ${pattern.action} in context ${pattern.context}${outcomeStr}`;

    // Check for duplicates.
    if (this._memoryStore.isDuplicate(content)) {
      return null;
    }

    const type = this._inferMemoryType(pattern);
    const provenance: MemoryProvenance = {
      source: "pattern_detected",
      sourceSessionId: pattern.sessionIds[0] ?? null,
      sourceMessageId: null,
      timestamp: Date.now(),
      confidence: pattern.confidence,
    };
    const ttl: MemoryTTL = {
      createdAt: Date.now(),
      expiresAt: null,
      lastVerifiedAt: Date.now(),
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
    };

    const entry = await this._memoryStore.saveWithProvenance(
      content,
      type,
      provenance,
      ttl,
      "project",
    );

    return { id: entry.id };
  }

  /** Infer the appropriate MemoryType from a pattern's action. */
  private _inferMemoryType(pattern: DetectedPattern): MemoryType {
    const action = pattern.action.toLowerCase();
    if (action.includes("decision")) return "decision";
    if (action.includes("error") || action.includes("fail")) return "error_resolution";
    if (action.includes("prefer") || action.includes("convention")) return "preference";
    return "fact";
  }

  /**
   * Compute token overlap between two strings.
   * Returns intersection / union ratio (0.0 to 1.0).
   */
  private _tokenOverlap(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
    if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }

    const union = tokensA.size + tokensB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}

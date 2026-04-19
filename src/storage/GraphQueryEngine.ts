import type {
  GraphEntity,
  GraphRelation,
  RelationType,
} from "./MemoryLayers.types.js";
import type { GraphMemory } from "./GraphMemory.js";
import type { EmbeddingClient } from "./EmbeddingClient.js";
import { EntityExtractor } from "./EntityExtractor.js";
import {
  CHARS_PER_TOKEN,
  MAX_NODES_VISITED,
  ONE_DAY_MS,
  ONE_WEEK_MS,
} from "./constants.js";

export interface GraphQueryResult {
  readonly entities: GraphEntity[];
  readonly relations: GraphRelation[];
  readonly totalWeight: number;
}

export interface PathExplanation {
  readonly path: GraphEntity[];
  readonly relations: GraphRelation[];
  readonly explanation: string;
}

/**
 * Query engine for the graph memory layer. Supports multi-hop traversal,
 * recency-weighted scoring, and formatted context injection.
 */
export class GraphQueryEngine {
  private readonly _graphMemory: GraphMemory;
  private readonly _embedder: EmbeddingClient | null;
  private readonly _entityExtractor: EntityExtractor;

  constructor(
    graphMemory: GraphMemory,
    embedder?: EmbeddingClient | null,
  ) {
    this._graphMemory = graphMemory;
    this._embedder = embedder ?? null;
    this._entityExtractor = new EntityExtractor();
  }

  /**
   * Query by a specific entity name, traversing up to `depth` hops.
   * Results are sorted by weight * recency_factor.
   */
  queryByEntity(
    entityName: string,
    depth: number,
    limit: number,
  ): GraphQueryResult {
    const entity = this._graphMemory.getEntity(entityName);
    if (!entity) return { entities: [], relations: [], totalWeight: 0 };

    const relatedEntities = this._graphMemory.findRelatedEntities(entityName, depth);
    const allEntities = [entity, ...relatedEntities];

    // Collect all relations between discovered entities.
    const entityIds = new Set(allEntities.map((e) => e.id));
    const relations: GraphRelation[] = [];
    const seenRelations = new Set<string>();

    for (const e of allEntities) {
      const rels = this._graphMemory.getEntityRelations(e.id, "both");
      for (const rel of rels) {
        if (
          !seenRelations.has(rel.id) &&
          entityIds.has(rel.sourceId) &&
          entityIds.has(rel.targetId)
        ) {
          seenRelations.add(rel.id);
          relations.push(rel);
        }
      }
    }

    // Score and sort by weight * recency.
    const now = Date.now();
    const scored = allEntities
      .map((e) => ({
        entity: e,
        score: e.mentionCount * this._recencyFactor(e.lastSeenAt, now),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const totalWeight = relations.reduce((sum, r) => sum + r.weight, 0);

    return {
      entities: scored.map((s) => s.entity),
      relations,
      totalWeight,
    };
  }

  /** All relations of a given type, sorted by weight descending. */
  queryByRelationType(
    relationType: RelationType,
    limit: number,
  ): GraphQueryResult {
    // Since GraphMemory doesn't have a direct "all relations by type" method,
    // we search for entities and collect their relations.
    const allEntities = this._graphMemory.searchEntities("", undefined, 200);
    const relations: GraphRelation[] = [];
    const seenRelations = new Set<string>();
    const involvedEntityIds = new Set<string>();

    for (const entity of allEntities) {
      const rels = this._graphMemory.getEntityRelations(entity.id, "both");
      for (const rel of rels) {
        if (rel.type === relationType && !seenRelations.has(rel.id)) {
          seenRelations.add(rel.id);
          relations.push(rel);
          involvedEntityIds.add(rel.sourceId);
          involvedEntityIds.add(rel.targetId);
        }
      }
    }

    relations.sort((a, b) => b.weight - a.weight);
    const limited = relations.slice(0, limit);

    const entities = allEntities.filter((e) => involvedEntityIds.has(e.id));
    const totalWeight = limited.reduce((sum, r) => sum + r.weight, 0);

    return { entities, relations: limited, totalWeight };
  }

  /**
   * Extract entity names from a natural language query, traverse each,
   * and merge results.
   */
  queryContextFor(query: string, limit: number): GraphQueryResult {
    const extracted = this._entityExtractor.extractFromText(query);
    if (extracted.length === 0) {
      // Fall back to word-based entity search.
      const words = query.split(/\s+/).filter((w) => w.length > 3);
      const allEntities: GraphEntity[] = [];
      for (const word of words.slice(0, 5)) {
        const found = this._graphMemory.searchEntities(word, undefined, 5);
        allEntities.push(...found);
      }
      if (allEntities.length === 0) {
        return { entities: [], relations: [], totalWeight: 0 };
      }
      // Deduplicate and return.
      const seen = new Set<string>();
      const unique = allEntities.filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
      return { entities: unique.slice(0, limit), relations: [], totalWeight: 0 };
    }

    // For each extracted entity, query by entity with depth=2.
    const allEntities: GraphEntity[] = [];
    const allRelations: GraphRelation[] = [];
    const seenEntities = new Set<string>();
    const seenRelations = new Set<string>();

    for (const ext of extracted) {
      const result = this.queryByEntity(ext.name, 2, limit);
      for (const e of result.entities) {
        if (!seenEntities.has(e.id)) {
          seenEntities.add(e.id);
          allEntities.push(e);
        }
      }
      for (const r of result.relations) {
        if (!seenRelations.has(r.id)) {
          seenRelations.add(r.id);
          allRelations.push(r);
        }
      }
    }

    const totalWeight = allRelations.reduce((sum, r) => sum + r.weight, 0);

    return {
      entities: allEntities.slice(0, limit),
      relations: allRelations,
      totalWeight,
    };
  }

  /**
   * Format graph query results as a markdown string for injection
   * into the system prompt.
   */
  formatAsContext(result: GraphQueryResult, maxTokens: number): string {
    if (result.entities.length === 0) return "";

    const maxChars = maxTokens * CHARS_PER_TOKEN;
    const parts: string[] = ["## Knowledge Graph Context\n"];

    // Entities section.
    if (result.entities.length > 0) {
      parts.push("### Entities");
      for (const e of result.entities) {
        parts.push(`- [${e.type}] ${e.name} (mentioned ${e.mentionCount} times)`);
      }
    }

    // Relationships section.
    if (result.relations.length > 0) {
      parts.push("\n### Relationships");
      for (const r of result.relations) {
        const source = result.entities.find((e) => e.id === r.sourceId);
        const target = result.entities.find((e) => e.id === r.targetId);
        if (source && target) {
          parts.push(`- ${source.name} --${r.type}--> ${target.name}`);
        }
      }
    }

    let text = parts.join("\n");
    if (text.length > maxChars) {
      text = text.slice(0, maxChars) + "\n[Graph context truncated]";
    }

    return text;
  }

  /**
   * Find the shortest path between two entities using BFS.
   * Returns null when no path exists.
   */
  explainPath(
    from: string,
    to: string,
    maxDepth: number,
  ): PathExplanation | null {
    const startEntity = this._graphMemory.getEntity(from);
    const endEntity = this._graphMemory.getEntity(to);
    if (!startEntity || !endEntity) return null;
    if (startEntity.id === endEntity.id) {
      return {
        path: [startEntity],
        relations: [],
        explanation: `${from} is the same entity as ${to}`,
      };
    }

    // BFS with parent tracking.
    const visited = new Set<string>([startEntity.id]);
    const parentMap = new Map<string, { entityId: string; relation: GraphRelation }>();
    let frontier = [startEntity.id];
    let nodesVisited = 0;

    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        if (nodesVisited++ >= MAX_NODES_VISITED) break;

        const relations = this._graphMemory.getEntityRelations(nodeId, "both");
        for (const rel of relations) {
          const neighborId =
            rel.sourceId === nodeId ? rel.targetId : rel.sourceId;
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            parentMap.set(neighborId, { entityId: nodeId, relation: rel });
            nextFrontier.push(neighborId);

            if (neighborId === endEntity.id) {
              // Found! Reconstruct path.
              return this._reconstructPath(
                startEntity,
                endEntity,
                parentMap,
              );
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    return null;
  }

  private _reconstructPath(
    start: GraphEntity,
    end: GraphEntity,
    parentMap: Map<string, { entityId: string; relation: GraphRelation }>,
  ): PathExplanation {
    const pathIds: string[] = [end.id];
    const relations: GraphRelation[] = [];
    let current = end.id;

    while (current !== start.id) {
      const parent = parentMap.get(current);
      if (!parent) break;
      pathIds.unshift(parent.entityId);
      relations.unshift(parent.relation);
      current = parent.entityId;
    }

    const path: GraphEntity[] = [];
    for (const id of pathIds) {
      if (id === start.id) {
        path.push(start);
        continue;
      }
      if (id === end.id) {
        path.push(end);
        continue;
      }
      const entity = this._graphMemory.getEntityById(id);
      if (entity) {
        path.push(entity);
      }
    }

    // Build natural-language explanation.
    const explanationParts: string[] = [];
    for (let i = 0; i < relations.length; i++) {
      const from = path[i];
      const to = path[i + 1];
      const rel = relations[i];
      if (from && to && rel) {
        explanationParts.push(`${from.name} ${rel.type.replace(/_/g, " ")} ${to.name}`);
      }
    }
    const explanation =
      explanationParts.length > 0
        ? explanationParts.join(" which ")
        : `${start.name} is connected to ${end.name}`;

    return { path, relations, explanation };
  }



  private _recencyFactor(lastSeenAt: number, now: number): number {
    const age = now - lastSeenAt;
    if (age < ONE_DAY_MS) return 1.0;
    if (age < ONE_WEEK_MS) return 0.7;
    return 0.4;
  }
}

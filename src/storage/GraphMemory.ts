import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import type {
  GraphEntity,
  GraphRelation,
  EntityType,
  RelationType,
  MemoryProvenance,
} from "./MemoryLayers.types.js";
import { escapeLikePattern } from "./likeEscape.js";
import { GRAPH_MAX_TRAVERSAL_RESULTS } from "./constants.js";

/**
 * Layer 4: graph-based relational memory.
 *
 * Stores entities (files, functions, classes, concepts, technologies) and
 * their relationships as triples in SQLite. All operations are synchronous
 * because better-sqlite3 is synchronous.
 */
export class GraphMemory {
  private readonly _db: Database.Database;

  constructor(db: Database.Database) {
    this._db = db;
    this._initSchema();
  }

  private _initSchema(): void {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS graph_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        properties TEXT DEFAULT '{}',
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        mention_count INTEGER DEFAULT 1,
        UNIQUE(name, type)
      );

      CREATE TABLE IF NOT EXISTS graph_relations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES graph_entities(id),
        target_id TEXT NOT NULL REFERENCES graph_entities(id),
        type TEXT NOT NULL,
        weight REAL DEFAULT 0.5,
        source TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        UNIQUE(source_id, target_id, type)
      );

      CREATE INDEX IF NOT EXISTS idx_relations_source ON graph_relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_relations_target ON graph_relations(target_id);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON graph_entities(type);
    `);
  }

  /**
   * Insert or update an entity. If an entity with the same (name, type)
   * exists, increment mention_count and update last_seen_at.
   */
  upsertEntity(
    name: string,
    type: EntityType,
    properties?: Record<string, unknown>,
  ): GraphEntity {
    const trimmedName = name.trim();
    const now = Date.now();

    const existing = this._db
      .prepare("SELECT * FROM graph_entities WHERE name = ? AND type = ?")
      .get(trimmedName, type) as EntityRow | undefined;

    if (existing) {
      const mergedProps = {
        ...JSON.parse(existing.properties),
        ...(properties ?? {}),
      };
      this._db
        .prepare(
          `UPDATE graph_entities
           SET last_seen_at = ?, mention_count = mention_count + 1, properties = ?
           WHERE id = ?`,
        )
        .run(now, JSON.stringify(mergedProps), existing.id);

      return {
        id: existing.id,
        name: existing.name,
        type: existing.type as EntityType,
        properties: mergedProps,
        firstSeenAt: existing.first_seen_at,
        lastSeenAt: now,
        mentionCount: existing.mention_count + 1,
      };
    }

    const id = randomUUID();
    const propsJson = JSON.stringify(properties ?? {});
    this._db
      .prepare(
        `INSERT INTO graph_entities (id, name, type, properties, first_seen_at, last_seen_at, mention_count)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(id, trimmedName, type, propsJson, now, now);

    return {
      id,
      name: trimmedName,
      type,
      properties: properties ?? {},
      firstSeenAt: now,
      lastSeenAt: now,
      mentionCount: 1,
    };
  }

  /**
   * Upsert a relation between two entities. Upserts both entities first.
   * If the relation already exists, increase weight by 0.1 (capped at 1.0).
   */
  upsertRelation(
    sourceName: string,
    sourceType: EntityType,
    targetName: string,
    targetType: EntityType,
    relationType: RelationType,
    provenance: MemoryProvenance,
  ): GraphRelation {
    const sourceEntity = this.upsertEntity(sourceName, sourceType);
    const targetEntity = this.upsertEntity(targetName, targetType);
    const now = Date.now();

    const existing = this._db
      .prepare(
        "SELECT * FROM graph_relations WHERE source_id = ? AND target_id = ? AND type = ?",
      )
      .get(sourceEntity.id, targetEntity.id, relationType) as RelationRow | undefined;

    if (existing) {
      const newWeight = Math.min(1.0, existing.weight + 0.1);
      this._db
        .prepare(
          "UPDATE graph_relations SET weight = ?, last_seen_at = ?, confidence = ? WHERE id = ?",
        )
        .run(newWeight, now, provenance.confidence, existing.id);

      return {
        id: existing.id,
        sourceId: existing.source_id,
        targetId: existing.target_id,
        type: existing.type as RelationType,
        weight: newWeight,
        provenance,
        firstSeenAt: existing.first_seen_at,
        lastSeenAt: now,
      };
    }

    const id = randomUUID();
    this._db
      .prepare(
        `INSERT INTO graph_relations
         (id, source_id, target_id, type, weight, source, confidence, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, 0.5, ?, ?, ?, ?)`,
      )
      .run(
        id,
        sourceEntity.id,
        targetEntity.id,
        relationType,
        provenance.source,
        provenance.confidence,
        now,
        now,
      );

    return {
      id,
      sourceId: sourceEntity.id,
      targetId: targetEntity.id,
      type: relationType,
      weight: 0.5,
      provenance,
      firstSeenAt: now,
      lastSeenAt: now,
    };
  }

  getEntity(name: string, type?: EntityType): GraphEntity | null {
    const row = type
      ? (this._db
          .prepare("SELECT * FROM graph_entities WHERE name = ? AND type = ?")
          .get(name.trim(), type) as EntityRow | undefined)
      : (this._db
          .prepare("SELECT * FROM graph_entities WHERE name = ?")
          .get(name.trim()) as EntityRow | undefined);

    return row ? this._entityRowToObj(row) : null;
  }

  getEntityRelations(
    entityId: string,
    direction: "outgoing" | "incoming" | "both" = "both",
  ): GraphRelation[] {
    let rows: RelationRow[];
    switch (direction) {
      case "outgoing":
        rows = this._db
          .prepare("SELECT * FROM graph_relations WHERE source_id = ?")
          .all(entityId) as RelationRow[];
        break;
      case "incoming":
        rows = this._db
          .prepare("SELECT * FROM graph_relations WHERE target_id = ?")
          .all(entityId) as RelationRow[];
        break;
      default:
        rows = this._db
          .prepare(
            "SELECT * FROM graph_relations WHERE source_id = ? OR target_id = ?",
          )
          .all(entityId, entityId) as RelationRow[];
    }
    return rows.map((r) => this._relationRowToObj(r));
  }

  /**
   * BFS traversal up to `depth` hops from the named entity.
   * Returns all reachable entities, capped at 50 results.
   */
  findRelatedEntities(entityName: string, depth: number): GraphEntity[] {
    const startEntity = this.getEntity(entityName);
    if (!startEntity) return [];

    const visited = new Set<string>([startEntity.id]);
    let frontier = [startEntity.id];
    const results: GraphEntity[] = [];

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];
      for (const nodeId of frontier) {
        const relations = this.getEntityRelations(nodeId, "both");
        for (const rel of relations) {
          const neighborId =
            rel.sourceId === nodeId ? rel.targetId : rel.sourceId;
          if (!visited.has(neighborId)) {
            visited.add(neighborId);
            nextFrontier.push(neighborId);

            const entity = this.getEntityById(neighborId);
            if (entity) {
              results.push(entity);
              if (results.length >= GRAPH_MAX_TRAVERSAL_RESULTS) return results;
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    return results;
  }

  /** LIKE search on entity names. */
  searchEntities(
    query: string,
    type?: EntityType,
    limit = 20,
  ): GraphEntity[] {
    const pattern = `%${escapeLikePattern(query)}%`;
    const rows = type
      ? (this._db
          .prepare(
            "SELECT * FROM graph_entities WHERE name LIKE ? ESCAPE '\\' AND type = ? LIMIT ?",
          )
          .all(pattern, type, limit) as EntityRow[])
      : (this._db
          .prepare("SELECT * FROM graph_entities WHERE name LIKE ? ESCAPE '\\' LIMIT ?")
          .all(pattern, limit) as EntityRow[]);

    return rows.map((r) => this._entityRowToObj(r));
  }

  getStats(): {
    entityCount: number;
    relationCount: number;
    byType: Record<string, number>;
  } {
    const entityCount = (
      this._db.prepare("SELECT COUNT(*) as c FROM graph_entities").get() as {
        c: number;
      }
    ).c;
    const relationCount = (
      this._db.prepare("SELECT COUNT(*) as c FROM graph_relations").get() as {
        c: number;
      }
    ).c;
    const typeRows = this._db
      .prepare(
        "SELECT type, COUNT(*) as count FROM graph_entities GROUP BY type",
      )
      .all() as Array<{ type: string; count: number }>;

    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = row.count;
    }

    return { entityCount, relationCount, byType };
  }

  /**
   * Remove entities with mentionCount < minMentions AND
   * lastSeenAt < now - olderThanMs. Cascade-deletes their relations.
   */
  prune(minMentions: number, olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;

    // First delete relations referencing prunable entities.
    this._db
      .prepare(
        `DELETE FROM graph_relations WHERE source_id IN (
          SELECT id FROM graph_entities WHERE mention_count < ? AND last_seen_at < ?
        ) OR target_id IN (
          SELECT id FROM graph_entities WHERE mention_count < ? AND last_seen_at < ?
        )`,
      )
      .run(minMentions, cutoff, minMentions, cutoff);

    const result = this._db
      .prepare(
        "DELETE FROM graph_entities WHERE mention_count < ? AND last_seen_at < ?",
      )
      .run(minMentions, cutoff);

    return result.changes;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  getEntityById(id: string): GraphEntity | null {
    const row = this._db
      .prepare("SELECT * FROM graph_entities WHERE id = ?")
      .get(id) as EntityRow | undefined;
    return row ? this._entityRowToObj(row) : null;
  }

  private _entityRowToObj(row: EntityRow): GraphEntity {
    return {
      id: row.id,
      name: row.name,
      type: row.type as EntityType,
      properties: JSON.parse(row.properties),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      mentionCount: row.mention_count,
    };
  }

  private _relationRowToObj(row: RelationRow): GraphRelation {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type as RelationType,
      weight: row.weight,
      provenance: {
        source: row.source as MemoryProvenance["source"],
        sourceSessionId: null,
        sourceMessageId: null,
        timestamp: row.last_seen_at,
        confidence: row.confidence,
      },
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
    };
  }
}

// -------------------------------------------------------------------------
// Internal row types
// -------------------------------------------------------------------------

interface EntityRow {
  id: string;
  name: string;
  type: string;
  properties: string;
  first_seen_at: number;
  last_seen_at: number;
  mention_count: number;
}

interface RelationRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  weight: number;
  source: string;
  confidence: number;
  first_seen_at: number;
  last_seen_at: number;
}

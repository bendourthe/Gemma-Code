-- Phase 4 (v1.1.0) -- Memory provenance + scope_id columns.
--
-- Adds two nullable columns to the three memory persistence tables:
--   * `provenance TEXT NULL` -- JSON blob carrying the lifecycle write
--     context: `{sessionId, hookKind, toolName?, parentSpanId?}`. Lets
--     downstream consumers (Memory panel, audit CLI, trace replay)
--     trace each row back to the lifecycle event that produced it.
--   * `scope_id   TEXT NULL` -- opaque folder-scope tag mirroring the
--     in-memory `MemoryHub` scope filter (v1.0.0 4.P1.X). Lets the
--     persistent store mirror the per-folder visibility rules that
--     the in-memory hub already enforces.
--
-- Backfill rule: existing rows get `NULL` for both columns. The
-- migration is idempotent -- running it twice is a no-op because every
-- statement is guarded by a column-presence check at the application
-- layer (see `MemoryStore._runMigrations`, `EpisodicMemory._initSchema`,
-- `GraphMemory._initSchema`). This file is checked in primarily as a
-- canonical reference; the runtime migration is performed by the
-- TypeScript layer to keep the column-presence check engine-agnostic.

-- Memory entries (semantic tier).
ALTER TABLE memories ADD COLUMN provenance TEXT NULL;
ALTER TABLE memories ADD COLUMN scope_id   TEXT NULL;

-- Episodic events (session tier).
ALTER TABLE episodic_events ADD COLUMN provenance TEXT NULL;
ALTER TABLE episodic_events ADD COLUMN scope_id   TEXT NULL;

-- Graph relations (graph tier -- edges).
ALTER TABLE graph_relations ADD COLUMN provenance TEXT NULL;
ALTER TABLE graph_relations ADD COLUMN scope_id   TEXT NULL;

-- Useful index for the Memory panel's "filter by hookKind" affordance.
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope_id);
CREATE INDEX IF NOT EXISTS idx_episodic_scope ON episodic_events(scope_id);
CREATE INDEX IF NOT EXISTS idx_relations_scope ON graph_relations(scope_id);

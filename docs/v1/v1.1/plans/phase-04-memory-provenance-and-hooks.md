# Phase 4 -- Memory provenance + 12-hook lifecycle + secret pre-index filter

**Goal**: Add structured provenance to every memory write; surface a typed lifecycle event bus; gate every memory write through the secret redactor.
**Prerequisites**: Phase 1 (shared core).
**Stability Gate**: `MemoryEntry` carries `provenance: {sessionId, hookKind, toolName, parentSpanId}`; SQLite migration runs idempotently and a fixture-based test loads a v1.0.0 database and verifies the new column is `NULL`-backfilled; `HookBus` emits events at every lifecycle event; an integration test runs a synthetic session and asserts the expected 12-event sequence; a memory write containing `AKIA...` is redacted before SQLite insert.

**Adopts**: agentmemory A8 + A5 + A7 (see [comparison-agentmemory.md](../comparison-agentmemory.md) Section 11.2 P0).

---

## Sub-tasks

### 4.1 -- Schema migration: add `provenance` to `MemoryEntry`

**Objective**: Add a JSON `provenance` column to `memory_entries`, `episodic_events`, and `graph_edges`; backfill existing rows as `NULL`.

**Prompt**:
> Write [core/storage/migrations/v1.1.0_provenance.sql](../../../../core/storage/migrations/v1.1.0_provenance.sql) that adds `provenance TEXT NULL` to `memory_entries`, `episodic_events`, and `graph_edges`. Add the column to the TypeScript types in [core/memory/types.ts](../../../../core/memory/types.ts): `provenance?: {sessionId: string; hookKind: string; toolName?: string; parentSpanId?: string} | null`. Update `MemoryStore.write(...)` to JSON-serialize on insert and parse on read. Write a fixture test that loads a v1.0.0 snapshot DB (commit a small one under `tests/fixtures/v1.0.0/memory.sqlite`), runs the migration, and asserts every existing row has `provenance = NULL` while new writes carry the structured object. Also add `scope_id TEXT NULL` to all three tables (closes v1.0.0 4.P1.X) in the same migration; backfill existing as `NULL`. Acceptance: migration is idempotent (running twice is a no-op); existing tests still pass; the new type carries through.

---

### 4.2 -- `HookBus` typed event surface

**Objective**: Add `core/lifecycle/HookBus.ts` -- a typed pub/sub on top of `TelemetryBus`.

**Prompt**:
> Add [core/lifecycle/HookBus.ts](../../../../core/lifecycle/HookBus.ts) with a closed discriminated-union `LifecycleEvent`:
> - `lifecycle.session.start`: `{sessionId, modelId, isoTime}`
> - `lifecycle.session.stop`: `{sessionId, isoTime, durationMs}`
> - `lifecycle.session.end`: `{sessionId, summary}`
> - `lifecycle.user.prompt`: `{sessionId, message, isoTime}`
> - `lifecycle.tool.pre`: `{sessionId, toolName, args, parentSpanId}`
> - `lifecycle.tool.post`: `{sessionId, toolName, ok, durationMs, parentSpanId}`
> - `lifecycle.tool.failed`: `{sessionId, toolName, redactedError, parentSpanId}`
> - `lifecycle.subagent.start`: `{sessionId, role, parentSpanId}`
> - `lifecycle.subagent.stop`: `{sessionId, role, ok, parentSpanId}`
> - `lifecycle.context.preCompact`: `{sessionId, beforeTokens, afterTokens}`
> - `lifecycle.notification`: `{kind, message, severity}`
> - `lifecycle.skill.entry`: `{sessionId, skillId, namespace, parentSpanId}`
>
> Expose `hookBus.emit(event)` and `hookBus.on("lifecycle.tool.pre", handler)`. Internally these wrap `TelemetryBus.publish` so existing trace consumers see the events too. Acceptance: a unit test publishes every event kind and asserts subscribers receive the correctly-typed payload.

---

### 4.3 -- Emit `HookBus` events at every call site

**Objective**: Wire emit calls into the existing AgentLoop / SubAgentManager / Tracer / ChatController surfaces.

**Prompt**:
> Find the equivalents in [modules/coding/](../../../../src) (post-Phase-1.4 layout): `AgentLoop.startSession()` -> emit `lifecycle.session.start`; `AgentLoop.finishTurn()` -> emit `lifecycle.session.stop`; `AgentLoop.handleUserMessage()` -> emit `lifecycle.user.prompt`; before/after `ToolRegistry.execute(...)` -> emit `lifecycle.tool.pre` + `.post` (or `.failed`); `SubAgentManager.spawn(...)` / `.stop()` -> emit `lifecycle.subagent.start` / `.stop`; `Tracer.snapshot()` / context compaction -> emit `lifecycle.context.preCompact`; `SessionStore.close(...)` -> emit `lifecycle.session.end`. Each emit fills in `provenance`-compatible fields. The `lifecycle.skill.entry` event is fired from Phase 8's `AgentLoop.setCurrentSkill(...)`. Acceptance: an integration test runs a synthetic session and asserts the 11 lifecycle events fire in the expected sequence; coverage on the HookBus consumers is >= 80% lines.

---

### 4.4 -- Pre-index secret redaction

**Objective**: Gate every `MemoryHub.write(...)` call through `redactSecrets()`.

**Prompt**:
> Find [core/observability/redactSecrets.ts](../../../../core/observability) (or its v1.0.0 location in `src/observability/`). Widen the call sites: `MemoryStore.write(...)` (used by `MemoryHub.write`) runs incoming `entry.text` (and any other free-text field) through `redactSecrets()` before insert. Existing trace-side calls remain. Add a new test that writes a memory entry containing every secret pattern in the redactor's rules (AWS keys, GitHub PATs, JWTs, SSH/PEM headers, Slack tokens) and asserts the stored row has them replaced with `<redacted>`. Acceptance: the test passes; existing memory-write tests are unaffected (their fixtures contain no secret patterns).

---

### 4.5 -- HookBus surfaces in the desktop UI

**Objective**: Make the Memory panel optionally display provenance and let the TraceDashboard filter by hookKind.

**Prompt**:
> Add a "Show provenance" toggle to the Memory panel ([desktop/src/modules/coding/panels/MemoryPanel.tsx](../../../../desktop/src/modules/coding/panels/MemoryPanel.tsx)); when on, each row renders the `provenance.hookKind` + `toolName` as small chips. Add a `hookKind` dropdown filter to the TraceDashboard ([desktop/src/modules/coding/panels/TraceDashboardPanel.tsx](../../../../desktop/src/modules/coding/panels/TraceDashboardPanel.tsx)). Both UI changes are read-only consumers of the new schema/bus. Acceptance: provenance chips render correctly on a fresh session's memory entries; trace filter narrows correctly.

---

### 4.6 -- Phase 4 lint, build, test gate

**Objective**: Verify the schema + bus + redaction is CI-green.

**Prompt**:
> Re-run the four-step gate. Acceptance: 0 failures; new tests added in Phase 4.1 / 4.2 / 4.3 / 4.4 are green.

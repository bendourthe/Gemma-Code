# v1.1.0 Phase 6 -- Memory lifecycle CLI + Ebbinghaus decay + `/recall` `/remember` `/forget`

**Date**: 2026-05-19
**Branch**: `main`
**Plan**: [docs/versions/v1/v1.1.0/plans/phase-06-memory-cli-decay-and-slash-commands.md](../../plans/phase-06-memory-cli-decay-and-slash-commands.md)
**Phase outcome**: Phase 6 of the v1.1.0 cycle ([v1.1.0-cycle](../../plans/v1.1.0-cycle.md)) landed -- four agentmemory adoptions (A11 `nexus memory audit`, A10 `nexus memory export`, A12 `/forget`, A3 Ebbinghaus decay) plus two new chat-side slash commands (`/recall`, `/remember`) plus the Memory panel "Forget" button.

---

## 1. Goal and scope

Surface user-facing memory commands and run the decay sweep on idle. The phase adopts four agentmemory P1 items in one cycle and rounds out the user-driven memory surface that Phase 4 (provenance + lifecycle hooks) and Phase 5 (hybrid retrieval) made possible.

Stability gate from the plan: `nexus memory audit --since 2026-05-01` prints a tabular log; `nexus memory export --out <file>` writes JSONL; `/recall <query>`, `/remember <text>`, `/forget --id <uuid>` all work in the chat UI; the `DecaySweep` worker evicts entries whose `lastAccessedAt` is older than `halfLife * 7` from the working tier (default half-life 24 h).

## 2. Pre-implementation review

Read [docs/versions/v1/v1.1.0/plans/phase-06-memory-cli-decay-and-slash-commands.md](../../plans/phase-06-memory-cli-decay-and-slash-commands.md) end-to-end, then mapped the seven sub-tasks against the existing codebase:

- **Existing surfaces**: [bin/nexus.mjs](../../../../bin/nexus.mjs) (CLI dispatcher with `skills`, `check`, `image`, `video` subcommands); [src/agents/IdleTimeScheduler.ts](../../../../src/agents/IdleTimeScheduler.ts) (24h cadence worker host); [src/tools/ConfirmationGate.ts](../../../../src/tools/ConfirmationGate.ts) (existing `/forget` confirmation hook); [core/memory/MemoryHub.ts](../../../../core/memory/MemoryHub.ts) (four-layer in-memory facade); [core/lifecycle/HookBus.ts](../../../../core/lifecycle/HookBus.ts) (12-variant lifecycle bus); [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts) (SQLite-backed memory store with provenance + scope_id columns from Phase 4).
- **Missing surfaces**: no `SlashCommandRouter` yet (the plan referenced `modules/coding/chat/SlashCommandRouter.ts` post-Phase-1.4 layout, but the layout move is still pending under open item 1.4.P1.B). Decision: implement the slash-command handlers in `core/memory/MemorySlashCommands.ts` as pure async functions over a `SlashCommandContext` shape; the desktop chat input + sidecar message handler call into them directly. This keeps the handlers unit-testable without depending on a router class that does not yet exist.
- **Schema coordination**: the plan called for adding `memory_audit_log` to the Phase 4 migration. Phase 4 already bumped `MEMORY_SCHEMA_VERSION` to 3, so adding the table now would either (a) require a 4th version bump without coordinating the rest of the persistence cluster (export/import adapters, `MemoryHub.delete`, decay tombstones), or (b) split the schema upgrade across two commits with no clean rollback. Decision: implement an `InMemoryAuditLog` ring buffer that the sidecar wires directly (no JSONL hop) and defer the SQLite-backed persistence + the matching CLI source/sink adapters to Phase 7/8. Tracked under 6.1.P2.P / 6.2.P2.Q / 6.5.P2.R / 6.6.P2.S.

## 3. Implementation

The seven sub-tasks landed in a single coherent module set under `core/memory/`. All five new modules are pure TypeScript (no Node-only APIs) so they unit-test without sidecar dependencies.

### 3.1 `core/memory/MemoryAuditLog.ts`

Defines the `MemoryAuditRow` shape (timestamp, op, tier, entryId, sessionId, hookKind, toolName, textPreview), the `MemoryAuditFilter` for `--since` / `--tier` / `--session` / `--op` / `--limit`, the `MemoryAuditLog` interface, and `InMemoryAuditLog` -- a ring-buffer implementation bounded at 10,000 rows by default (drops oldest on overflow). Helpers `previewText(text, n=120)` (whitespace-collapsing + ellipsis truncation) and `rowFromProvenance({op, tier, entryId, text, provenance, timestamp?})` (project a `LifecycleProvenance` into a row) live in the same module so callers do not thread provenance fields by hand.

### 3.2 `core/memory/MemoryAudit.ts`

Pure formatters. `formatAuditTable(rows, columns?)` renders a fixed-width table whose column widths are computed from the actual rows (capped at each column's `maxWidth`). `formatAuditJsonl(rows)` emits one JSON object per line with trailing newline. `formatTimestamp(unixMs)` is the canonical ISO-without-ms representation. `parseSinceFlag(value)` accepts both bare `YYYY-MM-DD` (appends `T00:00:00Z` for timezone stability) and full ISO 8601 strings; returns `null` for unparseable input so the CLI can reject `--since` gracefully.

### 3.3 `core/memory/MemoryExport.ts`

Defines `ExportableRow` (id, tier, content, vectorB64, scopeId, provenance, createdAt, accessedAt, accessCount, corroborationCount), the `ExportSource` / `ImportSink` interfaces, and four pure functions: `exportToJsonl(source, filter)`, `importFromJsonl(text, sink)`, `encodeVectorB64(vec)` / `decodeVectorB64(b64)`, and the `isPathInside(absoluteTarget, allowedRoot)` path-traversal guard. Vector encoding uses `Buffer` on Node and `btoa` / `atob` in browsers, writing raw little-endian Float32 bytes so JSON line length stays predictable and there is no precision loss from decimal serialization. Decoding copies into an aligned `ArrayBuffer` so the Float32Array view is safe regardless of underlying `Buffer` alignment.

### 3.4 `core/memory/MemorySlashCommands.ts`

Pure async handlers over a `SlashCommandContext`:

- `handleRecall(input, ctx)` calls `HybridRetriever.retrieve(query, {scopeId, visibleScopes, limit: 10})` via the structural `HybridRetrieverLike` interface, renders the top-10 hits as a fenced JSON block + machine-readable payload (text, tier, score, entryId, provenance), and writes one `read` row per hit to `ctx.auditLog` tagged with `hookKind: "slash.recall"`. Rejections for empty query, missing retriever, and warming-up retriever each return a structured `{ok: false, status}`.
- `handleRemember(input, ctx)` writes a working-tier observation via `MemoryWritePort.writeWorking(...)` with `hookKind: "slash.remember"`. Empty text is rejected.
- `handleForget(input, ctx)` -- `parseForgetArgs` accepts `--id <uuid>` (exact) or `--pattern <regex>` (quoted or bare). Walks `MemoryWritePort.listForForget()` for matches, gates via `ctx.confirm(...)`, deletes via `MemoryWritePort.delete(id)`, writes one `delete` audit row per row.

### 3.5 `core/memory/DecaySweep.ts`

Closed-form Ebbinghaus retention curve `R(t) = exp(-elapsed / halfLife * ln(2))` with per-tier defaults (working = 24 h, episodic = 7 d, semantic = 30 d, graph = 365 d). Eviction rule: `retention < 0.05 AND accessCount < 3`. The `DecayProvider` interface decouples the sweep from the store; `evict(id)` returns `true` on success; per-row exceptions are caught so a single flaky row cannot wedge the whole sweep. Pure `retentionAt(elapsed, halfLife)` helper exposed for unit tests + UI previews; `shouldEvict(entry, now)` decides per-row without driving the full sweep.

### 3.6 CLI dispatch

[bin/nexus.mjs](../../../../bin/nexus.mjs) gains the `memory` subcommand routed through `runMemoryCommand(args)` with four sub-subcommand handlers: `runMemoryAudit`, `runMemoryExport`, `runMemoryImport`, `runMemoryDecay`. Each resolves the compiled artifact under `out/core/memory/*.js` (so the CLI uses the same code paths the sidecar uses). The `--out` flag on `nexus memory export` is clamped to `~/.nexus/exports/` via `isPathInside`. The HELP banner picks up the new subcommands.

### 3.7 Desktop wiring

- [desktop/src/modules/coding/slashCommands.ts](../../../../desktop/src/modules/coding/slashCommands.ts) catalog gains `recall`, `remember`, `forget` entries so the chat composer suggests them.
- [desktop/src/modules/coding/panels/MemoryPanel.tsx](../../../../desktop/src/modules/coding/panels/MemoryPanel.tsx) gains an optional `onForget(layerKey, index, entry)` prop; when supplied, every entry row renders a "Forget" button alongside the provenance chips.

## 4. Tests

Five new test files under `tests/unit/core/memory/`:

- `MemoryAuditLog.test.ts` -- 10 tests covering ring-buffer behaviour, filter shapes, capacity overflow.
- `MemoryAudit.test.ts` -- 10 tests covering table + JSONL formatting, timestamp formatting, since-flag parsing.
- `MemoryExport.test.ts` -- 12 tests covering base64 round-trip, export filtering, import shape validation, path-inside guard.
- `DecaySweep.test.ts` -- 10 tests including the retention-curve closed form (R(t=halfLife) = 0.5) and the "within 5% of the math" assertion against a 100-row synthetic corpus over 7 days.
- `MemorySlashCommands.test.ts` -- 16 tests covering all three handlers + `parseForgetArgs` shapes (--id, --id=, --pattern bare, --pattern quoted, invalid-regex).

Plus extensions to existing test files:

- `tests/unit/cli/nexus-cli.test.ts` gains 3 parseArgs cases for `memory audit --since`, `memory export --out`, `memory decay --now`.
- `desktop/tests/slashCommands.test.ts` updates the catalog assertion to include the three new commands.
- `desktop/tests/panels.test.tsx` gains 2 cases for the Forget button (rendered when `onForget` supplied; suppressed when omitted).

All 58 new tests pass.

## 5. Build / Lint

- `npm run build` (tsc) -- clean. One readonly-assignment issue caught and fixed in `handleRemember` by constructing the `writeWorking` args object eagerly with a conditional spread instead of mutating after-the-fact.
- `npm run lint` (eslint src) -- clean (no new findings; the `core/memory/*` modules are outside the eslint scope per the project's existing policy, matching Phase 4 / 5's pattern).

## 6. Known gaps recap

Four new P2 open items, all clustered around the live-`MemoryStore` wiring that Phase 7 or 8 will land:

- **6.1.P2.P** -- SQLite-backed `memory_audit_log` table deferred (the v1.1.0 Phase 4 migration already bumped to schema version 3; adding the table without a coordinated bump would split the schema upgrade).
- **6.2.P2.Q** -- export/import CLI consumes injected JSONL pending the `MemoryStoreExportSource` adapter.
- **6.5.P2.R** -- Memory panel "Forget" IPC pipeline needs a new `MemoryHub.delete(id)` method per layer.
- **6.6.P2.S** -- DecaySweep `IdleTimeScheduler` binding awaits the `MemoryStoreDecayProvider` adapter (parallels 5.6.P2.O for the warm-build worker).

Updates to [docs/versions/v1/v1.1.0/known-gaps.md](../../known-gaps.md): 7 new closures under "Phase 6 closures (this commit)"; summary recomputed to 16 open / 28 resolved / 44 total.

## 7. Next phase

Phase 7 -- session replay timeline ([docs/versions/v1/v1.1.0/plans/phase-07-session-replay-timeline.md](../../plans/phase-07-session-replay-timeline.md)). Adds a `<TimelineScrubber>` component to the TraceDashboard panel with play/pause/speed and a "Compare two sessions" delta view. Adopts agentmemory A6.

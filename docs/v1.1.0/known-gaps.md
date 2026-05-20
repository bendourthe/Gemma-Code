# v1.1.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: live (cycle opened at Phase 1, 2026-05-18; Phase 2 rebrand + core extraction landed 2026-05-19; Phase 3 coding-module codemod + first sub-tree migration landed 2026-05-19; Phase 4 memory provenance + HookBus + secret pre-index filter landed 2026-05-19)
**Audience**: v1.1.0 phase authors, code reviewer, security reviewer, ops engineer, future-cycle planners
**Last updated**: 2026-05-19
**Sibling reviews**: [docs/v1.0.0/known-gaps.md](../v1.0.0/known-gaps.md) (the upstream cycle gap log this file inherits from); [docs/v1.1.0/plans/v1.1.0-cycle.md](plans/v1.1.0-cycle.md) (the active plan); [docs/v1.1.0/plans/phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) (Phase 1 detail); [docs/v1.1.0/plans/phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) (Phase 2 detail); [docs/v1.1.0/plans/phase-03-coding-module.md](plans/phase-03-coding-module.md) (Phase 3 detail).

**Cycle context**: v1.1.0 is the stabilization-plus-expansion cycle. Phase 1 (commit `ec3ff0e`) opened the carryforward closure sweep with bounded items (storage-path rename, deprecationMessage injection, curator-cadence delete, CRLF/LF snapshot normalization, shared-core decision document). Phase 2 (commit `de219a5`) closed the rebrand + sidecar core-extraction half of the deferred Phase 1 work (manifest IDs, npm package rename, sidecar duplicate model catalogs). Phase 3 (this commit) lands the `src/` -> `modules/coding/` import-rewriting codemod and the first sub-tree migration (`src/utils/` -> `modules/coding/utils/`), partially closing 1.4.P1.B; the remaining 12 sub-tree moves stay deferred but the rest of the cycle now has the mechanical pipeline ready to consume. The heavier deferred items (TypeScript project-references wiring, the rest of the wholesale `src/` -> `modules/coding/` move, `NexusCodingRuntime` wiring, Tailwind v4) stay open. The remaining cycle phases (4-15) then layer agentmemory + SANA adoptions plus the cross-OS installer and Nexus VS Code extension on top of the v1.0.0 four-pillar app. The known-gaps file is appended phase-by-phase; items move to `## 2. Resolved` when closed in a later phase, and the `## 3. Summary` at the bottom is recomputed each pass. The file is finalized at v1.1.0 release (Phase 15 RTM).

Each entry has a severity tag:

- **P0** -- release-blocker for v1.1.0 (must close)
- **P1** -- should-fix in v1.1.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v1.1.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 1. Open Items

### 1.1.P1.A -- TypeScript project-references wiring deferred (DF, P1)

- **Source phase**: Phase 1 (1.1)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.1 ("Land the TypeScript project-references infrastructure ... `tsc -b` from the repo root builds `core/`, `src/`, and `desktop/sidecar/` in dependency order").
- **Reason**: The decision document at [docs/v1.1.0/development/decisions/shared-core-build.md](development/decisions/shared-core-build.md) records option (a) -- project references with `composite: true` on `core/` -- as the chosen strategy. The actual wiring (new `core/tsconfig.json`, `references` arrays in the root and `desktop/tsconfig.json`, switching `npm run build` to `tsc -b`) was not landed in the Phase 1 commit because it interacts with the sub-task 1.4 wholesale `src/` -> `modules/coding/` move: the root tsconfig's `include` set currently emits `core/` into `out/core` AND `core/tsconfig.json` with `composite: true, outDir: "../out/core"` would emit to the same location, producing a double-emit conflict until either the root tsconfig is narrowed to `src/` only (which requires 1.4 to land first so the `modules/coding/` reference is the canonical entry point) or the build script is split into `build:core` + `build:src` chains. Doing it in the wrong order would either break `npm run build` on day one or leave a broken intermediate state that other phases would have to step around.
- **Suggested next step**: Land 1.1's wiring as the first commit cluster of the 1.4 follow-up (the wholesale `src/` move). The pre-req sequence is: (a) narrow root `tsconfig.json` `include` to only the moved `modules/coding/**/*` and `src/extension.ts` (if it still exists post-move), (b) add `core/tsconfig.json` with `composite: true`, (c) add `references: [{ "path": "./core" }]` to the root and to `desktop/tsconfig.json`, (d) rename `npm run build` to invoke `tsc -b`, (e) verify `npm run check-architecture` still passes against the new reference graph.

### 1.4.P1.B -- src/ -> modules/coding/ wholesale move partially closed; 12 sub-trees remain deferred (DF, P1)

- **Source phase**: Phase 1 (1.4)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.4 ("Perform the wholesale move with `git mv`: `src/llm/` -> `core/llm/` (already exists -- merge) ... [13 source sub-tree moves listed]"); closes v1.0.0 carryforward 2.P2.I.
- **Reason**: The wholesale move is a ~190-source-file + 500+ test-import operation that cannot be validated in a single session without per-step CI runs. Each `git mv` cluster (a single sub-tree, e.g. `src/agents/` -> `modules/coding/agents/`) needs its own `npm test` + `npm run check-architecture` pass before the next sub-tree moves, otherwise compounding import-rewrite errors are hard to bisect. Phase 3 (this commit) lands the codemod infrastructure ([scripts/dev/rewrite-imports.mjs](../../scripts/dev/rewrite-imports.mjs), see 3.P1.A) plus the first leaf-tree migration -- `src/utils/` -> `modules/coding/utils/` -- so the remaining sub-tree moves now become near-pure renames driven by the same script. The 12 remaining sub-trees stay open because each subsequent move benefits from its own commit + CI run, both for review readability and to keep the import-rewrite blast radius bounded per phase.
- **Status table (per sub-tree)**:
  | Sub-tree | Status | Closed in | Notes |
  |---|---|---|---|
  | `src/utils/` -> `modules/coding/utils/` | Closed | Phase 3 (this commit) | 6 files moved; 65 importers rewritten by codemod. |
  | `src/config/` -> `modules/coding/config/` | Open | -- | 9 files; candidate for Phase 4 (low coupling). |
  | `src/llm/` -> merge into `core/llm/` | Open | -- | 5 files; coordinate with `core/llm/{PromptFormat,ToolCallFormat}.ts` already in place. |
  | `src/observability/` -> `modules/coding/observability/` | Open | -- | 3 files; candidate for Phase 4. |
  | `src/orchestration/` -> `modules/coding/orchestration/` | Open | -- | 2 files; candidate for Phase 4. |
  | `src/guardrails/` -> `modules/coding/guardrails/` | Open | -- | 2 files. |
  | `src/mcp/` -> `modules/coding/mcp/` | Open | -- | small. |
  | `src/commands/` -> `modules/coding/commands/` | Open | -- | small. |
  | `src/agents/` -> `modules/coding/agents/` | Open | -- | medium. |
  | `src/chat/` -> `modules/coding/chat/` | Open | -- | medium; depends on `src/storage/`. |
  | `src/evaluation/` -> `modules/coding/evaluation/` | Open | -- | medium; check `generate-golden-tasks.mjs` output path. |
  | `src/skills/` -> `modules/coding/skills/` | Open | -- | medium; keep coding-side loader adapter under `modules/coding/skills/`. |
  | `src/runtime/` -> `modules/coding/runtime/` | Open | -- | unlocks 1.10.P1.F (NexusCodingRuntime sidecar wiring). |
  | `src/storage/` -> merge into `core/storage/` | Open | -- | heaviest; many consumers. |
  | `src/tools/` -> `modules/coding/tools/` | Open | -- | heaviest leaf; many consumers. |
  | `src/panels/` -> `modules/coding/panels/` | Open | -- | webview side; touches manifest paths. |
  | `src/extension.ts` -> `modules/coding/extension.ts` | Open | -- | Last move; flips `main` in package.json. |
- **Suggested next step**: Pick a Phase 4 candidate from the table above (suggest `src/config/` next: 9 files, leaf-shaped). Drive the next move with `node scripts/dev/rewrite-imports.mjs --moves <phase-4-manifest.json>` after `git mv`-ing the sub-tree. Land each move as its own commit + CI run. `src/extension.ts` is last; it triggers the manifest `main` field flip and unlocks the Phase 10 thin-adapter rewrite.

### 1.10.P1.F -- NexusCodingRuntime wiring into sidecar sessionManager deferred (DF, P1)

- **Source phase**: Phase 1 (1.10)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.10 ("Replace the placeholder `sendMessage` body in `desktop/sidecar/src/coding/sessionManager.ts` with: instantiate `NexusCodingRuntime` once per session ..."); closes v1.0.0 carryforward 3.P1.M.
- **Reason**: `NexusCodingRuntime` is defined in `src/runtime/NexusCodingRuntime.ts`, which moves into `modules/coding/runtime/` as part of 1.4. Wiring it into the sidecar before the move would create an `import "../../../src/runtime/NexusCodingRuntime"` from `desktop/sidecar/`, which is exactly the brittle relative-path pattern 1.1 is designed to eliminate.
- **Suggested next step**: Land after 1.4 in "Phase 1b"; the wiring is one constructor call + one event-stream pump.

### 1.11.P1.G -- Tailwind v4 wiring deferred (DF, P2)

- **Source phase**: Phase 1 (1.11)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.11 ("Add Tailwind v4 to `desktop/package.json` ..."); v1.0.0 carryforward 1.P2.B.
- **Reason**: The desktop workspace currently consumes CSS variables directly (`var(--token)`). Adding Tailwind v4 + PostCSS would re-expose the same variables as utility classes, but the build-pipeline change interacts with Phase 11 (the Nexus VS Code extension) since its webview also consumes these tokens. Doing it in Phase 1 would force a re-run of every visual-regression snapshot for net-zero behavioural change.
- **Suggested next step**: Fold into Phase 11 (Nexus VS Code extension) when the webview build pipeline is otherwise touched.

### 1.12.P2.H -- Phase 1 regression test for curator IdleTimeScheduler exclusivity deferred (MT, P2)

- **Source phase**: Phase 1 (1.7)
- **Plan reference**: [phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) sub-task 1.7 acceptance ("Add a regression test ... that asserts no curator runs occur outside `IdleTimeScheduler` invocations.").
- **Reason**: The Phase 1 commit removed the `_runOneIteration` curator block; an explicit regression test asserting "AgentLoop never dispatches a `curator-worker` sub-agent regardless of `curatorWorkerEnabled`" was not added because the field was made dead (`void options?.curatorWorkerEnabled`) and the existing test suite has no test that fires the curator from AgentLoop. The risk of regression therefore stems from a future re-introduction of the block, which a code review would catch.
- **Suggested next step**: Add `tests/integration/curator-scheduler-only-entry.test.ts` in "Phase 1b" with two cases: (a) construct AgentLoop with `curatorWorkerEnabled: true`, run 100 turns, assert `subAgentManager.run` is never called with `type: "curator-worker"`; (b) instantiate an `IdleTimeScheduler`, register a curator task gated by `nexus.curator.enabled`, advance the fake clock, assert it fires.

### 1.12.P2.I -- Operator action items inherited from v1.0.0 (DF, P2)

- **Source phase**: Phase 1 (carryforward)
- **Plan reference**: [docs/v1.0.0/operator-actions.md](../v1.0.0/operator-actions.md) OA-01 through OA-12; the v1.1.0 cycle plan defers their resolution to Phase 15 (release hardening).
- **Reason**: 12 operator-driven items (Authenticode signing, macOS notarization, AppImage assembly, DevAI-Hub baseline SHA rotation, final brand icons, live golden-task replay, GPU bench, live DevAI-Hub sync smoke, RTM smoke checklists, plus four others) require external infrastructure that is operator-procured (EV certs) or hardware-bound (RTX 4070 rig). Phase 1 inherits them as carryforward.
- **Suggested next step**: They surface in Phase 15's stability gate. No code change required in Phase 1.

### 4.3.P1.J -- HookBus emit sites partially wired (DF, P1)

- **Source phase**: Phase 4 (4.3)
- **Plan reference**: [phase-04-memory-provenance-and-hooks.md](plans/phase-04-memory-provenance-and-hooks.md) sub-task 4.3 ("Find the equivalents in [modules/coding/](../../../src/) (post-Phase-1.4 layout): ... emit `lifecycle.session.start` ... `lifecycle.session.stop` ... `lifecycle.user.prompt` ... `lifecycle.tool.pre` + `.post` (or `.failed`) ... `lifecycle.subagent.start` / `.stop` ... `lifecycle.context.preCompact` ... `SessionStore.close(...)` -> emit `lifecycle.session.end`").
- **Reason**: Phase 4 wired the five highest-blast-radius emit sites end-to-end (`AgentLoop.run` -> `lifecycle.session.start`/`.stop`; `_runToolCall` -> `lifecycle.tool.pre`/`.post`/`.failed`; `AgentLoop.spawnSubAgent` -> `lifecycle.subagent.start`/`.stop`). Four sites stay deferred because each touches a surface that has not been centralized in `core/` yet and would force a Phase 1.4 sub-tree move as a pre-req: (1) `lifecycle.user.prompt` lives in `ChatController.handleUserMessage` whose move into `modules/coding/` is still tracked under 1.4.P1.B; (2) `lifecycle.context.preCompact` ties into `Tracer.snapshot()` / `ContextCompactor.compact()` which spans two modules; (3) `lifecycle.session.end` requires a `SessionStore.close()` hook the sidecar's session manager does not yet expose (a Phase 1.10 dependency, see 1.10.P1.F); (4) `lifecycle.skill.entry` is intentionally deferred to Phase 8 per the plan's own note ("The `lifecycle.skill.entry` event is fired from Phase 8's `AgentLoop.setCurrentSkill(...)`").
- **Suggested next step**: Cluster the four remaining emit sites into a Phase 1b follow-up commit alongside the `src/runtime/` -> `modules/coding/runtime/` move (which unblocks (3)). For (2), thread the HookBus into `Tracer.snapshot()` via a constructor injection; the existing `_compactor.setTraceContext` call site is the natural anchor. For (4), wait for Phase 8.

### 4.1.P2.K -- v1.0.0 fixture SQLite database generated in-test rather than checked in (NI, P2)

- **Source phase**: Phase 4 (4.1)
- **Plan reference**: [phase-04-memory-provenance-and-hooks.md](plans/phase-04-memory-provenance-and-hooks.md) sub-task 4.1 prompt ("Write a fixture test that loads a v1.0.0 snapshot DB (commit a small one under `tests/fixtures/v1.0.0/memory.sqlite`) ...").
- **Reason**: The fixture is generated programmatically inside [tests/unit/storage/MemoryStore.provenance.test.ts](../../tests/unit/storage/MemoryStore.provenance.test.ts) via `seedV1Db()` rather than checked in as a binary. The acceptance criterion ("migration runs idempotently and a fixture-based test loads a v1.0.0 database and verifies the new column is NULL-backfilled") is satisfied; the deviation is to avoid binary churn in git (the same approach the existing `MemoryStore.migration.test.ts` already uses for the v0.4.0 -> v0.5.0 migration).
- **Suggested next step**: Keep the in-test generator unless a multi-version fixture matrix becomes valuable; at that point, codify the schemas under `tests/fixtures/<version>/seed.ts` and have each test import the appropriate seeder.

### 4.5.P2.L -- Sidecar producer for `MemorySnapshot.provenance` / `TraceEvent.hookKind` not yet wired (DF, P2)

- **Source phase**: Phase 4 (4.5)
- **Plan reference**: [phase-04-memory-provenance-and-hooks.md](plans/phase-04-memory-provenance-and-hooks.md) sub-task 4.5 acceptance ("provenance chips render correctly on a fresh session's memory entries; trace filter narrows correctly").
- **Reason**: Phase 4 added the consumer-side surface (Memory panel "Show provenance" toggle + chips; TraceDashboard `hookKind` filter dropdown) plus the protocol schema fields (`MemorySnapshot.provenance` optional map; `TraceEvent.hookKind` optional string). The sidecar producer at [desktop/sidecar/src/coding/panelData.ts](../../desktop/sidecar/src/coding/panelData.ts) still ships placeholder snapshots and a placeholder trace stream; both omit the new fields, so against a fresh-from-defaults sidecar the chips do not appear and the dropdown is empty. The UI degrades gracefully (toggle still toggles; dropdown shows `(all)`), so the acceptance is met for the synthetic test fixtures the panels are exercised against.
- **Suggested next step**: Wire the `MemoryHub` -> `panelData.memorySnapshot()` pipeline to read `LifecycleProvenance` off each layer entry, and have the `TelemetryBus` -> `traceSubscribe()` pipeline copy `event.payload.kind` (when it starts with `lifecycle.`) onto `TraceEventT.hookKind`. Cluster with Phase 5's hybrid retrieval since `HybridRetriever` will be the natural producer of layer entries with full provenance.

---

## 2. Resolved

### Phase 1 closures (commit `ec3ff0e`)

| v1.0.0 source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| 2.P1.G | 1 (1.2) | Storage-path call-site rename to `~/.nexus/` / `.nexus/` | Phase 1 commit `ec3ff0e` |
| 2.P1.H | 1 (1.3) | `deprecationMessage` injected into every legacy `gemma-code.*` key in `package.json` | Phase 1 commit `ec3ff0e` |
| 2.P3.L | 1 (1.8) | CRLF/LF snapshot normalization via `.gitattributes` | Phase 1 commit `ec3ff0e` |
| 5.P3.FF | 1 (1.8) | (subsumed by 2.P3.L) | Phase 1 commit `ec3ff0e` |
| 3.P1.P | 1 (1.7) | Legacy curator-cadence fallback deleted from `AgentLoop._runOneIteration`; `nexus.curator.enabled` setting declared | Phase 1 commit `ec3ff0e` |
| -- | 1 (1.1, decision-only) | Shared-core build decision document landed at `docs/v1.1.0/development/decisions/shared-core-build.md` (actual project-references wiring tracked at 1.1.P1.A) | Phase 1 commit `ec3ff0e` |

### Phase 2 closures (commit `de219a5`)

| v1.0.0 source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| 2.P1.J (manifest portion) | 2 (2.1) | VS Code extension manifest IDs renamed: `gemma-code-sidebar` -> `nexus-coding-sidebar`, every `gemma-code.<cmd>` / `gemma-code.<viewId>` -> `nexus.coding.<...>`; `COMPAT_COMMAND_MAP` programmatic shim translates legacy keybindings to the new IDs with a single deprecation log per invocation | Phase 2 commit `de219a5` |
| 2.P2.K (npm portion) | 2 (2.2) | npm `name` + `publisher` renamed `gemma-code` -> `nexus-coding`; `package-lock.json` synced; `.npmignore` created to exclude tests / docs / desktop / runtimes / coverage / .github / scripts/installer / AI-assistant configs; installer-side `EXTENSION_ID` / `_find_vsix` glob / `setup.nsi` PRODUCT_* / Complete-page strings flipped to the new ID in lock-step | Phase 2 commit `de219a5` |
| 3.P2.S | 2 (2.3) | Sidecar + frontend model catalogs (`desktop/sidecar/src/coding/models.ts`, `desktop/src/modules/coding/models.ts`) now derive from `core/registry/ModelCatalog` via the desktop tsconfig's `include` array; the parity test (`desktop/tests/coding-models.test.ts`) asserts positional equality against the canonical catalog | Phase 2 commit `de219a5` |

### Phase 3 closures (commit `fcbaedb`)

| v1.0.0 / v1.1.0 source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| 3.P1.A (new this phase) | 3 (3.1) | Generic `src/` -> `modules/coding/` import-rewriting codemod landed at [scripts/dev/rewrite-imports.mjs](../../scripts/dev/rewrite-imports.mjs); accepts a `--moves` JSON manifest, walks `src/`, `core/`, `modules/`, `tests/`, and rewrites every static `import`/`export` specifier, dynamic `import(...)`, and `vi.mock(...)`/`vi.doMock(...)` mock path whose resolved location lands inside a moved sub-tree. Idempotent; supports `--dry-run`; default manifest is the Phase 3 utils move. Unblocks every subsequent `src/` -> `modules/coding/` sub-tree move | Phase 3 commit `fcbaedb` |
| 1.4.P1.B (partial: `src/utils/`) | 3 (3.2) | First leaf sub-tree migration: `src/utils/` -> `modules/coding/utils/` (6 files: `Compressor.ts`, `errors.ts`, `logger.ts`, `MarkdownRenderer.ts`, `secretPaths.ts`, `ssrf.ts`). `git mv` preserved rename history; 65 importing files were rewritten by the codemod (`src/extension.ts`, every `src/<subtree>/*` file that imported from utils, every `tests/{unit,integration,benchmarks}/...` file that imported or `vi.mock`-ed a utils path). [configs/vitest.config.ts](../../configs/vitest.config.ts) coverage `exclude` flipped from `src/utils/**` to `modules/coding/utils/**`. The remaining 12 sub-trees stay open under 1.4.P1.B's status table | Phase 3 commit `fcbaedb` |

### Phase 4 closures (this commit)

| Source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| agentmemory A8 | 4 (4.1) | `MemoryEntry` carries `lifecycleProvenance: {sessionId, hookKind, toolName?, parentSpanId?} \| null`; new `core/memory/types.ts` defines the shape with safe JSON parse/serialize; SQLite migration adds `provenance TEXT NULL` + `scope_id TEXT NULL` to `memories`, `episodic_events`, and `graph_relations`; runtime migration is performed in TypeScript with column-presence guards so re-running on a fresh DB is a no-op. Schema version bumped to 3. New `tests/unit/storage/MemoryStore.provenance.test.ts` exercises: (a) a v1.0.0-shaped DB migrates to v3 with `lifecycleProvenance: null` / `scopeId: null` on every row; (b) new writes round-trip the structured object; (c) idempotent re-open. Canonical migration SQL also checked in at [core/storage/migrations/v1.1.0_provenance.sql](../../core/storage/migrations/v1.1.0_provenance.sql) for reference | This commit |
| v1.0.0 4.P1.X (scope_id on persistent memory tables) | 4 (4.1) | Same migration adds `scope_id TEXT NULL` to all three memory tables plus a helper index on each (`idx_memories_scope`, `idx_episodic_scope`, `idx_relations_scope`); mirrors the existing in-memory `MemoryHub` scope filter | This commit |
| agentmemory A5 | 4 (4.2 + 4.3) | New `core/lifecycle/HookBus.ts` defines a closed 12-variant `LifecycleEvent` discriminated union and an `InProcessHookBus` that wraps `TelemetryBus`. Every emit republishes onto the underlying telemetry bus so existing trace consumers see the events. `AgentLoop.run`, `_runToolCall`, and `spawnSubAgent` emit five of the twelve hooks today (`session.start`/`.stop`, `tool.pre`/`.post`/`.failed`, `subagent.start`/`.stop`). The remaining four (`user.prompt`, `context.preCompact`, `session.end`, `skill.entry`) are deferred under 4.3.P1.J. New `tests/unit/core/lifecycle/HookBus.test.ts` covers every event kind + Disposable + republish; `tests/unit/tools/AgentLoop.hookBus.test.ts` asserts the run boundaries + tool brackets in an integration scenario | This commit |
| agentmemory A7 | 4 (4.4) | New `core/observability/redactSecrets.ts` consolidates the existing trace-side patterns into a string-in / string-out scrubber covering AWS access keys, classic + fine-grained GitHub PATs, Slack tokens, JWTs, PEM private-key blocks (multi-line), and env-style assignments. Wired into `MemoryStore.save(...)` so every memory write is scrubbed before SQLite insert. Same scrubber redacts `lifecycle.tool.failed.redactedError` so leaked secrets in tool errors never reach the bus. New `tests/unit/core/observability/redactSecrets.test.ts` exercises every pattern + benign-content round-trip + `detectSecretCategories` helper. The `MemoryStore.provenance.test.ts` redaction case asserts the end-to-end gate against an `AKIA...` AWS key | This commit |
| -- (UI surface) | 4 (4.5) | `MemoryPanel` gains a "Show provenance" toggle; when on, each entry renders `hookKind` + `toolName` chips. `TraceDashboardPanel` gains a `hookKind` dropdown filter populated from the distinct hookKinds present on the event stream. Protocol schemas extended with optional `MemorySnapshot.provenance` map and `TraceEvent.hookKind` string. Sidecar producer wiring is tracked at 4.5.P2.L | This commit |

---

## 3. Summary

| Severity | Open | Resolved | Total |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 4 | 7 | 11 |
| P2 | 5 | 0 | 5 |
| P3 | 0 | 0 | 0 |
| **Total** | **9** | **15** | **24** |

Phase 4 contributes five closures (agentmemory A8 schema, v1.0.0 4.P1.X scope_id, agentmemory A5 HookBus + emit sites, agentmemory A7 secret pre-index filter, the UI surfaces for 4.5) and three new open items (4.3.P1.J HookBus emit sites partially wired; 4.1.P2.K fixture generated in-test rather than checked in; 4.5.P2.L sidecar producer for provenance / hookKind not yet wired). The Phase 3 closures (3.P1.A codemod + partial 1.4.P1.B) stay on the books from the prior pass.

By category (open items only):
- **DF** (deferred): 7
- **MT** (missing tests): 1
- **NI** (not implemented as planned): 1
- **BG / WN / QG**: 0

By phase (open items only):
- Phase 1: 6 (deferred sub-tasks 1.1 wiring + 1.4 wholesale move (12/13 sub-trees still open) + 1.10 NexusCodingRuntime + 1.11 Tailwind v4 + 1.12.P2.H + 1.12.P2.I) -- the codemod from Phase 3 (3.P1.A) is now available to consume them.
- Phase 4: 3 (4.3.P1.J emit sites + 4.1.P2.K fixture-in-test + 4.5.P2.L sidecar producer)

---

## 4. Carryforward map (v1.0.0 -> v1.1.0)

This table mirrors the cycle plan's [Carryforward Map](plans/v1.1.0-cycle.md#carryforward-map-v100---v110). Items in **Phase 1** are closed here (see `## 2. Resolved` above) or recorded as open items in `## 1` when deferred to "Phase 1b". Items in later phases are open and tracked against their target phase.

| v1.0.0 code | v1.1.0 phase | Status (as of 2026-05-19) |
|---|---|---|
| 2.P1.G | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.2) |
| 2.P1.H | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.3) |
| 2.P2.I | 1 / 3 / future | Partially closed -- Phase 3 (this commit, sub-tasks 3.1 + 3.2) lands the codemod and migrates `src/utils/`; open item 1.4.P1.B holds the per-sub-tree status table for the remaining 12 sub-trees |
| 2.P1.J | 1 (manifest) + 10 | Closed-manifest-portion (Phase 2 commit `de219a5`, sub-task 2.1); Marketplace re-publish targets cycle Phase 10 |
| 2.P2.K | 1 (npm) + 10 | Closed-npm-portion (Phase 2 commit `de219a5`, sub-task 2.2); Marketplace re-publish targets cycle Phase 10 |
| 2.P3.L | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.8) |
| 3.P1.M | 1 | Deferred (open item 1.10.P1.F) -- waits for `src/runtime/` to migrate under 1.4.P1.B |
| 3.P1.P | 1 | Closed (Phase 1 commit `ec3ff0e`, sub-task 1.7) |
| 3.P2.S | 1 | Closed (Phase 2 commit `de219a5`, sub-task 2.3) |
| 5.P3.FF | 1 (subsumed by 2.P3.L) | Closed (Phase 1 commit `ec3ff0e`) |
| 1.P2.B | 1 | Deferred (open item 1.11.P1.G) -- folds into cycle Phase 11 webview-build pipeline change |
| 1.P2.C | 15 (OA-07) | Open (operator action, target Phase 15) |
| 1.P2.D | 1 / 15 | Open (target Phase 15 RTM) |
| All remaining v1.0.0 carryforwards (Phases 2-15) | 2-15 | Open, tracked in cycle plan |

---

## References

- [docs/v1.0.0/known-gaps.md](../v1.0.0/known-gaps.md) -- upstream cycle gap log
- [docs/v1.0.0/operator-actions.md](../v1.0.0/operator-actions.md) -- OA-01 through OA-12
- [docs/v1.1.0/plans/v1.1.0-cycle.md](plans/v1.1.0-cycle.md) -- active plan
- [docs/v1.1.0/plans/phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) -- Phase 1 detail
- [docs/v1.1.0/plans/phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) -- Phase 2 detail (rebrand + sidecar core extraction)
- [docs/v1.1.0/plans/phase-03-coding-module.md](plans/phase-03-coding-module.md) -- Phase 3 detail (codemod + first `src/` -> `modules/coding/` sub-tree migration)
- [docs/v1.1.0/development/decisions/shared-core-build.md](development/decisions/shared-core-build.md) -- ADR for sub-task 1.1
- [scripts/dev/rewrite-imports.mjs](../../scripts/dev/rewrite-imports.mjs) -- generic import-rewriting codemod consumed by Phase 3 + future sub-tree migrations

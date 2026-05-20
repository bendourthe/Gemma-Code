# v1.1.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: live (cycle opened at Phase 1, 2026-05-18; Phase 2 rebrand + core extraction landed 2026-05-19; Phase 3 coding-module codemod + first sub-tree migration landed 2026-05-19; Phase 4 memory provenance + HookBus + secret pre-index filter landed 2026-05-19; Phase 5 hybrid retrieval + local embedder + warm-build worker landed 2026-05-19; Phase 6 memory CLI + Ebbinghaus decay + slash commands landed 2026-05-19; Phase 7 session replay timeline + compare mode landed 2026-05-20)
**Audience**: v1.1.0 phase authors, code reviewer, security reviewer, ops engineer, future-cycle planners
**Last updated**: 2026-05-20
**Sibling reviews**: [docs/v1.0.0/known-gaps.md](../v1.0.0/known-gaps.md) (the upstream cycle gap log this file inherits from); [docs/v1.1.0/plans/v1.1.0-cycle.md](plans/v1.1.0-cycle.md) (the active plan); [docs/v1.1.0/plans/phase-01-shared-core-and-carryforward-closure.md](plans/phase-01-shared-core-and-carryforward-closure.md) (Phase 1 detail); [docs/v1.1.0/plans/phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) (Phase 2 detail); [docs/v1.1.0/plans/phase-03-coding-module.md](plans/phase-03-coding-module.md) (Phase 3 detail); [docs/v1.1.0/plans/phase-05-hybrid-retrieval-and-local-embedder.md](plans/phase-05-hybrid-retrieval-and-local-embedder.md) (Phase 5 detail).

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

### 5.1.P1.M -- LocalEmbedder runs against the deterministic hash fallback in CI (DF, P1)

- **Source phase**: Phase 5 (5.1)
- **Plan reference**: [phase-05-hybrid-retrieval-and-local-embedder.md](plans/phase-05-hybrid-retrieval-and-local-embedder.md) sub-task 5.1 ("Add `@xenova/transformers` to `package.json` dependencies. Add `core/memory/LocalEmbedder.ts` with `class LocalEmbedder { async embed(text: string): Promise<Float32Array> }` ... The installer (Phase 14) packs the weights so production hosts never hit the Hub.").
- **Reason**: `@xenova/transformers` is the binary-heavy ONNX runtime (`onnxruntime-node` transitive, plus the ~80 MB `all-MiniLM-L6-v2` weights downloaded on first use). The Phase 5 commit adds it as an `optionalDependencies` entry (so `npm ci` does not require it on CI hosts that lack the native build toolchain) and the `LocalEmbedder` class lazy-loads it via a guarded dynamic `import()`. When the import fails, the class transparently switches to a deterministic 384-dim hash sketch (`hashEmbed` in [core/memory/LocalEmbedder.ts](../../core/memory/LocalEmbedder.ts)). The sketch is contractually identical (384-dim, deterministic, L2-normalized, batch-callable) so the rest of the pipeline -- `DenseIndex`, `HybridRetriever`, `WarmRebuildWorker` -- can be exercised end-to-end without the runtime payload, but it is NOT a substitute for real semantic embeddings in production. The unit tests (`tests/unit/core/memory/LocalEmbedder.test.ts`) run against the fallback by passing `forceFallback: true`, so CI assertions cover the fallback path verbatim; the real ONNX pipeline is exercised manually on the operator's GPU rig under OA-09 and again as part of Phase 14's installer payload smoke.
- **Suggested next step**: When the cross-OS installer lands in Phase 14, add an integration test that runs against the bundled weights at `~/.nexus/runtimes/embedder/all-MiniLM-L6-v2/` and asserts: (a) `backend === "transformers"` after first use; (b) deterministic vector for "hello world" matches a fixture; (c) cosine similarity between semantically-similar sentence pairs is materially higher than the hash sketch produces. The test gates the v1.1.0 RTM by depending on the installer's weight payload, so it cannot run earlier than Phase 14.

### 5.5.P1.N -- `src/storage/UnifiedMemoryRetriever` not yet migrated; delegation happens at the `MemoryHub` level instead (DF, P1)

- **Source phase**: Phase 5 (5.5)
- **Plan reference**: [phase-05-hybrid-retrieval-and-local-embedder.md](plans/phase-05-hybrid-retrieval-and-local-embedder.md) sub-task 5.5 ("Replace the substring path in `UnifiedMemoryRetriever` with a delegating call to `HybridRetriever`. Keep the substring path as a fast-path-fallback for very small corpora (<100 entries) where BM25 is overkill.").
- **Reason**: `src/storage/UnifiedMemoryRetriever` is a 312-line legacy class whose retrieval path is not substring-based: it dispatches per-layer token budgets, fuses a hybrid HNSW + FTS5 + recency ranking via the v0.9.0 Phase 2.2 `MemoryStore.retrieveHybrid`, and falls back to the v0.7.0 keyword + cosine merge on the legacy route. The literal substring path the plan describes lives in `core/memory/MemoryHub.ts::InMemoryMemoryHub.retrieve` -- the four-layer in-memory facade that pillars (Chat, Image, Video) consume during Phase 2-5 before the SQLite stack is wired in. Phase 5 wires the new `HybridRetriever` into that hub (with the documented `<100`-entry substring fast-path fallback gated by `nexus.memory.hybridMinCorpus`) so the user-visible semantics of "substring on tiny corpora, hybrid on real ones" are satisfied; the deeper migration of `src/storage/UnifiedMemoryRetriever` will fold into the Phase 6/9 work where `MemoryStore` itself gains the BM25 / dense indexes alongside its existing HNSW path. The deviation note: the plan over-simplified the existing retriever's role; the corrected interpretation is that the hybrid path lands in the `MemoryHub` first (where it has consumers today) and migrates into the SQLite-backed `UnifiedMemoryRetriever` second.
- **Suggested next step**: In Phase 6 (memory CLI + decay) or Phase 9 (consolidation), add a `MemoryStore`-backed adapter that builds `Bm25Index` + `DenseIndex` from the persistent rows on startup and wires them into a `HybridRetriever` consumed by `UnifiedMemoryRetriever.retrieve(query)` for the semantic layer's budget. The substring path stays as a fast-path fallback for corpora <100 entries via `nexus.memory.hybridMinCorpus`.

### 5.6.P2.O -- IdleTimeScheduler binding for `memory.warm-rebuild` not yet wired in the sidecar (DF, P2)

- **Source phase**: Phase 5 (5.6)
- **Plan reference**: [phase-05-hybrid-retrieval-and-local-embedder.md](plans/phase-05-hybrid-retrieval-and-local-embedder.md) sub-task 5.6 ("Add an `IdleTimeScheduler` worker `memory.warm-rebuild` that on first launch (or when the indexes are detected as stale -- a hash-of-row-count mismatch) reads all `memory_entries` rows and embeds them in batches of 32.").
- **Reason**: The worker code (`core/memory/WarmRebuildWorker.ts::warmRebuild` plus `createWarmRebuildTask`) ships with full unit-test coverage (11 tests including the 10,000-row latency budget). The `createWarmRebuildTask` helper returns the exact `{id, idleThresholdMs, cadenceMs, run()}` shape that `IdleTimeScheduler.register` expects, but the actual `scheduler.register(createWarmRebuildTask(...))` call site in `desktop/sidecar/` has not been wired because it needs (a) a `MemoryStore`-backed `WarmRebuildSource` implementation (currently the worker only knows about an in-memory rows array; see 5.5.P1.N for the related migration story) and (b) a singleton `LocalEmbedder` injected at sidecar boot. Both prerequisites cluster naturally with the Phase 6 CLI work (which adds the persistent-memory adapters anyway) or the Phase 10 thin-adapter rewrite (which is where the sidecar's `IdleTimeScheduler` is materialized).
- **Suggested next step**: In Phase 6, build the `MemoryStoreWarmRebuildSource` (wraps `MemoryStore.iterateAllRows()`, hashes row count + last-updated timestamp into `fingerprint()`), instantiate one shared `LocalEmbedder` per sidecar (`LocalEmbedder.fromInstallPath()`), and register the task on the existing `IdleTimeScheduler` instance. Acceptance: a fresh-from-defaults sidecar fires the warm-rebuild within ~5 s of becoming idle, surfaces progress via `lifecycle.notification`, and the Memory panel reflects the rebuild status.

### 6.1.P2.P -- SQLite-backed `memory_audit_log` table not yet wired; CLI consumes captured JSONL snapshots (DF, P2)

- **Source phase**: Phase 6 (6.1)
- **Plan reference**: [phase-06-memory-cli-decay-and-slash-commands.md](plans/phase-06-memory-cli-decay-and-slash-commands.md) sub-task 6.1 ("Reads from `memory_entries` + `memory_audit_log` (a new lightweight log table written on every read/write/delete; add to the Phase 4 migration).").
- **Reason**: Phase 6 ships the audit log as an in-memory `InMemoryAuditLog` plus a pure formatter (`formatAuditTable` / `formatAuditJsonl`) and threads the log through the slash-command handlers so `/recall` / `/remember` / `/forget` already write audit rows. The persistence boundary -- a SQLite-backed `MemoryAuditLog` implementation against a new `memory_audit_log` table in the v1.1.0 Phase 4 migration -- was not landed because Phase 4's `_runMigrations()` block already bumped `MEMORY_SCHEMA_VERSION` to 3 for the provenance + scope_id columns, and adding the audit table without a coordinated migration version bump would split the schema upgrade across two commits with no clean rollback. Phase 6's CLI surface therefore reads from a captured JSONL snapshot via `--source <path.jsonl>`; the sidecar wires the in-memory log directly into the slash-command handlers (no JSONL hop) so the production path is fully exercised end-to-end without the persistence layer.
- **Suggested next step**: In Phase 7 or 8, bump `MEMORY_SCHEMA_VERSION` to 4 and add the `memory_audit_log` table (columns mirror `MemoryAuditRow`: `timestamp INTEGER NOT NULL, op TEXT NOT NULL, tier TEXT NOT NULL, entry_id TEXT NOT NULL, session_id TEXT NULL, hook_kind TEXT NULL, tool_name TEXT NULL, text_preview TEXT NOT NULL, PRIMARY KEY (timestamp, entry_id, op)`). Implement `SqliteMemoryAuditLog implements MemoryAuditLog` against it, and have the sidecar swap the in-memory instance for the SQLite one at boot. The CLI's `--source` flag remains useful for forensic replay against captured snapshots.

### 6.2.P2.Q -- `nexus memory export` / `nexus memory import` CLI surface consumes injected JSONL rather than the live store (DF, P2)

- **Source phase**: Phase 6 (6.2)
- **Plan reference**: [phase-06-memory-cli-decay-and-slash-commands.md](plans/phase-06-memory-cli-decay-and-slash-commands.md) sub-task 6.2 ("Output: one JSONL line per row, full row contents (text, vector base64, provenance, tier, timestamps).").
- **Reason**: The core export/import logic lives in [core/memory/MemoryExport.ts](../../core/memory/MemoryExport.ts) (`exportToJsonl(source, filter)` + `importFromJsonl(text, sink)` + `encodeVectorB64` / `decodeVectorB64` + `isPathInside` path-traversal guard) and is fully exercised by [tests/unit/core/memory/MemoryExport.test.ts](../../tests/unit/core/memory/MemoryExport.test.ts) (12 cases including the round-trip integrity assertion). The CLI surface in [bin/nexus.mjs](../../bin/nexus.mjs) calls into the same code path with a `--source <jsonl>` injection. The end-to-end "CLI binds to the live `MemoryStore` and walks every row" wiring is deferred for the same schema-coordination reason as 6.1.P2.P: the production path runs through the desktop daemon's sidecar where the export/import code is already wired (the sidecar instantiates `MemoryStoreExportSource` directly), so the CLI's `--source` injection is the operator-facing surface for forensic replay rather than a primary user path. The acceptance criterion ("a small corpus exports and reimports via `nexus memory import` with round-trip integrity") is satisfied at the unit level.
- **Suggested next step**: Add a `MemoryStoreExportSource` adapter under [src/storage/MemoryExportAdapters.ts](../../src/storage/) (wraps `MemoryStore.listAll(limit)` and projects each row into `ExportableRow`); add a matching `MemoryStoreImportSink`; have the sidecar inject them at boot so the desktop app's export button writes the live store without any JSONL intermediate. Land alongside 6.1.P2.P.

### 6.5.P2.R -- Memory panel "Forget" button signals via callback; IPC delete pipeline deferred (DF, P2)

- **Source phase**: Phase 6 (6.5)
- **Plan reference**: [phase-06-memory-cli-decay-and-slash-commands.md](plans/phase-06-memory-cli-decay-and-slash-commands.md) sub-task 6.5 ("Add a 'Forget' button on each row in the Memory panel ... that calls `memory.delete(id)` IPC -> sidecar handler -> `MemoryHub.delete(id)`.").
- **Reason**: Phase 6 adds the `onForget` callback on `MemoryPanel` (rendered as a "Forget" button per row) plus the two panel tests asserting render + click-dispatch. The actual IPC pipeline (`memory.delete(id)` in the protocol -> sidecar handler -> `MemoryHub.delete(id)`) is deferred because the `MemoryHub` interface in [core/memory/MemoryHub.ts](../../core/memory/MemoryHub.ts) does not yet expose a `delete(id)` method -- the four-layer in-memory facade was designed write-add-only with bulk `clear()` and `retagScope()` semantics. Adding `delete(id)` requires per-layer wiring (`WorkingMemory.deleteById`, `EpisodicMemory.deleteById`, `SemanticMemory.deleteById`, `GraphMemory.deleteByEntryId`), the matching protocol schema field, the sidecar handler, and the `desktop/sidecar/src/coding/panelData.ts` route -- a non-trivial cross-cutting change. The `/forget` slash command exercises the same `MemoryWritePort.delete(id)` interface at the handler layer (covered by [tests/unit/core/memory/MemorySlashCommands.test.ts](../../tests/unit/core/memory/MemorySlashCommands.test.ts)) so the contract is proven; only the panel-button-to-sidecar path is left.
- **Suggested next step**: Extend `MemoryHub` with `delete(id: string): Promise<boolean>` (return `true` when the row existed). Add `memory.delete` to the sidecar protocol; route it to the live hub. In the desktop panel, swap the placeholder `onForget` consumer for an IPC call that confirms via the existing `ConfirmationGate` then dispatches `memory.delete(id)`. Cluster with 6.1.P2.P / 6.2.P2.Q so the schema migration and IPC additions land together.

### 6.6.P2.S -- DecaySweep `IdleTimeScheduler` binding deferred to sidecar wiring (DF, P2)

- **Source phase**: Phase 6 (6.6)
- **Plan reference**: [phase-06-memory-cli-decay-and-slash-commands.md](plans/phase-06-memory-cli-decay-and-slash-commands.md) sub-task 6.6 ("Register the sweep as an `IdleTimeScheduler` worker with a 24-hour cadence.").
- **Reason**: The sweep worker ([core/memory/DecaySweep.ts](../../core/memory/DecaySweep.ts)) is feature-complete with the closed-form Ebbinghaus retention curve (`retentionAt(elapsed, halfLife) = exp(-elapsed / halfLife * ln(2))`), per-tier half-lives (24h / 7d / 30d / 365d), the `retention < 0.05 AND accessCount < 3` eviction rule, and full unit-test coverage including the "5% of the math" assertion against a 100-row synthetic corpus. The `nexus memory decay --now` CLI surface fires the sweep manually for debugging. The `IdleTimeScheduler.register({id: "memory.decay-sweep", idleThresholdMs: 5 * 60_000, cadenceMs: 24 * 60 * 60_000, run: () => sweep.sweep()})` call site in the sidecar is deferred for the same reason as 5.6.P2.O ("warm-rebuild" worker): the sidecar needs a `MemoryStore`-backed `DecayProvider` adapter (currently the worker only knows about an array of `DecayableEntry` rows) and the corresponding tombstone table.
- **Suggested next step**: In Phase 7 or 8 (alongside the schema migration that lands 6.1.P2.P + 6.2.P2.Q), add `MemoryStoreDecayProvider` (wraps `MemoryStore.listAll().map(rowToDecayableEntry)` and `MemoryStore.deleteById` for eviction) plus a `memory_tombstones` table (30-day retention). Register the worker at sidecar boot.

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

### Phase 5 closures (this commit)

| Source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| agentmemory A2 | 5 (5.1) | `LocalEmbedder` (in [core/memory/LocalEmbedder.ts](../../core/memory/LocalEmbedder.ts)) wraps `@xenova/transformers` + the `all-MiniLM-L6-v2` ONNX weights. `embed(text)` and `embedBatch(texts)` return 384-dim L2-normalized Float32Arrays. Production hosts read from `~/.nexus/runtimes/embedder/all-MiniLM-L6-v2/` (installer payload, Phase 14); dev hosts fall back to the Hub fetch. CI runs against a deterministic 384-dim hash sketch (`hashEmbed`) so the surrounding pipeline is exercised without the binary runtime -- see open item 5.1.P1.M. `@xenova/transformers ^2.17.2` declared under `optionalDependencies`. 17 unit tests in [tests/unit/core/memory/LocalEmbedder.test.ts](../../tests/unit/core/memory/LocalEmbedder.test.ts) | This commit |
| agentmemory A1 (BM25 portion) | 5 (5.2) | `Bm25Index` (in [core/memory/Bm25Index.ts](../../core/memory/Bm25Index.ts)) implements standard Okapi BM25 with default `k1=1.5` and `b=0.75` (exposed via Settings `nexus.memory.bm25.k1` / `.b`). Tokenizer in [core/memory/stopwords.ts](../../core/memory/stopwords.ts) is case-folded, splits on non-alnum, drops a 120-word stop-list. `add(entryId, text)` / `delete(entryId)` mutate in O(tokens-per-doc); `search(query, limit)` returns an insertion-ordered map keyed by descending score with deterministic tie-breaking. 1,000-entry corpus: indexing <200 ms total; search <50 ms p50; add <5 ms median. 18 unit tests in [tests/unit/core/memory/Bm25Index.test.ts](../../tests/unit/core/memory/Bm25Index.test.ts) | This commit |
| agentmemory A1 (dense portion) | 5 (5.3) | `DenseIndex` (in [core/memory/DenseIndex.ts](../../core/memory/DenseIndex.ts)) holds a flat in-memory `Float32Array[]` keyed by `entryId`. Search is linear cosine similarity (no HNSW yet; documented v1.2.0 upgrade path beyond ~50K entries). `delete(id)` tombstones; `compact()` reclaims tombstones. `save(filePath)` / `static load(filePath)` round-trip the live slots through a custom `"NXDI" + uint32 dim + uint32 count + (uint32 idLen + utf8 id + dim*float32 vec)*` binary format that does not require Float32Array alignment. Default on-disk path is `~/.nexus/memory/dense.bin`. 1,000-entry scan <50 ms p50. 16 unit tests in [tests/unit/core/memory/DenseIndex.test.ts](../../tests/unit/core/memory/DenseIndex.test.ts) | This commit |
| agentmemory A1 (RRF portion) | 5 (5.4) | `RrfFuser` + free `fuse(rankings, k=60)` (in [core/memory/RrfFuser.ts](../../core/memory/RrfFuser.ts)) compute `sum_over_rankings(1/(k + rank_i))` for every entryId present in any input ranking, sort descending by fused score (deterministic tie-break). Default `k = 60` matches Cormack et al. (SIGIR 2009) and is exposed as `nexus.memory.rrf.k`. The instance class lets SettingsStore listeners mutate `k` without re-instantiating. 9 unit tests in [tests/unit/core/memory/RrfFuser.test.ts](../../tests/unit/core/memory/RrfFuser.test.ts) including the hand-computed three-ranking example from the paper | This commit |
| agentmemory A1 (façade portion) | 5 (5.5) | `HybridRetriever` (in [core/memory/HybridRetriever.ts](../../core/memory/HybridRetriever.ts)) runs BM25 + Dense (via embedder) + Graph (optional `GraphRanker`) in parallel, fuses via `RrfFuser`, resolves ids to `MemoryHit` via an injected `entryProvider`, applies the existing `isVisibleFromScope` filter, and truncates to `limit`. `InMemoryMemoryHub` (in [core/memory/MemoryHub.ts](../../core/memory/MemoryHub.ts)) takes an optional `hybridRetriever` via constructor or `setHybridRetriever()`; corpora below the `hybridMinCorpus` threshold (`nexus.memory.hybridMinCorpus`, default 100) stay on substring; larger corpora delegate to the hybrid path automatically. The structural `HybridRetrieverLike` interface declared inline in `MemoryHub.ts` breaks the would-be circular dep. `substringFallback(query, entries, limit)` is exported for consumers that want explicit fast-path control. 14 unit tests in [tests/unit/core/memory/HybridRetriever.test.ts](../../tests/unit/core/memory/HybridRetriever.test.ts) (including the 1,000-entry p50<50ms / p99<150ms latency budget and the 10-query regression that asserts substring top hits stay in the hybrid top-10) plus 5 in [tests/unit/core/memory/MemoryHub.hybrid.test.ts](../../tests/unit/core/memory/MemoryHub.hybrid.test.ts) | This commit |
| agentmemory A1 + A2 (warm-build) | 5 (5.6) | `warmRebuild(source, embedder, bm25, dense, opts)` (in [core/memory/WarmRebuildWorker.ts](../../core/memory/WarmRebuildWorker.ts)) reads every memory row, embeds in batches of 32 (configurable), repopulates `Bm25Index` + `DenseIndex`, and reports progress via the Phase 4 `HookBus` as `lifecycle.notification` events (`notificationKind: "memory.warm-rebuild"`). Fingerprint-based short-circuit skips when the source returns the same identifier as the previous run. `createWarmRebuildTask({...})` returns an `IdleTimeScheduler.register`-compatible shape (default 5 s idle threshold, 24 h cadence) so the sidecar wiring -- tracked under 5.6.P2.O -- is a one-liner once the `MemoryStore` adapter lands. Embedder failures degrade to BM25-only with a warning notification rather than crashing. 10,000-row rebuild completes well under the 60 s acceptance ceiling. 11 unit tests in [tests/unit/core/memory/WarmRebuildWorker.test.ts](../../tests/unit/core/memory/WarmRebuildWorker.test.ts) | This commit |
| -- (benchmark + settings) | 5 (5.7) | [tests/benchmarks/hybrid-retrieval.bench.ts](../../tests/benchmarks/hybrid-retrieval.bench.ts) declares the Phase 5 latency benchmark (top-10 retrieve on 1,000 entries + BM25 add median ceiling). Settings schema additions in [package.json](../../package.json): `nexus.memory.bm25.k1` (default 1.5), `nexus.memory.bm25.b` (default 0.75), `nexus.memory.rrf.k` (default 60), `nexus.memory.hybridMinCorpus` (default 100), each with min/max bounds and a description that points to the consuming module | This commit |

### Phase 7 closures (this commit)

| Source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| agentmemory A6 (session replay) | 7 (7.1 + 7.2 + 7.3) | The TraceDashboard ([desktop/src/modules/coding/panels/TraceDashboardPanel.tsx](../../desktop/src/modules/coding/panels/TraceDashboardPanel.tsx)) gained an optional left-rail session list (driven by the existing `coding.sessions.list` IPC), a `<TimelineScrubber>` ([desktop/src/modules/coding/panels/TimelineScrubber.tsx](../../desktop/src/modules/coding/panels/TimelineScrubber.tsx)) with play/pause + variable speed (0.5x / 1x / 2x / 4x) + Go-to-start/end + per-event tick marks + `requestAnimationFrame`-driven playhead, and a "Compare to..." picker that flips the dashboard to a side-by-side `<SessionCompareView>` ([desktop/src/modules/coding/panels/SessionCompareView.tsx](../../desktop/src/modules/coding/panels/SessionCompareView.tsx)) with a linked play state, a shared speed dropdown, and a row-per-index Diff pane that highlights `kind`/`summary` deltas. 13 new component tests (9 `TimelineScrubber` including the deterministic 2x-speed wall-clock assertion + 4 `SessionCompareView`) + 3 new `TraceDashboardPanel` cases. Coverage on the three new/modified files: `TimelineScrubber.tsx` 97.79%, `SessionCompareView.tsx` 100%, `TraceDashboardPanel.tsx` 99.59% -- comfortably above the 80% gate. The CodingPage ([desktop/src/modules/coding/CodingPage.tsx](../../desktop/src/modules/coding/CodingPage.tsx)) wires replay/compare state to `coding.trace.subscribe({sessionId})` + `coding.sessions.list` IPC | This commit |

### Phase 6 closures (commit `c8d9e0b`)

| Source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| agentmemory A11 | 6 (6.1) | `nexus memory audit [--since <ISO>] [--tier <t>] [--scope <id>] [--session <id>] [--op <op>] [--format table\|json] [--source <jsonl>]` ships as a new CLI subcommand in [bin/nexus.mjs](../../bin/nexus.mjs). Implementation in [core/memory/MemoryAudit.ts](../../core/memory/MemoryAudit.ts) (`formatAuditTable`, `formatAuditJsonl`, `parseSinceFlag`) plus the log abstraction in [core/memory/MemoryAuditLog.ts](../../core/memory/MemoryAuditLog.ts) (`MemoryAuditRow`, `MemoryAuditFilter`, `InMemoryAuditLog`, `rowFromProvenance`, `previewText`). Output columns: timestamp, op (write/read/delete), tier, entryId, sessionId, hookKind, toolName, textPreview. 10 unit tests in [tests/unit/core/memory/MemoryAuditLog.test.ts](../../tests/unit/core/memory/MemoryAuditLog.test.ts) + 10 in [tests/unit/core/memory/MemoryAudit.test.ts](../../tests/unit/core/memory/MemoryAudit.test.ts). Persistence to SQLite is tracked under open item 6.1.P2.P | This commit |
| agentmemory A10 | 6 (6.2) | `nexus memory export --out <file>` and `nexus memory import --in <file>` ship as new CLI subcommands. Implementation in [core/memory/MemoryExport.ts](../../core/memory/MemoryExport.ts) (`exportToJsonl(source, filter)`, `importFromJsonl(text, sink)`, `encodeVectorB64` / `decodeVectorB64` for base64-encoded Float32 vectors, `isPathInside` for path-traversal guard). One JSONL line per row with full row contents (text, vectorB64, provenance, tier, scope, timestamps, accessCount, corroborationCount). The output path is clamped to `~/.nexus/exports/` by the CLI surface. 12 unit tests in [tests/unit/core/memory/MemoryExport.test.ts](../../tests/unit/core/memory/MemoryExport.test.ts) including the round-trip integrity assertion. Live `MemoryStore` source/sink adapters are tracked under 6.2.P2.Q | This commit |
| `/recall <query>` slash command | 6 (6.3) | New `recall` entry in the desktop slash-command catalog ([desktop/src/modules/coding/slashCommands.ts](../../desktop/src/modules/coding/slashCommands.ts)). Handler `handleRecall(input, ctx)` in [core/memory/MemorySlashCommands.ts](../../core/memory/MemorySlashCommands.ts) calls `HybridRetriever.retrieve(query, {scopeId, visibleScopes, limit: 10})` (via the structural `HybridRetrieverLike` interface) and renders the top-10 hits as a fenced JSON block + machine-readable `payload`. Every hit produces a `read` row in the audit log tagged with `hookKind: "slash.recall"`. 4 unit tests in [tests/unit/core/memory/MemorySlashCommands.test.ts](../../tests/unit/core/memory/MemorySlashCommands.test.ts) covering happy-path, missing-query, missing-retriever, and warming-up | This commit |
| `/remember <text>` slash command | 6 (6.4) | New `remember` entry in the desktop catalog. Handler `handleRemember(input, ctx)` writes a working-tier observation via `MemoryWritePort.writeWorking({content, provenance, scopeId?})` with `provenance: {sessionId, hookKind: "slash.remember", parentSpanId?}`. Every write produces a `write` row in the audit log. 2 unit tests cover the happy path and the empty-text rejection | This commit |
| agentmemory A12 (`/forget --id\|--pattern`) | 6 (6.5) | New `forget` entry in the desktop catalog. Handler `handleForget(input, ctx)` parses `--id <uuid>` (exact) or `--pattern <regex>` (matches `text` field), gates the deletion via `ctx.confirm(...)`, deletes via `MemoryWritePort.delete(id)`, and writes a `delete` row to the audit log per row. The `parseForgetArgs` helper is unit-tested for all four flag shapes (`--id`, `--id=`, `--pattern bare`, `--pattern "quoted"`) plus invalid-regex rejection. The `MemoryPanel` ([desktop/src/modules/coding/panels/MemoryPanel.tsx](../../desktop/src/modules/coding/panels/MemoryPanel.tsx)) gains an optional `onForget(layerKey, index, entry)` prop; when supplied, every entry row renders a "Forget" button alongside the provenance chips. 6 unit tests for `handleForget` + 2 new desktop panel tests in [desktop/tests/panels.test.tsx](../../desktop/tests/panels.test.tsx). IPC pipeline to live `MemoryHub.delete(id)` is tracked under 6.5.P2.R | This commit |
| agentmemory A3 (Ebbinghaus decay) | 6 (6.6) | [core/memory/DecaySweep.ts](../../core/memory/DecaySweep.ts) implements the closed-form Ebbinghaus retention curve `R(t) = exp(-t / halfLife * ln(2))` with per-tier half-lives (working = 24 h, episodic = 7 d, semantic = 30 d, graph = 365 d -- configurable via constructor `halfLives`). Eviction rule: `retention < 0.05 AND accessCount < 3`. The `DecayProvider` interface decouples the sweep from the store; the `evict(id)` callback owns tombstoning. `nexus memory decay --now` exposes a manual sweep for debugging. 10 unit tests in [tests/unit/core/memory/DecaySweep.test.ts](../../tests/unit/core/memory/DecaySweep.test.ts) including the "5% of the math" assertion (100-row synthetic corpus, 7-day advancement). IdleTimeScheduler wiring in the sidecar is tracked under 6.6.P2.S | This commit |
| Phase 6 CLI parsing | 6 (6.7) | [bin/nexus.mjs](../../bin/nexus.mjs) gains the `memory` subcommand with four sub-subcommands (`audit`, `export`, `import`, `decay`) routed through `runMemoryCommand`. Each subcommand resolves the compiled artifact from `out/core/memory/*.js`, so the CLI works against the same code paths the sidecar uses. New parseArgs test cases in [tests/unit/cli/nexus-cli.test.ts](../../tests/unit/cli/nexus-cli.test.ts) cover `memory audit --since`, `memory export --out`, and `memory decay --now` | This commit |

### Phase 4 closures (commit `9323352`)

| Source | v1.1.0 phase | Item | Resolved in |
|---|---|---|---|
| agentmemory A8 | 4 (4.1) | `MemoryEntry` carries `lifecycleProvenance: {sessionId, hookKind, toolName?, parentSpanId?} \| null`; new `core/memory/types.ts` defines the shape with safe JSON parse/serialize; SQLite migration adds `provenance TEXT NULL` + `scope_id TEXT NULL` to `memories`, `episodic_events`, and `graph_relations`; runtime migration is performed in TypeScript with column-presence guards so re-running on a fresh DB is a no-op. Schema version bumped to 3. New `tests/unit/storage/MemoryStore.provenance.test.ts` exercises: (a) a v1.0.0-shaped DB migrates to v3 with `lifecycleProvenance: null` / `scopeId: null` on every row; (b) new writes round-trip the structured object; (c) idempotent re-open. Canonical migration SQL also checked in at [core/storage/migrations/v1.1.0_provenance.sql](../../core/storage/migrations/v1.1.0_provenance.sql) for reference | Phase 4 commit `9323352` |
| v1.0.0 4.P1.X (scope_id on persistent memory tables) | 4 (4.1) | Same migration adds `scope_id TEXT NULL` to all three memory tables plus a helper index on each (`idx_memories_scope`, `idx_episodic_scope`, `idx_relations_scope`); mirrors the existing in-memory `MemoryHub` scope filter | Phase 4 commit `9323352` |
| agentmemory A5 | 4 (4.2 + 4.3) | New `core/lifecycle/HookBus.ts` defines a closed 12-variant `LifecycleEvent` discriminated union and an `InProcessHookBus` that wraps `TelemetryBus`. Every emit republishes onto the underlying telemetry bus so existing trace consumers see the events. `AgentLoop.run`, `_runToolCall`, and `spawnSubAgent` emit five of the twelve hooks today (`session.start`/`.stop`, `tool.pre`/`.post`/`.failed`, `subagent.start`/`.stop`). The remaining four (`user.prompt`, `context.preCompact`, `session.end`, `skill.entry`) are deferred under 4.3.P1.J. New `tests/unit/core/lifecycle/HookBus.test.ts` covers every event kind + Disposable + republish; `tests/unit/tools/AgentLoop.hookBus.test.ts` asserts the run boundaries + tool brackets in an integration scenario | Phase 4 commit `9323352` |
| agentmemory A7 | 4 (4.4) | New `core/observability/redactSecrets.ts` consolidates the existing trace-side patterns into a string-in / string-out scrubber covering AWS access keys, classic + fine-grained GitHub PATs, Slack tokens, JWTs, PEM private-key blocks (multi-line), and env-style assignments. Wired into `MemoryStore.save(...)` so every memory write is scrubbed before SQLite insert. Same scrubber redacts `lifecycle.tool.failed.redactedError` so leaked secrets in tool errors never reach the bus. New `tests/unit/core/observability/redactSecrets.test.ts` exercises every pattern + benign-content round-trip + `detectSecretCategories` helper. The `MemoryStore.provenance.test.ts` redaction case asserts the end-to-end gate against an `AKIA...` AWS key | Phase 4 commit `9323352` |
| -- (UI surface) | 4 (4.5) | `MemoryPanel` gains a "Show provenance" toggle; when on, each entry renders `hookKind` + `toolName` chips. `TraceDashboardPanel` gains a `hookKind` dropdown filter populated from the distinct hookKinds present on the event stream. Protocol schemas extended with optional `MemorySnapshot.provenance` map and `TraceEvent.hookKind` string. Sidecar producer wiring is tracked at 4.5.P2.L | Phase 4 commit `9323352` |

---

## 3. Summary

| Severity | Open | Resolved | Total |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 6 | 14 | 20 |
| P2 | 10 | 8 | 18 |
| P3 | 0 | 0 | 0 |
| **Total** | **16** | **29** | **45** |

Phase 7 contributes one closure (agentmemory A6 session replay timeline) and introduces no new open items -- the IPC `coding.trace.subscribe({sessionId?})` contract was already in place from Phase 2 and the new `<TimelineScrubber>`, session-list side-rail, and `<SessionCompareView>` are pure consumers of that surface. Phase 6 contributed seven closures (A11 audit, A10 export+import, `/recall`, `/remember`, A12 `/forget`, A3 Ebbinghaus decay, plus the CLI parsing surface) and four P2 deferrals (6.1.P2.P, 6.2.P2.Q, 6.5.P2.R, 6.6.P2.S) -- all still open and clustered around the same live `MemoryStore` adapter cluster.

By category (open items only):
- **DF** (deferred): 14
- **MT** (missing tests): 1
- **NI** (not implemented as planned): 1
- **BG / WN / QG**: 0

By phase (open items only):
- Phase 1: 6 (deferred sub-tasks 1.1 wiring + 1.4 wholesale move (12/13 sub-trees still open) + 1.10 NexusCodingRuntime + 1.11 Tailwind v4 + 1.12.P2.H + 1.12.P2.I) -- the codemod from Phase 3 (3.P1.A) is now available to consume them.
- Phase 4: 3 (4.3.P1.J emit sites + 4.1.P2.K fixture-in-test + 4.5.P2.L sidecar producer)
- Phase 5: 3 (5.1.P1.M hash-fallback in CI + 5.5.P1.N UnifiedMemoryRetriever migration deferred to Phase 6/9 + 5.6.P2.O IdleTimeScheduler binding deferred to Phase 6)
- Phase 6: 4 (6.1.P2.P SQLite audit log table deferred + 6.2.P2.Q export/import CLI consumes injected JSONL + 6.5.P2.R Memory panel "Forget" IPC pipeline deferred + 6.6.P2.S DecaySweep IdleTimeScheduler binding deferred)
- Phase 7: 0 new open items.

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
- [docs/v1.1.0/plans/phase-05-hybrid-retrieval-and-local-embedder.md](plans/phase-05-hybrid-retrieval-and-local-embedder.md) -- Phase 5 detail (hybrid retrieval + local embedder + warm-build worker)
- [docs/v1.1.0/development/decisions/shared-core-build.md](development/decisions/shared-core-build.md) -- ADR for sub-task 1.1
- [scripts/dev/rewrite-imports.mjs](../../scripts/dev/rewrite-imports.mjs) -- generic import-rewriting codemod consumed by Phase 3 + future sub-tree migrations

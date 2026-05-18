# v1.0.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: in-progress (the v1.0.0 cycle opened with Phase 1 on 2026-05-17; this file is finalized at v1.0.0 release in Phase 11)
**Audience**: v1.0.0 phase authors, code reviewer, security reviewer, ops engineer
**Sibling reviews**: [docs/v0.9.0/known-gaps.md](../v0.9.0/known-gaps.md) (the upstream cycle gap log this file inherits from); [docs/v1.0.0/plans/v1.0.0-cycle.md](plans/v1.0.0-cycle.md) (the active plan).
**Context**: This file mirrors `docs/v0.9.0/known-gaps.md`'s structure. It is appended phase-by-phase as v1.0.0 lands. Each entry records the source phase, plan reference, category, severity, reason, and suggested next step. Items move to `## Resolved` when closed in a later phase, and the `## Summary` at the bottom is recomputed each pass.

Each entry has a severity tag:

- **P0** -- release-blocker for v1.0.0 (must close)
- **P1** -- should-fix in v1.0.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v1.0.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 1. Open Items

### 1.P1.A -- Tauri runtime smoke not executed on this host (DF, P1)

- **Source phase**: Phase 1 (1.1, 1.8)
- **Plan reference**: [phase-01-shell-foundation.md](plans/phase-01-shell-foundation.md) sub-task 1.1 acceptance ("`npm run dev:shell` opens a window") and 1.8 acceptance ("integration test that boots the shell with WebDriver / Playwright").
- **Reason**: The implementing session ran on a Windows 11 host without an interactive desktop session. `cargo check` / `cargo clippy` / `cargo test` were not exercised locally because the Rust toolchain install was not in scope of this session; the Tauri shell relies on the new `shell-build.yml` GitHub Actions matrix (windows-latest / macos-latest / ubuntu-latest) to validate the Rust core. Vitest + lint + typecheck all passed on this host (52/52, 99.11% lines, 100% functions).
- **Suggested next step**: First green CI run on the `shell-build.yml` workflow validates 1.1's acceptance criterion across all three OS legs; if any leg fails, fold the diagnosis into Phase 2 (the next cycle entry, which already touches the desktop workspace for the rebrand sweep). A live `npm run dev:shell` smoke (window opens, ping IPC roundtrips) is also expected to be captured by the operator in `docs/v1.0.0/operator-actions.md` once that file is opened at Phase 11.

### 1.P2.B -- Tailwind v4 wiring deferred (DF, P2)

- **Source phase**: Phase 1 (1.2)
- **Plan reference**: [phase-01-shell-foundation.md](plans/phase-01-shell-foundation.md) sub-task 1.2 ("Apply tokens via Tailwind CSS v4 configured to consume CSS variables").
- **Reason**: Tokens are codified in `desktop/src/styles/tokens.css` and consumed directly via `var(--token)` in every component. Tailwind v4's `@theme inline` directive would re-expose the same vars as utility classes, but plumbing Tailwind v4 also requires PostCSS configuration that we do not need until Phase 2 (rebrand sweep) when the build pipeline is otherwise touched. Shipping Tailwind in Phase 1 would have added a build step with zero behavioural change.
- **Suggested next step**: Phase 2.X (carve `core/` from `src/`) folds in a Tailwind v4 step alongside the build-pipeline rebrand; until then, components read tokens directly. The `<StyleguidePage>` already inspects every token visually so the verification path stays intact.

### 1.P2.C -- Lucide React icon usage stops at module-default icons (NI, P2)

- **Source phase**: Phase 1 (1.3)
- **Plan reference**: [phase-01-shell-foundation.md](plans/phase-01-shell-foundation.md) sub-task 1.3 ("color-coded icons (Chatbot / Agentic AI / Images / Videos)").
- **Reason**: The Sidebar maps each module to a single Lucide icon (MessageSquare / Code2 / Image / Film). The mockup hints at custom glyphs for each pillar; we hold the visual identity work for Phase 2 brand sweep so the rebrand and the icon refresh land together and we do not churn the icon set twice.
- **Suggested next step**: Phase 2 rebrand sweep includes finalizing the Lucide icon shortlist or commissioning custom SVGs.

### 1.P2.D -- Tauri integration / E2E test pending (DF, MT, P2)

- **Source phase**: Phase 1 (1.8)
- **Plan reference**: [phase-01-shell-foundation.md](plans/phase-01-shell-foundation.md) sub-task 1.8 ("integration test that boots the shell with WebDriver / Playwright (if Tauri-compatible)").
- **Reason**: Phase 1 ships unit tests at 99.11% lines / 100% functions / 87.21% branches across `desktop/src/` and the Node sidecar (well above the 80% gate). An end-to-end Tauri-driver test that actually spawns the native window + sidecar requires `tauri-driver` and a display server (`xvfb`/`Xvnc` on Linux, headed runs on macOS / Windows). That harness has its own setup cost; we ship the unit + sidecar coverage now and add the Tauri-driver smoke in a follow-on without delaying Phase 2.
- **Suggested next step**: Land `tauri-driver` + a single "open window + ping IPC + close" Playwright/WebDriver smoke in the `shell-build.yml` CI job, scheduled as the first task of Phase 2 testing-and-stabilization.

### 1.P2.E -- Tauri icons placeholder (NI, P2)

- **Source phase**: Phase 1 (1.1)
- **Plan reference**: [phase-01-shell-foundation.md](plans/phase-01-shell-foundation.md) sub-task 1.1 ("placeholder window opens").
- **Reason**: `desktop/src-tauri/tauri.conf.json` references icons under `icons/` (`32x32.png`, `128x128.png`, `icon.icns`, `icon.ico`). The asset files are not committed in Phase 1 because the brand identity (logo, color palette finalization) is part of Phase 2's rebrand sweep. `tauri build` will fail until icons land; `tauri dev` works against the bundled default.
- **Suggested next step**: Phase 2 rebrand sweep generates the icon set (typically via `cargo tauri icon path/to/source.png`).

### 2.P1.G -- Storage-path call-site rename deferred (DF, P1)

- **Source phase**: Phase 2 (2.2)
- **Plan reference**: [phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) sub-task 2.2 ("Search for every literal of the old path in `src/`, `tests/`, `scripts/`, `docs/`").
- **Reason**: The migration module (`core/storage/StorageMigration.ts`) and the canonical-path helper (`core/storage/paths.ts`) land in Phase 2.2. The 9 homedir-based call sites in `src/` (`MemoryFiles.ts`, `SkillLoader.ts`, `SkillMetrics.ts`, `CurationLoop.ts`, `WorkflowDetector.ts`, `McpManager.ts`, `ImprovementHook.ts`, `TraceFile.ts`, `PlanArchive.ts`, `quickLabels.ts`) plus the 4 workspace-local sites (`webCache.ts`, `MemoryHealthCheck.ts`, `OutputRedirector.ts`, `dbPermissions.ts`) still read/write `~/.gemma-code/` and `<workspace>/.gemma-code/`. POSIX symlink (created by the migration) keeps `~/.gemma-code/` working on macOS / Linux; on Windows the legacy directory is preserved alongside the new one. The mechanical rename cascades into ~14 test files; doing it atomically with the migration was deemed higher-risk than two separate landings.
- **Suggested next step**: A follow-up Phase 2.2.1 commit replaces every call site with `nexusHome()` / `path.join(workspaceRoot, ".nexus")`, updates the affected tests, and removes the legacy `.gemma-code` paths from `src/utils/secretPaths.ts`. Verify by `grep -r "\.gemma-code" src/ tests/ scripts/` returning zero hits outside `docs/v0.X.0/development/history/`.

### 2.P1.H -- Settings package.json deprecationMessage incomplete (DF, P1)

- **Source phase**: Phase 2 (2.1)
- **Plan reference**: [phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) sub-task 2.1.
- **Reason**: The `SettingsCompat` shim resolves every legacy `gemma-code.*` key to its canonical `nexus.*` counterpart with a runtime deprecation log. The canonical `nexus.*` schema entries were added to `package.json` for the load-bearing keys (`ollamaUrl`, `modelName`, `editMode`, `memoryEnabled`, etc.) but the older `gemma-code.*` schema entries are mostly NOT tagged with `deprecationMessage`. VS Code therefore renders the legacy keys as ordinary settings in the Settings UI; users see them but get no in-UI deprecation hint. The runtime log catches misconfigured callers regardless.
- **Suggested next step**: A scripted pass that walks `SETTINGS_KEY_MAP` and injects `"deprecationMessage": "Use \`<newKey>\` instead. Removed in v1.1.0."` into every legacy entry in `package.json contributes.configuration.properties`. Verify with the existing `SettingsCompat.test.ts` and a snapshot of `package.json`.

### 2.P2.I -- Wholesale physical move of `src/` -> `modules/coding/` deferred (DF, P2)

- **Source phase**: Phase 2 (2.3)
- **Plan reference**: [phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) sub-task 2.3 ("Move `src/llm/` -> `core/llm/`; `src/storage/` -> `core/memory/`; `src/tools/` -> `modules/coding/tools/`...").
- **Reason**: Phase 2.3 establishes the canonical `core/` + `modules/coding/` directory layout, the dep-cruiser boundary rules, and the new `tsconfig` `rootDirs`. The shared-core surfaces (Phase 2.6) and the storage migration (Phase 2.2) live under `core/`. However, the 189 files currently under `src/` are NOT yet moved into `modules/coding/<sub-tree>/` because the cascading import-path rewrite across 517 test files is mechanical but high-volume, and doing it inside the same commit as the rebrand sweep would have made review and rollback substantially harder. The boundary rule is enforced for any NEW code added to `core/` or `modules/`.
- **Suggested next step**: Phase 2.3.1 (follow-on commit) performs the wholesale move with `git mv`, runs a single find/replace pass over the import paths, and re-runs the full test suite. Acceptance: `npm test` stays green, `npm run check-architecture` stays green, every import in `modules/coding/` resolves from `core/` or `modules/coding/<sibling>/`.

### 2.P1.J -- VS Code extension manifest IDs not renamed (DF, P1)

- **Source phase**: Phase 2 (2.7)
- **Plan reference**: [phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) sub-task 2.7 ("grep for `GemmaCode` and `gemmaCode` returns 0 results in `src/`...").
- **Reason**: Code identifiers `GemmaCodePanel` / `GemmaRuntime` were renamed to `NexusCodingPanel` / `NexusCodingRuntime`. The VS Code extension manifest in `package.json` still uses `gemma-code-sidebar` (viewContainer id), `gemma-code.<command>` (command ids), and `gemma-code.chatView` / `.memoryPanel` / `.traceDashboard` (view ids). Renaming these is a breaking change for any user who has personal keybindings bound to `gemma-code.<command>`; ride a major VS Code extension version bump (v1.1.0) so the breaking-change story is bundled with the npm package re-publish.
- **Suggested next step**: Phase 11 release-gate task: rename every `gemma-code.*` view / command id to `nexus.coding.*`, bump the extension manifest version, update keybinding-customization docs, and re-publish under `nexus-coding` on the VS Code Marketplace.

### 2.P2.K -- VS Code extension npm package name not renamed (DF, P2)

- **Source phase**: Phase 2 (rebrand)
- **Plan reference**: pivot-brief Section 7.
- **Reason**: `package.json` `"name": "gemma-code"` and `"publisher": "gemma-code"` are unchanged. Renaming these forks the published VSIX -- a user installed from `gemma-code` Marketplace listing cannot transparently migrate to a `nexus-coding` listing without a manual update flow. Defer to the same v1.1.0 release that flips the VS Code extension manifest IDs (item J).
- **Suggested next step**: Tie this rename to the v1.1.0 cycle so both happen in a single Marketplace re-publish.

### 2.P3.L -- Pre-existing test failures on Windows (DF, BG, P3)

- **Source phase**: Phase 2 (2.9 test run)
- **Plan reference**: [phase-02-rebrand-and-core-extraction.md](plans/phase-02-rebrand-and-core-extraction.md) sub-task 2.9 acceptance ("Run the test suite, fix all failures").
- **Reason**: After Phase 2 changes land, 5 tests still fail under `npm test`: 4 in `tests/unit/agents/SubAgentManager.characterization.test.ts` (snapshot files stored with LF in git but checked out with CRLF on Windows; the prompt builder emits LF), and 1 in `tests/unit/workflow-discipline.test.ts` (the Phase 1 `.github/workflows/shell-build.yml` references `dtolnay/rust-toolchain@stable` and `actions/cache@v4` without 40-char SHA pinning). Neither is caused by Phase 2: a `git stash`-and-rerun shows the same failures before any Phase 2 commit. The 2683 / 5-fail / 5-skip count is held at the same level as pre-Phase-2 baseline.
- **Suggested next step**: Two separate follow-ups. (1) Add a `.gitattributes` rule normalising `tests/snapshots/specialists/*.txt` to LF, or change the test to compare normalised strings (`actual.replace(/\r\n/g, "\n")`). (2) SHA-pin the two GitHub Actions references in `shell-build.yml` to specific commits with version-tag comments, matching the rest of `.github/workflows/`.

### 3.P1.M -- NexusCodingRuntime not wired into the sidecar session manager (DF, P1)

- **Source phase**: Phase 3 (3.1)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.1 ("instantiate `NexusCodingRuntime` once per process and route IPC calls into it").
- **Reason**: The full `NexusCodingRuntime` (AgentLoop + ToolRegistry + ChatController) still lives under `src/` during the one-cycle compat window; the sidecar workspace cannot import from `../../src/` cleanly without the shared-core build step that lands in Phase 5. Phase 3 ships an in-memory `CodingSessionManager` against a stable IPC surface so the desktop UI, frontend tests, and the protocol union are all exercised end-to-end. The Phase 3 acceptance "an end-to-end fix-the-failing-test task succeeds against each of the three model backends" therefore runs against the placeholder responder rather than a live engine.
- **Suggested next step**: Phase 5 introduces the shared-core build and Phase 3 follow-on swaps the placeholder responder in `desktop/sidecar/src/coding/sessionManager.ts` for a real `NexusCodingRuntime` instance. The IPC contract does not change; only the body of `sendMessage` does.

### 3.P1.N -- Streaming IPC notifications still envelope-only (DF, P1)

- **Source phase**: Phase 3 (3.1)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.1 ("streams agent output as `coding.session.event` notifications").
- **Reason**: The Phase 1 JSON-RPC transport is request/response only -- the sidecar lacks a server-initiated notification channel (no second pipe, no SSE, no WebSocket). Phase 3 ships the full event union (`token` / `toolCallHeader` / `toolCallArgDelta` / `toolCallComplete` / `done`) but returns the events in the response envelope from `coding.session.sendMessage`. The desktop frontend already reduces the event array via the `toolCallCard` reducer, so the rendering path is identical for the streamed and batched variants.
- **Suggested next step**: Phase 5 (where the IPC surface is broadened anyway for the model browser) adds a Tauri `tauri::Channel` for notifications; the sidecar emits one frame per event, the response shrinks to `{sessionId}`, and the frontend swaps the event reducer onto a channel listener.

### 3.P1.O -- Thin VS Code adapter still hosts the engine in-process (DF, P1)

- **Source phase**: Phase 3 (3.3)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.3 ("The extension at `src/extension.ts` becomes a ~200-line adapter that...").
- **Reason**: `src/extension.ts` is 445 lines today and wires the full in-process engine. Phase 3 ships `src/desktop/daemonDiscovery.ts` (with unit tests covering proxy / extension-only / opt-in / error branches) so the activation code path that decides between proxying and falling back is in place; the actual rewrite of the activator + panel hosts is a contained refactor that lands as a Phase 3 follow-on once the daemon socket layer (item N) is ready to carry the proxy traffic.
- **Suggested next step**: Phase 3 follow-on commit: extract `extension.ts` activation into a smaller `activateProxy()` / `activateExtensionOnly()` branch behind `discoverDesktopDaemon()`; thin the panel hosts (`NexusCodingPanel`, `MemoryPanel`, `TraceDashboardPanel`) to webview shells that forward `postMessage` calls into the IPC client.

### 3.P1.P -- Legacy curator-cadence fallback still present in AgentLoop (DF, P1)

- **Source phase**: Phase 3 (3.4)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.4 ("Once the scheduler is wired and integration-tested, delete the legacy curator-cadence fallback in `modules/coding/tools/AgentLoop.ts._runOneIteration`").
- **Reason**: The Phase 3 scheduler bootstrap (`desktop/sidecar/src/runtime/idleScheduler.ts`) is wired with synthetic curator + reflect workers and verified by the 30-minute integration test. The legacy post-N-edits dispatch in `src/tools/AgentLoop.ts._runOneIteration` is left in place because the engine is still hosted by the VS Code extension during the compat window, and deleting it now would regress the v0.22.x extension-only mode that item O still relies on. The new scheduler path becomes the only entry point once the engine moves into `modules/coding/`.
- **Suggested next step**: Bundle with the AgentLoop relocation: delete the curator-cadence fallback, add a Settings UI toggle at `nexus.curator.enabled` (default `true`), and a regression test that asserts the scheduler is the sole curator entry point.

### 3.P1.Q -- Memory / Trace / Sessions panels backed by placeholder data (DF, P1)

- **Source phase**: Phase 3 (3.5)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.5 ("Each panel consumes data via the IPC protocol... Reuse the existing `MemoryPanel` host-side handlers").
- **Reason**: The desktop panels (`MemoryPanel`, `TraceDashboardPanel`, `SessionListPanel`) ship in `desktop/src/modules/coding/panels/` and render the full data shape they will see in production (four memory layers + `anticipated` + `proposedSkills`; trace events with redacted secret paths; session summaries). The sidecar handlers (`coding.memory.snapshot`, `coding.trace.subscribe`, `coding.sessions.list`) return deterministic placeholder payloads in `desktop/sidecar/src/coding/panelData.ts`. The wiring to live `MemoryHub` / `TelemetryBus` waits on the same engine relocation that items M and P depend on.
- **Suggested next step**: When `MemoryHub` is imported by the sidecar, replace `memorySnapshot()` and `traceSubscribe()` with adapter functions that call into the hub and bus. Reuse the existing `redactSecrets()` utility unchanged; widen its pattern set as the security review surfaces additional secret formats.

### 3.P2.R -- Slash-command parity test against VS Code reference deferred (DF, MT, P2)

- **Source phase**: Phase 3 (3.6)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.6 acceptance ("an integration test runs each of the 12 most-used slash commands... and asserts identical outputs against the VS Code reference").
- **Reason**: The desktop chat input now autocompletes the twelve canonical slash commands (`/plan`, `/clear`, `/commit`, `/review-pr`, `/curate`, `/trace`, `/thinking-mode`, `/skill-metrics`, `/memory`, `/verify`, `/research`, `/help`) and unit tests cover the catalog + filter behaviour. The end-to-end equivalence test (run each command in the desktop module and in the VS Code reference, assert byte-identical outputs) requires the live `SlashCommandRouter` import path which is blocked on items M / O. A capture-and-diff harness is straightforward to add once those land.
- **Suggested next step**: Add `tests/integration/slashCommandParity.test.ts` once the desktop runtime imports `SlashCommandRouter` from `modules/coding/chat/`. The harness drives both code paths against a fixed model mock and asserts equality on the rendered `RenderedTurn` from `toolCallCard.applyEvents`.

### 3.P2.S -- Frontend / sidecar model catalogs duplicated until shared-core build (DF, P2)

- **Source phase**: Phase 3 (3.2)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.2 ("add the model to `core/registry/models.json`").
- **Reason**: The canonical model definitions live in `core/registry/models.json` and `core/registry/ModelCatalog.ts`. The sidecar workspace (`desktop/sidecar/src/coding/models.ts`) and the desktop frontend (`desktop/src/modules/coding/models.ts`) each inline a TypeScript mirror because Node16 module resolution cannot reach across to `../../../core/` without a published-package build step. A parity test (`desktop/tests/coding-models.test.ts`) keeps the two copies aligned, and the root catalog test asserts the TS file matches `models.json`.
- **Suggested next step**: Phase 5 introduces the shared-core build (TypeScript project references or a small published `@nexus/core` workspace package). Once that lands, delete the two mirrors and import the canonical catalog directly.

### 3.P2.T -- Golden-task validation against live Ollama backends deferred to operator action (DF, MT, P2)

- **Source phase**: Phase 3 (3.2, 3.7)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.2 acceptance ("a golden-task run against each of `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b` produces the same `read_file` -> `apply_edit` trajectory").
- **Reason**: The prompt-format strategies and tool-call extractors are unit-tested with canned inputs covering every wire format. A live golden-task run requires three resident Ollama models on the host (~22 GB total) and is therefore operator-driven, in line with the v0.9.0 P3 pattern that rolled forward into v1.0.0 as item set 10.N.live-bench.
- **Suggested next step**: Operator captures the trajectory of `nexus-check golden --model <id>` for each of the three model ids in `docs/v1.0.0/operator-actions.md`. The fixture is committed back under `tests/golden/v1.0.0/multi-llm/` for future regression checks.

### 3.P2.U -- Tauri channel notifications: Tauri-side wiring blocked on Phase 5 IPC widening (DF, P2)

- **Source phase**: Phase 3 (3.1)
- **Plan reference**: [phase-03-coding-module.md](plans/phase-03-coding-module.md) sub-task 3.1 (event streaming).
- **Reason**: The `desktop/src-tauri/src/sidecar.rs` core currently exposes a single `ipc_call` command (request/response). Adding a `tauri::Channel<CodingSessionEventT>` requires touching the Rust side and re-running the matrix build, which is bundled with the Phase 5 ModelRegistry IPC widening to avoid two cargo-rebuild touches in adjacent phases.
- **Suggested next step**: Track alongside item N; one Rust-side commit covers both.

### 4.P1.V -- HTML5 drag-drop instead of `@dnd-kit/core` for the folder tree (NI, P1)

- **Source phase**: Phase 4 (4.3)
- **Plan reference**: [phase-04-chat-module.md](plans/phase-04-chat-module.md) sub-task 4.3 ("Use `@dnd-kit/core` for drag-drop").
- **Reason**: The `<FolderTree>` ships drag-drop via the native HTML5 `dragstart` / `dragover` / `drop` events instead of `@dnd-kit/core`. The plan called for `@dnd-kit/core` explicitly; native dnd was chosen to avoid (a) a new third-party dependency in the v1.0.0 cycle, (b) the `@dnd-kit` testing-utility setup cost, and (c) one extra cold-start cost in the Vite bundle. Native HTML5 dnd is sufficient for folder-into-folder and chat-into-folder moves; the FolderTree refuses cycles at the store layer. The component is structured so the dnd surface is contained in a few handlers and a follow-on swap to `@dnd-kit/core` does not need to reshape the FolderTree internals -- it only re-implements the four `handleDragStart` / `handleDragOver` / `handleDrop` / `dragSourceRef` paths.
- **Suggested next step**: When a future phase adds another drag-drop surface (Image Studio canvas in Phase 6 or Video Lab timeline in Phase 7), evaluate `@dnd-kit/core` against the in-place HTML5 path; if the new surface needs it, swap the FolderTree implementation in the same commit so the dependency cost is amortised.

### 4.P1.W -- ChatExplorerStore not wired into the sidecar IPC layer (DF, P1)

- **Source phase**: Phase 4 (4.1, 4.5)
- **Plan reference**: [phase-04-chat-module.md](plans/phase-04-chat-module.md) sub-tasks 4.1 (store) and 4.5 (top-bar search).
- **Reason**: The SQLite-backed `ChatExplorerStore` lives under `modules/chat/storage/` at the repository root (where `better-sqlite3` is already a dependency) and has its own 41 unit + integration tests. The desktop frontend consumes the same surface through an in-memory `InMemoryChatExplorerClient` under `desktop/src/modules/chat/`, which mirrors the public API (`createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`, `createChat`, `renameChat`, `moveChat`, `deleteChat`, `listTree`, `search`, `ancestors`). The sidecar IPC layer does not yet bridge the two; a chat created in the desktop UI is not persisted to disk across restarts. This mirrors the Phase 3 placeholder pattern (items 3.P1.M, 3.P1.N, 3.P1.Q) and is gated on the same shared-core build that closes those follow-ons.
- **Suggested next step**: A Phase 4 follow-on (or fold into the Phase 5 IPC widening alongside items 3.P1.N / 3.P2.S) adds `chat.explorer.listTree`, `chat.explorer.createFolder`, etc. methods to `desktop/sidecar/src/protocol.ts`, an adapter in `desktop/sidecar/src/chat/explorerManager.ts` that delegates to the root `ChatExplorerStore`, and a sidecar-backed client in `desktop/src/modules/chat/sidecarChatExplorerClient.ts`. The frontend swap is one line per `<ChatPage>` / `<TopBar>` consumer.

### 4.P1.X -- MemoryHub scope filter is in-memory only (DF, P1)

- **Source phase**: Phase 4 (4.2)
- **Plan reference**: [phase-04-chat-module.md](plans/phase-04-chat-module.md) sub-task 4.2 ("The graph memory entity table also gains a `scope_id` column").
- **Reason**: The `InMemoryMemoryHub` now supports `scopeId` tagging across every layer (working / episodic / semantic / graph) and the `ChatScopedMemory` bridge translates a chat's folder ancestry into the visible scope chain. The SQLite-backed layers (MemoryStore, EpisodicMemory, GraphMemory in `src/storage/`) still don't carry a `scope_id` column on their entity / event tables. Adding the column is a migration plus a few query updates, but the engine is still hosted by the VS Code extension during the one-cycle compat window (Phase 3 known-gap 3.P1.M) and migrating the columns now would require co-ordinating with the Phase 2 storage-path migration that still has untouched call sites (item 2.P1.G).
- **Suggested next step**: Bundle with the Phase 5 ModelRegistry SQLite work: add `scope_id TEXT NULL` columns to `memory_entries`, `episodic_events`, and `graph_edges`; gate retrieval on `WHERE scope_id IS NULL OR scope_id IN (?, ?, ...)`; backfill existing rows as `NULL` (legacy unscoped). The `ChatScopedMemory` bridge does not change.

### 4.P2.Y -- Local memory search adapter not yet wired to MemoryHub (DF, P2)

- **Source phase**: Phase 4 (4.5)
- **Plan reference**: [phase-04-chat-module.md](plans/phase-04-chat-module.md) sub-task 4.5 ("call ... `MemoryHub.retrieve(query, {scopeId: null, limit: 10})`").
- **Reason**: The `<TopBar>` accepts a `memoryAdapter` prop (typed as `MemorySearchAdapter`) and tests cover the Memories group via an injected mock. The default `<Dashboard>` does not yet pass an adapter -- the Memories group is hidden in production because the desktop frontend cannot reach `MemoryHub` without the shared-core build (same blocker as 4.P1.W / 3.P1.N). The search input still works for folders + chats from the chat explorer client.
- **Suggested next step**: Once the sidecar exposes `memory.retrieve(query)` and the desktop client lives under `desktop/src/lib/memorySearch.ts`, wire it into the `<Dashboard memoryAdapter={memorySearch}>` prop. The TopBar component does not change.

### 4.P2.Z -- ChatPage messages are in-memory only (DF, P2)

- **Source phase**: Phase 4 (4.4)
- **Plan reference**: [phase-04-chat-module.md](plans/phase-04-chat-module.md) sub-task 4.4 ("Memory hub is wired with the folder's `contextScopeId`").
- **Reason**: The `<ChatPage>` stores chat messages in a per-instance `Map<string, ChatMessage[]>` so the UI surface (`<MessageList>`, breadcrumb, model selector, tools toggle) is exercised end-to-end without a sidecar round-trip. Once the IPC widening lands (items 3.P1.M / 4.P1.W), the assistant response will come from the Coding-module-style streaming-event handler instead of the local echo stub. The shared chat shell does not change; only the `handleSubmit` body in ChatPage.
- **Suggested next step**: Replace the echo in `ChatPage.handleSubmit` with an `ipc.call("coding.session.sendMessage", { sessionId, message })` once the chat module gets its own `chat.session.*` surface (or shares the Coding surface with a `module` discriminator).

### 4.P2.AA -- TopBar empty-state badge on Dashboard bell still hard-coded (DF, P2)

- **Source phase**: Phase 4 (4.5)
- **Plan reference**: Pivot-brief Section 3.2.
- **Reason**: The `<TopBar extraButtons>` slot renders the Dashboard's notification bell with a red-dot badge. The badge visibility is currently always-on (hard-coded markup) because no notification source exists yet; the previous Phase 1 implementation behaved identically. Genuine notifications surface in Phase 8 (telemetry) and Phase 10 (skills sync diffs).
- **Suggested next step**: Phase 8 introduces a `notificationStream` prop on the Dashboard that drives the badge visibility; the TopBar already accepts `extraButtons` so the badge gating happens at the call site, no TopBar changes needed.

### 5.P1.BB -- Settings UI is wired to a mock client (DF, P1)

- **Source phase**: Phase 5 (5.5)
- **Plan reference**: [phase-05-model-registry.md](plans/phase-05-model-registry.md) sub-task 5.5 ("Install shows a progress bar driven by the downloader's progress event (subscribe via IPC). Cancel button.").
- **Reason**: `desktop/src/pages/settings/ModelsSettings.tsx` ships the full UI surface (Installed / Available / External sections, type / family filters, search, disk-usage summary, install progress + cancel, remove, reveal). The default route binds to `createMockModelsClient()` because the sidecar's `models.list` / `models.install` / `models.remove` / `models.diskUsage` IPC methods are still declared as `NotImplementedError` in `desktop/sidecar/src/handlers.ts` (Phase 1 contract surface). The mock client mimics download progress in real time so the UI is exercised end-to-end in tests.
- **Suggested next step**: A Phase 5 follow-on commit wires four new handlers in `desktop/sidecar/src/handlers.ts` against a `NexusModelRegistry` instance (constructed once via `bootstrapCoding` + `NexusModelRegistry.create({ root: nexusHome() })`), adds schemas for `models.list` / `models.install` / `models.remove` / `models.diskUsage` to `protocol.ts`, and introduces a `sidecarModelsClient` in `desktop/src/pages/settings/` that satisfies `ModelsClient`. Install progress flows through the same `tauri::Channel` approach tracked by 3.P1.N / 3.P2.U.

### 5.P2.CC -- Catalog SHA-256 digests for HTTP-sourced models are placeholders (NI, P2)

- **Source phase**: Phase 5 (5.3)
- **Plan reference**: [phase-05-model-registry.md](plans/phase-05-model-registry.md) sub-task 5.3 ("source: {protocol: 'ollama' | 'huggingface' | 'url', url, sha256}").
- **Reason**: `core/registry/catalog.json` carries every Phase 6 image entry (SDXL Turbo, SDXL 1.0, Flux Schnell, SD 1.5) and Phase 7 video entry (LTX-Video, SVD) with `source.sha256: "0".repeat(64)` as a placeholder. The `Downloader` will reject any actual fetch against these specs (`DigestMismatch`), which is the safe failure mode -- but a user clicking "Install" today gets a digest-mismatch error rather than a verified download. Ollama-sourced entries delegate digest verification to `ollama pull` and are unaffected.
- **Suggested next step**: Phase 6 (image studio) and Phase 7 (video lab) capture the canonical SHA-256 for each weights file from the hosting site (HuggingFace's `lfs.sha256` field or a manual `shasum -a 256` over the downloaded file) and replace the placeholder digests. A small `core/registry/catalog-digests.test.ts` is added at the same time that asserts every non-ollama entry has a non-zero digest.

### 5.P2.DD -- StreamingPipeline keep-alive resolver hand-wiring is operator-driven (DF, P2)

- **Source phase**: Phase 5 (5.6)
- **Plan reference**: [phase-05-model-registry.md](plans/phase-05-model-registry.md) sub-task 5.6 ("inject the `keepAliveFor(modelId)` resolver into the streaming pipeline via the existing `KeepAliveResolver` callback in `StreamingPipeline`").
- **Reason**: `core/registry/ModelPinRegistry` exposes `resolver()` -> `(model) => keepAliveFor(model)`, and `desktop/sidecar/src/runtime/codingBootstrap.ts` builds the `keepAliveResolver`. The actual hand-off into `src/chat/StreamingPipeline.ts`'s constructor argument is still operator-controlled by `src/panels/ChatPanelBootstrap.ts`, which lives under the VS Code-bound code path and continues to consume the legacy `src/storage/ModelPinRegistry.ts` (now a re-export). Once the engine relocates into `modules/coding/` (Phase 2.P2.I / 3.P1.M), the sidecar will own `StreamingPipeline` construction and pass `boot.keepAliveResolver` directly; until then, both code paths see the same underlying registry instance because the legacy module re-exports the core class.
- **Suggested next step**: Bundle with the engine relocation (Phase 5 follow-on or Phase 6): construct `StreamingPipeline` in the sidecar's session manager and pass `bootstrap.keepAliveResolver` as the `resolveKeepAlive` argument. The VS Code adapter (item 3.P1.O) then no longer needs to thread its own resolver through.

### 5.P2.EE -- Settings UI per-model "Keep loaded in VRAM" checkbox not yet bound (DF, P2)

- **Source phase**: Phase 5 (5.6)
- **Plan reference**: [phase-05-model-registry.md](plans/phase-05-model-registry.md) sub-task 5.6 ("Add a Settings UI checkbox per installed LLM: 'Keep loaded in VRAM' toggles the pin.").
- **Reason**: The `ModelsClient` interface accepts optional `pin` / `isPinned` methods, and `ModelsSettings` renders a "Pin" action on installed entries when the client wires them. The default mock client in `desktop/src/pages/settings/mockModelsClient.ts` does not implement them yet (because the IPC bridge in 5.P1.BB is also stubbed). Once the sidecar client lands, a one-line `pin: (id, pinned) => ipc.call("models.pin", { id, pinned })` finishes the wiring; the UI side already exists.
- **Suggested next step**: Same Phase 5 follow-on that wires 5.P1.BB also adds `models.pin` (calls `bootstrap.modelPins.setPinned(id, pinned)`) and `models.isPinned` IPC methods, plus the matching `sidecarModelsClient` implementation. Replace the "Pin" button with a checkbox in the Installed section once both ends are live.

### 5.P3.FF -- Pre-existing test failures unchanged on Windows (DF, BG, P3)

- **Source phase**: Phase 5 (5.7 test run)
- **Plan reference**: [phase-05-model-registry.md](plans/phase-05-model-registry.md) sub-task 5.7 ("Run the test suite, fix all failures, iterate").
- **Reason**: The full `npm test` run still shows 5 failures unchanged from Phase 2's recording in item 2.P3.L (4x `SubAgentManager.characterization.test.ts` CRLF/LF snapshot mismatches; 1x `workflow-discipline.test.ts` SHA-pin check against the Phase 1 `shell-build.yml` workflow). All Phase 5 tests (115 / 115) pass; the failure set is identical to a pre-Phase-5 stash-and-rerun.
- **Suggested next step**: No new action. Tracked exhaustively under item 2.P3.L; this entry exists so the Phase 5 audit trail reflects the same baseline.

### 6.P1.GG -- Diffusion runtime ships with stub executors (no live PyTorch) (DF, P1)

- **Source phase**: Phase 6 (6.2, 6.3, 6.4)
- **Plan reference**: [phase-06-image-studio.md](plans/phase-06-image-studio.md) sub-tasks 6.2 ("StableDiffusionXLPipeline"), 6.3 ("img2img / inpaint / outpaint pipelines"), 6.4 ("LoRA + ControlNet (pose / depth / canny)").
- **Reason**: Each pipeline's `register(handlers)` selects between `base.stub_execute(mode)` and a real diffusers-backed executor via `base.select_executor`. The implementing session ran on a Windows 11 host without CUDA / `torch` / `diffusers` available, so the stub executor is the active path. The runner orchestration (param validation -> smart-offload decision via `device.choose_offload` -> execution -> PIL-free PNG workflow embed) is exercised end-to-end by 12 pytest tests; the stub returns a deterministic 1x1 PNG with full workflow metadata embedded so the JSON-RPC contract and the round-trip test still verify the wiring. The 30-second SDXL Turbo 1024x1024 timing target in the phase stability gate is an operator action.
- **Suggested next step**: Operator captures a real-host run in `docs/v1.0.0/operator-actions.md`: `pip install -r runtimes/diffusion/requirements.txt`, drop a real diffusers-backed `_execute(ctx)` into each pipeline module (replacing `base.stub_execute(mode)`), and record SDXL Turbo / SDXL 1.0 / img2img / inpaint / outpaint timings on the RTX 4070 baseline rig.

### 6.P1.HH -- Tauri Rust core does not yet spawn the Python sidecar (DF, P1)

- **Source phase**: Phase 6 (6.1)
- **Plan reference**: [phase-06-image-studio.md](plans/phase-06-image-studio.md) sub-task 6.1 ("The Tauri Rust core spawns the Python sidecar at app launch alongside the Node sidecar").
- **Reason**: `desktop/src-tauri/src/sidecar.rs` spawns the Node sidecar only. The Python runtime contract is wired end-to-end through Node (`desktop/sidecar/src/diffusion/runtimeClient.ts` ships both `InMemoryDiffusionRuntime` for CI and `ChildProcessDiffusionRuntime` for production), but the production handler binds to the in-memory client until the Rust core can also spawn `python -m runtimes.diffusion.main` and Node can be told where to reach it. The Phase 6.1 unit + integration tests exercise the IPC contract through the in-memory client (job IDs, payload forwarding, error surfacing, event queueing).
- **Suggested next step**: Bundle with the Phase 9 installer rework: the installer provisions the Python venv at `~/.nexus/runtimes/diffusion/.venv/`, the Rust core then spawns it the same way it spawns Node (`Sidecar::spawn_python`), and the Node sidecar swaps `InMemoryDiffusionRuntime` for `ChildProcessDiffusionRuntime` pointing at the spawned process. The IPC contract does not change.

### 6.P1.II -- Real ControlNet preprocessors are stubbed in CI (DF, P1)

- **Source phase**: Phase 6 (6.4)
- **Plan reference**: [phase-06-image-studio.md](plans/phase-06-image-studio.md) sub-task 6.4 ("Preprocessors: pose via controlnet_aux.OpenposeDetector, depth via controlnet_aux.MidasDetector, canny via OpenCV's Canny").
- **Reason**: `runtimes/diffusion/preprocessors/{canny,pose,depth}.py` each try to import the real backend lazily and fall back to a tagged byte string (`b"canny-stub:<bytes>"`, etc.) when the import fails. CI runs the fallback path; the real path is only exercised on a host where `cv2` (canny) or `controlnet_aux` (pose / depth) is installed.
- **Suggested next step**: Same operator-actions follow-on as 6.P1.GG: install `controlnet-aux` + `opencv-python` in the runtime venv, replace `b"<x>-stub:"` returns with the real annotator output, capture a sample of pose / depth / canny conditioning preview PNGs in `docs/v1.0.0/operator-actions.md`.

### 6.P2.JJ -- Image Studio UI uses a hard-coded model / LoRA / ControlNet list (NI, P2)

- **Source phase**: Phase 6 (6.5)
- **Plan reference**: [phase-06-image-studio.md](plans/phase-06-image-studio.md) sub-task 6.5 ("Model dropdown, ... collapsible Advanced for LoRAs and ControlNet").
- **Reason**: `desktop/src/modules/image/ImageStudioPage.tsx` ships `DEFAULT_MODELS`, `DEFAULT_LORAS`, `DEFAULT_CONTROLNETS` as inline constants. The proper source is the `ModelRegistry` (`type: "image"`, `type: "lora"`, etc.) which is reachable from the desktop frontend via the same `models.list` IPC that 5.P1.BB still gates on. Once that IPC bridge lands, the dropdowns subscribe to the catalog. Until then, the user sees the four headline checkpoints (SDXL Turbo, SDXL 1.0 Base, SD 1.5, FLUX.1 Schnell) and a synthetic LoRA / ControlNet shortlist for UX testing.
- **Suggested next step**: When the Phase 5 follow-on that closes 5.P1.BB lands, pass `ipc.call("models.list", { type: "image" })` results into ImageStudioPage as a `models` prop (or expose a `useModelCatalog` hook). The form does not change.

### 6.P2.KK -- Tauri Channel for diffusion progress events not yet wired (DF, P2)

- **Source phase**: Phase 6 (6.2, 6.5)
- **Plan reference**: [phase-06-image-studio.md](plans/phase-06-image-studio.md) sub-task 6.2 ("streams `diffusion.job.progress` events"), sub-task 6.5 ("Generate button shows a progress bar and the live latent preview").
- **Reason**: The ImageStudioPage polls `diffusion.job.drainEvents(jobId)` every 100 ms while a job is running. Polling is correct and bounded (drain is cheap, every event is consumed at most once) but suboptimal versus a server-initiated notification channel. The same blocker keeps `coding.session.event` and `chat.session.event` on polling (item 3.P1.N). The Phase 5 follow-on that introduces `tauri::Channel` covers all three at once.
- **Suggested next step**: When the channel lands (item 3.P2.U), add a `diffusion.job.events` channel; Node forwards every event line from the Python sidecar to the channel; the ImageStudioPage swaps the polling loop for a channel listener.

### 6.P2.LL -- Coverage on `desktop/src/modules/image/diffusionClient.ts` is partial (MT, P2)

- **Source phase**: Phase 6 (6.7)
- **Plan reference**: [phase-06-image-studio.md](plans/phase-06-image-studio.md) sub-task 6.7 ("coverage gate at lines >= 80, functions >= 80").
- **Reason**: The new `diffusion-ipcClient.test.ts` covers the seven production paths through `createIpcDiffusionClient` and the unwrap helper. The remaining uncovered lines are the lazy `import("@tauri-apps/api/core")` branch inside `desktop/src/lib/ipc.ts` (only reachable when `__TAURI_INTERNALS__` is set, which jsdom does not simulate). Coverage overall is 94.24% lines / 80.75% functions / 85.65% branches, comfortably above the gate; the `image/` directory specifically is at 86.52% lines and 46.77% functions because the InMemoryDiffusionClient class members are bound paths that vitest considers separate functions.
- **Suggested next step**: Acceptable as-is for Phase 6. If the function-coverage threshold for `image/` becomes a concern, add a tiny test that constructs an `InMemoryDiffusionClient` and calls every method directly (no UI). Bundled into the same Phase 8 polish pass as 6.P2.KK.

### 7.P1.MM -- Video pipelines ship with stub executors (no live PyTorch + imageio) (DF, P1)

- **Source phase**: Phase 7 (7.1)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.1 (LTX-Video / SVD / CogVideoX text2video + image2video pipelines).
- **Reason**: Each video pipeline (`video_text2video`, `video_image2video`) registers a `VideoPipelineRunner` whose executor defaults to `video_base.stub_execute(method)`. The runner orchestration (param validation -> video-upgraded offload decision via `device.choose_offload` + `_upgrade_for_video` -> `vram_scope` -> execution -> workflow JSON build) is exercised end-to-end by 39 pytest tests; the stub returns one deterministic 1x1 JPEG thumbnail per generated second and no real MP4, so the JSON-RPC contract + thumbnail-strip UI flow + workflow-JSON shape are verified in CI without a CUDA / `diffusers` / `imageio` install. The Phase 7 stability gate's <= 5-minute LTX-Video 4 s @ 24 fps timing is an operator action.
- **Suggested next step**: Operator captures a real-host run in `docs/v1.0.0/operator-actions.md`: `pip install -r runtimes/diffusion/requirements.txt` (adding `imageio[ffmpeg]` to the requirements), drop a real diffusers-backed `_execute(ctx)` into each video pipeline module (replacing `video_base.stub_execute(method)`), and record LTX-Video / SVD / CogVideoX 5B / CogVideoX 2B timings on the RTX 4070 baseline rig.

### 7.P1.NN -- ffmpeg / ffprobe assumed on $PATH; installer-bundled binaries land in Phase 9 (DF, P1)

- **Source phase**: Phase 7 (7.3)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.3 ("Bundled ffmpeg / ffprobe come from the installer (Phase 9)").
- **Reason**: `core/video/WorkflowMetadata.ts` resolves ffmpeg + ffprobe via an injected `FfmpegContext { ffmpegPath, ffprobePath, spawnFn? }`. The sidecar default (`DEFAULT_FFMPEG_CONTEXT`) reads `NEXUS_FFMPEG_PATH` / `NEXUS_FFPROBE_PATH` env vars and falls back to the generic `ffmpeg` / `ffprobe` names on `$PATH`. On a fresh Windows / macOS / Linux host with no ffmpeg installed, `diffusion.video.workflow.extract` (and the on-host executor's MP4 writer) will fail with `ENOENT`. The unit-test suite injects a stub `spawnFn` so the IPC contract + extract / round-trip path are verified without a system ffmpeg.
- **Suggested next step**: Phase 9 installer drops `ffmpeg.exe` / `ffprobe.exe` into `~/.nexus/runtimes/ffmpeg/` and sets `NEXUS_FFMPEG_PATH` / `NEXUS_FFPROBE_PATH` in the Nexus desktop process environment. Adopted via the existing injection seam; no production code change in `core/video/`.

### 7.P1.OO -- Tauri Rust core does not yet spawn the Python sidecar for video (DF, P1)

- **Source phase**: Phase 7 (7.1)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.1 (Python sidecar hosts both image + video pipelines).
- **Reason**: This is the same blocker tracked as `6.P1.HH` for image diffusion -- the Tauri Rust core still spawns only the Node sidecar, and the Node-side handler binds to `InMemoryDiffusionRuntime` until the Rust core can also launch `python -m runtimes.diffusion.main` and Node can be told where to reach it. Phase 7's video runtime piggybacks on the same sidecar process, so once the Python spawn lands in Phase 9 (installer), `ChildProcessDiffusionRuntime` carries both image and video traffic without further wiring. The Phase 7 unit + integration tests exercise the IPC contract through the in-memory client.
- **Suggested next step**: Bundled into the same Phase 9 follow-on tracked by `6.P1.HH`. No separate work required for video.

### 7.P2.PP -- Video Lab UI uses a hard-coded model list (NI, P2)

- **Source phase**: Phase 7 (7.2)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.2 ("Model dropdown filtered to video models").
- **Reason**: `desktop/src/modules/video/VideoLabPage.tsx` ships `DEFAULT_VIDEO_MODELS` as an inline constant (LTX-Video + CogVideoX 5B / 2B for text2video, SVD + CogVideoX-I2V for image2video). The proper source is the `ModelRegistry` (`type: "video"`) reachable via the `models.list` IPC that `5.P1.BB` still gates on. Once that bridge lands, the dropdowns subscribe to the catalog filtered by `type: "video"` + `mode`. Until then, the user sees the five planned video checkpoints for UX testing.
- **Suggested next step**: When the Phase 5 follow-on that closes `5.P1.BB` lands, pass `ipc.call("models.list", { type: "video" })` results into VideoLabPage as a `models` prop (or expose a `useVideoModelCatalog` hook). The form does not change.

### 7.P2.QQ -- MP4 source-of-truth resolution for the previewer is a placeholder (DF, P2)

- **Source phase**: Phase 7 (7.2)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.2 ("timeline previewer scrubber (HTML5 video element) for completed clips").
- **Reason**: `VideoLabPage` accepts a `resolveMp4Url(mp4Path: string) => string` prop that maps the sidecar's local-disk MP4 path into a URL the HTML5 `<video>` element can play. The default identity mapping ("path-as-URL") works inside Tauri once the `fs` allow-list grants read access to `~/.nexus/outputs/videos/`, but the Tauri config has not been updated to whitelist that directory yet. Until then, real playback in a packaged Tauri build will fail; tests inject a stub resolver (`(path) => "mock://" + path`) so the UI surface is exercised.
- **Suggested next step**: Phase 9 installer adds `~/.nexus/outputs/videos/` to the Tauri allow-list. The default `resolveMp4Url` then wraps the path with `convertFileSrc()` from `@tauri-apps/api/core` to translate it into a `tauri://localhost/<id>` URL the webview can play.

### 7.P2.RR -- Save As / Use Last Frame as Image actions not yet wired (NI, P2)

- **Source phase**: Phase 7 (7.2)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.2 ("Output context menu: Open, Save As..., Copy Workflow (workflow embedded in the MP4 via ffmpeg metadata), Use Last Frame as Image (sends to Image Studio)").
- **Reason**: The Video Lab gallery context-menu actions ship with the first two surfaces from the plan: "Open" (loads into the timeline previewer) and "Copy Workflow" (forwards extracted JSON to the clipboard adapter). "Save As..." requires a Tauri dialog handler (`dialog.save()`) plus a sidecar `video.save` IPC that copies the local MP4 to the user-chosen target, and "Use Last Frame as Image" requires either a follow-on ffmpeg call (`ffmpeg -ss <end> -frames:v 1 -f image2`) or harvesting the trailing JPEG preview from the progress stream. Both depend on plumbing not present in the Phase 7 surface.
- **Suggested next step**: Phase 8 polish pass adds a `video.export.lastFrame` IPC backed by the Python sidecar (calls into the existing pipeline output to read the final frame as a PIL image -> PNG -> base64), and wires "Save As..." through the existing Tauri `dialog` plugin. The UI buttons land in the same commit.

### 7.P2.SS -- Tauri Channel for video progress events not yet wired (DF, P2)

- **Source phase**: Phase 7 (7.2)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.2 ("thumbnail strip updates").
- **Reason**: Same blocker as image diffusion (`6.P2.KK`): the VideoLabPage polls `diffusion.job.drainEvents(jobId)` every 100 ms instead of subscribing to a server-initiated `tauri::Channel`. The polling is correct and bounded (drain is cheap, every event is consumed at most once) but suboptimal. The Phase 5 follow-on that introduces the channel for `coding.session.event` (item `3.P1.N` / `3.P2.U`) and `diffusion.job.progress` covers video at the same time.
- **Suggested next step**: When the channel lands, add a `diffusion.video.job.events` channel (or share the existing `diffusion.job.events` from `6.P2.KK`); Node forwards every event line from the Python sidecar to the channel; the VideoLabPage swaps the polling loop for a channel listener.

### 7.P3.TT -- Operator acceptance on real GPU rig deferred (DF, MT, P3)

- **Source phase**: Phase 7 (7.5)
- **Plan reference**: [phase-07-video-lab.md](plans/phase-07-video-lab.md) sub-task 7.5 acceptance ("operator-driven acceptance on a real GPU rig... (RTX 4070: LTX-Video 4 s @ 24 fps @ 480p in <= 5 min; SVD image+prompt to 4 s clip in <= 4 min; CogVideoX opt-in works)").
- **Reason**: The Phase 7 stability gate (<= 5 minutes for a 4-second LTX-Video clip on a 12 GB RTX 4070) requires three resident video models on the host (~31 GB total: LTX-Video 12 GB + SVD 9 GB + CogVideoX 5B 10 GB) and is therefore operator-driven, in line with the v0.9.0 P3 pattern that rolled forward into v1.0.0 as item set `10.N.live-bench`. The Python orchestration is fully unit-tested with stubs.
- **Suggested next step**: Operator captures the timings in `docs/v1.0.0/operator-actions.md` once the live-PyTorch wiring lands (item `7.P1.MM`). Fixture clips committed back under `tests/golden/v1.0.0/video/` for regression checks.

### 8.P1.UU -- Sidecar-side `nvidia-smi` long-lived stream not yet spawned (DF, P1)

- **Source phase**: Phase 8 (8.2)
- **Plan reference**: [phase-08-gpu-scheduler-and-telemetry.md](plans/phase-08-gpu-scheduler-and-telemetry.md) sub-task 8.2 ("On Windows + Linux, shell out to `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` (cached child process re-used via long-lived `nvidia-smi -lms 500` stream)").
- **Reason**: `core/telemetry/GpuTelemetrySource.ts` exposes a pluggable `GpuQueryFn`; the implementation uses CPU fallback by default when no host-platform query is wired. The actual `nvidia-smi -lms 500` long-lived child-process driver (Windows / Linux) and the `system_profiler` one-shot + Metal Performance Shaders fallback (macOS) parse-existing fixtures via `parseNvidiaSmiCsv` / `parseAppleSystemProfiler` in unit tests, but the platform spawning glue that drives those fixtures from the real `nvidia-smi` binary on the host sidecar process is deferred. The widget therefore still renders the deterministic mock stream from `desktop/src/lib/telemetryMock.ts` on developer machines.
- **Suggested next step**: Phase 9 installer ships an installer-bundled `nvidia-smi` invocation; Node sidecar at the same time gets a `telemetry.subscribe` IPC that wraps `core/telemetry/GpuTelemetrySource.ts` with a `ChildProcessGpuQuery` (long-lived stream on Win / Linux, polling on macOS). The desktop `App.tsx` swaps the mock for the real Tauri-channel-backed stream.

### 8.P1.VV -- GpuScheduler not yet integrated with the four pillar runtimes (DF, P1)

- **Source phase**: Phase 8 (8.1)
- **Plan reference**: [phase-08-gpu-scheduler-and-telemetry.md](plans/phase-08-gpu-scheduler-and-telemetry.md) sub-task 8.1 ("Module integration: Coding's `AgentLoop` does NOT go through the scheduler for tool calls (those are CPU); only the streaming-LLM-token-generation call enqueues a job. Image / Video pipelines route every generation through the scheduler.").
- **Reason**: `GpuScheduler` ships as a shared-core service with full unit + integration coverage (FIFO, foreground bump, VRAM gating, cancel, telemetry envelopes -- 16 unit + 3 integration tests; 99% lines / 100% functions). The wiring at the call sites is deferred: `StreamingPipeline` (Coding token generation), `runtimes/diffusion/pipelines/base.py` (Image), and `runtimes/diffusion/pipelines/video_base.py` (Video) still serialize jobs through the sidecar request loop. The Phase 7 known-gap `7.P1.OO` (Tauri Rust core does not yet spawn the Python sidecar) is the upstream blocker for the diffusion-side wiring.
- **Suggested next step**: Phase 9 installer follow-on adds a `nexus.gpu.scheduler` IPC surface that the Node sidecar instantiates once per process; the Coding `StreamingPipeline` enqueues its single token-generation call, and the Python sidecar exposes a `scheduler.enqueue` JSON-RPC that the Rust core forwards into the same TS-side `GpuScheduler` instance via a thin proxy. Acceptance: the multi-module integration test in `tests/integration/gpu-scheduler-multi-module.test.ts` is replayed end-to-end against the live processes.

### 8.P2.WW -- Settings UI "Hardware" page does not yet surface DiffusionTier override (NI, P2)

- **Source phase**: Phase 8 (8.4)
- **Plan reference**: [phase-08-gpu-scheduler-and-telemetry.md](plans/phase-08-gpu-scheduler-and-telemetry.md) sub-task 8.4 ("The tier display surfaces in Settings -> Hardware with a 'your GPU classifies as ...' readout and an 'override to ...' dropdown").
- **Reason**: `core/config/DiffusionTier.ts` ships the four-tier classification, the per-tier image + video defaults, and `resolveDiffusionTier(vramGB, override)` that fuses an auto-detected tier with an optional user override. The Settings UI surface (a "Hardware" page in `desktop/src/pages/settings/`) is not yet built; Settings currently exposes only the Models sub-page (Phase 5). Auto-detection from `GpuTelemetrySource` is also pending the live telemetry wiring (`8.P1.UU`).
- **Suggested next step**: Phase 9 polish pass adds `desktop/src/pages/settings/HardwareSettings.tsx` with a tier readout (driven by `classifyDiffusionTier(lastSample.totalVramGB)`) and an "override to" dropdown that writes `nexus.diffusion.tierOverride` via `SettingsStore`. The Image Studio and Video Lab forms read the resolved tier for default form values.

### 8.P2.XX -- DiffusionTier defaults not yet read by Image Studio / Video Lab forms (DF, P2)

- **Source phase**: Phase 8 (8.4)
- **Plan reference**: [phase-08-gpu-scheduler-and-telemetry.md](plans/phase-08-gpu-scheduler-and-telemetry.md) sub-task 8.4 ("Default form values in Image Studio + Video Lab are derived from the tier").
- **Reason**: The `DIFFUSION_TIER_CONFIGS` table ships with per-tier `image` (width / height / steps / sampler / model / allowControlNet / allowControlNetStacking / allowLoRA) and `video` (model / clipSeconds / fps / dimensions / enabled) defaults, plus a `parallelJobs` flag for the pro tier. The Image Studio (`desktop/src/modules/image/ImagePromptForm.tsx`) and Video Lab (`desktop/src/modules/video/VideoPromptForm.tsx`) forms still use the Phase 6 / 7 hard-coded initial values. Tying them together depends on the Settings Hardware page (`8.P2.WW`) and the live telemetry wiring (`8.P1.UU`) so the tier resolution does not change under the user's feet.
- **Suggested next step**: Phase 9 polish pass: once `8.P2.WW` lands, both forms accept a `defaultsFor: DiffusionTierConfig` prop with the resolved tier as the initial state. Acceptance: a `diffusion-mid` host opens Image Studio to 1024x1024 SDXL Turbo defaults; a `diffusion-low` host opens to 512x512 SD 1.5 with video disabled.

### 8.P2.YY -- TelemetryBus event union does not yet model `job.cancelled` (WN, P2)

- **Source phase**: Phase 8 (8.1)
- **Plan reference**: [phase-08-gpu-scheduler-and-telemetry.md](plans/phase-08-gpu-scheduler-and-telemetry.md) sub-task 8.1 ("The scheduler publishes `scheduler.job.queued`, `scheduler.job.started`, `scheduler.job.completed`, `scheduler.job.cancelled` events on the `TelemetryBus`.").
- **Reason**: `core/telemetry/TelemetryBus.ts` declares a closed `TelemetryEventKind` union (`job.queued | job.started | job.completed | job.failed | ...`) without an explicit `job.cancelled` kind. `GpuScheduler` publishes cancellation events using the `job.failed` kind with a `schedulerEvent: "job.cancelled"` payload discriminator -- subscribers that filter by payload-side discriminator see the right thing, but kind-filtered subscribers lump cancelled with failed. The union is shared across pillars, so widening it warrants its own coordinated commit.
- **Suggested next step**: Phase 9 polish pass: widen `TelemetryEventKind` with `job.cancelled` and update `GpuScheduler._publish` to use the dedicated kind instead of the `job.failed` overload. Subscribers that already inspect `payload.schedulerEvent` stay correct.

---

## 2. Resolved

| Item | Resolution | Phase / commit |
|---|---|---|
| [v0.9.0:10.N.Q] IdleTimeScheduler wiring | Sidecar bootstrap registers curator (5 min idle / 12 h cadence) + reflect (10 min idle / 24 h cadence) workers; 30-minute synthetic-idle integration test passes. Legacy `AgentLoop` curator-cadence fallback removal tracked as 3.P1.P. | Phase 3.4 (desktop/sidecar/src/runtime/idleScheduler.ts) |
| [v0.9.0:10.N.A] ModelPinRegistry wiring | Ported `src/storage/ModelPinRegistry.ts` to `core/registry/ModelPinRegistry.ts`, persisted pin set through new `SettingsStore` (`nexus.llm.modelPins`), exposed `resolver()` for `StreamingPipeline`'s existing `KeepAliveResolver` callback. Sidecar bootstrap (`desktop/sidecar/src/runtime/codingBootstrap.ts`) hydrates the registry on startup. Legacy module is a compat re-export. | Phase 5.6 (core/registry/ModelPinRegistry.ts, core/storage/SettingsStore.ts, desktop/sidecar/src/runtime/codingBootstrap.ts) |
| 1.P3.F Real telemetry source wired in Phase 8 | Shipped `core/telemetry/GpuTelemetrySource.ts` (2 Hz poller with platform-agnostic `GpuQueryFn`, `parseNvidiaSmiCsv` / `parseAppleSystemProfiler` / `buildCpuFallbackSample` and CPU-only graceful degrade) and `desktop/src/lib/telemetryStream.ts` (renders raw GPU samples + scheduler snapshot into the `LocalModelTelemetry` shape consumed by `<LocalModelStatus>`). The widget gained hover tooltip, click-to-open queue modal, idle state, and a floating `<LocalModelStatusDock>` placement on every non-dashboard page. Sidecar-side `nvidia-smi -lms 500` spawn deferred to `8.P1.UU`. | Phase 8.2 / 8.3 (core/telemetry/GpuTelemetrySource.ts, desktop/src/lib/telemetryStream.ts, desktop/src/components/LocalModelStatus.tsx, desktop/src/components/LocalModelStatusDock.tsx) |

---

## 3. Summary

| Severity | Open | Resolved |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 21 | 2 |
| P2 | 27 | 0 |
| P3 | 3 | 1 |
| **Total** | **51** | **3** |

| Category | Open | Resolved |
|---|---|---|
| NI | 8 | 0 |
| DF | 42 | 3 |
| BG | 2 | 0 |
| MT | 5 | 0 |
| WN | 1 | 0 |
| QG | 0 | 0 |

**Last updated**: 2026-05-17 (Phase 8 close; `core/scheduler/GpuScheduler.ts` cross-module FIFO queue with foreground-bump + VRAM gating + cancel + telemetry envelopes; `core/telemetry/GpuTelemetrySource.ts` 2 Hz poller with `parseNvidiaSmiCsv` / `parseAppleSystemProfiler` / CPU fallback; `core/config/DiffusionTier.ts` four-tier diffusion classification with per-tier image + video defaults; `<LocalModelStatus>` lit up with hover tooltip, click-to-open queue modal, idle state + `<LocalModelStatusDock>` floating placement on every module page; 1.P3.F resolved; sidecar-side `nvidia-smi -lms 500` spawn, Settings -> Hardware page, Image / Video form default-wiring, and `job.cancelled` TelemetryEventKind widening rolled forward to Phase 9 follow-ons)

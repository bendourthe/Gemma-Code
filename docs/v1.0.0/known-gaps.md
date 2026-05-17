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

### 1.P3.F -- Real telemetry source wired in Phase 8 (DF, P3)

- **Source phase**: Phase 1 (1.6)
- **Plan reference**: [phase-01-shell-foundation.md](plans/phase-01-shell-foundation.md) sub-task 1.6 ("The widget subscribes to a `telemetry.subscribe` IPC stream (still placeholder in this phase)").
- **Reason**: The `LocalModelStatus` widget consumes a `TelemetryStream` and renders muted / loading / active states. The current source is a deterministic mock in `desktop/src/lib/telemetryMock.ts`; the real GPU/VRAM probe lands in Phase 8 ("GpuScheduler + Local Model Status dashboard widget"). This is by design per the phase plan, not a regression.
- **Suggested next step**: Phase 8 implements `telemetry.subscribe` in the sidecar over `nvidia-smi` / `nvml` and swaps the mock at the App level.

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

---

## 2. Resolved

| Item | Resolution | Phase / commit |
|---|---|---|
| [v0.9.0:10.N.Q] IdleTimeScheduler wiring | Sidecar bootstrap registers curator (5 min idle / 12 h cadence) + reflect (10 min idle / 24 h cadence) workers; 30-minute synthetic-idle integration test passes. Legacy `AgentLoop` curator-cadence fallback removal tracked as 3.P1.P. | Phase 3.4 (desktop/sidecar/src/runtime/idleScheduler.ts) |

---

## 3. Summary

| Severity | Open | Resolved |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 12 | 1 |
| P2 | 14 | 0 |
| P3 | 2 | 0 |
| **Total** | **28** | **1** |

| Category | Open | Resolved |
|---|---|---|
| NI | 3 | 0 |
| DF | 24 | 1 |
| BG | 1 | 0 |
| MT | 3 | 0 |
| WN | 0 | 0 |
| QG | 0 | 0 |

**Last updated**: 2026-05-17 (Phase 4 close; in-memory ChatExplorer + MemoryHub scopes shipped, SQLite/IPC wiring deferred to Phase 5 alongside items 3.P1.M / 3.P1.N / 3.P2.S)

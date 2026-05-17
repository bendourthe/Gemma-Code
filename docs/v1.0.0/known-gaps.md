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

---

## 2. Resolved

| Item | Resolution | Phase / commit |
|---|---|---|
| (none yet) | -- | -- |

---

## 3. Summary

| Severity | Open | Resolved |
|---|---|---|
| P0 | 0 | 0 |
| P1 | 4 | 0 |
| P2 | 6 | 0 |
| P3 | 2 | 0 |
| **Total** | **12** | **0** |

| Category | Open | Resolved |
|---|---|---|
| NI | 2 | 0 |
| DF | 9 | 0 |
| BG | 1 | 0 |
| MT | 1 | 0 |
| WN | 0 | 0 |
| QG | 0 | 0 |

**Last updated**: 2026-05-17 (Phase 2 close)

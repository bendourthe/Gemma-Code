# 2026-05-17 - Phase 2: Rebrand sweep + shared-core extraction

**Plan**: [docs/versions/v1/v1.0.0/plans/phase-02-rebrand-and-core-extraction.md](../../plans/phase-02-rebrand-and-core-extraction.md)
**Goal**: Rename all forward-facing identifiers (settings keys, storage paths, code namespaces, CLI binaries) with a one-cycle compat shim; establish the `core/` + `modules/coding/` directory layout and the dependency-cruiser boundary rules; stub the four shared-core surfaces (ModelRegistry, MemoryHub, TelemetryBus, SkillCatalog).

## Outcome

Phase 2 stability gate met:

- `npm test`: 2683 passed / 5 failed / 5 skipped (all 5 failures are pre-existing on Windows: 4 in `SubAgentManager.characterization` due to CRLF line-ending mismatch on snapshot files, 1 in `workflow-discipline` due to Phase 1's `shell-build.yml` referencing `dtolnay/rust-toolchain@stable` and `actions/cache@v4` without SHA pinning -- both tracked as `2.P3.L`).
- `npm run check-architecture`: 0 errors, 7 orphan warnings (expected for Phase 2.6 stub files that are not yet wired into the engine).
- `npm run build` (tsc): clean.
- 58 new Phase 2 unit tests added; all pass.

## Sub-tasks landed

### 2.1 -- Settings keys: `gemma-code.*` -> `nexus.*` with compat shim

- Added [`src/config/settingsKeyMap.ts`](../../../../src/config/settingsKeyMap.ts) mapping every new `nexus.*` key to its legacy `gemma-code.*` counterpart, grouped by `nexus.coding.*`, `nexus.llm.*`, `nexus.memory.*`, `nexus.mcp.*`, `nexus.workers.*`, `nexus.skills.*`, `nexus.hooks.*`, plus cross-cutting keys at the top level.
- Added [`src/config/SettingsCompat.ts`](../../../../src/config/SettingsCompat.ts): a shim that wraps `vscode.workspace.getConfiguration`. For every read, it first checks the canonical `nexus.*` key via `inspect()` (so the schema default does not mask "unset"), then falls back to the mapped legacy key, emitting a one-time per-session `console.warn` deprecation log when the legacy value is used. Removed in v1.1.0.
- Rewrote [`src/config/settings.ts`](../../../../src/config/settings.ts) to read every setting via the shim instead of `vscode.workspace.getConfiguration("gemma-code")`. The `GemmaCodeSettings` type aliases `NexusSettings` for one cycle.
- Added the canonical `nexus.*` schema entries for the load-bearing keys to [`package.json`](../../../../package.json) `contributes.configuration.properties`. The legacy `gemma-code.*` entries stay alongside them; tagging every legacy entry with `deprecationMessage` is tracked as `2.P1.H`.
- Updated the three direct readers (`src/panels/MemoryPanel.ts`, `src/tools/handlers/terminal.ts`, and the three `getConfiguration("gemma-code").update(...)` write call sites in `ChatCommandHandlers.ts` / `ChatMessageRouter.ts`) to prefer the canonical sub-section with a legacy fallback.
- `onSettingsChange` listens to both `nexus` and `gemma-code` namespaces during the compat window.
- Tests: [`tests/unit/config/SettingsCompat.test.ts`](../../../../tests/unit/config/SettingsCompat.test.ts) (10 tests covering canonical-wins, legacy fallback, warn-once-per-key, default-when-neither-set, nested keys, scope precedence, reset-for-testing). [`tests/unit/config/settings.test.ts`](../../../../tests/unit/config/settings.test.ts) rewritten to use `inspect`-aware mocks.

### 2.2 -- Storage path: `~/.gemma-code/` -> `~/.nexus/` with idempotent migration

- Added [`core/storage/paths.ts`](../../../../core/storage/paths.ts) (`nexusHome()` / `legacyGemmaHome()` helpers; pure, no fs reads).
- Added [`core/storage/StorageMigration.ts`](../../../../core/storage/StorageMigration.ts): `runStorageMigration(deps?)` walks all three branches (already-migrated -> no-op; fresh-install -> create empty; legacy-exists -> recursive copy with mtime preservation, skipping `.DS_Store` and `*.lock`, writing a `migrated-from-gemma-code.txt` marker; POSIX additionally creates a symlink at the legacy path; Windows leaves a `MOVED-TO-NEXUS.txt` README). All branches idempotent.
- Tests: [`tests/unit/core/storage/StorageMigration.test.ts`](../../../../tests/unit/core/storage/StorageMigration.test.ts) (10 tests against real disk under per-test tmpdirs).
- Call-site sweep deferred (tracked as `2.P1.G`): 9 homedir-based `path.join(os.homedir(), ".gemma-code", ...)` sites in `src/` plus 4 workspace-local sites still point at the legacy paths. POSIX symlink keeps them working transparently; Windows preserves the legacy directory. A follow-on Phase 2.2.1 commit will replace every call site with `nexusHome()`.

### 2.3 -- `core/` + `modules/coding/` layout + boundary rules

- Created `core/` (with `core/storage/`, `core/registry/`, `core/memory/`, `core/telemetry/`, `core/skills/`, plus a [`core/README.md`](../../../../core/README.md) explaining the boundary rule).
- Created `modules/coding/` with a [README](../../../../modules/coding/README.md) noting that the Coding engine still lives under `src/` during the v1.0.0 compat window.
- Updated [`tsconfig.json`](../../../../tsconfig.json) to include `core/**/*` and `modules/**/*` via `rootDirs` (so tsc compiles all three trees into `out/`).
- Updated [`configs/vitest.config.ts`](../../../../configs/vitest.config.ts) coverage `include` to `["src/**/*.ts", "core/**/*.ts", "modules/**/*.ts"]`.
- Added two new `error`-severity rules to [`configs/dependency-cruiser.cjs`](../../../../configs/dependency-cruiser.cjs): `no-core-from-modules` (forbids `core/**` from importing `modules/**`) and `no-cross-module-deps` (forbids `modules/<x>/**` from importing `modules/<y>/**` for x != y).
- Added `npm run check-architecture` script that runs dep-cruiser against `src`, `core`, `modules`.
- Wholesale physical move of `src/` files into `modules/coding/<sub-tree>/` deferred (tracked as `2.P2.I`).

### 2.4 -- CLI rename: `gemma-check` -> `nexus-check` with alias

- Moved `bin/gemma-check.mjs` -> [`bin/nexus-check.mjs`](../../../../bin/nexus-check.mjs). Updated header, HELP string, and every user-facing message inside the CLI.
- Created [`bin/gemma-check-compat.mjs`](../../../../bin/gemma-check-compat.mjs): a 25-line shim that forwards all arguments to `nexus-check.mjs` and prints a one-line deprecation warning on stderr.
- Updated [`package.json`](../../../../package.json) `bin` field to expose both names. Updated `npm scripts` (`check`, `check:prompts`) to invoke `nexus-check.mjs` directly.
- Added a canonical `NEXUS_CHECK_PROMPT_TOKEN_BUDGET` env var to [`lib/checks/prompt-oversized.mjs`](../../../../lib/checks/prompt-oversized.mjs); the legacy `GEMMA_CHECK_PROMPT_TOKEN_BUDGET` is still honored with a one-time deprecation log per process.
- Updated [`src/agents/BackgroundWorkers.ts`](../../../../src/agents/BackgroundWorkers.ts) `findCheckScript()` to look for `nexus-check.mjs` first, falling back to the legacy name. Renamed comment / error string references to `nexus-check`.
- Updated CI workflow [`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) (`gemma-check` job -> `nexus-check`).
- Updated [`tests/unit/cli/gemma-check.test.ts`](../../../../tests/unit/cli/gemma-check.test.ts), [`tests/unit/lib/gemma-check-exit-codes.test.ts`](../../../../tests/unit/lib/gemma-check-exit-codes.test.ts), and [`tests/integration/background-workers-end-to-end.test.ts`](../../../../tests/integration/background-workers-end-to-end.test.ts) to import from / spawn `nexus-check.mjs`. Updated assertion strings (`"nexus-check: 0 findings"`, `"nexus-check"` in error messages, etc.).

### 2.5 -- Python installer: `gemma_installer` -> `nexus_installer`

- `git mv scripts/installer/pyqt/src/gemma_installer scripts/installer/pyqt/src/nexus_installer`.
- Bulk-replaced `gemma_installer` -> `nexus_installer` across 44 Python files (23 source files in `src/nexus_installer/`, 21 test files in `tests/`).
- Updated [`pyproject.toml`](../../../../scripts/installer/pyqt/pyproject.toml): package rename to `nexus-installer`, entry-point `[project.scripts]` -> `nexus-installer = "nexus_installer.main:main"`, `[tool.hatch.build.targets.wheel]` packages, version bumped to `1.0.0a0`.
- Renamed [`scripts/installer/pyqt/build/gemma-installer.spec`](../../../../scripts/installer/pyqt/build/nexus-installer.spec) -> `nexus-installer.spec`. Updated PyInstaller spec's `APP_NAME` constants (`NexusSetup`, `Nexus Installer`, `nexus-setup`) and the source path (`src/nexus_installer/main.py`).
- Updated [`build-windows.ps1`](../../../../scripts/installer/pyqt/build/build-windows.ps1), [`build-macos.sh`](../../../../scripts/installer/pyqt/build/build-macos.sh), [`build-linux.sh`](../../../../scripts/installer/pyqt/build/build-linux.sh) to reference `nexus-installer.spec` and the new binary names (`NexusSetup.exe`, `Nexus Installer.app`, `nexus-setup`).
- Updated [`tests/smoke/smoke-*.{ps1,sh}`](../../../../tests/smoke/) and [`tests/integration/installer/test-install-pyqt-*.{ps1,sh}`](../../../../tests/integration/installer/) to invoke `python -m nexus_installer.main` and import from `nexus_installer.<sub>`.
- Updated [`scripts/installer/pyqt/tests/test_packaging.py`](../../../../scripts/installer/pyqt/tests/test_packaging.py) and [`scripts/installer/pyqt/VERSIONS.md`](../../../../scripts/installer/pyqt/VERSIONS.md).

### 2.6 -- Stub shared-core surfaces

Four new interface definitions under `core/` with in-memory reference implementations and full unit-test coverage of the interface contract:

- [`core/registry/ModelRegistry.ts`](../../../../core/registry/ModelRegistry.ts) -- `list(filter?)`, `install(spec)`, `remove(id)`, `metadata(id)`. Default-seeded with the `gemma4:e4b` recommended model. 9 tests.
- [`core/memory/MemoryHub.ts`](../../../../core/memory/MemoryHub.ts) -- four-layer facade (`workingMemory`, `episodic`, `semantic`, `graph`) + cross-layer `retrieve(query, opts)`. 8 tests.
- [`core/telemetry/TelemetryBus.ts`](../../../../core/telemetry/TelemetryBus.ts) -- in-process `publish(event)` / `subscribe(filter, handler)` with a per-event ISO timestamp, kind/source filters, and isolation against throwing subscribers. 7 tests.
- [`core/skills/SkillCatalog.ts`](../../../../core/skills/SkillCatalog.ts) -- `list()`, `load(id)`, `reload()`; first-class namespaced ids (`devai-hub/<name>`). 7 tests.

Phase 5 (ModelRegistry full impl), Phase 8 (TelemetryBus + GpuScheduler), Phase 4 (MemoryHub from `UnifiedMemoryRetriever`), and Phase 10 (SkillCatalog + DevAI-Hub sync) progressively replace the stubs.

### 2.7 -- Code identifier rename

Bulk-renamed via a single PowerShell pass across 23 files in `src/`, `tests/`, `configs/`, `package.json`:

- `GemmaCodePanel` -> `NexusCodingPanel` (class + file rename `src/panels/GemmaCodePanel.ts` -> `src/panels/NexusCodingPanel.ts`).
- `GemmaRuntime` -> `NexusCodingRuntime` (class + file rename `src/runtime/GemmaRuntime.ts` -> `src/runtime/NexusCodingRuntime.ts`).
- `gemmaCodeSidebar` -> `nexusCodingSidebar` (the camelCase var; the kebab `gemma-code-sidebar` viewContainer id in `package.json` stays for one cycle to avoid breaking user keybindings, tracked as `2.P1.J`).
- Test file names matched: `tests/unit/runtime/GemmaRuntime.test.ts` -> `NexusCodingRuntime.test.ts`, `tests/unit/panels/GemmaCodePanel*.ts` -> `NexusCodingPanel*.ts`.

The Gemma 4 *model* identifiers (`Gemma4ToolFormat`, `gemma4`, `Gemma 4`, `gemma4:e4b`) are intentionally preserved -- they correctly name the Google model, not the product.

### 2.8 -- Docs

- Updated [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) with a new `## Layout (v1.0.0)` section describing the `core/` + `modules/coding/` boundary rule.
- Updated [`AGENTS.md`](../../../../AGENTS.md) `## Tech Stack` (added Tauri / React / Tailwind v4) and `## Project Layout` (added `core/`, `modules/`, `desktop/`, `scripts/installer/pyqt/`, `bin/nexus-check.mjs`).
- Updated [`CONTRIBUTING.md`](../../../../CONTRIBUTING.md) "Project tour" to point at the new paths and class names.
- Created [`docs/versions/v1/v1.0.0/architecture.md`](../../architecture.md) as the v1.0.0 architecture document (referenced from `ARCHITECTURE.md`).
- Updated [`docs/versions/v1/v1.0.0/pivot-brief.md`](../../pivot-brief.md) Section 7 ("Repository-wide rebrand scope") to move Phase 2 deliverables from "deferred" to "completed".

### 2.9 -- Testing and stabilization

- 58 new tests added (10 SettingsCompat, 7 settings.ts rewrite, 10 StorageMigration, 9 ModelRegistry, 8 MemoryHub, 7 TelemetryBus, 7 SkillCatalog).
- Cascading fixes: updated `tests/setup.ts` mock to provide `inspect()` and `update()` on the default `getConfiguration` mock; updated `tests/integration/config-reload.test.ts` to use section-aware `mockImplementation` instead of the single-section `mockImplementationOnce` pattern; updated `tests/unit/agents/BackgroundWorkers.test.ts` and `tests/unit/lib/gemma-check-exit-codes.test.ts` assertion strings from `gemma-check` -> `nexus-check`.
- Made `SettingsCompat._readExplicit` gracefully fall back to `config.get(leaf)` when the test mock does not expose `inspect()` -- preserves backwards compat with older test fixtures that only mock `get`.

## Failing tests at Phase 2 close (pre-existing, not Phase 2 regressions)

1. `tests/unit/agents/SubAgentManager.characterization.test.ts` (4 tests) -- snapshot files at `tests/snapshots/specialists/*.txt` are stored as LF in git but checked out as CRLF on Windows due to `core.autocrlf`; the prompt builder emits LF, so `actual.length === expected.length - <line count>` and the snapshot comparison fails. Tracked as `2.P3.L`. Fix: add `.gitattributes` rule or normalise CRs in the test.
2. `tests/unit/workflow-discipline.test.ts` (1 test) -- the Phase 1 `.github/workflows/shell-build.yml` references `dtolnay/rust-toolchain@stable` and `actions/cache@v4` without a 40-character SHA pin. Tracked as `2.P3.L`. Fix: SHA-pin both references.

Both were verified pre-Phase-2 via `git stash` + rerun; neither is caused by Phase 2 changes.

## Files added

```
core/
  README.md
  registry/ModelRegistry.ts
  memory/MemoryHub.ts
  telemetry/TelemetryBus.ts
  skills/SkillCatalog.ts
  storage/StorageMigration.ts
  storage/paths.ts
modules/
  coding/.gitkeep
  coding/README.md
src/config/SettingsCompat.ts
src/config/settingsKeyMap.ts
bin/nexus-check.mjs                          (renamed from gemma-check.mjs)
bin/gemma-check-compat.mjs                   (compat shim)
docs/versions/v1/v1.0.0/architecture.md
docs/versions/v1/v1.0.0/development/history/2026-05-17_phase-02-rebrand-and-core-extraction.md
scripts/installer/pyqt/src/nexus_installer/  (renamed from gemma_installer/)
scripts/installer/pyqt/build/nexus-installer.spec
tests/unit/config/SettingsCompat.test.ts
tests/unit/core/registry/ModelRegistry.test.ts
tests/unit/core/memory/MemoryHub.test.ts
tests/unit/core/telemetry/TelemetryBus.test.ts
tests/unit/core/skills/SkillCatalog.test.ts
tests/unit/core/storage/StorageMigration.test.ts
```

## Files removed

```
bin/gemma-check.mjs                          (renamed to nexus-check.mjs)
scripts/installer/pyqt/build/gemma-installer.spec (renamed)
scripts/installer/pyqt/src/gemma_installer/   (renamed)
src/panels/GemmaCodePanel.ts                  (renamed to NexusCodingPanel.ts)
src/runtime/GemmaRuntime.ts                   (renamed to NexusCodingRuntime.ts)
```

## Next phase

Phase 3 -- Agentic AI Coding module + multi-LLM + thin VS Code adapter ([phase-03-coding-module.md](../../plans/phase-03-coding-module.md)).

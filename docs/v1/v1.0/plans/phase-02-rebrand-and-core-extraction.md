# Phase 2 - Rebrand sweep + shared-core extraction

**Goal**: Rename all forward-facing identifiers (settings keys, storage paths, code namespaces, CLI binaries) with a one-cycle compat shim; carve the existing `src/` into `core/` + `modules/coding/`.
**Prerequisites**: Phase 1 (shell needs the new namespace to import from).
**Stability Gate**: All 1932 historical Gemma-Code mentions are either renamed or explicitly preserved in `docs/v0.X.0/development/history/`; `npm test` is green; `~/.gemma-code/` -> `~/.nexus/` migration runs idempotently; legacy `gemma-code.*` settings keys still resolve through the compat shim with a single-line deprecation log.

---

## Sub-tasks

### 2.1 - Settings key migration `gemma-code.*` -> `nexus.*` with compat shim

**Objective**: Rename every settings key in `package.json` and every `vscode.workspace.getConfiguration('gemma-code')` call site; install a compat shim that reads legacy keys, returns their value to consumers, and logs a one-line deprecation warning.

**Prompt**:
> Rename every `gemma-code.*` settings key to `nexus.*` (mostly `nexus.coding.*` for coding-specific keys, `nexus.*` for cross-cutting keys like `nexus.embeddingModel`). The full mapping is: keys directly tied to the coding engine move under `nexus.coding.` (e.g. `gemma-code.editMode` -> `nexus.coding.editMode`); keys that are cross-module become `nexus.<group>.` (e.g. `gemma-code.memoryEnabled` -> `nexus.memory.enabled`); keys that are LLM-runtime become `nexus.llm.` (e.g. `gemma-code.modelName` -> `nexus.llm.modelName`). Update every property in `package.json`'s `contributes.configuration.properties` and every `vscode.workspace.getConfiguration(...)` call site in `src/`. Then install a compat shim at `src/config/SettingsCompat.ts` that wraps `vscode.workspace.getConfiguration` so that when a consumer asks for `nexus.foo` and the value is unset but `gemma-code.foo` (or the mapped old name) IS set, the old value is returned and `console.warn('[nexus] Deprecated setting gemma-code.foo - migrate to nexus.foo. Removed in v1.1.0')` is emitted once per key per session. The mapping is defined in `src/config/settingsKeyMap.ts` as a const object. Acceptance: a user with only legacy settings in their `settings.json` sees the new app honor them with a deprecation log; a user with new settings sees no log; the test suite covers both paths.

---

### 2.2 - Storage path migration `~/.gemma-code/` -> `~/.nexus/`

**Objective**: Rename the storage root and provide a first-launch idempotent migration; symlink the old path on POSIX, copy + leave a README on Windows.

**Prompt**:
> Rename the storage root constant `~/.gemma-code/` to `~/.nexus/` across the codebase. Search for every literal of the old path in `src/`, `tests/`, `scripts/`, `docs/` (excluding `docs/v0.X.0/development/history/`). Implement a migration at `src/storage/StorageMigration.ts` that on first launch in v1.0.0: (a) checks if `~/.nexus/` already exists - if yes, no-op and return `already-migrated`; (b) checks if `~/.gemma-code/` exists - if not, create `~/.nexus/` empty and return `fresh-install`; (c) if `~/.gemma-code/` exists, copy its contents to `~/.nexus/` (preserving mtimes, skipping `.DS_Store` and lock files), write a `migrated-from-gemma-code.txt` marker in `~/.nexus/`, and on POSIX additionally create `~/.gemma-code/` as a symlink to `~/.nexus/` so legacy tools still work; on Windows, leave `~/.gemma-code/` in place with a `MOVED-TO-NEXUS.txt` README. The migration is invoked once at app launch from the desktop shell's startup sequence (added in Phase 1 startup hook). Idempotent under all branches. Acceptance: integration test creates a synthetic `~/.gemma-code/` with three files, runs the migration, asserts `~/.nexus/` has the three files; a second run is a no-op.

---

### 2.3 - Carve `src/` into `core/` + `modules/coding/`

**Objective**: Move the existing `src/` files into either `core/` (shared by all modules) or `modules/coding/` (engine-specific). Establish dependency-cruiser rules: `core/` may not import from `modules/`; modules may import from `core/` but not from each other.

**Prompt**:
> Refactor the repository layout. Create top-level directories `core/` and `modules/coding/`. Move files according to this rule: anything providing infrastructure that the future Chat / Image / Video modules will also need goes to `core/`; anything specifically about coding-agent behavior stays in `modules/coding/`. Specific moves: `src/llm/` -> `core/llm/`; `src/storage/` (memory layers, embeddings, chat history, plan archive) -> `core/memory/`; `src/skills/` -> `core/skills/`; `src/mcp/` -> `core/mcp/`; `src/observability/` -> `core/observability/`; `src/config/` -> `core/config/`; `src/guardrails/` -> `core/guardrails/`; `src/tools/` -> `modules/coding/tools/`; `src/chat/` -> `modules/coding/chat/`; `src/agents/` -> `modules/coding/agents/`; `src/panels/` -> `modules/coding/panels/`; `src/commands/` -> `modules/coding/commands/`; `src/runtime/GemmaRuntime.ts` -> `modules/coding/runtime/NexusCodingRuntime.ts`. Rename `GemmaCodePanel` -> `NexusCodingPanel`. Update every `import` path. Update `tests/` to mirror the new layout (move `tests/unit/foo/` mirrors). Update `tsconfig.json` paths. Update `configs/dependency-cruiser.cjs` with the new boundary rule: `core/**` must not depend on `modules/**`; `modules/<x>/**` must not depend on `modules/<y>/**` for `x != y`. Acceptance: `npm run build` is clean; `npm test` is green; `npm run check-architecture` passes; closes `[v0.9.0:10.N.R]` lazy-import utility split as a side effect of the move (the new handler files only import their own concerns).

---

### 2.4 - Rename CLI binary `gemma-check` -> `nexus-check` with alias

**Objective**: Rename the deterministic-checks CLI; ship a `gemma-check` shim that forwards to `nexus-check` with a deprecation log.

**Prompt**:
> Rename the `gemma-check` CLI to `nexus-check`. Move `bin/gemma-check.mjs` to `bin/nexus-check.mjs`. Update `package.json`'s `bin` field to expose both names: `"nexus-check": "./bin/nexus-check.mjs", "gemma-check": "./bin/gemma-check-compat.mjs"`. The new `bin/gemma-check-compat.mjs` is a 10-line shim that prints `console.warn('[nexus] gemma-check is deprecated - use nexus-check. Removed in v1.1.0.')` then `process.exit(spawnSync('node', ['./bin/nexus-check.mjs', ...process.argv.slice(2)]).status)`. Update every doc reference, CHANGELOG line for v1.0.0, and README usage example. The `GEMMA_CHECK_PROMPT_TOKEN_BUDGET` env var becomes `NEXUS_CHECK_PROMPT_TOKEN_BUDGET` with the old name still honored. Acceptance: both `npx nexus-check src/` and `npx gemma-check src/` (with the deprecation log) work; CI smoke covers both.

---

### 2.5 - Rename Python installer package `gemma_installer` -> `nexus_installer`

**Objective**: Rename the PyQt5 installer Python package; preserve its `--headless --json-output` interface; update build scripts.

**Prompt**:
> Rename `scripts/installer/pyqt/src/gemma_installer/` to `scripts/installer/pyqt/src/nexus_installer/`. Update every `import` from `gemma_installer.` to `nexus_installer.`. Update `scripts/installer/pyqt/pyproject.toml` package name, entry-point, and console-scripts. Update `scripts/installer/pyqt/build/` PyInstaller specs and the `build-windows.ps1` / `build-macos.sh` / `build-linux.sh` paths. Update test imports under `scripts/installer/pyqt/tests/`. The CLI entry-point becomes `python -m nexus_installer.main` (old `python -m gemma_installer.main` no longer works - this is a breaking change scoped to the installer authors, not end users). Acceptance: `pytest scripts/installer/pyqt/tests/` is green; a clean PyInstaller build produces `nexus-installer.exe` on Windows.

---

### 2.6 - Stub shared-core surfaces

**Objective**: Create stub interfaces for the four shared-core modules that Phases 3-10 will fill in: `ModelRegistry`, `MemoryHub`, `TelemetryBus`, `SkillCatalog`. They start as thin wrappers around the existing engine internals.

**Prompt**:
> In `core/registry/ModelRegistry.ts` define the interface `ModelRegistry { list(filter?: ModelFilter): ModelRecord[]; install(spec: ModelSpec): Promise<InstallResult>; remove(id: string): Promise<void>; metadata(id: string): ModelMetadata; }`. Implement a minimal version backed by the existing Ollama list + the model directory under `~/.nexus/models/`. In `core/memory/MemoryHub.ts` define the cross-module memory facade: `MemoryHub { workingMemory: WorkingMemory; episodic: EpisodicMemory; semantic: SemanticMemory; graph: GraphMemory; retrieve(query: string, opts?: RetrieveOpts): Promise<MemoryHit[]>; }`. The current `UnifiedMemoryRetriever` becomes the implementation. In `core/telemetry/TelemetryBus.ts` define `TelemetryBus { publish(event: TelemetryEvent): void; subscribe(filter: EventFilter, handler: (e: TelemetryEvent) => void): Disposable; }` with an in-process EventEmitter implementation. In `core/skills/SkillCatalog.ts` define `SkillCatalog { list(): SkillRecord[]; load(id: string): Promise<Skill>; reload(): Promise<void>; }` wrapping the existing `SkillLoader`. All four surfaces have full unit-test coverage of their interface contracts. Acceptance: each shared-core surface has its own `*.test.ts`, the existing engine still works (the Coding module calls the new core APIs internally), and dependency-cruiser confirms no `core/` -> `modules/` imports.

---

### 2.7 - Code namespace rename `Gemma*` -> `Nexus*` (selective)

**Objective**: Rename load-bearing code identifiers that contain "Gemma": `GemmaCodePanel` -> `NexusCodingPanel`, `GemmaRuntime` -> `NexusCodingRuntime`, `Gemma4ToolFormat` -> stays as-is (it correctly names the protocol for the Gemma 4 model). Update every call site.

**Prompt**:
> Rename code identifiers that name the *product* (Gemma Code) but not identifiers that name the *model* (Gemma 4). Specifically: `GemmaCodePanel` -> `NexusCodingPanel`; `GemmaRuntime` -> `NexusCodingRuntime`; `gemmaCodeSidebar` -> `nexusCodingSidebar`; any `gemmaCode*` variable / type / function in `src/` -> `nexusCoding*`. Keep `Gemma4ToolFormat`, `gemma4`, `Gemma 4`, `gemma4:e4b` model identifiers untouched - they refer to the Google model and renaming would be wrong. Update every import and call site. Run `npm test` after each batch of renames. Acceptance: grep for `GemmaCode` and `gemmaCode` returns 0 results in `src/`, `core/`, `modules/`, `tests/`, `desktop/` (excluding historical docs under `docs/v0.X.0/development/history/`); `Gemma 4` and `gemma4` references in code comments and model IDs are preserved.

---

### 2.8 - Update top-level docs to reflect the new layout

**Objective**: Refresh `ARCHITECTURE.md`, `AGENTS.md`, `CONTRIBUTING.md`, and the v1.0.0 docs to reflect the `core/` + `modules/` layout established here.

**Prompt**:
> Update `ARCHITECTURE.md` to describe the new `core/` + `modules/coding/` layout established in 2.3. Add a `## Layout (v1.0.0)` section explaining the boundary rule and the four shared-core surfaces from 2.6. Update `AGENTS.md` `## Project Layout` and `## Tech Stack` sections to match. Update `CONTRIBUTING.md` "Project tour" bullets to point at the new paths. Add `docs/versions/v1/v1.0.0/architecture.md` as the v1.0.0 architecture document (referenced by `ARCHITECTURE.md`'s preamble). Update `docs/versions/v1/v1.0.0/pivot-brief.md` Section 7 to mark the rebrand items completed by Phase 2 (settings keys / storage paths / code identifiers / installer / CLI). Acceptance: docs are internally consistent; CI's `check-architecture` job passes against the new dep-cruiser config.

---

### 2.9 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 2. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 2. Include: unit tests for `SettingsCompat` (legacy-key fallback, deprecation-once-per-session); unit tests for `StorageMigration` (fresh-install / already-migrated / migration paths, idempotency, symlink-on-POSIX, README-on-Windows); integration test that exercises the full settings-key migration round-trip; integration test that boots the desktop shell against a synthetic `~/.gemma-code/` and confirms data shows up under `~/.nexus/`; coverage gate at lines >= 80, functions >= 80 across `core/` and `modules/coding/`. Run the test suite, fix all failures, iterate until every test passes. Do not advance to Phase 3 until this phase is fully verified. After all tests pass, run `/generate-session-history` to document Phase 2.

---

### Phase 2 Exit Checklist

- [ ] All sub-tasks completed
- [ ] `npm test` is green
- [ ] `npm run check-architecture` is green
- [ ] Settings compat shim verified
- [ ] Storage migration verified (idempotent)
- [ ] `core/` / `modules/coding/` layout in place
- [ ] CLI rename (`nexus-check` + deprecation alias) verified
- [ ] Installer package rename verified
- [ ] Top-level docs updated
- [ ] Session history generated for Phase 2
- [ ] Ready to advance to Phase 3

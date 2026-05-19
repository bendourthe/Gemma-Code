# Phase 1 -- Shared-core build + carryforward closure

**Goal**: Stand up the shared-core TypeScript build (project references or `@nexus/core` workspace package) so the sidecar can import from `core/` cleanly; cascade the dependent renames (storage paths, src/ -> modules/coding/, VS Code IDs); delete the legacy curator-cadence fallback; normalize CRLF/LF snapshot tests and SHA-pin the two GitHub Actions in `shell-build.yml`.
**Prerequisites**: v1.0.0 closed.
**Stability Gate**: `npm run check-architecture` is green; `grep -r "\.gemma-code" src/ modules/ desktop/ scripts/` returns zero hits outside `docs/v0.X.0/development/history/`; all 5 previously-failing tests are green; the curator scheduler is the sole entry point (legacy fallback path removed); a fresh `npm ci && npm run build && npm test` produces 0 failures.

---

## Sub-tasks

### 1.1 -- Shared-core build infrastructure

**Objective**: Make `core/` importable by `desktop/sidecar/`, `src/`, and future `modules/*` without going through `../../core/`.

**Prompt**:
> Land the TypeScript project-references infrastructure that lets the sidecar workspace import `core/` directly. Two options: (a) **project references** -- add a `tsconfig.json` in `core/` with `composite: true`, list it under `references` in `desktop/sidecar/tsconfig.json` and the root `tsconfig.json`, and use `tsc -b` for incremental builds; or (b) **workspace package** -- restructure `core/` as `packages/core/` and add it to the npm workspaces array as `@nexus/core`, then `import { ModelRegistry } from "@nexus/core/registry"`. Pick (a) for v1.1.0 because it preserves the current import paths and is reversible; document the decision in `docs/v1.1.0/development/decisions/shared-core-build.md`. Update [configs/dependency-cruiser.cjs](../../../configs/dependency-cruiser.cjs) so the new references are allowed paths. Acceptance: `tsc -b` from the repo root builds `core/`, `src/`, and `desktop/sidecar/` in dependency order; an explicit failure case (sidecar importing from `../../core/path`) is replaced with `import { X } from "core/path"` and the build still succeeds; CI's `npm run typecheck` step runs `tsc -b`.

---

### 1.2 -- Storage-path call-site rename

**Objective**: Replace every literal `~/.gemma-code/` and `.gemma-code/` reference with the canonical `nexusHome()` / `path.join(workspaceRoot, ".nexus")`.

**Prompt**:
> Walk the 13 call sites in [src/](../../../src/) that still consume the legacy storage path: [src/storage/MemoryFiles.ts](../../../src/storage/MemoryFiles.ts), [src/skills/SkillLoader.ts](../../../src/skills/SkillLoader.ts), [src/skills/SkillMetrics.ts](../../../src/skills/SkillMetrics.ts), [src/skills/CurationLoop.ts](../../../src/skills/CurationLoop.ts), [src/skills/WorkflowDetector.ts](../../../src/skills/WorkflowDetector.ts), [src/mcp/McpManager.ts](../../../src/mcp/McpManager.ts), [src/skills/ImprovementHook.ts](../../../src/skills/ImprovementHook.ts), [src/observability/TraceFile.ts](../../../src/observability/TraceFile.ts), [src/orchestration/PlanArchive.ts](../../../src/orchestration/PlanArchive.ts), [src/skills/quickLabels.ts](../../../src/skills/quickLabels.ts), [src/utils/webCache.ts](../../../src/utils/webCache.ts), [src/storage/MemoryHealthCheck.ts](../../../src/storage/MemoryHealthCheck.ts), [src/observability/OutputRedirector.ts](../../../src/observability/OutputRedirector.ts), [src/storage/dbPermissions.ts](../../../src/storage/dbPermissions.ts). Each call site imports `nexusHome` from [core/storage/paths.ts](../../../core/storage/paths.ts). The 14 affected test fixtures (under [tests/](../../../tests/)) need updated mocks. Verify by `grep -r "\.gemma-code" src/ tests/ scripts/` returning zero hits outside `docs/v0.X.0/development/history/`. Acceptance: full `npm test` is green; the migration module ([core/storage/StorageMigration.ts](../../../core/storage/StorageMigration.ts)) still creates the POSIX symlink for backwards compatibility on existing user installations.

---

### 1.3 -- Settings package.json deprecationMessage injection

**Objective**: Inject `"deprecationMessage": "Use \`<newKey>\` instead. Removed in v1.2.0."` into every legacy `gemma-code.*` entry in [package.json](../../../package.json) `contributes.configuration.properties`.

**Prompt**:
> Write a one-shot script `scripts/dev/inject-deprecation-messages.mjs` that walks `SETTINGS_KEY_MAP` (the canonical map in [src/config/SettingsCompat.ts](../../../src/config/SettingsCompat.ts)), reads `package.json`, and for every legacy `gemma-code.<key>` entry in `contributes.configuration.properties`, sets `"deprecationMessage": "Use \`${newKey}\` instead. Will be removed in v1.2.0."`. Run the script once, commit the diff, and verify with the existing [tests/unit/config/SettingsCompat.test.ts](../../../tests/unit/config/SettingsCompat.test.ts) plus a new snapshot test that asserts the `package.json` shape. Acceptance: VS Code Settings UI renders the legacy keys with the strikethrough + deprecation hint; the runtime compat shim continues to resolve them.

---

### 1.4 -- src/ wholesale move to modules/coding/

**Objective**: Move the 189 files currently under `src/` into `modules/coding/<sub-tree>/` and rewrite all import paths.

**Prompt**:
> Perform the wholesale move with `git mv`: `src/llm/` -> `core/llm/` (already exists -- merge), `src/storage/` -> `core/storage/` (already exists -- merge with care for new methods), `src/tools/` -> `modules/coding/tools/`, `src/agents/` -> `modules/coding/agents/`, `src/chat/` -> `modules/coding/chat/`, `src/commands/` -> `modules/coding/commands/`, `src/evaluation/` -> `modules/coding/evaluation/`, `src/guardrails/` -> `modules/coding/guardrails/`, `src/mcp/` -> `modules/coding/mcp/`, `src/observability/` -> `modules/coding/observability/`, `src/orchestration/` -> `modules/coding/orchestration/`, `src/panels/` -> `modules/coding/panels/`, `src/runtime/` -> `modules/coding/runtime/`, `src/skills/` -> `modules/coding/skills/` (note: there is also a `core/skills/` -- keep the coding-module loader adapter under `modules/coding/skills/`), `src/utils/` -> `modules/coding/utils/`, `src/extension.ts` -> `modules/coding/extension.ts`. Run a single `npm run codemod:rewrite-imports` step (`scripts/dev/rewrite-imports.mjs`) that walks the 517 test files and the moved sources, rewriting `from "../src/..."` / `from "src/..."` to `from "../modules/coding/..."` / `from "modules/coding/..."`. Re-run `npm test` and fix any residual import errors. Acceptance: `npm test` stays green, `npm run check-architecture` stays green, and every import in `modules/coding/` resolves from `core/` or `modules/coding/<sibling>/` (no upward escape).

---

### 1.5 -- VS Code extension manifest IDs rename

**Objective**: Rename `gemma-code-sidebar` (viewContainer id), `gemma-code.<command>` (command ids), and `gemma-code.chatView` / `.memoryPanel` / `.traceDashboard` (view ids) to `nexus.coding.<...>`.

**Prompt**:
> Update [package.json](../../../package.json) `contributes.viewsContainers.activitybar`, `contributes.views`, `contributes.commands`, `contributes.keybindings`, `contributes.menus`, and `activationEvents`: change every `gemma-code-sidebar` to `nexus-coding-sidebar`, every `gemma-code.<cmd>` to `nexus.coding.<cmd>`, every `gemma-code.chatView` to `nexus.coding.chatView`, etc. Update [modules/coding/extension.ts](../../../src/extension.ts) (after Phase 1.4 move) to register the new ids. Add a one-cycle compat shim: when VS Code fires the legacy `gemma-code.<cmd>` keybinding, the extension translates it to `nexus.coding.<cmd>` with a single-line deprecation log to the Output channel. Acceptance: a manual launch of the extension in `Extension Development Host` renders the sidebar; every command in the Command Palette appears under the new id; legacy keybindings still fire the right handler.

---

### 1.6 -- npm package + publisher rename

**Objective**: Rename `package.json` `"name": "gemma-code"` -> `"nexus-coding"` and `"publisher": "gemma-code"` -> `"nexus-coding"` (or the agreed publisher slug).

**Prompt**:
> Update [package.json](../../../package.json) and [package-lock.json](../../../package-lock.json) `name` + `publisher`. Update the [.releaserc.json](../../../.releaserc.json) so semantic-release continues to operate on the renamed package. Add a `.npmignore` (or update the existing one) so the published package excludes test fixtures, the desktop workspace, and the runtimes. **Do NOT re-publish to the Marketplace in this phase** -- that happens in Phase 10 once the thin-adapter rewrite is also ready. Acceptance: `npm pack` produces `nexus-coding-1.1.0.tgz`; the tarball contents include the renamed extension entry point and exclude desktop / runtimes.

---

### 1.7 -- Delete legacy curator-cadence fallback in AgentLoop

**Objective**: Remove the post-N-edits dispatch in `_runOneIteration` now that the IdleTimeScheduler is the only entry point.

**Prompt**:
> Open [modules/coding/tools/AgentLoop.ts](../../../src/tools/AgentLoop.ts) (after the Phase 1.4 move). Find `_runOneIteration` and the curator-cadence fallback that fires after every N edits. Delete that branch. Add a Settings UI toggle at `nexus.curator.enabled` (default `true`) so users can disable curator runs entirely. Add a regression test in [modules/coding/tests/integration/curator-scheduler-only-entry.test.ts](../../../tests/integration/) that asserts no curator runs occur outside `IdleTimeScheduler` invocations. Acceptance: removing the fallback path does not regress any existing test; the new integration test passes.

---

### 1.8 -- CRLF/LF snapshot normalization + SHA-pin shell-build.yml

**Objective**: Close the two pre-existing Windows test failures by normalizing snapshot line endings and SHA-pinning the GitHub Actions in `shell-build.yml`.

**Prompt**:
> (a) Add `tests/snapshots/specialists/*.txt text eol=lf` to [.gitattributes](../../../.gitattributes) so the 4 snapshot files in [tests/unit/agents/SubAgentManager.characterization.test.ts](../../../tests/unit/agents/SubAgentManager.characterization.test.ts) check out with LF on Windows. Alternatively, change the test comparison to normalise via `.replace(/\r\n/g, "\n")` -- pick the .gitattributes path because it is the canonical fix. (b) Open [.github/workflows/shell-build.yml](../../../.github/workflows/shell-build.yml) and replace `dtolnay/rust-toolchain@stable` with `dtolnay/rust-toolchain@<40-char-sha> # stable`, and `actions/cache@v4` with `actions/cache@<40-char-sha> # v4` (or the existing v4 sha). The version-tag comment is retained for human readability. Re-run [tests/unit/workflow-discipline.test.ts](../../../tests/unit/workflow-discipline.test.ts) to verify the SHA-pin assertion passes. Acceptance: `npm test` produces 0 failures on Windows + macOS + Linux CI.

---

### 1.9 -- Sidecar imports core/ directly

**Objective**: With Phase 1.1's project references in place, replace the duplicated frontend/sidecar model catalog mirrors with a single import from `core/registry/ModelCatalog`.

**Prompt**:
> Delete [desktop/sidecar/src/coding/models.ts](../../../desktop/sidecar/src/coding/models.ts) and [desktop/src/modules/coding/models.ts](../../../desktop/src/modules/coding/models.ts). Replace every consumer with `import { ... } from "core/registry/ModelCatalog"` (sidecar) or the equivalent via the desktop-frontend route (which goes through the IPC `models.list` once Phase 2 lands). For now, the desktop-frontend can `import` directly because the project references make it work for the test/build step; the runtime path swaps to IPC in Phase 2. Acceptance: the parity test [desktop/tests/coding-models.test.ts](../../../desktop/tests/coding-models.test.ts) is replaced with a simpler test that imports `models.json` and asserts shape; the typecheck `tsc -b` step is green.

---

### 1.10 -- Wire NexusCodingRuntime into sidecar sessionManager

**Objective**: Replace the placeholder responder in `desktop/sidecar/src/coding/sessionManager.ts` with a real `NexusCodingRuntime` instance (AgentLoop + ToolRegistry + ChatController).

**Prompt**:
> With Phase 1.4 done, `modules/coding/` is importable from the sidecar. Replace the placeholder `sendMessage` body in [desktop/sidecar/src/coding/sessionManager.ts](../../../desktop/sidecar/src/coding/sessionManager.ts) with: instantiate `NexusCodingRuntime` once per session, route incoming `coding.session.sendMessage` calls into `runtime.sendMessage(...)`, stream events back through the response envelope (channel-based streaming lands in Phase 2). Update the integration test [tests/integration/coding-session-end-to-end.test.ts](../../../tests/integration/) to exercise the live runtime instead of the placeholder. Acceptance: an end-to-end "fix the failing test in tests/unit/<file>.test.ts" task succeeds against `gemma4:e4b` (mocked Ollama) through the sidecar.

---

### 1.11 -- Tailwind v4 wiring (build-pipeline rebrand)

**Objective**: Plumb Tailwind v4 into the desktop workspace's build pipeline so `<StyleguidePage>` and downstream components can use utility classes that consume the design tokens.

**Prompt**:
> Add Tailwind v4 to [desktop/package.json](../../../desktop/package.json), wire a `postcss.config.cjs`, and add a `@theme inline { --color-...: var(--nexus-...); ... }` block to [desktop/src/styles/tokens.css](../../../desktop/src/styles/tokens.css) (creates a parallel utility-class surface backed by the existing CSS variables). Components continue to consume `var(--token)` directly OR Tailwind classes -- both work. Acceptance: `npm run build:shell` produces a bundle that includes the Tailwind utility classes; a styleguide page snapshot renders identically; an explicit visual check shows no regressions on the dashboard.

---

### 1.12 -- Phase 1 lint, build, test, doc gate

**Objective**: Re-run the full `npm ci && npm run build && npm test && npm run lint` chain on Windows + macOS + Linux. Document the carryforward closures.

**Prompt**:
> Run the four-step gate locally on Windows; verify CI passes on macOS + Linux. Update [docs/v1.1.0/known-gaps.md](../known-gaps.md) (create if not present, mirroring the [docs/v1.0.0/known-gaps.md](../../v1.0.0/known-gaps.md) structure) and mark each closure under `## 2. Resolved` with the v1.0.0 source code, a one-line description, and the implementing commit / sub-task. Acceptance: 0 failures across all OS legs; the v1.1.0 known-gaps file has the Phase 1 closures recorded.

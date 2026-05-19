# Phase 2 -- Rebrand and core extraction (Phase 1b carryforward closure)

**Goal**: Close the bounded "rebrand" and "core extraction" sub-tasks that Phase 1 deferred (sub-tasks 1.5, 1.6, and 1.9 from [phase-01-shared-core-and-carryforward-closure.md](phase-01-shared-core-and-carryforward-closure.md)). The heavier sub-tasks (1.1 project-references wiring, 1.4 wholesale `src/` -> `modules/coding/` move, 1.10 `NexusCodingRuntime` wiring, 1.11 Tailwind v4) stay deferred to a future Phase 1c because each requires its own `git mv` cluster + per-step CI run and cannot be safely batched into a single session.

**Prerequisites**: Phase 1 partial (commit `ec3ff0e`) -- storage-path rename, `deprecationMessage` injection, curator-cadence fallback removal, CRLF/LF snapshot normalization landed; shared-core decision document committed.

**Stability Gate**:

1. VS Code activity-bar sidebar registers under `nexus-coding-sidebar`; the chat / memory / trace views register under `nexus.coding.chatView` / `.memoryPanel` / `.traceDashboard`; every command in the Command Palette appears under `nexus.coding.<cmd>`.
2. A keybinding using the legacy `gemma-code.<cmd>` identifier still fires the new handler via the runtime compat shim, with a single-line deprecation log.
3. `npm pack` produces `nexus-coding-<version>.tgz` (renamed from `gemma-code-<version>.tgz`); `package.json` `name` is `nexus-coding`, `publisher` is `nexus-coding`.
4. `desktop/sidecar/src/coding/models.ts` and `desktop/src/modules/coding/models.ts` are re-exports / derived views over `core/registry/ModelCatalog`; the parity test in `desktop/tests/coding-models.test.ts` asserts shape against `core/registry/models.json` directly.
5. `npm test` and `npm run lint` are green; `desktop` workspace `npm run typecheck` is green.

---

## Sub-tasks

### 2.1 -- VS Code extension manifest IDs rename (closes 1.5.P1.C)

**Objective**: Flip `gemma-code-sidebar` / `gemma-code.<cmd>` / `gemma-code.chatView` / `.memoryPanel` / `.traceDashboard` to the canonical `nexus-coding-sidebar` / `nexus.coding.<...>` identifiers in [package.json](../../../package.json), update [src/extension.ts](../../../src/extension.ts) registration call-sites, and add a runtime compat shim that translates legacy `gemma-code.<cmd>` keybindings to the new IDs with a single-line deprecation log to the `Nexus Coding` output channel.

**Prompt**:
> Walk every `contributes.viewsContainers.activitybar[].id`, `contributes.views.<key>` map key, `contributes.views.<key>[].id`, `contributes.commands[].command`, and `contributes.menus.<scope>[].command` entry in `package.json`. Replace `gemma-code-sidebar` with `nexus-coding-sidebar` and every `gemma-code.<segment>` command/view identifier with `nexus.coding.<segment>`. Leave `gemma-code.<setting-key>` entries in `contributes.configuration.properties` untouched (those are the legacy settings backed by the v1.0.0 compat shim with `deprecationMessage`). In `src/extension.ts`, update the 8 string literals used in `vscode.commands.registerCommand` / `vscode.window.registerWebviewViewProvider` to the new identifiers. Add a `COMPAT_COMMAND_MAP` table at the top of `src/extension.ts` enumerating the 6 legacy command IDs and their replacements; register each legacy ID programmatically (not in the manifest -- so they do not show in the Command Palette) and have it call `vscode.commands.executeCommand(newId, ...args)` with a single-line `this.outputChannel.appendLine` log. Update the `editor/title` menu reference. Acceptance: launching the extension renders the sidebar under the new container; the Command Palette lists every command under `Nexus Coding:` / `nexus.coding.*`; a manually invoked `gemma-code.newChat` (e.g. via Developer: Run Command) succeeds and writes a single deprecation line to the output channel.

---

### 2.2 -- npm package + publisher rename (closes 1.6.P1.D)

**Objective**: Rename the npm `name` from `gemma-code` to `nexus-coding`, the `publisher` field from `gemma-code` to `nexus-coding`, and update `.releaserc.json` / `.npmignore` so semantic-release continues to operate on the renamed package without re-publishing to the Marketplace in this phase.

**Prompt**:
> Update [package.json](../../../package.json) `name` (`gemma-code` -> `nexus-coding`) and `publisher` (`gemma-code` -> `nexus-coding`). Update [package-lock.json](../../../package-lock.json) `name` to match. Verify [.releaserc.json](../../../.releaserc.json) does not hard-code the old package name in its plugin config; update any reference. Verify [.npmignore](../../../.npmignore) (create one if missing) excludes `tests/`, `docs/`, `desktop/`, `runtimes/`, `scripts/installer/`, `out/desktop/`, `coverage/`, `.github/`. Do NOT re-publish to the VS Code Marketplace -- that happens in cycle Phase 10. Acceptance: `npm pack --dry-run` reports `nexus-coding-<version>.tgz` and the listed file count is sensible (no test fixtures / installer scripts / desktop workspace in the tarball); `npm test` still produces the same passing-test count.

---

### 2.3 -- Sidecar imports core/ directly (closes 1.9.P1.E)

**Objective**: Replace the duplicated model catalog mirrors at [desktop/sidecar/src/coding/models.ts](../../../desktop/sidecar/src/coding/models.ts) and [desktop/src/modules/coding/models.ts](../../../desktop/src/modules/coding/models.ts) with derived views over [core/registry/ModelCatalog.ts](../../../core/registry/ModelCatalog.ts). Without project references (1.1 deferred), use the desktop workspace's existing `tsconfig.json` `include` path to pull `../core/registry` directly; the sidecar's esbuild bundle resolves the relative path at bundle time.

**Prompt**:
> Add `../core/registry` to the [desktop/tsconfig.json](../../../desktop/tsconfig.json) `include` array (the same pattern already used for `../core/image`). Rewrite [desktop/sidecar/src/coding/models.ts](../../../desktop/sidecar/src/coding/models.ts) so `SidecarModelEntry` is a derived projection of `LlmCatalogEntry` (`Pick<LlmCatalogEntry, "id" | "displayName" | "family" | "promptFormat" | "toolFormat">`) and `SIDECAR_MODELS` is computed from `ModelCatalog.listLlm()`; keep the public export surface (`SIDECAR_MODELS`, `SidecarModelEntry`, the type aliases) so existing consumers compile unchanged. Rewrite [desktop/src/modules/coding/models.ts](../../../desktop/src/modules/coding/models.ts) the same way for `FRONTEND_MODELS` / `FrontendModelEntry` (`Pick<LlmCatalogEntry, "id" | "displayName" | "family">`); export the same `DEFAULT_MODEL_ID` constant. Replace [desktop/tests/coding-models.test.ts](../../../desktop/tests/coding-models.test.ts)'s sidecar/frontend parity assertions with a single assertion that both derived views are non-empty and that `SIDECAR_MODELS[i].id === FRONTEND_MODELS[i].id === ModelCatalog.listLlm()[i].id` (positional equality), plus a shape-only assertion against `core/registry/models.json`. Acceptance: `desktop` `npm run typecheck` is green; `desktop` `npm test` produces no new failures; the sidecar esbuild step (`npm run build:sidecar`) still emits a working bundle.

---

### 2.4 -- Phase 2 lint, build, test gate (closes the rebrand + extraction half of the cycle)

**Objective**: Verify the rename + extraction landed without regressing CI.

**Prompt**:
> Run from the repo root: `npm run lint`, `npm test`, then from `desktop/`: `npm run typecheck`, `npm test`, `npm run build:sidecar`. Resolve any regression introduced by the manifest / npm / sidecar changes. Update [docs/v1.1.0/known-gaps.md](../known-gaps.md): move 1.5.P1.C, 1.6.P1.D, and 1.9.P1.E to `## 2. Resolved` with a "Phase 2 (this commit)" entry; leave 1.1.P1.A, 1.4.P1.B, 1.10.P1.F, 1.11.P1.G, 1.12.P2.H, and 1.12.P2.I open with a "still deferred -- target Phase 1c follow-up" note. Recompute the `## 3. Summary` counts. Acceptance: 0 lint warnings, 0 test failures; the known-gaps file shows 3 newly resolved items and the summary is recomputed.

---

## Out of scope (carryforward to Phase 1c)

- **1.1.P1.A** (TypeScript project-references wiring) -- requires 1.4 to land first; deep build-graph change that must own its own CI cycle.
- **1.4.P1.B** (wholesale `src/` -> `modules/coding/` move) -- 171 source files + 204 test files; per the existing known-gaps entry this work must land sub-tree by sub-tree on a dedicated `phase-1c-modules-coding-move` branch.
- **1.10.P1.F** (`NexusCodingRuntime` wiring into sidecar) -- depends on 1.4 landing so `modules/coding/runtime/NexusCodingRuntime` is the canonical import path; relative-path import from `desktop/sidecar/` before the move is explicitly the brittle pattern 1.1 is designed to eliminate.
- **1.11.P1.G** (Tailwind v4 wiring) -- deferred to cycle Phase 11 per the original Phase 1 plan; touching the desktop build pipeline now would force a re-run of every visual-regression snapshot for net-zero behavioural change.
- **1.12.P2.H** (curator IdleTimeScheduler exclusivity regression test) -- queued for the same Phase 1c follow-up alongside the IdleTimeScheduler-curator task wiring.
- **1.12.P2.I** (12 v1.0.0 operator-action items) -- surface in cycle Phase 15 (release hardening).

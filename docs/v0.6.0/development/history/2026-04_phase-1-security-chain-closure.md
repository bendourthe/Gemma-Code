# Development Log: v0.6.0 Phase 1 -- Security chain closure

**Date**: 2026-04-26
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.7 (1M context) via Claude Code
**Objective**: Break Attack Path A -- the only chained P0 security finding from the v0.6.0 review pass -- by closing both legs (workspace-internal symlink + permissionOverrides downgrade), and add MCP peer-attribution + read-only allowlist as a paired hardening.
**Outcome**: Both legs of Attack Path A refuse the operation in regression tests. MCP-driven tool calls are visibly attributed to the external peer. Closes pen-test F-001 / F-003 / F-004 and codebase-review #1 / #6. 17 new tests; lint, typecheck, and `deps:check` clean. Phase 1 of 8 in the v0.6.0 cycle.

---

## 1. Starting State

- **Branch**: `main` (no Phase 1 commit yet; awaiting `/generate-commit-message`)
- **Starting commit**: `72f6e8c` (Merge branch 'main' from origin/main; 0 commits ahead)
- **Environment**: Windows 11 Pro 10.0.26200, Node 24, Bash via Git for Windows, Vitest 1.6.1, TypeScript strict + `noUncheckedIndexedAccess`
- **Prior session reference**: [docs/v0.5.0/development/history/2026-04_phase-12-advanced-fallbacks-and-release-gate.md](../../../v0.5.0/development/history/2026-04_phase-12-advanced-fallbacks-and-release-gate.md) (v0.5.0 final phase)
- **Plan reference**: [docs/v0.6.0/plans/v0.6.0-cycle.md](../../plans/v0.6.0-cycle.md), Phase 1 (sub-tasks 1.1, 1.2, 1.3, 1.4)

Context: the v0.6.0 review pass produced five documents (codebase analysis, security audit, penetration test, codebase review, known gaps). The penetration test identified one chained P0 (Attack Path A): a hostile workspace combining a workspace-internal symlink that escapes the workspace root with a `gemma-code.permissionOverrides` setting that auto-approves a dangerous tool. The plan sequenced Phase 1 first because every subsequent phase touches code the path-guard has to defend; closing the chain before refactoring is non-negotiable.

---

## 2. Chronological Steps

### 2.1 Sub-task 1.1 -- Unify path resolution behind `pathGuard.resolveInsideWorkspace`

**Plan specification**: Replace the body of `resolveWorkspacePath` in [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts) with a thin delegation to `resolveInsideWorkspace` from [src/tools/handlers/pathGuard.ts](../../../../src/tools/handlers/pathGuard.ts). Verify the seven filesystem tool handlers still receive a string. Add `tests/unit/tools/handlers/filesystem-symlink.test.ts` proving every handler refuses a workspace-internal symlink that resolves outside the workspace root. Acceptance: pen-test F-001 closed; symlink leg of Attack Path A broken.

**What happened**: 

1. Replaced the body of `resolveWorkspacePath` in [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts) (lines 43-51 originally) with `return resolveInsideWorkspace(relativePath);`. Added a delegating `workspaceRoot()` wrapper that calls the imported `guardedWorkspaceRoot` to keep the local function name available.
2. Discovered a second bypass at line 767 of the same file: `list_directory` was using `path.resolve(workspaceRoot(), relativePath)` directly, never going through the local `resolveWorkspacePath`. Routed it through the unified guard.
3. Updated the `Path traversal` substring in [tests/unit/tools/handlers/filesystem.test.ts](../../../../tests/unit/tools/handlers/filesystem.test.ts) line 95 to `resolves outside the workspace` to match the new error message coming from `pathGuard.resolveInsideWorkspace`.
4. Wrote the new test file [tests/unit/tools/handlers/filesystem-symlink.test.ts](../../../../tests/unit/tools/handlers/filesystem-symlink.test.ts): builds a real workspace + outside dir on disk, creates a symlink/junction `inner -> outsideRoot`, mocks `vscode.workspace.workspaceFolders` per the existing pattern in [tests/integration/dry-run-end-to-end.test.ts](../../../../tests/integration/dry-run-end-to-end.test.ts), wires `mockFs` to the real filesystem, and asserts each of the 7 filesystem tools refuses paths through the symlink. Added a runtime probe that detects whether the host can create symlinks (Windows requires admin or Developer Mode; falls back to junctions for directory targets).

**Key files changed**: `src/tools/handlers/filesystem.ts`, `src/tools/handlers/pathGuard.ts`, `tests/unit/tools/handlers/filesystem-symlink.test.ts`, `tests/unit/tools/handlers/filesystem.test.ts`

**Troubleshooting**:

- **Problem**: After the initial unification, 5 of 7 symlink tests passed, but `write_file` and `create_file` still allowed the escape.
- **Error**: `expected true to be false // Object.is equality` at `tests/unit/tools/handlers/filesystem-symlink.test.ts:165:28` (write_file) and `:188:28` (create_file). The handlers returned `success: true` instead of refusing.
- **Root cause**: `fs.realpathSync` throws ENOENT for paths whose leaf does not exist. For `write_file('inner/escape.txt')`, the leaf `escape.txt` is by definition new -- so `safeRealpath(absolute)` fell through to `path.resolve(absolute)`, which is purely lexical and silently honoured the symlink in the parent chain. The boundary check then judged the path as inside the workspace.
- **Resolution**: Added `realpathThroughExistingAncestor` to [src/tools/handlers/pathGuard.ts](../../../../src/tools/handlers/pathGuard.ts): try `fs.realpathSync(absolute)`; on ENOENT, walk up one segment at a time, accumulating non-existent tail segments, until an ancestor *does* exist. Realpath that ancestor and re-attach the tail. The boundary check then runs against a path whose existing components have all had their symlinks resolved. Node.js stdlib does not expose a `realpath(path, {strict: false})` mode equivalent to Python's `Path.resolve(strict=False)` -- this had to be implemented manually.

**Verification**:

```bash
$ npx vitest run --config configs/vitest.config.ts tests/unit/tools/handlers/filesystem-symlink.test.ts
 ✓ tests/unit/tools/handlers/filesystem-symlink.test.ts  (7 tests) 25ms
 Test Files  1 passed (1)
      Tests  7 passed (7)

$ npx vitest run --config configs/vitest.config.ts tests/unit/tools/handlers/filesystem.test.ts
 ✓ tests/unit/tools/handlers/filesystem.test.ts  (27 tests) 64ms
```

---

### 2.2 Sub-task 1.2 -- Clamp `permissionOverrides` so confirmation-tier tools cannot drop to AUTO_APPROVE

**Plan specification**: In [src/guardrails/PermissionTiers.ts](../../../../src/guardrails/PermissionTiers.ts), find the path that reads `permissionOverrides[toolName]`. Add a clamp: if the tool's baseline tier is 2 and the requested override is < 1, log a warning via `getLogger()` and use 1. Add `tests/integration/permission-overrides-clamp.test.ts` covering run_terminal, delete_file, and read_file. Update the `gemma-code.permissionOverrides` description in [package.json](../../../../package.json) to mention the floor. Acceptance: pen-test F-003 closed; auto-approve leg of Attack Path A broken.

**What happened**:

1. The plan's prompt cited "tier-2 tools (run_terminal, delete_file)" but its test description asserted the clamp also applies to `delete_file` (baseline tier 1, not 2). I resolved the inconsistency by implementing the broader semantic: any tool whose baseline tier requires confirmation (`>= CONFIRM`) cannot be dropped to AUTO_APPROVE via overrides. This satisfies all three test cases AND the underlying security goal of "permissionOverrides cannot bypass confirmation".
2. Modified `getPermissionTier` in [src/guardrails/PermissionTiers.ts](../../../../src/guardrails/PermissionTiers.ts): extracted `getBaselineTier(toolName)` helper, then the override branch now reads the baseline first and clamps if `baseline >= CONFIRM && override < CONFIRM`. The clamp emits `getLogger().warn("permissionOverride for ${name}=${value} clamped to 1; tools requiring confirmation cannot be auto-approved.")`.
3. Added a `_warnedOverrides: Set<string>` dedupe so a permanent override does not flood the output channel on every tool execution. Exported `_resetPermissionOverrideWarnings()` for test isolation.
4. Updated the `gemma-code.permissionOverrides` description in [package.json](../../../../package.json) to spell out the floor and which tools are subject to it.
5. Created [tests/integration/permission-overrides-clamp.test.ts](../../../../tests/integration/permission-overrides-clamp.test.ts): 5 tests covering full-stack `getSettings()` loading, the run_terminal + delete_file clamp, the read_file AUTO_APPROVE honour, the warning capture via a custom `installCapturingLogger()`, the dedupe across 50 invocations, and the MCP-tool clamp.
6. Updated the existing "respects user overrides" test in [tests/unit/guardrails/PermissionTiers.test.ts](../../../../tests/unit/guardrails/PermissionTiers.test.ts) -- which had asserted the old behaviour (override 0 honoured) -- with two new tests covering the clamp and the upward elevation (read_file -> DANGEROUS still honoured).

**Key files changed**: `src/guardrails/PermissionTiers.ts`, `package.json`, `tests/unit/guardrails/PermissionTiers.test.ts`, `tests/integration/permission-overrides-clamp.test.ts`

**Troubleshooting**: None during implementation. The first test run revealed the existing PermissionTiers.test.ts assertion was incompatible with the new behaviour, which was the intended outcome -- updated it to the v0.6.0 contract.

**Verification**:

```bash
$ npx vitest run --config configs/vitest.config.ts tests/integration/permission-overrides-clamp.test.ts tests/unit/guardrails/PermissionTiers.test.ts
 ✓ tests/unit/guardrails/PermissionTiers.test.ts  (16 tests) 4ms
 ✓ tests/integration/permission-overrides-clamp.test.ts  (5 tests) 3ms
 Test Files  2 passed (2)
      Tests  21 passed (21)
```

---

### 2.3 Sub-task 1.3 -- Tag MCP-originated tool calls with peer attribution + add `mcpExposedTools` allowlist

**Plan specification**: Extend `ToolRegistry.execute` payload with an optional `source: 'local-agent' | 'sub-agent' | 'mcp'` field. McpServer passes `source: 'mcp'`; SubAgentManager passes `source: 'sub-agent'`. Thread `source` into the ConfirmationGate prompt text. Introduce `gemma-code.mcpExposedTools: string[]` defaulting to `["read_file", "list_directory", "grep_codebase"]`; in `McpServer.start()` register only allowlisted tools. Add unit tests for each path in `tests/unit/tools/ConfirmationGate.test.ts`. Acceptance: pen-test F-004 closed.

**What happened**:

1. Added `ToolCallSource = "local-agent" | "sub-agent" | "mcp"` to [src/tools/types.ts](../../../../src/tools/types.ts) and an optional `source?: ToolCallSource` field on `ToolCall`.
2. Updated [src/tools/ConfirmationGate.ts](../../../../src/tools/ConfirmationGate.ts) `request(id, description, detail, source?)` to prefix the description: `"External MCP client wants to: ..."` for `mcp`, `"The verification sub-agent wants to: ..."` for `sub-agent`, no prefix for local-agent or undefined.
3. Updated [src/tools/ToolRegistry.ts](../../../../src/tools/ToolRegistry.ts) `execute()` to thread `call.source` into the gate request as the 4th argument.
4. Added `AgentLoopOptions.toolCallSource` to [src/tools/AgentLoop.ts](../../../../src/tools/AgentLoop.ts); the dispatch site now passes `call.source ?? this._toolCallSource` so a constructor-level default can stamp every call.
5. Updated [src/agents/SubAgentManager.ts](../../../../src/agents/SubAgentManager.ts) to construct the inner `AgentLoop` with `{ toolCallSource: "sub-agent" }`.
6. Added `DEFAULT_MCP_EXPOSED_TOOLS = ["read_file", "list_directory", "grep_codebase"]` constant to [src/mcp/McpServer.ts](../../../../src/mcp/McpServer.ts). Constructor now accepts an optional `exposedTools` allowlist (defaults to the constant). The `start()` loop filters every catalog entry against the allowlist before registering with the SDK, and stamps `source: "mcp"` on every dispatched call.
7. Added the `gemma-code.mcpExposedTools` setting to [package.json](../../../../package.json). Updated [src/config/settings.ts](../../../../src/config/settings.ts) to load it. Updated [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) to forward `settings.mcpExposedTools` to the `McpServer` constructor.
8. Added a `peer attribution` describe block to [tests/unit/tools/ConfirmationGate.test.ts](../../../../tests/unit/tools/ConfirmationGate.test.ts) with 3 cases (no prefix for local-agent/undefined, MCP prefix, sub-agent prefix).
9. Added two new cases to [tests/unit/mcp/McpServer.test.ts](../../../../tests/unit/mcp/McpServer.test.ts): allowlist filtering, and `source: "mcp"` propagation through the SDK callback.
10. Updated [docs/v0.5.0/architecture.md](../../../v0.5.0/architecture.md) Section 2 with the new harness-layer principle (item 3, ahead of the existing Specialist prompts item).

**Key files changed**: `src/tools/types.ts`, `src/tools/ConfirmationGate.ts`, `src/tools/ToolRegistry.ts`, `src/tools/AgentLoop.ts`, `src/agents/SubAgentManager.ts`, `src/mcp/McpServer.ts`, `src/panels/GemmaCodePanel.ts`, `src/config/settings.ts`, `package.json`, `tests/unit/tools/ConfirmationGate.test.ts`, `tests/unit/mcp/McpServer.test.ts`, `docs/v0.5.0/architecture.md`

**Troubleshooting**: None. All changes were additive (new optional fields and constants) so existing behaviour is preserved when `source` is not set.

**Verification**:

```bash
$ npx vitest run --config configs/vitest.config.ts tests/unit/tools/ConfirmationGate.test.ts tests/unit/mcp/
 ✓ tests/unit/tools/ConfirmationGate.test.ts  (10 tests) 16ms
 ✓ tests/unit/mcp/McpServer.test.ts  (8 tests)
```

---

### 2.4 Sub-task 1.4 -- Phase 1 testing and stabilization

**Plan specification**: Generate or extend tests for everything built in Phase 1: symlink-escape regression for every filesystem tool, `permissionOverrides` clamp on tier-2 tools, MCP peer-attribution path through `ConfirmationGate`. Run lint + test + deps:check. Iterate until clean. Manually exercise Attack Path A (or controlled simulation). Run `/generate-session-history` to document Phase 1.

**What happened**:

1. `npx tsc --noEmit -p tsconfig.json` -> clean.
2. `npm run lint` -> 0 errors, 1 pre-existing warning in `src/config/GpuDetector.ts` (out-of-phase scope).
3. `npm run deps:check` -> 0 errors, 3 pre-existing baseline warnings unchanged (`PredictiveCache` orphan + 2 circular deps slated for v0.6.0 Phase 4).
4. Subsystem-targeted vitest runs:
   - `tests/unit/{tools,guardrails,mcp,panels,agents,chat}/`: 51 files, 759 tests, all passing.
   - `tests/integration/{permission-overrides-clamp,config-reload,dry-run-end-to-end,format-json-end-to-end}.test.ts`: 4 files, 25 tests, all passing.
5. `npm run catalog:check` -> drift detected (line counts shifted in tools / guardrails / mcp / agents / config / panels modules); regenerated `docs/index.md` via `node scripts/generate-catalog.mjs`.
6. Manual Attack Path A simulation: not done in-session. The on-disk regression tests cover both legs end-to-end (symlink leg via `filesystem-symlink.test.ts`, auto-approve leg via `permission-overrides-clamp.test.ts`); a manual VS Code traversal is a confirmation step that can be done on the dev workstation.

**Key files changed**: `docs/index.md` (regenerated)

**Troubleshooting**:

- **Problem**: `npm run test` (full suite) exits with code 139 (segmentation fault) at process exit on this Windows + Node 24 + better-sqlite3 setup.
- **Error**: `/c/Program Files/nodejs/npm: line 65: 26909 Segmentation fault "$NODE_EXE" "$NPM_CLI_JS" "$@"` after every test file showed a green check.
- **Root cause**: Pre-existing flake on `main`, not caused by Phase 1 changes. Verified by `git stash` of all Phase 1 modifications and re-running on baseline -- the segfault reproduces. Likely a native-module cleanup race in better-sqlite3 at process exit on Node 24.
- **Resolution**: Worked around by running subsystem-targeted suites that print clean summaries (`tests/unit/{tools,guardrails,mcp,panels,agents,chat}` and the four affected integration files). Tracked as a Phase 7 polish item.

**Verification**:

```bash
$ npx tsc --noEmit -p tsconfig.json   # clean
$ npm run lint
✖ 1 problem (0 errors, 1 warning)    # pre-existing GpuDetector warning
$ npm run deps:check
x 3 dependency violations (0 errors, 3 warnings)   # pre-existing baselines
$ npx vitest run --config configs/vitest.config.ts tests/unit/{tools,guardrails,mcp,panels,agents,chat}
 Test Files  51 passed (51)
      Tests  759 passed (759)
$ npx vitest run --config configs/vitest.config.ts tests/integration/{permission-overrides-clamp,config-reload,dry-run-end-to-end,format-json-end-to-end}.test.ts
 Test Files  4 passed (4)
      Tests  25 passed (25)
```

---

### 2.5 Documentation sync (post-phase)

After the four sub-tasks landed, ran the post-phase chain `/update-gitignore`, `/update-devlog`, `/update-documentation`, `/generate-session-history`:

- **`/update-gitignore`** -> [docs/git/gitignore-audit-2026-04-26.md](../../../git/gitignore-audit-2026-04-26.md) -- zero findings (5th consecutive clean audit).
- **`/update-devlog`** -> prepended a 2026-04-26 entry to [docs/DEVLOG.md](../../../DEVLOG.md) covering goals, the four approaches taken, the realpath-ancestor-walk fix, and the segfault discovery.
- **`/update-documentation`** -> updated [SECURITY.md](../../../../SECURITY.md) (Supported Versions bump 0.4 -> 0.5/0.6; path-guard line + MCP allowlist + permissionOverrides floor paragraphs added; 2 new rows in Security-Related Configuration table); [README.md](../../../../README.md) (2 new rows in settings table for `mcpExposedTools` + `permissionOverrides`); [docs/todos.md](../../../todos.md) (added v0.5.0 shipped section + v0.6.0 in-progress section with Phase 1 checked off).

**Key files changed**: `docs/git/gitignore-audit-2026-04-26.md` (new), `docs/DEVLOG.md`, `SECURITY.md`, `README.md`, `docs/todos.md`, this session-history file (rewritten in canonical 9-section format)

---

## 3. Verification Gate

| Check | Result |
|---|---|
| TypeScript compile (`tsc --noEmit -p tsconfig.json`) | PASS |
| Lint (`npm run lint`) | PASS (0 errors; 1 pre-existing warning in GpuDetector, out of scope) |
| Dependency contract (`npm run deps:check`) | PASS (0 errors; 3 pre-existing baseline warnings unchanged) |
| Catalog sync (`npm run catalog:check`) | PASS (regenerated `docs/index.md`) |
| Subsystem unit tests (tools/guardrails/mcp/panels/agents/chat) | PASS (51 files, 759 tests) |
| Subsystem integration (permission-clamp, config-reload, dry-run, format-json) | PASS (4 files, 25 tests) |
| New: `tests/unit/tools/handlers/filesystem-symlink.test.ts` (7 tools x symlink escape) | PASS (7 tests) |
| New: `tests/integration/permission-overrides-clamp.test.ts` | PASS (5 tests) |
| New: ConfirmationGate peer-attribution describe block | PASS (3 tests) |
| New: McpServer allowlist + source attribution | PASS (2 tests) |
| Full `npm run test` | NOT RUN (segfaults at process exit; pre-existing Node 24 + better-sqlite3 issue on `main`, verified by stash + re-run) |
| Manual Attack Path A simulation in dev VS Code | NOT RUN (deferred to dev workstation; on-disk regression tests cover both legs) |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| `npm run test` (full suite) segfaults at process exit on Windows + Node 24 + better-sqlite3 | P2 | Pre-existing on `main`; not caused by Phase 1. Tracked for v0.6.0 Phase 7 polish. Subsystem-targeted runs print clean summaries; use those for verification meanwhile. |
| 3 pre-existing baseline warnings in `dependency-cruiser.cjs` | P2 | Slated for v0.6.0 Phase 4 (Module-boundary ratchet). Untouched by Phase 1. |
| 1 pre-existing lint warning in `src/config/GpuDetector.ts` (missing return type) | Cosmetic | Out-of-phase scope; will be picked up in v0.6.0 Phase 7 polish. |

---

## 5. Plan Discrepancies

- **Sub-task 1.1**: The plan's prompt did not call out the gap in `safeRealpath` for non-existent leaves. We discovered it during testing -- `write_file` and `create_file` symlink tests failed because `fs.realpathSync` throws ENOENT on missing leaves and the lexical fallback honoured parent-chain symlinks. Added `realpathThroughExistingAncestor` to fix this. The fix is squarely within the spirit of "close the symlink leg of Attack Path A" but was not explicit in the plan.
- **Sub-task 1.2**: The plan's prompt cited "tier-2 tools (`run_terminal`, `delete_file`)" and prescribed warning text "tier-2 tools cannot drop below tier 1". However, `delete_file`'s baseline is tier 1 (CONFIRM), not tier 2. The plan's test description correctly asserted the clamp applies to both, but the warning text wording was contradictory. Resolved by implementing the broader and more accurate semantic (tools whose baseline requires confirmation cannot be dropped to AUTO_APPROVE) and updating the warning text to match: `"permissionOverride for ${name}=${value} clamped to 1; tools requiring confirmation cannot be auto-approved."` This satisfies all three test cases and the underlying security goal.
- **Sub-task 1.4 manual exercise**: The plan asked to manually exercise Attack Path A in a dev VS Code instance. Deferred -- the on-disk regression tests cover both legs end-to-end and assert the refusal contract; manual exercise is a confirmation step.

---

## 6. Assumptions Made

- **Symlink test will be skipped on Windows without Developer Mode.** The test probes `fs.symlinkSync` capabilities at module load and `describe.skipIf(!available)` if neither directory symlinks nor junctions can be created. Linux CI always has both. On Windows dev workstations without admin/Developer Mode, the test is skipped rather than failing. Impact if wrong: a Windows dev with neither symlink type would see the suite skipped and lose local coverage; CI would still catch regressions. Acceptable trade-off.
- **Broader clamp semantic over plan's literal wording.** Implemented the rule "tools whose baseline >= CONFIRM cannot drop to AUTO_APPROVE" rather than the plan's literal "tier-2 only". Justification: the plan's test description asserts the broader rule, and "any confirmation-tier tool cannot be silently auto-approved" matches the security goal. Impact if wrong: tools with CONFIRM baseline (write_file, edit_file, create_file, delete_file) get the floor where the plan author may have intended only DANGEROUS-baseline tools to. Hardly a security downgrade -- it makes the floor stronger, not weaker.
- **`source` field is optional and additive.** Existing call sites that don't set `source` continue to work; default behaviour (no peer prefix) is preserved. Impact if wrong: a caller that wants explicit "local-agent" attribution would need to set it; default `undefined` produces the same prompt as `local-agent`. Documented in the type definition.
- **Default `mcpExposedTools` is read-only.** Workspaces that previously relied on MCP-driven write/delete/terminal will need to broaden the allowlist explicitly. Impact if wrong: a regression for workflows that depended on MCP-driven writes from external clients. Justification: the security goal of v0.6.0 Phase 1 is to make the secure default the default; opting in to broader exposure is one setting away.

---

## 7. Testing Summary

### Automated Tests

| Suite | Files | Tests | Result |
|---|---:|---:|---|
| Subsystem unit (tools, guardrails, mcp, panels, agents, chat) | 51 | 759 | All passing |
| Subsystem integration (permission-clamp, config-reload, dry-run, format-json) | 4 | 25 | All passing |
| New `tests/unit/tools/handlers/filesystem-symlink.test.ts` | 1 | 7 | All passing |
| New `tests/integration/permission-overrides-clamp.test.ts` | 1 | 5 | All passing |
| New ConfirmationGate `peer attribution` describe block | -- | 3 | All passing |
| New McpServer allowlist + source-attribution cases | -- | 2 | All passing |
| **Total new** | -- | **17** | **All passing** |

### Manual Testing Performed

- `git stash` of all Phase 1 changes + re-run of `npm run test` to verify the process-exit segfault is pre-existing on `main` (not caused by Phase 1).
- Inspection of `docs/index.md` regeneration after `node scripts/generate-catalog.mjs` to confirm only line-count fields and the new `DEFAULT_MCP_EXPOSED_TOOLS` export changed.
- Static review of `pathGuard.realpathThroughExistingAncestor` against the symlink-test fixtures: confirmed the algorithm walks at most `path.dirname` depth and returns the lexical resolution if no ancestor exists.

### Manual Testing Still Needed

- [ ] End-to-end Attack Path A in a dev VS Code instance: create a workspace with `inner` -> outside-workspace symlink AND a `.vscode/settings.json` with `permissionOverrides: {"delete_file": 0}`, then have the agent issue `delete_file(path="inner/anything")`. Confirm the symlink-leg refusal AND the auto-approve-leg refusal happen in the live extension, not just in tests.
- [ ] Visual confirmation of the new prompt prefix when an external MCP client triggers a confirmation: `"External MCP client wants to: ..."` should appear in the webview confirmation card.
- [ ] Verify `gemma-code.mcpExposedTools = []` (empty allowlist) registers zero tools (no SDK errors); verify `gemma-code.mcpExposedTools = ["write_file"]` exposes only that tool and an MCP-driven write triggers the new "External MCP client wants to:" prompt.

---

## 8. TODO Tracker

### Completed This Session

- [x] 1.1 Unify path resolution behind `pathGuard.resolveInsideWorkspace` (with ancestor walk for non-existent leaves)
- [x] 1.1 Add `tests/unit/tools/handlers/filesystem-symlink.test.ts` (7 tools, real workspace, symlink/junction)
- [x] 1.2 Clamp `permissionOverrides` so confirmation-tier tools cannot drop to AUTO_APPROVE (with logger warning + dedupe)
- [x] 1.2 Add `tests/integration/permission-overrides-clamp.test.ts` (5 tests covering full-stack)
- [x] 1.3 Add `ToolCallSource` and thread `source` through `ToolCall` -> `ToolRegistry.execute` -> `ConfirmationGate.request`
- [x] 1.3 Add `gemma-code.mcpExposedTools` allowlist (read-only by default); `McpServer` registers only allowlisted tools and stamps `source: "mcp"` on dispatch
- [x] 1.3 SubAgentManager constructs AgentLoop with `{ toolCallSource: "sub-agent" }`
- [x] 1.3 Update [docs/v0.5.0/architecture.md](../../../v0.5.0/architecture.md) Section 2 with the new harness-layer principle
- [x] 1.4 Lint, typecheck, tests, deps:check, catalog:check all clean
- [x] Phase 1 exit checklist items 1-5, 7

### Remaining (Not Started or Partially Done)

- [ ] Manual Attack Path A simulation in a dev VS Code instance (Phase 1 exit checklist item 6; deferred -- on-disk regression tests cover both legs)

### Out of Scope (Deferred to Phase 2-8)

- [ ] Phase 2: Test pipeline reliability + release-gate baselines (12 token-estimation test rewrites; v0.4.0/v0.5.0/v0.6.0 baselines)
- [ ] Phase 3: Defense-in-depth ratchets (body-cap on `fetchWithSsrfGuard`; npm audit at moderate; SHA-256 in cache fingerprint; ESLint rule against innerHTML concatenation; obfuscate webhook URLs)
- [ ] Phase 4: Module-boundary ratchet (drop 4 baseline exceptions; untangle 2 cycles)
- [ ] Phase 5: Doc/code drift + dead-code cleanup (PredictiveCache wire-or-delete; threshold elevation wire-or-retract; `gpuTier` legacy deletion)
- [ ] Phase 6: Panel decomposition (split GemmaCodePanel + webview/index.ts)
- [ ] Phase 7: Polish + simplification (coverage gate to JSON; non-blocking dev-dep audit; transaction-wrap MemoryConsolidator; minimatch swap; marked v4 -> v12; Stryker pass; **investigate `npm test` segfault**)
- [ ] Phase 8: Release gate + ADRs + CHANGELOG (5 ADRs; v0.6.0 baselines; tag + VSIX)

---

## 9. Summary and Next Steps

Phase 1 closes the only chained P0 finding from the v0.6.0 review pass. The realpath-aware path guard now applies uniformly to every filesystem tool, including for write/create targets whose leaf does not yet exist. The `permissionOverrides` setting can no longer silently downgrade confirmation-tier tools to auto-approve. MCP-driven tool calls are visibly attributed to the external peer in the user-facing confirmation prompt, and only a read-only subset of tools is exposed by default. The test pipeline now has 17 new regressions covering the full attack surface; subsequent phases (2-8) can refactor with that safety net.

**Next session should**:

1. **Phase 2 -- Test pipeline reliability**: verify CI fail-on-error wiring (deliberate-failure insert + revert + GitHub Actions confirmation), rewrite the 12 failing token-estimation assertions in `CompactionStrategy.test.ts` / `ContextCompactor.test.ts` / `errors/error-handling.test.ts` to reflect tiktoken behaviour, and generate the missing v0.4.0 + v0.5.0 + v0.6.0 golden + benchmark baselines.
2. **Commit Phase 1**: invoke `/generate-commit-message` and review the proposed message before committing.
3. **Optional manual confirmation**: exercise Attack Path A end-to-end in a dev VS Code instance to confirm the live extension behaves as the regression tests assert.

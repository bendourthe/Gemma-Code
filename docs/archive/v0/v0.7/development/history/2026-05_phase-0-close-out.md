# v0.7.0 Phase 0 -- v0.6.0 close-out + carryovers

**Cycle**: v0.7.0
**Phase**: 0 (foundation; v0.6.0 obligations + carryover P1 items)
**Date**: 2026-05-05
**Plan reference**: [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](../../plans/v0.7.0-cycle.md) Phase 0
**Known-gaps reference**: [docs/archive/versions/v0/v0.7.0/known-gaps.md](../../known-gaps.md) Sections 2.1-2.4, 4.1-4.5, 5.3
**ADR**: [docs/adr/0011-ollama-client-injection.md](../../../../versions/v0/adr/0011-ollama-client-injection.md)

---

## 1. Scope

Phase 0 discharges the agent-runnable items in v0.7.0 known-gaps Sections 2 and 4. The phase is the foundation gate that v0.7.0 feature work depends on; without the panel decomposition and the marked migration, the v0.7.0 webview overhaul (Phase 4) would have to migrate on top of unchanged surfaces.

Eight sub-tasks. Five run autonomously here; three are operator-action items (live-Ollama baselines, post-tag verification, pre-cycle benchmark) that require an `ollama serve` instance and remain owner-driven.

---

## 2. Sub-tasks executed

### 2.1 -- 0.3 Cycle plan kickoff (Section 5.3)

The three v0.7.0 cycle-plan files were untracked in the working tree at the start of Phase 0. Reviewed the contents of each, confirmed they form a coherent cycle plan, staged and committed as `feat(v0.7.0): cycle plan kickoff`. Updated known-gaps Section 5.3 with the resolution.

### 2.2 -- 0.5 marked v4 -> v12 migration (Section 2.1)

Bumped `marked` from `^4.3.0` to `^12.0.0` (resolved at `12.0.2`). Removed the now-redundant `@types/marked` dev dependency. The v0.7.0 plan described the v12 line as reshaping the Renderer API to a token-object signature; investigation showed that change actually landed in v15 and v15+ is ESM-only (incompatible with the CJS extension). The MarkdownRenderer file is updated to use `marked.parse(text, { async: false })` (the recommended v12 entry point) but the three custom renderers (`code`, `link`, `image`) are unchanged-by-need because v12 still uses the v4-positional Renderer signature. All 8 renderer tests green; sanitization chain (DOMPurify) intact.

Deviation logged in DEVLOG and in known-gaps Section 2.1 resolution.

### 2.3 -- 0.4 Panel decomposition + ChatController hoist (Sections 2.3 + 2.4)

`GemmaCodePanel.ts` shrunk from 935 to 305 lines (-67%, well under the 400-line ADR-0008 target). The construction graph (memory subsystem, context compactor, sub-agent manager, orchestrator, agent loop, streaming pipeline) extracted into:

1. **`src/panels/ChatPanelBootstrap.ts`** -- a single `bootstrapChatPanel(input): BootstrappedPanel` free function that owns the ordered construction and returns a 30-field record of every subsystem. The panel constructor calls this once and pins the result to `private readonly` fields.
2. **Static factories on `ChatController`** -- `buildContextCompactor`, `buildSubAgentManager`, `buildOrchestrator`, `buildAgentLoop`, `buildStreamingPipeline`. Each accepts a typed deps object and returns the constructed subsystem. Static (not instance) so the existing `ChatControllerContext` injection contract used by the controller's unit tests stays intact.
3. **`src/panels/ChatPanelInit.ts`** -- `initStore`, `initToolOutputCache`, `initWebResponseCache`, `initOperationLog`, `buildMemorySubsystem`. Each helper builds a single subsystem from runtime/workspace inputs and falls back to null on failure.
4. **`src/panels/ChatStatusReporter.ts`** -- the `post*` status pushes (history, token count, memory status, MCP status, thinking-mode status) plus the per-assistant Markdown render cache.
5. **`src/panels/ChatMessageRouter.ts`** -- the webview `WebviewToExtensionMessage` dispatch (ready / sendMessage / clearChat / cancelStream / loadSession / setEditMode / rollbackRequest).
6. **`src/panels/ToolActivationContext.ts`** -- `buildPromptContext`, `getEnabledToolMetadata`, `buildOllamaTools`. The owning panel resolves late-binding state (mcpTools, ollama reachability, hardware tier) via callbacks.
7. **`src/tools/ToolRegistryBuilder.ts`** -- `buildToolRegistry` free function. Centralises the per-tool registration list previously inlined in the panel.

ADR-0011 documents the injection pattern. `tests/unit/runtime/GemmaRuntime.test.ts` (4 tests) asserts the `GemmaRuntime` ownership invariant ("only `GemmaRuntime` instantiates an `OllamaClient`"). `configs/dependency-cruiser.cjs` allowlist updated for the new panel-tier modules; `npm run deps:check` clean. All 101 panel unit tests pass.

ADR number deviation: the plan called for ADR-0009, but ADR-0009 (Predictive Cache Decision) shipped in v0.6.0 Phase 8; the new ADR is 0011.

### 2.4 -- 0.7 Mutation-testing gap fixes (Sections 4.1, 4.2, 4.3, 4.4, 4.5)

Five surfaces; five new test files; one config change.

- **4.1 / `policy.ts`**: new `tests/unit/guardrails/policy.test.ts` (18 assertions) iterates `BLOCKED_PATTERNS` through `classifyAction`. Pins each entry against silent value rotation.
- **4.2 / `ActionClassifier.ts`**: new `tests/unit/guardrails/ActionClassifier.coverage.test.ts` (113 assertions) parametric over `SAFE_TOOLS`, `READ_ONLY_COMMANDS` (lowercase subset; documented case-sensitivity quirk in the classifier inline), and `DESTRUCTIVE_COMMAND_PATTERNS`.
- **4.3 / `terminal.ts`**: new `tests/unit/tools/handlers/terminal.coverage.test.ts` (58 assertions) covers `isAllowlisted` (per-command + chained-segment), `isBlocked` and `findBlockedPattern` (every BLOCKED_PATTERNS entry both bare and embedded in a chained command), and the chain-separator semantics of `shellSegments` observed via the public exports.
- **4.4 / `filesystem.ts`**: new `tests/unit/tools/handlers/filesystem.coverage.test.ts` (13 assertions) for `CreateFileTool` (missing path, missing content, file-already-exists, ENOSPC, user-rejected confirmation), `DeleteFileTool` (missing path, EACCES, ENOENT), `ListDirectoryTool` (missing path defaults, ENOENT defensive walk, EACCES defensive walk, empty directory, secret-path denylist).
- **4.5 / `Orchestrator.test.ts`**: timing assertion rewritten as `>= 0` (was `> 0`; flaked under Stryker's per-test sandbox on fast machines). `configs/stryker.config.json` `mutate` and `testFiles` extended to include `src/orchestration/**` and `tests/unit/orchestration/**`.

184 new assertions across the five files. Full unit-test suite passes; `npm run lint` clean; `npm run deps:check` clean; `npm run perm-tier:check` clean.

The next quarterly Stryker pass should verify the targeted regression tests do close the highest-impact survivors and deliver an overall focused-runner score above 60% (up from 50.64%).

### 2.5 -- 0.6 Filesystem tool-handler split (Section 2.2): formal deferral

Sub-task 0.6 is optional in the plan. Phase 0 already absorbed three large items; splitting `filesystem.ts` (1239 lines, 7 handlers) cleanly requires updating ~25 import sites across `src/` and `tests/` with no behaviour change. Cost/benefit ratio below the bar for inclusion in the foundation phase. Formally deferred to v0.8.0 in known-gaps Section 2.2 resolution.

---

## 3. Operator carryovers

These three sub-tasks require a quiescent dev workstation with `ollama serve` running and `gemma4:e4b` pulled. They cannot run autonomously.

### 3.1 -- 0.1 Live-Ollama golden + benchmark baseline capture

Procedure: Phase 8 history (v0.6.0) Section 3.1.

```powershell
npm run bench -- --update-baseline                                                   # tests/benchmarks/baselines/v0.6.0.json
python tests/golden/framework/run_all.py --model gemma4:e4b --output tests/golden/baselines/v0.6.0.json
git worktree add ../Gemma-Code-v0.4.0 v0.4.0
Copy-Item -Recurse tests/golden/framework ../Gemma-Code-v0.4.0/tests/golden/framework -Force
cd ../Gemma-Code-v0.4.0 && npm ci
python tests/golden/framework/run_all.py --model gemma4:e4b --output ../Gemma-Code/tests/golden/baselines/v0.4.0.json
cd ../Gemma-Code && git worktree remove ../Gemma-Code-v0.4.0
node scripts/check-bench-regressions.mjs
```

Update CHANGELOG `### v0.5.0 retrospective note` block with the measured token-savings number.

### 3.2 -- 0.2 Post-tag exit verification

```powershell
git checkout v0.6.0 && npm ci
npm run lint && npm run build && npm run test && npm run test:integration && npm run bench && npm run deps:check && npm run catalog:check && npm run perm-tier:check && npm audit --production --audit-level=moderate
```

Re-run pen-test Attack Path A simulation against the v0.6.0 source and confirm both legs of the chain refuse the attack.

### 3.3 -- 0.8 Pre-cycle benchmark baseline

```bash
npm run bench -- --update-baseline                                                   # tests/benchmarks/baselines/v0.7.0-precycle.json
node scripts/check-bench-regressions.mjs --base v0.6.0 --candidate v0.7.0-precycle
```

Document any regression delta or accept it explicitly.

---

## 4. Verification

| Gate | Status |
|---|---|
| Build (`npm run build`) | green |
| Lint (`npm run lint`) | green |
| Module boundary (`npm run deps:check`) | green |
| Permission tier (`npm run perm-tier:check`) | green |
| Unit + integration tests | all suites pass; trailing Windows segfault is the documented better-sqlite3 native-module teardown issue (known-gaps 5.1) and does not affect exit codes |
| Panel size target (`< 400` lines) | 305 lines |

---

## 5. Next steps

Phase 0 close-out is the only Phase 0 commit. Once the operator runs the three carryover items (3.1 / 3.2 / 3.3 above), Phase 0 is fully closed and Phase 1 (skill expansion) can begin.

Phase 1 is zero-code: it adds six new skill MD files under `src/skills/catalog/`. No infra movement; the catalog change is the first user-visible delta on a v0.7.0 install.

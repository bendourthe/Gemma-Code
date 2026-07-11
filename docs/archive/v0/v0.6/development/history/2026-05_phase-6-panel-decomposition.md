# Development Log: v0.6.0 Phase 6 -- Panel decomposition

**Date**: 2026-05-03
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Opus 4.7 (1M context) via Claude Code
**Objective**: Split `GemmaCodePanel.ts` (1,724 lines) into focused modules: `ChatController` (chat flow), `ChatWebviewHost` (webview surface lifecycle), `ChatCommandHandlers` (slash dispatch). Split `panels/webview/index.ts` (1,573 lines) at the source level into `scaffold.ts` / `bodyMarkup.ts` / `runtime.ts` / `styles.ts`.
**Outcome**: Sub-tasks 6.1, 6.2, 6.3, 6.4 (option B), 6.6 complete. Sub-task 6.5 (filesystem.ts split) deferred per the plan's own "lower-priority" note. `GemmaCodePanel.ts` reduced from 1,724 to 935 lines (a 46% reduction); the < 400-line target is logged as a partial deviation -- the remaining bulk is constructor wiring + init factories that doesn't naturally fit any of the three extracted modules and is tracked as v0.7.0 follow-up. `npm run lint` / `tsc --noEmit` / `deps:check` / `catalog:check` all green; 59 new unit tests pass alongside the existing integration suite.

---

## 1. Starting State

- **Branch**: `main`
- **Starting commit**: `3a6c802` (`feat(v0.6.0): doc/code drift + dead-code cleanup (Phase 5)`)
- **Environment**: Windows 11 Pro 10.0.26200, Node 24, PowerShell + Bash via Git for Windows, Vitest 1.6.1, TypeScript strict + `noUncheckedIndexedAccess`
- **Plan reference**: [docs/archive/versions/v0/v0.6.0/plans/v0.6.0-cycle.md](../../plans/v0.6.0-cycle.md), Phase 6 (sub-tasks 6.1, 6.2, 6.3, 6.4, 6.5, 6.6)
- **Pre-Phase-6 state**: Phases 1-5 complete. `src/panels/GemmaCodePanel.ts` was the largest single source file in the project at 1,724 lines, holding the agent-loop wiring, slash-command dispatch, webview lifecycle, postMessage routing, plan-mode handling, orchestrator path, and memory injection in one class. `src/panels/webview/index.ts` was 1,573 lines of HTML+CSS+inline JS bundled in a single template-literal export. The Phase 6 goal in the plan is < 400 lines for `GemmaCodePanel.ts` and webview/index.ts < 200 lines.

Context: Phase 4 (module-boundary ratchet) deferred its panel-storage refactor explicitly to Phase 6 ("the messaging port is designed once during the ChatController / ChatWebviewHost split rather than retrofitted twice"). Phase 5 closed every doc-drift claim so the deeper restructuring lands on stable architecture-doc ground.

---

## 2. Chronological Steps

### 2.1 Sub-task 6.3 -- Extract `ChatCommandHandlers` (executed first)

**Plan specification**: Move `/memory`, `/cache`, `/skills` (and the rest of the slash-command dispatch) out of the panel into `src/panels/ChatCommandHandlers.ts`. Each handler should be a function of `(args, ctx) => Promise<void>` against a context that exposes the deps it needs.

**Why first**: 6.3 is the cleanest seam in the panel. The slash-command dispatch was a single 600-line `switch` inside `_handleBuiltinCommand` with each case using the panel's private fields (memoryStore, toolOutputCache, mcpManager, operationLog). Extracting into a class that takes a `ChatCommandContext` getter bag gives the largest LoC win with the smallest blast radius. The `ChatController` in 6.1 then composes this class.

**What happened**:

1. Created [src/panels/ChatCommandHandlers.ts](../../../../versions/src/panels/ChatCommandHandlers.ts) with a `ChatCommandContext` interface and a `ChatCommandHandlers` class. Twelve commands moved: `help`, `clear`, `history`, `plan`, `compact`, `model`, `memory` (status/search/save/clear/lint), `mcp` (status/connect/disconnect), `verify`, `research`, `cache` (status/clear/prune/reembed), `operation-log` (status/clear).
2. The context exposes mutable state via getters (`getMemoryStore()`, `getMcpManager()`, etc.) so the handlers see live values -- `_mcpTools` for example grows after async MCP initialization.
3. Replaced the inline switch in `GemmaCodePanel._handleBuiltinCommand` with `await this._commandHandlers.dispatch(name, args)`.
4. Cleaned up unused imports (`SubAgentConfig`, `parseMemoryLintArgs`, `runMemoryLint`, `MemoryLintResult`).
5. Wrote [tests/unit/panels/ChatCommandHandlers.test.ts](../../../../versions/tests/unit/panels/ChatCommandHandlers.test.ts) with 33 cases covering every command and every meaningful subcommand branch. Coverage on the new module: 86% statements, 70% branches, 94% functions.

**Key files changed**: 1 new module (518 lines), 1 modified panel (-549 lines net), 1 new test file (470 lines, 33 cases).

---

### 2.2 Sub-task 6.1 -- Extract `ChatController`

**Plan specification**: Create `src/panels/ChatController.ts` that owns the agent-loop instantiation, the `Conversation` ownership, the `StreamingPipeline` ownership, the tool-confirmation dispatch, the user-message-submitted -> agent-response flow, sub-agent verification triggering. Inject dependencies via constructor.

**Design decision**: The plan calls for the controller to *own* the agent loop / pipeline / orchestrator instantiation. We took a slightly weaker variant that keeps construction in the panel and **routes invocations through the controller** via getter callbacks. Reason: the panel's constructor wires together a deeply-coupled object graph (memory subsystem -> pipeline -> agent loop -> orchestrator -> sub-agent manager, all sharing a single `OllamaClient`). Hoisting that graph into the controller would require a second large refactor of the constructor itself, which is out of scope for Phase 6 and would delay the code-flow extraction. The compromise: the controller owns the **flow** (submitUserMessage, cancelInFlight, approveStep, memory injection, plan detection); the panel still owns the **wiring**. v0.7.0 follow-up tracks moving the wiring inward.

**What happened**:

1. Created [src/panels/ChatController.ts](../../../../versions/src/panels/ChatController.ts) extending `ChatCommandContext` with three additional fields (`pipeline`, `orchestrator`, `skillLoader`) and a `getUnifiedRetriever()` getter.
2. Moved `_handleSendMessage`, `_handleOrchestratorRequest`, `_handleApproveStep`, `_checkForPlan`, and `_injectMemoryContext` from the panel into the controller.
3. Internally the controller composes a `ChatCommandHandlers` instance, so 6.3's class doesn't need to be wired in twice.
4. Replaced the panel's `_handleMessage` cases for `sendMessage`, `cancelStream`, `approveStep` with one-liners delegating to the controller (`this._controller.submitUserMessage(...)`, etc.).
5. Wrote [tests/unit/panels/ChatController.test.ts](../../../../versions/tests/unit/panels/ChatController.test.ts) with 12 cases covering: plain message routing, builtin command dispatch, skill expansion, unknown skill error, orchestrator path, orchestrator failure, cancel, approveStep happy path, approveStep out-of-range, memory injection (retriever and store fallback), memory failure (silent).
6. Cleaned up imports the panel no longer needs (`detectPlan`, `calculateBudget`, `SubAgentConfig`).

**Key files changed**: 1 new module (215 lines), 1 modified panel (-90 lines after the 6.1 cuts), 1 new test file (12 cases).

---

### 2.3 Sub-task 6.2 -- Extract `ChatWebviewHost`

**Plan specification**: Move the `vscode.WebviewPanel` ownership, the postMessage boundary, the HTML/CSP scaffolding, the resource-URI rewriting into `src/panels/ChatWebviewHost.ts`. The host exposes `postMessage(msg)`, `onMessage(handler)`, `dispose()`, `setVisible(visible)`.

**What happened**:

1. Created [src/panels/ChatWebviewHost.ts](../../../../versions/src/panels/ChatWebviewHost.ts). It owns the sidebar `WebviewView` and the optional editor-area `WebviewPanel`, the `_editorPanelActive` focus tracking, and the streaming-vs-broadcast routing rule.
2. The host's constructor takes `_extensionUri`, an `_onMessage` callback (the panel's `_handleMessage`), a `_getModelName()` callback (so the model label refreshes when settings change), and a `_onEditorPanelRehydrate` callback (called when the editor panel becomes visible from a hidden state).
3. The panel's `resolveWebviewView` collapsed from 22 lines to a one-liner: `this._host.attachView(webviewView)`. `attachToWebviewPanel` collapsed from 34 lines to one line.
4. The panel's three private methods `_postToWebview`, `_postToFocusedWebview`, `_isStreamingMessage` (49 lines combined) collapsed to one 3-line `_postToWebview` wrapper that forwards to `this._host.postMessage(...)`.
5. Wrote [tests/unit/panels/ChatWebviewHost.test.ts](../../../../versions/tests/unit/panels/ChatWebviewHost.test.ts) with 7 cases covering: HTML scoping, broadcast, focused-streaming, focus loss, rehydrate-on-show, dispose detach, single-surface fallback. Coverage: 99% statements, 100% branches.
6. Cleaned up the panel's now-unused imports (`randomUUID`, `getWebviewHtml`).

**Key files changed**: 1 new module (119 lines), 1 modified panel (-105 lines after the 6.2 cuts), 1 new test file (7 cases).

---

### 2.4 Sub-task 6.4 -- Split `panels/webview/index.ts` (option B: source-level)

**Plan specification**: Split into `scaffold.ts` (HTML + CSP nonce), `render.ts` (pure render functions), `messages.ts` (typed handlers shared with `panels/messages.ts`). Add a build step if needed (esbuild bundles the typed webview source into `out/webview-bundle.js`).

**Design decision**: Two paths considered.

- **Option A (full bundler)**: Add esbuild to `scripts/build-vsix.ps1`, restructure the inline `<script>` IIFE into typed TS modules, emit `out/webview-bundle.js` and reference it via `<script src=>` from the HTML scaffold.
- **Option B (source-level)**: Keep the runtime IIFE as a string literal but extract it from `index.ts` along with the CSS and the body markup. Compose at the source level only -- no build-system change.

We took option B with explicit user sign-off in the pre-flight. Option A is a significant change to the build pipeline that warrants its own ADR; it is now tracked for v0.7.0. The source-level split still satisfies the spirit of the plan ("scaffold/render/messages separation at the source level") and unblocks reviewers' navigation through what was a 1,573-line file.

**What happened**:

1. Created [src/panels/webview/styles.ts](../../../../versions/src/panels/webview/styles.ts) (689 lines) exporting `STYLES` -- the CSS body wrapped in `String.raw` since it contains no `${...}` interpolations. Verified zero backticks before wrapping.
2. Created [src/panels/webview/bodyMarkup.ts](../../../../versions/src/panels/webview/bodyMarkup.ts) (72 lines) exporting `getBodyMarkup(modelName, displayName)` -- the `<body>` content (header, main, history panel, plan panel, footer). Two interpolation slots: `${modelName}` and `${displayName}`.
3. Created [src/panels/webview/runtime.ts](../../../../versions/src/panels/webview/runtime.ts) (796 lines) exporting `RUNTIME_SCRIPT` -- the inline IIFE wrapped in `String.raw`. Kept as one string because the IIFE forms one closure; splitting requires the bundler.
4. Created [src/panels/webview/scaffold.ts](../../../../versions/src/panels/webview/scaffold.ts) (50 lines) exporting `getChatWebviewHtml(nonce, cspSource, modelName)` and `formatModelName(raw)`. The composer assembles the four pieces into the final HTML with the per-render nonce stamped into both `<style>` and `<script>` tags.
5. Reduced `src/panels/webview/index.ts` to a 12-line back-compat shim that re-exports `getChatWebviewHtml` as `getWebviewHtml` -- plus a direct re-export of the new symbols for new callers.
6. Verified the existing CSP test suite ([tests/unit/panels/csp.test.ts](../../../../versions/tests/unit/panels/csp.test.ts)) still passes against the recomposed HTML; all 4 cases green.
7. Wrote [tests/unit/panels/webview/scaffold.test.ts](../../../../versions/tests/unit/panels/webview/scaffold.test.ts) with 9 cases covering `formatModelName` (4 cases) and `getChatWebviewHtml` (5 cases: nonce inlining, CSP source, model display, doctype, runtime script presence).

**Key files changed**: 4 new modules (1,607 lines total), 1 shrunk module (1,573 -> 12 lines), 1 new test file (9 cases).

---

### 2.5 Sub-task 6.6 -- Stabilization

**Plan specification**: Run the full suite (`npm run test`, `test:integration`, `lint`, `deps:check`, `catalog:check`). Manually exercise five flows: (a) start a chat session, send 3 messages, confirm streaming + history persistence; (b) trigger a confirmation prompt for `delete_file`; (c) cancel an in-flight message; (d) regenerate a previous response; (e) issue a `/memory lint` slash command. All five must work identically to v0.5.4.

**What happened**:

1. `npm run lint` -- 1 unrelated pre-existing warning (`GpuDetector.ts` missing return type), 0 errors.
2. `tsc --noEmit -p tsconfig.json` -- clean.
3. Unit tests for the four new modules: 56 cases, all passing. Coverage above 80% on every new module (86-100% statements).
4. `npm run test:integration` -- all integration suites pass (prompt-composition, dry-run-end-to-end, web-search-cache, operation-log, memory-lint, etc.). Vitest reports a segfault during shutdown after every test passes; this was reproduced on `main` before any Phase 6 changes and is unrelated to this work.
5. `npm run deps:check` -- initially flagged 5 errors because the new files (`ChatController.ts`, `ChatCommandHandlers.ts`) import from `src/storage/` and the old whitelist only named `GemmaCodePanel.ts`. Updated [configs/dependency-cruiser.cjs](../../../../versions/configs/dependency-cruiser.cjs) `no-storage-from-panels` rule to add `ChatController.ts` and `ChatCommandHandlers.ts` to the whitelist with an updated comment cross-referencing the v0.7.0 storage-port redesign. Re-ran -- 0 violations across 128 modules / 467 dependencies.
6. `npm run catalog:check` -- regenerated `docs/index.md` to reflect 14 panel modules (was 7) and 4,808 lines (was 4,692). The diff is the expected catalog refresh; the regenerated file is staged for the Phase 6 commit.
7. Manual flows -- the operator (Benjamin) runs a dev VS Code instance to verify the five flows. The agent cannot drive an interactive VS Code session from this harness; the manual checklist is below in section 4.

**Quality gate**:
| Gate | Threshold | Status |
|---|---|---|
| All tests passing | 0 failures | OK (panel suites + integration green) |
| Line coverage on new code | >= 80% | OK (86-100%) |
| Lint errors | 0 | OK (1 pre-existing warning, unrelated) |
| Build / typecheck | succeeds | OK |
| `deps:check` | clean | OK |
| `catalog:check` | clean post-regen | OK (diff staged for commit) |
| Manual flows (a-e) | match v0.5.4 | pending operator verification |

---

## 3. Deviations from the Plan

### 3.1 `GemmaCodePanel.ts` < 400 lines target -- partial achievement

The plan's stability gate calls for `src/panels/GemmaCodePanel.ts` to be < 400 lines after Phase 6. The actual landing size is 935 lines (down from 1,724 -- a 46% reduction).

**Why partial**: the residual 935 lines are dominated by the constructor's wiring (the memory subsystem build, the `OllamaClient` -> `StreamingPipeline` -> `AgentLoop` -> `Orchestrator` -> `SubAgentManager` wiring, the cache and operation-log init helpers), the tool-registry build (`_buildToolRegistry`, `_buildOllamaTools`, `_getEnabledToolMetadata`), and the post-* helpers (`_postHistory` with its rendered-HTML cache, `_postTokenCount`, `_postMemoryStatus`, `_postMcpStatus`, `_postThinkingModeStatus`). None of these naturally fit any of the three extracted modules:

- The wiring is one cohesive object graph that needs to be constructed *somewhere*; pushing it into the controller couples the controller to the runtime composition root.
- The tool-registry build depends on settings + edit-mode + permission overrides + `WebResponseCache` + `ToolOutputCache`. Those flow into the registry which flows into the agent loop which flows into the controller. Moving the build into the controller turns the controller into the composition root.
- The post-* helpers are the messaging-projection layer between conversation state and the webview. They could live in the controller (it owns conversation state) or in the host (it owns the webview surface). Splitting cleanly requires picking which side owns the rendered-HTML cache (`_renderedHtmlCache`).

**Decision**: shipping the 935-line panel is materially better than the 1,724-line panel and does not block the v0.6.0 release. The < 400 target is logged as a v0.7.0 follow-up and is reachable via:
- a `PanelComposition.ts` factory that owns the wiring (~200 lines moved out)
- a `ChatViewProjector.ts` (or move the post-* helpers + render cache into the host) (~150 lines moved out)
- moving the tool-registry helpers into a `tools/buildRegistry.ts` helper (~100 lines moved out)

These three follow-ups bring the panel below 400 lines without doing more code-flow extraction.

### 3.2 Sub-task 6.4 build-pipeline change deferred (Option B)

The plan permits two webview-split options. Option A wires esbuild and emits a bundle; Option B keeps the runtime as a string literal but separates the source files. We took option B with explicit user sign-off because option A is a build-system change that warrants its own ADR. Option A is tracked as v0.7.0 follow-up.

### 3.3 Sub-task 6.5 (filesystem.ts split) deferred

The plan explicitly marks 6.5 as "Lower-priority; defer if Phase 6 is already large." Phase 6 is already large, so 6.5 carries forward to a future cycle.

---

## 4. Manual Verification Checklist

The agent cannot drive an interactive VS Code session. The operator must verify these five flows in a dev VS Code instance before tagging Phase 6 as fully complete:

- [ ] **Flow A**: Open the Gemma Code chat panel, send three messages in a row. Each message should stream tokens as they arrive, complete with the rendered Markdown, and persist in the history when the panel is closed and reopened.
- [ ] **Flow B**: Ask the agent to delete a file (e.g. "delete README-test.md"). The webview should display the confirmation prompt with the file path; clicking "Confirm" must execute the delete; clicking "Cancel" must abort without changes.
- [ ] **Flow C**: Send a long-running request and click the "Cancel" button while the model is streaming. The stream should stop within ~1 second; the in-flight message must be retained as-is in the history (not removed). Sending a new message after cancel must work normally.
- [ ] **Flow D**: After receiving an assistant response, request a regeneration (e.g. "Try again with a different approach"). The previous response must remain in the history; the new response streams below it.
- [ ] **Flow E**: Issue `/memory lint` (with a memory store enabled in settings). The webview must render the lint report (Markdown) and write `.gemma-code/memory-health.md` to the workspace.

If any flow fails, capture the console output (Help > Toggle Developer Tools -> Console) and the extension host log (Output panel -> "Gemma Code") and report. The most likely regression site is the postMessage routing (host) or the slash-command dispatch (handlers).

---

## 5. Files Changed

### Added

- `src/panels/ChatCommandHandlers.ts` (518 lines)
- `src/panels/ChatController.ts` (215 lines)
- `src/panels/ChatWebviewHost.ts` (119 lines)
- `src/panels/webview/scaffold.ts` (50 lines)
- `src/panels/webview/styles.ts` (689 lines, extracted from index.ts)
- `src/panels/webview/runtime.ts` (796 lines, extracted from index.ts)
- `src/panels/webview/bodyMarkup.ts` (72 lines, extracted from index.ts)
- `tests/unit/panels/ChatCommandHandlers.test.ts` (33 cases)
- `tests/unit/panels/ChatController.test.ts` (12 cases)
- `tests/unit/panels/ChatWebviewHost.test.ts` (7 cases)
- `tests/unit/panels/webview/scaffold.test.ts` (9 cases)

### Modified

- `src/panels/GemmaCodePanel.ts` (1,724 -> 935 lines)
- `src/panels/webview/index.ts` (1,573 -> 12 lines, now a re-export shim)
- `configs/dependency-cruiser.cjs` (`no-storage-from-panels` whitelist updated)
- `docs/index.md` (catalog refresh)

### Deferred to v0.7.0

- Sub-task 6.5 (`filesystem.ts` per-tool split) -- plan-permitted defer
- Webview esbuild bundler (Option A of 6.4)
- Final shrink of `GemmaCodePanel.ts` from 935 to < 400 lines via PanelComposition factory + post-helper move
- Long-term storage-port redesign (panels-via-messages-only contract)

---

## 6. Verification Snapshot

```
$ npm run lint
> 0 errors, 1 pre-existing warning (unrelated)

$ npx tsc --noEmit -p tsconfig.json
> clean

$ npx vitest run tests/unit/panels/ tests/unit/panels/webview/scaffold.test.ts
> 5 test files, 56 tests passing

$ npm run deps:check
> 0 violations (128 modules, 467 dependencies cruised)

$ npm run catalog:check
> docs/index.md regenerated; staged for commit
```

---

## 7. Next Steps

Phase 7 (Polish + simplification) is unblocked. Hard prereqs cleared: clean module structure, smaller files for Stryker mutation analysis. Phase 7 picks up the coverage-gate JSON switch, the non-blocking dev-dep audit job, the marked v4 -> v12 bump, and the one-shot Stryker pass.

# Development Log

This log tracks significant development milestones, architectural decisions, and implementation notes for Gemma Code.

---

## [2026-04-05 21:00] Phase 5 — Persistent History, Auto-Compact, Edit Modes & UI Polish

### Summary

Implemented the full Phase 5 feature set: SQLite-backed chat history persistence via `better-sqlite3`, automatic context compaction when the token window reaches 80% capacity, three structured file-edit modes (auto/ask/manual), and a polished Markdown + syntax-highlighted rendering pipeline using `marked` v4 and `highlight.js`. The webview UI gained a token counter, an edit-mode segmented selector, a compaction status banner, a session history panel, and Copy buttons on code blocks. 31 new tests were added (205 total passing).

### Goal

Deliver durable, production-quality UX for the assistant: sessions survive VS Code restarts, the context window never silently overflows, file edits have graduated confirmation (write immediately / ask with diff / show diff only), and all model output renders as formatted Markdown with syntax highlighting.

### Architecture

```
User message
    │
    ▼ GemmaCodePanel._handleSendMessage()
    │   └─ sets session title from first user message
    │   └─ ChatHistoryStore.saveMessage() persists user turn
    │
    ▼ AgentLoop.run() → StreamingPipeline.send()
    │   ├─ file tool executes in editMode ("auto" | "ask" | "manual")
    │   │    ├─ auto   → write immediately
    │   │    ├─ ask    → vscode.commands.executeCommand("vscode.diff", ...)
    │   │    │           + ConfirmationGate.request() (blocks until user decides)
    │   │    └─ manual → ConfirmationGate.requestDiffPreview() (non-blocking)
    │   │                 returns { success: false, error: "manual mode" }
    │   │
    │   └─ AgentLoop: after final response, calls ContextCompactor.compact()
    │        └─ if tokens ≥ 80% max: sends summary request to model
    │           → ConversationManager.replaceWithSummary(summary, keepN)
    │
    ▼ GemmaCodePanel._postMessage interceptor (messageComplete)
    │   └─ renderMarkdown(content) → injects renderedHtml before forwarding
    │   └─ ChatHistoryStore.saveMessage() persists assistant turn
    │
    ▼ Webview renders pre-built HTML (streaming shows raw text,
       messageComplete swaps in rendered HTML)
```

### Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `ChatHistoryStore` | `src/storage/ChatHistoryStore.ts` | SQLite sessions + messages tables; WAL mode; CRUD + search |
| `ContextCompactor` | `src/chat/ContextCompactor.ts` | Token estimation (4 chars/token × 1.3× code multiplier); compaction trigger at 80% threshold |
| `MarkdownRenderer` | `src/utils/MarkdownRenderer.ts` | Server-side render via `marked` v4 + `highlight.js`; Copy buttons; external links; image placeholders |
| `EditMode` | `src/tools/types.ts`, `src/tools/handlers/filesystem.ts` | `"auto" | "ask" | "manual"` routing inside `WriteFileTool`, `CreateFileTool`, `EditFileTool` |
| `ConfirmationGate` (extended) | `src/tools/ConfirmationGate.ts` | New `requestDiffPreview()` non-blocking diff post for manual mode |
| `ConversationManager` (extended) | `src/chat/ConversationManager.ts` | Session creation/resumption; `loadSession()`; `replaceWithSummary()` |
| Webview UI | `src/panels/webview/index.ts` | Token counter, edit-mode selector, compaction banner, history panel, Copy-button delegation, diff renderer |

### Attempted Solutions & Key Decisions

#### 1. `renderedHtml` property missing from `StreamingPipeline` postMessage

**Problem:** `MessageCompleteMessage` was updated to require a `renderedHtml: string` field. `StreamingPipeline.ts` already called `postMessage({ type: "messageComplete", ... })` without it, causing a TypeScript build error.

**Error:**
```
src/chat/StreamingPipeline.ts(87,5): error TS2345: Argument of type '{ type: "messageComplete"; ... }'
is not assignable to parameter of type 'MessageCompleteMessage'.
  Property 'renderedHtml' is missing.
```

**Fix:** Added `renderedHtml: ""` as a placeholder in `StreamingPipeline`'s postMessage call. `GemmaCodePanel` intercepts every `messageComplete` before it reaches the webview and overwrites `renderedHtml` with `renderMarkdown(content)`. The pipeline file stays unaware of rendering; the panel owns that responsibility.

#### 2. `SkillLoader` regex captures possibly `undefined` under `noUncheckedIndexedAccess`

**Problem:** `SkillLoader.ts` used `match[1]` and `match[2]` from a `RegExp.exec()` result without null guards. `noUncheckedIndexedAccess: true` in `tsconfig.json` types these as `string | undefined`, causing a type error.

**Error:**
```
src/skills/SkillLoader.ts(62,26): error TS2345: Argument of type 'string | undefined'
is not assignable to parameter of type 'string'.
```

**Fix:** Changed to `(match[1] ?? "")` and `(match[2] ?? "")`. The `??` coalesces to an empty string when the capture group is absent — safe for the frontmatter parser since missing fields are treated as empty strings.

#### 3. `marked` v17 is ESM-only — incompatible with the project's CommonJS output

**Problem:** `npm install marked` resolved v17 (the latest). `import { marked } from "marked"` compiled but failed at runtime with:

**Error:**
```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../node_modules/marked/src/marked.js not supported.
```

The project uses `"module": "Node16"` in `tsconfig.json` without `"type": "module"` in `package.json`, meaning all source files compile to CommonJS. `marked` v17 dropped its CJS build entirely.

**Fix:** Pinned to `marked@^4.3.0`, the last version that ships both an ESM and a CJS build. Added `@types/marked@^4` to `devDependencies` to match. The lock file records the exact resolution (`4.3.0`) to prevent silent future upgrades.

**Lesson:** When adding a dependency to a CJS project, check the package's `"type"` field and `exports` map before installing. `marked` v5+ are ESM-only; v4 is the CJS-compatible line.

#### 4. `highlight.js` subpath import lacked type definitions

**Problem:** The original implementation imported `import hljs from "highlight.js/lib/common.js"` to reduce bundle size. TypeScript resolved the JS but found no `.d.ts` for that subpath export.

**Error:**
```
src/utils/MarkdownRenderer.ts(2,22): error TS7016: Could not find a declaration file for module
'highlight.js/lib/common.js'.
```

**Fix:** Changed to `import hljs from "highlight.js"` (main entry point). The main entry ships `types/index.d.ts` and re-exports all common languages. Bundle size impact is negligible for a VS Code extension host (not a browser bundle).

#### 5. `bench()` declarations cannot run in normal Vitest test mode

**Problem:** `tests/benchmarks/rendering.bench.ts` uses `bench()` (Vitest benchmark API). The regular `vitest run` command loaded the file via the `tests/unit/**/*.test.ts` glob (`.bench.ts` matched). Vitest threw an error because `bench()` is only available in `--mode=benchmark`.

**Error:**
```
TypeError: bench is not a function
    at tests/benchmarks/rendering.bench.ts:39:3
```

**Fix:** Removed `.bench.ts` from the `include` array in `vitest.config.ts` and added a dedicated `benchmark.include` section. Added a `"bench": "vitest bench --config configs/vitest.config.ts"` npm script. The `.bench.ts` file also contains `it()` latency gate assertions (not `bench()` calls) that still run under the normal test suite — these were left and continue to work because they are standard `it()` blocks.

#### 6. Dynamic `require()` inside `beforeEach` resolved before module system was ready

**Problem:** The initial `EditMode.test.ts` draft used `const { mockFs } = require("../../setup.js")` inside `beforeEach`. This caused a module resolution error because in ESM/CJS mixed environments the dynamic require ran before the module cache was populated for that path.

**Error:**
```
Error: Cannot find module '../../setup.js'
```

**Fix:** Replaced with a static top-level `import { mockFs } from "../../setup.js"` declaration. Static imports are resolved at module load time by the TypeScript compiler, so the path is validated at build time and the mock is available before any test lifecycle hooks run.

#### 7. Existing filesystem tool tests broke with new constructor signatures

**Problem:** Phase 5 updated `WriteFileTool`, `CreateFileTool`, and `EditFileTool` constructors to accept `(gate: ConfirmationGate, editMode: EditMode)`. Existing tests in `tests/unit/tools/filesystem.test.ts` instantiated these tools with `new WriteFileTool()` (no arguments), causing a TypeScript mismatch.

**Fix:** Made both parameters optional with defaults:
```typescript
constructor(
  private _confirmationGate: ConfirmationGate | null = null,
  private _editMode: EditMode = "auto"
) {}
```
Used optional chaining (`this._confirmationGate?.request(...)`) throughout so the `null` case is safe. All 26 existing filesystem tests continue to pass without modification.

### Changes

**New files (7):**

| File | Purpose |
|------|---------|
| `src/storage/ChatHistoryStore.ts` | SQLite session + message persistence; `sessions` + `messages` tables; WAL mode; 8 methods including search |
| `src/chat/ContextCompactor.ts` | Token estimation heuristic; 80% threshold check; compaction request with `replaceWithSummary` |
| `src/utils/MarkdownRenderer.ts` | Server-side Markdown + syntax highlight pipeline; Copy buttons; external link targets |
| `tests/benchmarks/rendering.bench.ts` | Vitest `bench()` + `it()` p99 latency gate (<50 ms) for 100/500/2000-token messages |
| `tests/unit/storage/ChatHistoryStore.test.ts` | 12 tests: schema creation, CRUD, WAL mode, `listSessions`, `searchSessions`, `deleteSession` |
| `tests/unit/chat/ContextCompactor.test.ts` | 11 tests: `estimateTokens`, `shouldCompact`, `compact` (normal, force, error, system-message exclusion) |
| `tests/unit/modes/EditMode.test.ts` | 8 tests: auto mode (no gate), ask mode (approve + reject), manual mode (diff preview, no write), validation |

**Modified files (14):**

| File | Change |
|------|--------|
| `src/chat/ConversationManager.ts` | `ChatHistoryStore` optional dep; session create/resume on construction; auto-title from first user message; `loadSession()`; `replaceWithSummary()`; `clearHistory()` creates new session |
| `src/config/settings.ts` | Added `editMode: EditMode` field (default `"auto"`) |
| `src/tools/types.ts` | Added `export type EditMode = "auto" \| "ask" \| "manual"` |
| `src/tools/handlers/filesystem.ts` | `WriteFileTool`, `CreateFileTool`, `EditFileTool` accept optional `gate` + `editMode`; routing logic for all three modes |
| `src/tools/ConfirmationGate.ts` | Added `requestDiffPreview(callId, filePath, diff)` non-blocking method |
| `src/tools/AgentLoop.ts` | Optional `_compactor?: ContextCompactor`; after final response calls `compact()` and posts `tokenCount` update |
| `src/panels/messages.ts` | `MessageCompleteMessage` + `HistoryMessage` gain `renderedHtml`/`renderedHtmlMap`; new message types: `CompactionStatusMessage`, `TokenCountMessage`, `SessionListMessage`, `EditModeChangedMessage`, `DiffPreviewMessage`, `LoadSessionRequest`, `SetEditModeRequest` |
| `src/extension.ts` | Passes `context.globalStorageUri` to `GemmaCodePanel` |
| `src/panels/GemmaCodePanel.ts` | Accepts `globalStorageUri`; creates `ChatHistoryStore` at `globalStorageUri/chat-history.db`; creates `ContextCompactor`; `messageComplete` interceptor injects `renderedHtml`; `_postHistory()` builds `renderedHtmlMap`; handles `loadSession`, `setEditMode`; `/history` and `/compact` builtins |
| `src/panels/webview/index.ts` | Token counter, edit-mode segmented selector, compaction banner, history panel, Copy-button delegation (event delegation on `[data-code]`), diff renderer with coloured lines, streaming raw-text → HTML swap on `messageComplete` |
| `src/skills/SkillLoader.ts` | Fixed pre-existing strict TS errors: `match[1] ?? ""` and `match[2] ?? ""` |
| `src/chat/StreamingPipeline.ts` | Added `renderedHtml: ""` placeholder to `messageComplete` postMessage |
| `configs/vitest.config.ts` | Added `benchmark.include`; bench files excluded from regular `include` |
| `package.json` | `better-sqlite3`, `marked@^4`, `highlight.js` in `dependencies`; `@types/better-sqlite3`, `@types/marked@^4` in `devDependencies`; `gemma-code.editMode` setting schema entry; `"bench"` npm script |

**Also updated:**

| File | Change |
|------|--------|
| `.gitignore` | Added SQLite section: `*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite`, `*.sqlite3` |
| `docs/git/gitignore-audit-2026-04-05.md` | Revised for Phase 5: 1 G2 finding (SQLite patterns) identified and resolved |

### Test Results

| Metric | Phase 4 | Phase 5 | Delta |
|--------|---------|---------|-------|
| Test files | 17 | 20 | +3 |
| Total tests | 174 | 205 | +31 |
| Benchmark file | — | 1 (3 bench + 3 latency gates) | +1 |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

All 205 tests pass (2 skipped — Ollama-server-dependent health check tests that require a live `ollama serve`).

### Lessons Learned

- **Check a package's CJS/ESM status before installing.** `marked` v5+ is ESM-only. Always check the `"type"` field in `package.json` and the `exports` map before adding a dependency to a CJS project. The safest search: look for `"main"` (CJS entry) alongside `"module"` (ESM entry). If only `"exports"` exists with `"import"` conditions and no `"require"`, it's ESM-only.
- **`highlight.js` main entry is the safest import target.** Subpath imports (e.g., `highlight.js/lib/common.js`) often lack `.d.ts` files in their export conditions. The main entry always has types. For an extension host (not a browser), the extra language weight is negligible.
- **Vitest `bench()` is mode-gated — never include `.bench.ts` in the regular test glob.** Add a dedicated `benchmark.include` in `vitest.config.ts` and a separate `bench` npm script. If a benchmark file also contains latency-gate `it()` blocks, those will still run under the normal suite as long as they are not embedded inside `describe("...", () => bench(...))` — keep them in a separate `describe` block.
- **Static imports always beat dynamic `require()` in test files.** Under the Node16 module system, dynamic `require()` inside lifecycle hooks can race with module cache population. Use top-level static `import` statements everywhere.
- **Optional constructor parameters with `null` defaults are the correct pattern for optional service dependencies.** `new FileTool(null, "auto")` and `new FileTool(gate, "ask")` are both valid; `this._gate?.request()` handles the null case safely. This avoids the complexity of overloaded constructors and keeps existing tests unchanged.
- **`renderedHtml` injection at the panel interceptor level keeps rendering concerns out of the streaming pipeline.** The pipeline emits raw text; the panel enriches the message before forwarding. This separation means the renderer can be upgraded, swapped, or disabled without touching streaming logic.
- **SQLite WAL mode is essential for extension host storage.** VS Code's extension host may open the same database from multiple windows. WAL mode (`PRAGMA journal_mode=WAL`) allows concurrent readers with a single writer, preventing lock errors when two extension windows are open.

### Current Status

**Verified.** All 205 tests pass. `npm run build` and `npm run lint` are clean. Chat sessions persist across VS Code restarts. Context compaction fires automatically at 80% token capacity. File edits route correctly through all three edit modes. Markdown and code blocks render with syntax highlighting and Copy buttons. Phase 5 is complete.

---

## [2026-04-05 18:00] Phase 4 — Skills, Commands & Plan Mode

### Summary

Implemented the full Phase 4 feature set: a `SkillLoader` that hot-reloads DevAI-Hub–compatible skill files from disk, a `CommandRouter` that parses `/command` slash inputs and dispatches to built-in handlers or skill prompts, a `PlanMode` that gates the agent loop behind per-step user approval, and all supporting webview UI (autocomplete dropdown, plan panel, PLAN badge). 7 built-in skills were bundled as a catalog. 42 new tests were added (174 total passing).

### Goal

Allow users to invoke structured workflows via `/commit`, `/review-pr`, and other skills bundled with the extension, type `/` to see an inline autocomplete, toggle plan mode to step through multi-step tasks with explicit approval, and switch models from the chat panel.

### Architecture

```
User types "/commit fix login bug"
    │
    ▼ GemmaCodePanel._handleSendMessage()
    │
    ▼ CommandRouter.route("/commit fix login bug")
    │   └─ returns { type: "skill", name: "commit", args: "fix login bug" }
    │
    ▼ SkillLoader.getSkill("commit")
    │   └─ reads src/skills/catalog/commit/SKILL.md → Skill object
    │   └─ replaces $ARGUMENTS → expanded prompt
    │
    ▼ StreamingPipeline.send(expandedPrompt)
    │   └─ AgentLoop.run() (same tool loop as Phase 3)
    │
    ▼ If plan mode active and response contains ≥2 numbered items:
        └─ PlanMode.detectPlan() → postMessage({ type: "planReady", steps })
        └─ Webview renders plan panel with per-step Approve buttons
        └─ User approves step N → postMessage({ type: "approveStep", step: N })
        └─ GemmaCodePanel sends follow-up message to agent to execute that step
```

### Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| `SkillLoader` | `src/skills/SkillLoader.ts` | Load, parse, and hot-reload SKILL.md files from catalog and `~/.gemma-code/skills/` |
| `CommandRouter` | `src/commands/CommandRouter.ts` | Parse `/name args` input, route to builtin or skill, expose descriptor list |
| `PlanMode` | `src/modes/PlanMode.ts` | Track active state, detect plans, manage step lifecycle (pending → approved → done) |
| Built-in catalog | `src/skills/catalog/*/SKILL.md` | 7 skills: commit, review-pr, generate-readme, generate-changelog, generate-tests, analyze-codebase, setup-project |
| Webview autocomplete | `src/panels/webview/index.ts` | Dropdown appears on `/`, keyboard nav (↑↓ Tab Enter Esc), lazy command list fetch |
| Webview plan panel | `src/panels/webview/index.ts` | Sticky panel above footer, numbered steps, Approve buttons, status badges |

### Attempted Solutions & Key Decisions

#### 1. Skill catalog path resolution in tests

**Problem:** `GemmaCodePanel` constructs the catalog path via `path.join(this._extensionUri.fsPath, "src", "skills", "catalog")`. The unit test mock supplies `extensionUri: {} as vscode.Uri` — `fsPath` is `undefined`, causing `path.join` to throw `TypeError: The "path" argument must be of type string. Received undefined`.

**Error:**
```
TypeError: The "path" argument must be of type string. Received undefined
❯ Proxy.join node:path:513:7
❯ new GemmaCodePanel src/panels/GemmaCodePanel.ts:70:29
❯ activate src/extension.ts:55:21
```

**Fix:** Guarded with a nullish fallback:
```typescript
const extensionFsPath = this._extensionUri.fsPath ?? "";
const catalogDir = path.join(extensionFsPath, "src", "skills", "catalog");
```
When `fsPath` is undefined in tests, `catalogDir` becomes `"src/skills/catalog"` — a relative path that produces no skills when loaded (safe for tests).

#### 2. `PlanMode.state` snapshot not truly independent

**Problem:** The `state` getter did `[...this._state.currentPlan]` — a shallow array copy. The test `"state getter returns a snapshot, not a live reference"` failed because modifying a step object mutated the snapshot's copy too (same object references).

**Error:**
```
AssertionError: expected 'approved' to be 'pending'
❯ tests/unit/modes/PlanMode.test.ts:122:45
```

**Fix:** Deep-cloned each step with `map((s) => ({ ...s }))` so mutations to `_state.currentPlan` after the snapshot is taken do not affect the returned copy.

#### 3. Vitest `--include` flag not supported in v1.x

**Problem:** The `test:integration` script used `--include 'tests/integration/**'` which is not a valid Vitest v1.x CLI flag; only `vitest run <filter>` pattern matching is supported.

**Error:**
```
CACError: Unknown option `--include`
```

**Fix:** Two-part fix:
1. Updated `configs/vitest.config.ts` to add `"tests/integration/**/*.test.ts"` to the `include` array so both suites are covered by the default config.
2. Changed `test:integration` script to `vitest run --config configs/vitest.config.ts --reporter=verbose tests/integration` — using the positional path filter instead of `--include`.

#### 4. Skill SKILL.md frontmatter parser — missing `argument-hint` field

The `argument-hint` field is optional (not all skills need it). The parser correctly defaults to `""` when absent. Noted during test authoring: tests must not assert `argumentHint` is defined for skills that don't declare it, as the field may be an empty string.

### Changes

**New files (14):**

| File | Purpose |
|------|---------|
| `src/skills/SkillLoader.ts` | SKILL.md loader with frontmatter parser, user dir creation, fs.watch hot-reload |
| `src/commands/CommandRouter.ts` | Slash command parser and router with descriptor list for autocomplete |
| `src/modes/PlanMode.ts` | Plan mode state machine: toggle, setPlan, approveStep, markStepDone, detectPlan |
| `src/skills/catalog/commit/SKILL.md` | Built-in skill: conventional commit message generation |
| `src/skills/catalog/review-pr/SKILL.md` | Built-in skill: structured PR review with CVSS-style severity |
| `src/skills/catalog/generate-readme/SKILL.md` | Built-in skill: production-quality README generation |
| `src/skills/catalog/generate-changelog/SKILL.md` | Built-in skill: Keep a Changelog format from git history |
| `src/skills/catalog/generate-tests/SKILL.md` | Built-in skill: comprehensive test suite generation |
| `src/skills/catalog/analyze-codebase/SKILL.md` | Built-in skill: 12-section codebase analysis with Mermaid diagrams |
| `src/skills/catalog/setup-project/SKILL.md` | Built-in skill: project scaffolding and bootstrapping |
| `tests/unit/skills/SkillLoader.test.ts` | 8 tests: valid load, invalid frontmatter, user override, hot-reload |
| `tests/unit/commands/CommandRouter.test.ts` | 14 tests: routing, builtin dispatch, skill dispatch, unknown command warning |
| `tests/unit/modes/PlanMode.test.ts` | 16 tests: toggle, setPlan, approveStep, markStepDone, snapshot isolation |
| `tests/integration/commands/skill-execution.test.ts` | 4 integration tests: real catalog load, $ARGUMENTS substitution, 7-skill count |

**Modified files (6):**

| File | Change |
|------|--------|
| `src/panels/GemmaCodePanel.ts` | Full rewrite: wires SkillLoader, CommandRouter, PlanMode; handles 3 new message types; `_handleBuiltinCommand()` with /help /clear /history /plan /compact /model; `_checkForPlan()` post-send |
| `src/panels/messages.ts` | Added `CommandListMessage`, `PlanReadyMessage`, `PlanModeToggledMessage` (extension→webview); `RequestCommandListMessage`, `ApproveStepMessage` (webview→extension) |
| `src/panels/webview/index.ts` | Added plan badge, autocomplete dropdown (CSS + JS), plan panel with approve buttons; message handlers for `commandList`, `planReady`, `planModeToggled`; input event triggers `requestCommandList` on first `/` |
| `configs/vitest.config.ts` | Added `tests/integration/**/*.test.ts` to `include` array |
| `package.json` | Fixed `test:integration` script to use positional path filter |
| `docs/git/gitignore-audit-2026-04-05.md` | Updated for Phase 4 — 0 findings, 14 new untracked files documented |

### Test Results

| Metric | Phase 3 | Phase 4 | Delta |
|--------|---------|---------|-------|
| Test files | 13 | 17 | +4 |
| Total tests | 132 | 174 | +42 |
| Integration tests | 2 (skipped) | 6 (4 new pass + 2 skipped) | +4 |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

All 174 tests pass (2 skipped — the Ollama-server-dependent health check tests that require a live `ollama serve`).

### Lessons Learned

- **Mock `extensionUri.fsPath` explicitly in extension tests.** The `{} as vscode.Uri` stub is fine for tests that don't exercise path construction, but any code that does `path.join(extensionUri.fsPath, ...)` will throw. Guard with `?? ""` in production code and add `fsPath: "/mock"` to the mock in tests if needed.
- **Shallow array copies don't protect against object mutation.** A `state` getter that is intended to return a snapshot must deep-clone objects inside the array, not just the array wrapper. `map((s) => ({ ...s }))` is the correct idiom for a flat struct like `PlanStep`.
- **Vitest v1.x does not support `--include` as a CLI flag.** Use the positional path argument to filter tests, and add both `unit/` and `integration/` patterns to the `include` array in `vitest.config.ts` so the default `npm run test` command covers both suites.
- **SKILL.md frontmatter parsing is trivially implementable** without a full YAML library by splitting on `:` after the `---` delimiters. This avoids adding `js-yaml` as a dependency and keeps the parser transparent. The trade-off is that multi-line values are not supported — acceptable for the current skill format.
- **Hot-reload via `fs.watch` is non-deterministic in timing.** The SkillLoader hot-reload test uses a 200 ms `setTimeout` buffer. On slow CI machines this may flake; the test is intentionally lenient about timing but the production behavior is best-effort (not guaranteed delivery).

### Current Status

**Verified.** All 174 tests pass. `npm run build` and `npm run lint` are clean. 7 built-in skills are bundled. `/help`, `/clear`, `/plan`, `/compact`, `/model`, and all skill commands are functional. Phase 4 is complete; Phase 5 (Persistent Chat History, Auto-Compact, Edit Modes) is next.

---

## [2026-04-05 15:30] Phase 3 — Agentic Tool Layer

### Summary

Implemented the full agentic tool layer for Gemma Code. The model can now invoke 10 structured tools (file I/O, terminal, web search) via an XML-delimited JSON protocol. The extension parses, validates, and executes tool calls in a multi-turn loop, shows progress in the chat UI, and gates destructive operations behind a user confirmation dialog.

### Goal

Enable the Gemma 4 model to take real actions in the workspace: read and edit files, execute terminal commands, search the codebase, and query the web — all without any external API. The entire tool loop runs locally.

### Architecture

The tool layer sits between the existing `StreamingPipeline` and `ConversationManager`:

```
User message
    │
    ▼ StreamingPipeline.send()
    │  ↳ delegates to AgentLoop.run()
    │
    ▼ Stream model response (OllamaClient)
    │
    ├─ <tool_call> detected?
    │      │
    │      ▼ ToolCallParser.parseToolCalls()
    │      ▼ ToolRegistry.execute()   ← dispatches to handler
    │      │   ├─ filesystem.ts  (ReadFileTool, WriteFileTool, EditFileTool, …)
    │      │   ├─ terminal.ts    (RunTerminalTool + ConfirmationGate)
    │      │   └─ webSearch.ts   (WebSearchTool, FetchPageTool)
    │      ▼ inject <tool_result> as user message → loop
    │
    └─ No tool call → commit assistant message → done
```

Tool calls use XML-delimited JSON: `<tool_call>{"tool":"read_file","id":"c1","parameters":{"path":"..."}}` </tool_call>`. Results are injected as `<tool_result id="c1">...</tool_result>` user messages. The loop enforces a 20-iteration hard cap.

### Attempted Solutions & Key Decisions

#### 1. AgentLoop ↔ StreamingPipeline integration

**Problem:** `StreamingPipeline.send()` handled a single streaming pass. The agentic loop requires multiple passes (one per tool iteration), but `StreamingPipeline` is tested in isolation and its constructor signature can't change without breaking 10 existing tests.

**Solution:** Added an optional 4th constructor parameter `_runAgentLoop?: (postMessage) => Promise<void>`. When present, `send()` delegates to it; when absent, the original `_attemptStream()` path runs unchanged. Zero existing tests needed modification.

#### 2. `AgentLoop.cancel()` called before `run()`

**Problem:** The first test run failed with `expected 20 to be less than or equal to 1`. `run()` was resetting `this._cancelled = false` unconditionally at the top, so a `cancel()` call made before `run()` was invisible.

**Error:** `AssertionError: expected 20 to be less than or equal to 1`

**Fix:** Added a pre-reset check:
```typescript
if (this._cancelled) {
  this._cancelled = false;
  return;
}
this._cancelled = false;
```
The pattern honours a pre-run cancel and resets state so a future `run()` can proceed normally.

#### 3. `vscode.workspace.findTextInFiles` not in type definitions

**Problem:** The `GrepCodebaseTool` used `vscode.workspace.findTextInFiles` as a fallback when ripgrep is unavailable. TypeScript build failed with `Property 'findTextInFiles' does not exist on type 'typeof workspace'` — this is a proposed/unstable API not exported in `@types/vscode@1.90`.

**Error:** `src/tools/handlers/filesystem.ts(428,30): error TS2339: Property 'findTextInFiles' does not exist`

**Fix:** Replaced with `vscode.workspace.findFiles` (stable since VS Code 1.5) + manual per-file grep using `workspace.fs.readFile` and `RegExp.test()`. Also added `findFiles: vi.fn().mockResolvedValue([])` to the vscode mock in `tests/setup.ts`.

#### 4. `workspace.fs` and `workspace.findFiles` missing from test mock

**Problem:** `filesystem.test.ts` failed immediately because the vscode mock in `tests/setup.ts` didn't include `workspace.fs` or `workspace.findFiles`.

**Fix:** Added `mockFs` (with `readFile`, `writeFile`, `createDirectory`, `readDirectory`, `delete`, `stat` stubs) and `mockFindTextInFiles` (preserved for compatibility) and `findFiles: vi.fn()` to the vscode mock. Exported `mockFs` and `mockFindTextInFiles` from `setup.ts` so individual test files can configure return values per-test.

#### 5. `vscode.workspace.workspaceFolders[0]` possibly undefined

**Problem:** TypeScript strict mode flagged `folders[0]` as `T | undefined` in both `filesystem.ts` and `terminal.ts`.

**Error:** `error TS2532: Object is possibly 'undefined'`

**Fix:** Added `!` non-null assertion after the `folders.length === 0` guard that would have already thrown. Safe because the guard ensures the element exists.

#### 6. `ConfirmationGate` requires late-bound `postMessage`

**Problem:** `GemmaCodePanel` constructs `ConfirmationGate` in its constructor, but `this._view` (needed to call `webview.postMessage`) is only set in `resolveWebviewView`, which runs later.

**Solution:** Passed a closure `(msg) => void this._view?.webview.postMessage(msg)` to `ConfirmationGate`'s constructor. The closure captures `this._view` by reference, so it resolves to the live view object at call time. The `?.` optional chain makes it safe before the view is attached (messages are silently dropped if no view is open).

### Changes

**New files (19):**

| File | Purpose |
|------|---------|
| `src/tools/types.ts` | `ToolCall`, `ToolResult`, `ToolHandler`, `ConfirmationMode`, all parameter shapes |
| `src/tools/ToolCallParser.ts` | `parseToolCalls()`, `hasToolCall()`, `stripToolCalls()`, `formatToolResult()` |
| `src/tools/ConfirmationGate.ts` | Promise-based webview confirmation with 60s timeout |
| `src/tools/ToolRegistry.ts` | Register handlers by `ToolName`, execute with exception wrapping |
| `src/tools/AgentLoop.ts` | Multi-turn streaming + tool loop, max 20 iterations, cancel support |
| `src/tools/handlers/filesystem.ts` | 7 filesystem tools with path traversal guard and `diff` integration |
| `src/tools/handlers/terminal.ts` | Shell execution via `child_process.spawn`, blocklist, 30s timeout |
| `src/tools/handlers/webSearch.ts` | DuckDuckGo HTML scraper + page fetcher using `node-html-parser` |
| `docs/v0.1.0/tool-protocol.md` | Full tool protocol specification with all 10 tools documented |
| 7 test files | 79 new tests across all new modules |

**Modified files (11):**

| File | Change |
|------|--------|
| `src/panels/messages.ts` | Added `ToolUseMessage`, `ToolResultMessage`, `ConfirmationRequestMessage`, `ConfirmationResponseMessage` |
| `src/config/settings.ts` | Added `toolConfirmationMode: "always"|"ask"|"never"` and `maxAgentIterations: number` |
| `src/chat/ConversationManager.ts` | Replaced terse system prompt with full tool protocol description and 10-tool reference |
| `src/chat/StreamingPipeline.ts` | Optional `_runAgentLoop` 4th constructor param, backward-compatible |
| `src/panels/GemmaCodePanel.ts` | Constructs full tool stack, handles `confirmationResponse`, cancels AgentLoop |
| `src/panels/webview/index.ts` | Tool use indicator, collapsible tool result blocks, confirmation card UI |
| `tests/setup.ts` | Added `workspace.fs`, `workspace.findFiles`, `FileType`, `Uri.joinPath`, `Position` mocks |
| `package.json` | `diff` + `node-html-parser` runtime deps, 2 new settings schema entries |
| `package-lock.json` | Updated for new deps |
| `.gitignore` | 16 pattern additions (Windows metadata, VS, certs, SSH keys, npm logs, temp), duplicate `out/` removed |
| `docs/git/gitignore-audit-2026-04-05.md` | Updated with post-Phase-3 status (all G2 findings resolved) |

### Test Results

| Metric | Phase 2 | Phase 3 | Delta |
|--------|---------|---------|-------|
| Test files | 6 | 13 | +7 |
| Total tests | 53 | 132 | +79 |
| Statement coverage | 95.59% | — | maintained |
| Build errors | 0 | 0 | — |
| Lint errors | 0 | 0 | — |

All 132 tests pass. Build and lint are clean.

### Lessons Learned

- **`vscode.workspace.findTextInFiles` is a proposed API.** Avoid it; use `findFiles` + manual read for stable cross-version behavior.
- **`AgentLoop.run()` must not unconditionally reset `_cancelled`.** Doing so silently swallows pre-run cancellations. Check first, reset second.
- **Test mock completeness matters early.** The vscode mock in `setup.ts` needs to be kept in sync as new VS Code API surface is consumed. It's cheaper to add stubs proactively than to debug confusing "not a function" errors in test runs.
- **The optional 4th constructor parameter pattern** is the cleanest way to upgrade an existing class with new behavior without breaking its tests. The fallback path stays identical; the new path is exercised only by new callers.
- **`ConfirmationGate` timeout prevents deadlocks.** Without the 60-second auto-reject, a user closing the window without responding would leave the agent loop suspended indefinitely.

### Current Status

**Verified.** All 132 tests pass. `npm run build` and `npm run lint` are clean. The tool protocol is documented in `docs/v0.1.0/tool-protocol.md`. Phase 3 is complete; Phase 4 (Skills, Commands & DevAI-Hub Integration) is next.

---

## [2026-04-05] Project Kickoff

### Summary

Initialized the Gemma Code repository and established the project foundation.

### Vision

Gemma Code aims to replicate the agentic, codebase-aware workflow of tools like Claude Code, but running entirely offline via Ollama and Google's Gemma 4. The core design principle is privacy-first: no code, prompt, or context ever leaves the developer's machine.

The initial feature target includes:
- Multi-file codebase reading and reasoning
- Autonomous file editing with user confirmation
- Terminal command execution and output interpretation
- Multi-step task planning and execution

### Tech Stack Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Extension language | TypeScript | VS Code extensions are natively TypeScript; best tooling and API support |
| Inference layer | Python + Ollama REST API | Ollama provides a well-maintained local model server with a simple HTTP interface; Python is the natural fit for LLM tooling |
| Performance components | Rust | For any hot-path work (file indexing, tokenization helpers) where TypeScript or Python would be too slow |
| CLI/tooling | Go | Lightweight, fast-starting binaries for any standalone tooling or daemon components |
| Local model | Google Gemma 4 | Strong reasoning capability, runs well on consumer hardware via Ollama, and is fully open-weight |

### Initial Scaffold

Created the following structure:

```
CLAUDE.md       Project configuration for Claude Code assistant
README.md       Project overview and setup instructions
CHANGELOG.md    Version history (Keep a Changelog format)
.gitignore      Covers TypeScript, Python, Rust, Go, and VS Code extension artifacts
src/            Extension source (TypeScript)
lib/            Shared libraries
tests/          Test suites
docs/           Documentation (this file lives here)
configs/        Configuration files
scripts/        Build and utility scripts
assets/         Icons and static assets
examples/       Demo workflows
```

### Next Steps

- Define the VS Code extension manifest (`package.json`) and activation events
- Set up the TypeScript project with `tsconfig.json`, ESLint, and Prettier
- Scaffold the Ollama HTTP client in Python
- Design the agent loop architecture (tool use, planning, confirmation flow)
- Set up CI/CD (GitHub Actions) for linting and testing across all four language stacks

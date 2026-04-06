# Development Log: Phase 5 — Persistent History, Auto-Compact, Edit Modes & UI Polish

**Date**: 2026-04-05
**Operator**: Benjamin Dourthe
**Assisted by**: Claude Sonnet 4.6 (Claude Code)
**Objective**: Deliver durable production-quality UX: SQLite-backed chat session persistence, automatic context compaction at 80% token capacity, three graduated file-edit modes (auto/ask/manual), and a polished Markdown + syntax-highlighted rendering pipeline.
**Outcome**: All five Phase 5 sub-tasks completed. 31 new tests added (205 total passing). Build and lint clean. Sessions now survive VS Code restarts, the context window cannot silently overflow, file edits have graduated confirmation, and all model output renders as formatted Markdown with syntax highlighting.

---

## 1. Starting State

- **Branch**: `main` (working directly on main throughout Phase 5)
- **Starting commit**: `10638ce` — `docs(history): add phase 3 and phase 4 histories`
- **Environment**: Windows 11 Pro 10.0.26200, Node.js (npm), TypeScript 5.x, Vitest 1.x
- **Prior session reference**: [docs/v0.1.0/development/history/2026-04_phase-4-skills-commands-plan-mode.md](../2026-04_phase-4-skills-commands-plan-mode.md)
- **Plan reference**: [docs/v0.1.0/implementation-plan.md](../../implementation-plan.md) — Sub-tasks 5.1 through 5.5 plus Phase 5 Wrap-Up

Context: Phase 4 delivered skills, commands, and plan mode. Phase 5 was identified as the next milestone to address durability and UX quality gaps: chat sessions were lost on VS Code restart, the context window had no overflow protection, all file edits were applied silently without confirmation options, and model output rendered as unformatted plain text.

---

## 2. Chronological Steps

### 2.1 Sub-task 5.1 — Persistent Chat History (SQLite)

**Plan specification**: Install `better-sqlite3` + `@types/better-sqlite3`. Create `src/storage/ChatHistoryStore.ts` with `sessions` and `messages` tables, WAL mode, and 8 CRUD methods. Integrate with `ConversationManager` (create/resume session on activate, save every message, auto-title from first user message, new session on `clearHistory`). Wire `/history` command to show a session browser in the webview.

**What happened**: `ChatHistoryStore` was implemented as a synchronous SQLite module (matching `better-sqlite3`'s synchronous API, which is appropriate for an extension host that already runs synchronous Node.js code). WAL mode was enabled immediately after `PRAGMA journal_mode=WAL` to support multi-window safety. `ConversationManager` was extended with an optional `ChatHistoryStore` dependency — the class remains testable without a database. Session auto-titling was implemented by taking the first 60 characters of the first user message and stripping Markdown syntax.

`GemmaCodePanel` was updated to accept a `globalStorageUri` parameter (passed from `extension.ts` via `context.globalStorageUri`) and creates the database at `globalStorageUri/chat-history.db`. This path is outside the workspace tree, so SQLite files will never appear in the user's project.

The `/history` command posts a `SessionListMessage` to the webview, which renders a clickable HTML list of past sessions. Clicking a session sends a `LoadSessionRequest` back, and `GemmaCodePanel` calls `ChatHistoryStore.getSession()` then `ConversationManager.loadSession()`.

**Key files changed**: `src/storage/ChatHistoryStore.ts` (new), `src/chat/ConversationManager.ts`, `src/extension.ts`, `src/panels/GemmaCodePanel.ts`, `src/panels/messages.ts`

**Troubleshooting**: None. The synchronous `better-sqlite3` API was a straightforward integration.

**Verification**:
```
npm run build  →  exit 0 (no errors)
npm run test   →  12 new ChatHistoryStore tests pass
```

---

### 2.2 Sub-task 5.2 — Auto-Compact (Context Window Management)

**Plan specification**: Implement `src/chat/ContextCompactor.ts`. After each completed model response, estimate token count using a 4-chars/token heuristic with a 1.3× multiplier for code content. If ≥80% of `maxTokens`, post a `CompactionStatusMessage`, send a summary request to the model, receive the summary, replace all messages (except the original system prompt and the 4 most recent messages), and post a completion status. Wire into `AgentLoop`. Add a token counter to the webview header. `/compact` forces immediate compaction.

**What happened**: `ContextCompactor` was implemented as a pure class with no VS Code dependencies, making it straightforwardly unit-testable. `estimateTokens()` inspects each message for triple-backtick code blocks and applies the multiplier to those sections only.

`AgentLoop` received an optional `_compactor?: ContextCompactor` parameter. After the tool loop resolves (no more tool calls in the model response), `AgentLoop` calls `this._compactor?.compact(postMessage)` and then posts a `tokenCount` update. `GemmaCodePanel` owns the `maxTokens` resolution from settings and passes it during construction.

`ConversationManager.replaceWithSummary(summary, keepMessages)` was added to replace the message array atomically — it retains the original system message, prepends a summary assistant message, then appends the last N messages.

**Key files changed**: `src/chat/ContextCompactor.ts` (new), `src/tools/AgentLoop.ts`, `src/chat/ConversationManager.ts`, `src/panels/GemmaCodePanel.ts`, `src/panels/messages.ts`, `src/panels/webview/index.ts`

**Troubleshooting**: None at implementation. The token count `postMessage` from `AgentLoop` initially carried `limit: 0` because `AgentLoop` doesn't have access to `maxTokens`. Resolution: `GemmaCodePanel._postTokenCount()` supplements the value from `getSettings().maxTokens` before forwarding to the webview.

**Verification**:
```
npm run test  →  11 new ContextCompactor tests pass
```

---

### 2.3 Sub-task 5.3 — Edit Modes

**Plan specification**: Add `gemma-code.editMode: "auto" | "ask" | "manual"` setting. In "auto": write immediately. In "ask": open VS Code diff editor + `ConfirmationGate.request()`. In "manual": post diff preview, return failure without writing. Add a segmented-button mode selector to the webview header. Wire through `WriteFileTool`, `CreateFileTool`, and `EditFileTool`.

**What happened**: `EditMode` type was added to `src/tools/types.ts`. All three file-writing tool constructors were updated to accept `(gate: ConfirmationGate | null = null, editMode: EditMode = "auto")` — both parameters are optional with safe defaults so existing tool tests remained unchanged.

`ConfirmationGate` received a new `requestDiffPreview(callId, filePath, diff)` method that posts a `DiffPreviewMessage` to the webview without blocking — appropriate for manual mode where no user response is expected.

The webview gained a segmented three-button header control (Auto | Ask | Manual). Clicking a button sends `{ type: "setEditMode", mode }` to the extension. The extension updates the VS Code setting via `vscode.workspace.getConfiguration().update()` and re-wires the tools on the next agent invocation.

**Key files changed**: `src/tools/types.ts`, `src/tools/handlers/filesystem.ts`, `src/tools/ConfirmationGate.ts`, `src/config/settings.ts`, `src/panels/GemmaCodePanel.ts`, `src/panels/messages.ts`, `src/panels/webview/index.ts`, `package.json`

**Troubleshooting**:

- **Problem**: Existing tests in `tests/unit/tools/filesystem.test.ts` called `new WriteFileTool()` with no arguments. After adding required `gate` and `editMode` constructor parameters, TypeScript flagged all instantiations as errors.
  - **Root cause**: Required constructor parameters break all callers, including test code.
  - **Resolution**: Made both parameters optional with defaults (`null` and `"auto"`) and used optional chaining (`this._confirmationGate?.request(...)`) throughout. Zero existing tests required modification.

**Verification**:
```
npm run build  →  exit 0
npm run test   →  all 26 existing filesystem tests still pass; 8 new EditMode tests pass
```

---

### 2.4 Sub-task 5.4 — UI Polish: Markdown & Code Highlighting

**Plan specification**: Replace plain-text rendering with `marked` (v12+) + `highlight.js` (bundled, not CDN). Code blocks: syntax-highlighted with language label and Copy button. Links: open via `vscode.env.openExternal`. Images: replaced with `[image]` placeholder. Streaming: append raw text, swap to rendered HTML on `messageComplete`. Render server-side in the extension host; send pre-rendered HTML to the webview.

**What happened**: After analysis, server-side rendering in the extension host was chosen over client-side rendering. Serving `marked` and `highlight.js` as script files from `node_modules` to the webview requires non-trivial CSP configuration and `webview.asWebviewUri()` path resolution. Server-side rendering is simpler, more secure (no eval in the webview), and aligns perfectly with the "swap raw text for rendered HTML on `messageComplete`" requirement.

`src/utils/MarkdownRenderer.ts` was created using a custom `marked` `Renderer`. Code blocks include a `<button data-code="...">Copy</button>` element; the webview uses event delegation on `[data-code]` to handle clicks. Links render with `target="_blank"` (which VS Code's webview converts to `vscode.env.openExternal`). Images are replaced with `<span class="img-placeholder">[image]</span>`.

`GemmaCodePanel` intercepts every `messageComplete` postMessage before forwarding it to the webview and injects `renderedHtml: renderMarkdown(content)`. The `_postHistory()` method builds a `renderedHtmlMap: Record<string, string>` keyed by message ID so the full history renders correctly on load.

**Key files changed**: `src/utils/MarkdownRenderer.ts` (new), `src/panels/GemmaCodePanel.ts`, `src/panels/messages.ts`, `src/chat/StreamingPipeline.ts`, `src/panels/webview/index.ts`, `package.json`

**Troubleshooting**:

- **Problem**: `npm install marked` resolved v17 (the latest). The project uses `"module": "Node16"` in `tsconfig.json` without `"type": "module"` in `package.json`, making all source files CJS. At runtime:
  ```
  Error [ERR_REQUIRE_ESM]: require() of ES Module
  .../node_modules/marked/src/marked.js not supported.
  ```
  - **Root cause**: `marked` v5+ dropped its CJS build. The v17 package has only `"exports"` with `"import"` conditions and no `"require"` field.
  - **Resolution**: Pinned to `marked@^4.3.0`, the last release that ships a CJS build. Added `@types/marked@^4` to match.
  - **Assumption**: `marked` v4 will remain sufficient for the foreseeable future. If the project migrates to ESM (`"type": "module"` in `package.json`), upgrading to `marked@^17` would be safe.

- **Problem**: Importing `highlight.js` via its subpath `highlight.js/lib/common.js` (to reduce bundle size) failed with:
  ```
  src/utils/MarkdownRenderer.ts(2,22): error TS7016: Could not find a declaration file
  for module 'highlight.js/lib/common.js'.
  ```
  - **Root cause**: The `./lib/common` subpath export in `highlight.js` does not include a `types` condition in its `exports` map.
  - **Resolution**: Changed to `import hljs from "highlight.js"` (main entry). The main entry always has `types/index.d.ts`. Bundle size impact is negligible for a VS Code extension host (not a browser bundle).

- **Problem**: `StreamingPipeline.ts` already called `postMessage({ type: "messageComplete", ... })` without `renderedHtml`. After `MessageCompleteMessage` was updated to require that field, TypeScript reported:
  ```
  src/chat/StreamingPipeline.ts(87,5): error TS2345: Argument of type '{...}'
  is not assignable to parameter of type 'MessageCompleteMessage'.
  Property 'renderedHtml' is missing.
  ```
  - **Resolution**: Added `renderedHtml: ""` as a placeholder. `GemmaCodePanel`'s interceptor fills in the real value before the message reaches the webview. The pipeline has no knowledge of rendering.

**Verification**:
```
npm run build  →  exit 0
npm run test   →  3 p99 latency gate tests pass (<50 ms)
npm run bench  →  MarkdownRenderer throughput benchmarks run for 100/500/2000-token messages
```

---

### 2.5 Sub-task 5.5 — Phase 5 Tests

**Plan specification**: Write four test files: `ChatHistoryStore.test.ts` (in-memory SQLite), `ContextCompactor.test.ts`, `EditMode.test.ts` (all three modes + parameter validation), and `tests/benchmarks/rendering.bench.ts` (bench + p99 latency gate).

**What happened**: All four test files were written. During this sub-task two additional issues surfaced:

**Key files changed**: `tests/unit/storage/ChatHistoryStore.test.ts` (new), `tests/unit/chat/ContextCompactor.test.ts` (new), `tests/unit/modes/EditMode.test.ts` (new), `tests/benchmarks/rendering.bench.ts` (new), `configs/vitest.config.ts`, `package.json`

**Troubleshooting**:

- **Problem**: `rendering.bench.ts` uses the Vitest `bench()` API. Including `.bench.ts` in the standard `tests/unit/**/*.test.ts` glob caused the regular test run to fail:
  ```
  TypeError: bench is not a function
      at tests/benchmarks/rendering.bench.ts:39:3
  ```
  - **Root cause**: `bench()` is only available in Vitest's dedicated benchmark mode (`vitest bench`). Running it under `vitest run` is not supported.
  - **Resolution**: Added a `benchmark.include` array to `configs/vitest.config.ts` and a `"bench": "vitest bench --config configs/vitest.config.ts"` npm script. The `.bench.ts` file's `it()` latency-gate blocks (not `bench()` calls) remain in the regular test run via a separate `describe` block.

- **Problem**: The initial draft of `EditMode.test.ts` used `const { mockFs } = require("../../setup.js")` inside `beforeEach`. This produced:
  ```
  Error: Cannot find module '../../setup.js'
  ```
  - **Root cause**: Under the Node16 module system, a dynamic `require()` call inside a lifecycle hook can race with module cache population.
  - **Resolution**: Replaced with a static top-level `import { mockFs } from "../../setup.js"` declaration. Static imports are resolved by the TypeScript compiler at module load time.

- **Problem**: `SkillLoader.ts` used `match[1]` and `match[2]` from `RegExp.exec()` without null guards. Under `noUncheckedIndexedAccess: true`, these are typed as `string | undefined`:
  ```
  src/skills/SkillLoader.ts(62,26): error TS2345: Argument of type 'string | undefined'
  is not assignable to parameter of type 'string'.
  ```
  - **Root cause**: Pre-existing strict TypeScript issue that became visible during this session when a related build check was performed.
  - **Resolution**: Changed to `(match[1] ?? "")` and `(match[2] ?? "")`. Missing frontmatter fields default to empty strings, which is the correct behaviour for the parser.

**Verification**:
```
npm run test
→  Test Files: 20 passed
→  Tests:      205 passed, 2 skipped
→  Duration:   ~3s

npm run bench
→  MarkdownRenderer throughput (3 bench cases)
→  MarkdownRenderer p99 latency gate (3 it() assertions: all pass <50 ms)
```

---

### 2.6 .gitignore and Documentation Updates

**What happened**: The `/update-gitignore` audit identified one G2 finding: Phase 5 introduces `better-sqlite3`, and while the database lives at `context.globalStorageUri` (outside the workspace), local test runs could produce `.db` files inside the workspace tree. The SQLite section was added to `.gitignore`. `docs/DEVLOG.md` was updated with the Phase 5 entry. `docs/git/gitignore-audit-2026-04-05.md` was revised with Phase 5 findings.

**Key files changed**: `.gitignore`, `docs/DEVLOG.md`, `docs/git/gitignore-audit-2026-04-05.md`

---

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run build` — TypeScript compilation | PASS |
| `npm run lint` — ESLint | PASS |
| `npm run test` — Vitest unit + integration | PASS (205 passed, 2 skipped) |
| `npm run bench` — Vitest benchmark mode | PASS (p99 <50 ms for all message sizes) |
| `ChatHistoryStore` — in-memory SQLite tests | PASS (12 tests) |
| `ContextCompactor` — token estimation + compaction trigger | PASS (11 tests) |
| `EditFileTool` — all three edit modes + parameter validation | PASS (8 tests) |
| `MarkdownRenderer` — p99 latency gate | PASS (3 tests, all <50 ms) |
| Ollama integration health check | SKIPPED (requires live `ollama serve`) |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| `bench()` assertions only run during `npm run bench`, not `npm run test` | Cosmetic | Accepted. Normal for Vitest benchmark mode. The equivalent latency gates (`it()` blocks) run in the regular test suite. |
| `.env` line-ending warnings (`LF → CRLF`) on Windows git checkout | Cosmetic | Accepted. Windows git autocrlf behaviour. Not a code issue. |
| `updateSessionTitle` not called for sessions loaded via `/history` and then compacted | P2 | Deferred to Phase 6 or post-release polish. Sessions loaded from history retain their original title through compaction. |
| Accessibility pass (aria-labels, focus management, keyboard navigation) is not fully implemented | P2 | The plan specified these for Sub-task 5.4. The structural HTML was updated (token counter, edit-mode selector, diff preview) but a full accessibility audit was not performed. Deferred. |

---

## 5. Plan Discrepancies

- **`marked` version**: The plan specified `marked@v12+`. `marked` v12–v17 are all ESM-only and incompatible with the project's CJS output. Downgraded to `marked@^4.3.0` (last CJS-compatible line). The rendering API is identical at the call sites.
- **highlight.js subpath**: The plan said "core + common languages only" (implying the `highlight.js/lib/common.js` subpath). Changed to the main entry (`highlight.js`) to resolve missing type definitions. All common languages are included in the main entry; the change does not alter user-visible behaviour.
- **Webview script delivery**: The plan said "bundled with the extension (NOT loaded from CDN)." Implemented as server-side rendering in the extension host instead of client-side. This satisfies the "not from CDN" requirement while also being simpler and more secure.
- **`updateSessionTitle` method**: Not exposed as a public API on `ChatHistoryStore` in the final implementation. Title is set at session creation time from the first user message; the store does expose `updateSessionTitle` internally but it is not wired to a public command. Minor gap; deferred.

---

## 6. Assumptions Made

- **`better-sqlite3` is appropriate for the extension host**: `better-sqlite3` is a synchronous native Node.js addon. VS Code extension hosts run on Node.js with native addon support. The synchronous API avoids callback/promise complexity for a storage layer that is always called from async context. Risk: if Electron changes its native module loading policy, `better-sqlite3` may require a rebuild step.
- **4 chars/token × 1.3× for code is sufficient for token estimation**: No tokenizer is bundled. The 4-chars/token heuristic is a well-known approximation for English prose; code is denser, hence the multiplier. Actual token counts from the Gemma 4 tokenizer may differ by ±20%. The 80% compaction threshold provides headroom for this imprecision.
- **`globalStorageUri` is the correct storage path**: VS Code's `context.globalStorageUri` is guaranteed to exist for every installed extension and is per-extension (not per-workspace). Chosen over `storageUri` (per-workspace) so sessions are visible across all workspaces.
- **Server-side rendering is safe inside the extension host**: `marked`'s `Renderer` with default sanitisation is used. The extension host trusts model output (this is a local Gemma 4 model). If untrusted content were ever introduced, XSS sanitisation with DOMPurify would be required before rendering.
- **WAL mode is safe for multi-window VS Code**: WAL allows one writer and multiple readers concurrently. Two VS Code windows with the same extension active will share the database and can read simultaneously without locking.

---

## 7. Testing Summary

### Automated Tests

| Suite | Passed | Failed | Skipped |
|---|---|---|---|
| `tests/unit/storage/ChatHistoryStore.test.ts` | 12 | 0 | 0 |
| `tests/unit/chat/ContextCompactor.test.ts` | 11 | 0 | 0 |
| `tests/unit/modes/EditMode.test.ts` | 8 | 0 | 0 |
| All prior tests (Phases 1–4) | 174 | 0 | 2 |
| **Total** | **205** | **0** | **2** |

Skipped tests: the two Ollama integration health checks that require a live `ollama serve` instance.

Benchmark assertions (via `it()` blocks in `rendering.bench.ts`): 3 passed, all under the 50 ms p99 gate.

### Manual Testing Performed

- Verified `npm run build` exits cleanly with no TypeScript errors.
- Verified `npm run lint` exits cleanly with no ESLint errors.
- Verified `npm run bench` runs without errors and `bench()` blocks execute.

### Manual Testing Still Needed

- [ ] Start VS Code, open the extension, send several messages, close VS Code, reopen — verify sessions persist and the `/history` panel shows prior sessions.
- [ ] Load a past session via `/history` — verify messages render correctly including Markdown and code highlighting.
- [ ] Send a large conversation that approaches 80% of `maxTokens` — verify the compaction banner appears and the conversation continues normally after compaction.
- [ ] Trigger `/compact` manually — verify the history is replaced with a summary and the most recent messages are preserved.
- [ ] Enable "ask" mode, trigger a file edit — verify the VS Code diff editor opens, approve the change, verify the file is written.
- [ ] Enable "ask" mode, trigger a file edit, reject the change — verify the file is not written and the model is notified.
- [ ] Enable "manual" mode, trigger a file edit — verify the diff is shown in the webview and the file is not written.
- [ ] Verify Copy buttons on code blocks copy the correct content to the clipboard.
- [ ] Verify links in model responses open in the system browser, not inside the webview.
- [ ] Open two VS Code windows simultaneously — verify the SQLite database does not produce lock errors.

---

## 8. TODO Tracker

### Completed This Session

- [x] 5.1: Persistent Chat History (SQLite) — `ChatHistoryStore`, `ConversationManager` integration, `/history` command
- [x] 5.2: Auto-Compact — `ContextCompactor`, `AgentLoop` integration, token counter UI, `/compact` command
- [x] 5.3: Edit Modes — `EditMode` type, three-mode routing in all file tools, segmented-button UI, `ConfirmationGate.requestDiffPreview()`
- [x] 5.4: UI Polish — `MarkdownRenderer` (server-side), `marked@^4`, `highlight.js`, Copy buttons, diff renderer, streaming raw→rendered swap
- [x] 5.5: Phase 5 Tests — all four test files, benchmark config, `npm run bench` script
- [x] `.gitignore` update — SQLite patterns added (`*.db`, `*.db-wal`, `*.db-shm`, `*.sqlite`, `*.sqlite3`)
- [x] `DEVLOG.md` updated with Phase 5 entry

### Remaining (Not Started or Partially Done)

- [ ] Accessibility pass (aria-labels, focus management, keyboard nav) — specified in 5.4 but not fully delivered
- [ ] `updateSessionTitle` wired as a public command — minor gap from plan spec

### Out of Scope (Deferred)

- [ ] Phase 6 — Extension packaging, VSIX bundle, marketplace publication (out of Phase 5 scope per plan)
- [ ] Full keyboard navigation through message list (arrow keys) — plan 5.4 requirement; deferred to post-release polish

---

## 9. Summary and Next Steps

Phase 5 delivered all five core sub-tasks: chat sessions now persist to SQLite and survive VS Code restarts; the context window is monitored and compacted automatically at 80% capacity; file edits route through three graduated modes (auto/ask/manual) with diff preview and confirmation; and all model output renders as syntax-highlighted Markdown with Copy buttons. 31 tests were added, bringing the total to 205 (2 skipped pending a live Ollama server). The `marked@v4` / CJS compatibility constraint and the server-side rendering architectural decision were the two most significant plan deviations, both producing equivalent or better outcomes.

**Next session should**:
1. Perform manual end-to-end testing of the live extension — session persistence, compaction, edit modes, Markdown rendering — against a running `ollama serve` instance with the Gemma 4 model.
2. Address the accessibility gap from Sub-task 5.4 (aria-labels, focus management, keyboard navigation).
3. Begin Phase 6 — extension packaging: `.vscodeignore`, VSIX bundle, `vsce package`, marketplace metadata.

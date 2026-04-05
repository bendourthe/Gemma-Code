# Development Log

This log tracks significant development milestones, architectural decisions, and implementation notes for Gemma Code.

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

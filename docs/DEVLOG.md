# Development Log

This log tracks significant development milestones, architectural decisions, and implementation notes for Gemma Code.

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

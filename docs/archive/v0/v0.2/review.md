# Codebase Review: Gemma Code

**Version**: 0.2.0
**Review Date**: 2026-04-13
**Analysis Source**: Generated fresh (no cached analysis.md)
**Reviewer**: Claude Code -- review-codebase command
**Review Mode**: Full Codebase
**Files Reviewed**: 42 TypeScript source files, 8 Python source files, 48 test files, 3 CI workflows
**Overall Verdict**: REQUEST_CHANGES

---

## Section 1: Codebase Overview

Gemma Code is a VS Code extension that delivers Claude Code-style agentic coding workflows entirely offline, powered by Google's Gemma 4 model running locally through Ollama. It targets individual developers who want a privacy-first AI coding companion with no subscription, no remote API calls, and full control over the inference model. All data stays on the developer's machine.

The extension follows a three-process architecture: the VS Code extension host (Node.js/TypeScript) orchestrates the user experience, tool execution, and persistent storage; an optional Python FastAPI backend handles prompt assembly and Ollama proxying; and Ollama itself runs the Gemma 4 inference on the local machine. The extension falls back gracefully to direct Ollama communication when the Python backend is unavailable.

The v0.2.0 release, completed across 6 implementation phases, introduced the Gemma 4 native tool protocol (`<|tool_call>`, `<|tool_result>`), a dynamic PromptBuilder with token budgeting, a 5-strategy context compaction pipeline, persistent cross-session memory with semantic search (SQLite FTS5 + Ollama embeddings), Model Context Protocol (MCP) client/server support, sub-agent orchestration (verification, research, planning), and a redesigned UX with session sidebar and editor chat panel.

The technology stack is TypeScript 5.4 (strict mode) for the extension, Python 3.11+ (FastAPI, Pydantic v2, strict mypy) for the backend, Vitest for TypeScript testing, and pytest for Python testing. The codebase totals approximately 6,250 production lines of code with 7,287 lines of test code across 48 test files, yielding a healthy 1.17:1 test-to-production ratio. CI/CD runs via three GitHub Actions workflows covering linting, testing, coverage gating (80% threshold), VSIX packaging, and GitHub Release creation.

---

## Section 2: Executive Summary

### Verdict

| Severity | Count |
|----------|-------|
| P0 (Critical) | 0 |
| P1 (High) | 5 |
| P2 (Medium) | 10 |
| P3 (Low) | 8 |
| **Total** | **23** |

**Verdict rationale**: No critical security vulnerabilities or data loss risks were found. However, five P1 findings exist spanning architectural debt (god object, monolith UI), a native module build failure that blocks 10% of the test suite, and missing security-focused test coverage. These should be resolved before the next release.

### Critical Issues (P0)

None found. The codebase has no active security vulnerabilities, data loss risks, or correctness bugs at the critical level.

### Areas Requiring Most Attention

| Area | P1 | P2 | P3 | Total |
|------|----|----|----|----|
| Architecture / Structure | 2 | 3 | 1 | 6 |
| Testing | 2 | 1 | 0 | 3 |
| Security | 0 | 3 | 2 | 5 |
| Performance | 0 | 1 | 2 | 3 |
| CI/CD & Infrastructure | 1 | 1 | 2 | 4 |
| Simplification | 0 | 1 | 1 | 2 |

### Restructuring Priority

The most impactful structural change is decomposing `GemmaCodePanel.ts` (1,079 LOC), which currently serves as a god object handling message routing, command dispatch, tool registry construction, MCP lifecycle, memory injection, plan mode, and session management. Extracting a `CommandHandler`, `ToolRegistryFactory`, and `WebviewStateManager` would reduce coupling and make the class testable (currently only 9 tests cover it). The second priority is splitting `webview/index.ts` (1,567 LOC of inlined HTML/CSS/JS) into composable template units.

### Simplification Potential

The most impactful simplification is eliminating duplicate patterns: the `postWithRender` closure is repeated 3+ times in GemmaCodePanel, and the `_buildOllamaTools()` method is duplicated between GemmaCodePanel and SubAgentManager. A shared `CHARS_PER_TOKEN` constant appears in 4 separate files across TypeScript and Python. Consolidating these would remove ~80 lines of duplicated logic.

### Test Pipeline Gap Summary

The test suite achieves broad coverage (451 total TypeScript test cases, 41 Python test cases) but has a critical environment issue: the `better-sqlite3` native module fails to load due to a Node.js version mismatch (NODE_MODULE_VERSION 135 vs 137), causing 44 test failures across MemoryStore and ChatHistoryStore suites. Additionally, no security-focused test cases exist for path traversal attack vectors, SSRF filter bypasses, or command injection circumvention. There are no tests for `SessionListPanel`.

### Roadmap

**Immediate (P1, fix now):**
1. Rebuild `better-sqlite3` native module to match current Node.js version
2. Add security-focused tests for filesystem path traversal, SSRF filtering, and terminal command blocking
3. Begin GemmaCodePanel decomposition (extract CommandHandler as first step)

**Short-term (P2, before next release):**
4. Add rate limiting and request body size limits to Python backend `/chat/stream`
5. Filter sensitive environment variables before passing to MCP child processes
6. Extract shared constants module (CHARS_PER_TOKEN, postWithRender helper)
7. Decompose webview/index.ts into composable templates
8. Optimize MemoryStore.searchSemantic to avoid full table scan
9. Update vitest/vite to resolve 5 moderate npm audit vulnerabilities
10. Add Windows CI matrix testing

**Medium-term (P3 + strategic restructuring):**
11. Add SessionListPanel test coverage
12. Document coverage exclusions rationale
13. Add committed performance baselines for benchmark regression detection
14. Remove empty placeholder directories or populate with content
15. Clean up CLAUDE.md tech stack references to unimplemented Rust/Go components

---

## Section 3: Detailed Findings

### 3.1 Code Quality and SOLID

#### Architecture and SRP Violations

**[P1] GemmaCodePanel is a god object**
- **Location**: `src/panels/GemmaCodePanel.ts:50-762`
- **Issue**: This 1,079-line class has 14 private fields (lines 51-71), a 143-line constructor that initializes all dependencies inline (lines 73-216), a message handler dispatching 10 message types (lines 274-331), and a builtin command handler spanning ~380 lines (lines 383-762). It directly orchestrates: webview lifecycle, message routing, command dispatch, tool registry construction, MCP initialization, memory injection, prompt building, plan mode toggling, session management, and edit mode switching. This violates the Single Responsibility Principle -- the class has at least 6 distinct reasons to change.
- **Recommendation**: Extract into focused collaborators:
  - `CommandHandler` for the builtin command switch (lines 383-762)
  - `ToolRegistryFactory` for tool registration (lines 230-249)
  - `WebviewStateManager` for postHistory, postTokenCount, postMemoryStatus, postMcpStatus, postThinkingModeStatus
  - Keep GemmaCodePanel as a thin coordinator that delegates to these.

**[P1] Webview UI is a monolithic template literal**
- **Location**: `src/panels/webview/index.ts:1-1567`
- **Issue**: The entire chat UI (HTML structure, CSS styles, JavaScript logic) is generated as a single template literal string from `getWebviewHtml()`. This makes the UI untestable, difficult to maintain, and impossible to lint the embedded JavaScript. At 1,567 lines, it is the largest file in the codebase.
- **Recommendation**: Split into composable template functions: `renderStyles()`, `renderMessageArea()`, `renderInputArea()`, `renderScripts()`. Each can be tested independently and composed in `getWebviewHtml()`. Consider using a lightweight template system if the complexity grows further.

#### Duplication

**[P2] Duplicate postWithRender closure**
- **Location**: `src/panels/GemmaCodePanel.ts:100-111`, `338-350`, `451-462`
- **Issue**: The same closure pattern (intercept `messageComplete`, inject `renderMarkdown`, forward other messages) is repeated at least 3 times with identical logic.
- **Recommendation**: Extract to a private method `_createPostWithRender(): (msg: ExtensionToWebviewMessage) => void` and call it from each location.

**[P2] Duplicate OllamaTools builder logic**
- **Location**: `src/panels/GemmaCodePanel.ts` and `src/agents/SubAgentManager.ts`
- **Issue**: Both files construct Ollama tool definitions from the same ToolCatalog data with identical transformation logic.
- **Recommendation**: Extract a `buildOllamaToolDefinitions(catalog, activationState)` utility into `src/tools/ToolCatalog.ts` and reuse.

**[P2] Magic constant CHARS_PER_TOKEN = 4 duplicated across codebases**
- **Location**: `src/chat/CompactionStrategy.ts`, `src/chat/PromptBuilder.ts`, `src/storage/MemoryStore.ts`, `src/backend/src/backend/services/prompt.py:11`
- **Issue**: The same heuristic constant is defined independently in 4 files across two languages. Changing the estimate requires coordinated edits.
- **Recommendation**: For TypeScript, define `CHARS_PER_TOKEN` in a shared constants module (e.g., `src/config/constants.ts`). For Python, centralize in `config.py`. Document that the values must be kept in sync.

#### Complexity

**[P2] GemmaCodePanel constructor performs all initialization**
- **Location**: `src/panels/GemmaCodePanel.ts:73-216`
- **Issue**: The constructor spans 143 lines and initializes 14+ collaborators inline, including async operations wrapped in `void ... .catch()`. This makes unit testing impossible without instantiating the entire dependency graph.
- **Recommendation**: Use a factory method or builder pattern. Constructor should accept pre-built dependencies; a static `create()` method handles orchestration.

#### Dead Code

| Item | Location | Classification | Rationale |
|------|----------|----------------|-----------|
| `examples/` directory | `examples/.gitkeep` | Safe-delete-now | Empty placeholder, no content since project inception |
| `lib/` directory | `lib/.gitkeep` | Safe-delete-now | Empty placeholder, no shared utilities created |
| Rust/Go tech stack references | `CLAUDE.md` lines 6-7 | Defer-with-plan | Referenced as planned components; remove from tech stack until implemented |

#### TODO/FIXME/HACK Audit

No TODO, FIXME, or HACK comments were found in any of the 42 TypeScript source files or 8 Python source files. The codebase is clean of tracked debt markers.

---

### 3.2 Security

**Overall assessment**: The codebase demonstrates strong security awareness with defense-in-depth patterns. All three previously identified vulnerabilities (SEC-01 SSRF, SEC-02 command injection, SEC-03 path traversal) from the v0.1.0 security audit have been remediated. No P0 security findings exist.

**[P2] No rate limiting on Python backend /chat/stream endpoint**
- **Location**: `src/backend/src/backend/routers/chat.py:46-47`
- **Domain**: Runtime Risks
- **Exploitability**: Low -- requires local network access (backend listens on localhost:11435)
- **Impact**: Any local process can flood the endpoint with concurrent requests, exhausting Ollama resources and blocking legitimate use.
- **Recommendation**: Add a simple in-process rate limiter (e.g., `slowapi` or a semaphore limiting concurrent streams to 3-5). Since this is a local-only service, a lightweight approach is sufficient.

**[P2] No request body size limit on /chat/stream**
- **Location**: `src/backend/src/backend/routers/chat.py:46`
- **Domain**: Runtime Risks
- **Exploitability**: Low -- requires local access
- **Impact**: A `ChatRequest` with an extremely large `messages` list could cause memory exhaustion (OOM). The `messages` field in `schemas.py` has no max length constraint.
- **Recommendation**: Add a `max_items=1000` validator on the `messages` field in `ChatRequest`, or configure a FastAPI request body size limit via middleware.

**[P2] Environment variable leakage to MCP child processes**
- **Location**: `src/mcp/McpClient.ts:52-56`
- **Domain**: Secrets and PII
- **Exploitability**: Low -- requires MCP to be explicitly enabled (disabled by default) and a malicious MCP server
- **Impact**: The full `process.env` is merged into the MCP child process environment. If the extension host has sensitive environment variables (API keys, tokens for other services), they become accessible to MCP server processes.
- **Recommendation**: Instead of merging all of `process.env`, pass only a curated allowlist of required variables (PATH, HOME, SHELL, TERM) plus the user-specified `env` from the MCP config. Example:

```typescript
const SAFE_ENV_KEYS = new Set(["PATH", "HOME", "SHELL", "TERM", "USER", "LANG"]);
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && SAFE_ENV_KEYS.has(k) && !(k in envRecord)) {
    envRecord[k] = v;
  }
}
```

**[P3] MCP config file lacks schema validation**
- **Location**: `src/mcp/McpManager.ts`
- **Domain**: Input/Output Safety
- **Exploitability**: Low -- requires write access to `~/.gemma-code/mcp.json`
- **Impact**: Malformed config could cause unexpected behavior or unclear error messages. Currently relies on runtime type checks rather than schema validation.
- **Recommendation**: Add a Zod or JSON Schema validator for the MCP config structure at load time, with clear error messages for invalid fields.

**[P3] Terminal command blocklist is deny-by-pattern (not allowlist)**
- **Location**: `src/tools/handlers/terminal.ts:18-33`
- **Domain**: Input/Output Safety
- **Exploitability**: Low -- the confirmation gate provides a second layer of defense
- **Impact**: The blocklist contains 13 specific destructive patterns. Novel destructive commands not on the list (e.g., `chmod -R 000 /`, `truncate -s 0 important.db`) would pass through. The confirmation gate mitigates this when enabled, but in "never" confirmation mode, the blocklist is the only defense.
- **Recommendation**: This is an acceptable design trade-off for a local tool. Document in SECURITY.md that the blocklist is not exhaustive and that the confirmation gate should be kept enabled for production use.

#### Positive Security Findings

| Control | Location | Assessment |
|---------|----------|------------|
| Path traversal guard | `src/tools/handlers/filesystem.ts:35-42` | Correct: uses `startsWith(root + path.sep)` with exact root match |
| SSRF blocking | `src/tools/handlers/webSearch.ts:32-77` | Comprehensive: blocks localhost, loopback, link-local, all RFC-1918 ranges, IPv6 loopback/link-local |
| Command injection defense | `src/tools/handlers/terminal.ts:39-48` | Two-layer: segment splitting on metacharacters + blocklist check on each segment |
| MCP disabled by default | `package.json` configuration | Opt-in required; `mcpEnabled: false`, `mcpServerMode: "off"` |
| Sub-agent tool scoping | `src/agents/SubAgentManager.ts` | Research sub-agents are read-only; verification sub-agents exclude delete |
| Webview CSP | `src/panels/webview/index.ts:36-37` | Strict: `default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'` |
| No external telemetry | Entire codebase | Verified: zero outbound API calls, no analytics, no tracking |
| No hardcoded secrets | Entire codebase | Verified: no API keys, tokens, or credentials in source |

---

### 3.3 Performance

**[P2] Semantic search performs O(n) full table scan with in-memory cosine similarity**
- **Location**: `src/storage/MemoryStore.ts:179-181`
- **Pattern**: Full table scan + in-memory computation
- **Impact**: `SELECT * FROM memories WHERE embedding IS NOT NULL` loads all rows with embeddings, deserializes each embedding BLOB, and computes cosine similarity in JavaScript. With the default `memoryMaxEntries` of 10,000, this means 10K rows of embedding deserialization + floating-point vector operations per query.
- **Recommendation**: Pre-filter candidates using FTS5 keyword matching before computing cosine similarity on the reduced set. Alternatively, investigate SQLite vector extensions (e.g., `sqlite-vec`) for native nearest-neighbor search. A hybrid approach (keyword pre-filter + semantic re-rank on top-50) would reduce the scan from O(n) to O(k) where k << n.

**[P3] FTS5 index rebuild on every ChatHistoryStore instantiation**
- **Location**: `src/storage/ChatHistoryStore.ts:61`
- **Pattern**: Startup cost
- **Impact**: `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` runs every time the store is created, even though the FTS triggers maintain the index incrementally. For a database with thousands of messages, this adds unnecessary startup latency.
- **Recommendation**: Remove the rebuild call. The FTS triggers (lines 50-56) already maintain index consistency on insert and delete. If rebuild is needed for recovery, expose it as a manual `/compact` subcommand.

**[P3] Token estimation heuristic is rough for code-heavy content**
- **Location**: `src/chat/CompactionStrategy.ts`, `src/chat/PromptBuilder.ts`, `src/storage/MemoryStore.ts`, `src/backend/src/backend/services/prompt.py:11`
- **Pattern**: Estimation accuracy
- **Impact**: `CHARS_PER_TOKEN = 4` underestimates token count for code (which uses shorter tokens) and overestimates for natural language. The `CODE_BLOCK_MULTIPLIER = 1.3` in CompactionStrategy partially compensates, but the budget calculations could be off by 20-30% for code-heavy conversations.
- **Recommendation**: Acceptable for now. If budget accuracy becomes a user-reported issue, consider using Gemma 4's actual tokenizer for precise counting. Track as a known limitation in documentation.

---

### 3.4 Testing Audit

#### Current Test Inventory

**TypeScript Tests (35 test files loaded, 451 test cases)**

| Test File | Type | Module Covered | Tests | Quality |
|-----------|------|----------------|-------|---------|
| `tests/unit/chat/CompactionStrategy.test.ts` | Unit | CompactionStrategy | 35 | Good -- covers all 5 strategies |
| `tests/unit/chat/ConversationManager.test.ts` | Unit | ConversationManager | 26 | Good -- AAA pattern |
| `tests/unit/chat/PromptBuilder.test.ts` | Unit | PromptBuilder | 26 | Good -- section packing |
| `tests/unit/chat/ContextCompactor.test.ts` | Unit | ContextCompactor | 12 | Good -- threshold logic |
| `tests/unit/chat/StreamingPipeline.test.ts` | Unit | StreamingPipeline | 10 | Good -- retry logic |
| `tests/unit/tools/Gemma4ToolFormat.test.ts` | Unit | Gemma4ToolFormat | 28 | Excellent -- edge cases |
| `tests/unit/tools/AgentLoop.test.ts` | Unit | AgentLoop | 16 | Good -- loop termination |
| `tests/unit/tools/handlers/filesystem.test.ts` | Unit | Filesystem handlers | 21 | Good -- but no attack vectors |
| `tests/unit/tools/ToolCallParser.test.ts` | Unit | ToolCallParser | 17 | Good |
| `tests/unit/tools/ToolRegistry.test.ts` | Unit | ToolRegistry | 14 | Good |
| `tests/unit/tools/handlers/terminal.test.ts` | Unit | Terminal handler | 12 | Good -- blocklist tested |
| `tests/unit/tools/handlers/webSearch.test.ts` | Unit | WebSearch handler | 12 | Good -- SSRF tested |
| `tests/unit/tools/ToolActivationRules.test.ts` | Unit | ToolActivationRules | 10 | Good |
| `tests/unit/storage/MemoryStore.test.ts` | Unit | MemoryStore | 27 | **FAILING** -- native module mismatch |
| `tests/unit/storage/ChatHistoryStore.test.ts` | Unit | ChatHistoryStore | 19 | **FAILING** -- native module mismatch |
| `tests/unit/storage/EmbeddingClient.test.ts` | Unit | EmbeddingClient | 13 | Good -- mock-based |
| `tests/unit/commands/CommandRouter.test.ts` | Unit | CommandRouter | 18 | Good |
| `tests/unit/modes/PlanMode.test.ts` | Unit | PlanMode | 16 | Good |
| `tests/unit/agents/SubAgentPrompts.test.ts` | Unit | SubAgentPrompts | 11 | Good |
| `tests/unit/mcp/McpClient.test.ts` | Unit | McpClient | 10 | Good |
| `tests/unit/mcp/McpManager.test.ts` | Unit | McpManager | 9 | Good |
| `tests/unit/panels/GemmaCodePanel.test.ts` | Unit | GemmaCodePanel | 9 | **Partial** -- 9 tests for 1,079 LOC |
| `tests/unit/ollama/client.test.ts` | Unit | Ollama client | 9 | Good |
| `tests/unit/skills/SkillLoader.test.ts` | Unit | SkillLoader | 8 | Good |
| `tests/unit/errors/error-handling.test.ts` | Unit | Error handling | 8 | Good |
| `tests/unit/agents/SubAgentManager.test.ts` | Unit | SubAgentManager | 7 | Good |
| `tests/unit/tools/ConfirmationGate.test.ts` | Unit | ConfirmationGate | 7 | Good |
| `tests/unit/tools/ToolCatalog.test.ts` | Unit | ToolCatalog | 6 | Good |
| `tests/unit/config/settings.test.ts` | Unit | Settings | 6 | Good |
| `tests/unit/modes/EditMode.test.ts` | Unit | EditMode | 6 | Good |
| `tests/unit/mcp/McpServer.test.ts` | Unit | McpServer | 6 | Good |
| `tests/unit/config/PromptBudget.test.ts` | Unit | PromptBudget | 5 | Good |
| `tests/unit/extension.test.ts` | Unit | Extension entry | 3 | Minimal |
| `tests/integration/ollama-health.test.ts` | Integration | Ollama health | N/A | Requires Ollama |
| `tests/integration/commands/skill-execution.test.ts` | Integration | Skill execution | N/A | Requires Ollama |
| `tests/e2e/extension-load.test.ts` | E2E | Extension load | N/A | 1 skipped |

**Python Tests (6 test files, 41 test cases, 91% coverage)**

| Test File | Type | Module Covered | Tests | Quality |
|-----------|------|----------------|-------|---------|
| `tests/unit/test_prompt.py` | Unit | prompt.py | 29 | Excellent -- comprehensive |
| `tests/unit/test_ollama_service.py` | Unit | ollama.py | 9 | Good -- error paths |
| `tests/integration/test_chat_endpoint.py` | Integration | chat.py | 5 | Good -- SSE parsing |
| `tests/integration/test_health_endpoint.py` | Integration | health.py | 2 | Good |
| `tests/benchmarks/bench_prompt.py` | Benchmark | prompt.py | 4 | Good -- regression |

**Benchmark Files (5 TypeScript + 1 Python)**

| Benchmark File | Focus |
|----------------|-------|
| `tests/benchmarks/context-compaction.bench.ts` | Compaction pipeline throughput |
| `tests/benchmarks/rendering.bench.ts` | Markdown rendering speed |
| `tests/benchmarks/skill-loading.bench.ts` | YAML skill file parsing |
| `tests/benchmarks/time-to-first-token.bench.ts` | Streaming pipeline latency |
| `tests/benchmarks/tool-execution.bench.ts` | Tool handler throughput |
| `src/backend/tests/benchmarks/bench_prompt.py` | Prompt assembly for 10/50/100 messages |

#### Feature-to-Test Mapping

| Feature / Capability | Unit Tests | Integration Tests | E2E Tests | Coverage Assessment |
|----------------------|------------|-------------------|-----------|---------------------|
| Ollama communication | Yes (9) | Yes (health) | No | Adequate |
| Chat streaming | Yes (10) | No | No | Adequate |
| Conversation management | Yes (26) | No | No | Adequate |
| Prompt building | Yes (26) | No | No | Adequate |
| Context compaction (5 strategies) | Yes (35) | No | No | Adequate |
| Context compactor orchestration | Yes (12) | No | No | Adequate |
| Gemma 4 tool call parsing | Yes (28) | No | No | Adequate |
| Agent loop (tool execution cycle) | Yes (16) | No | No | Adequate |
| Tool registry | Yes (14) | No | No | Adequate |
| Tool activation rules | Yes (10) | No | No | Adequate |
| Filesystem tools (read/write/edit/etc.) | Yes (21) | No | No | Gap -- no attack vectors |
| Terminal tool | Yes (12) | No | No | Gap -- no injection bypasses |
| Web search + fetch page | Yes (12) | No | No | Gap -- no SSRF bypasses |
| Confirmation gate | Yes (7) | No | No | Adequate |
| Chat history persistence (SQLite) | Yes (19) | No | No | **Critical Gap** -- all failing |
| Memory system (FTS5 + semantic) | Yes (27) | No | No | **Critical Gap** -- all failing |
| Embedding client | Yes (13) | No | No | Adequate |
| MCP client | Yes (10) | No | No | Adequate |
| MCP manager | Yes (9) | No | No | Adequate |
| MCP server | Yes (6) | No | No | Adequate |
| Sub-agent manager | Yes (7) | No | No | Adequate |
| Sub-agent prompts | Yes (11) | No | No | Adequate |
| Command router | Yes (18) | No | No | Adequate |
| Plan mode | Yes (16) | No | No | Adequate |
| Edit mode | Yes (6) | No | No | Adequate |
| Skill loader | Yes (8) | Yes (execution) | No | Adequate |
| Settings / config | Yes (6) | No | No | Adequate |
| Prompt budget | Yes (5) | No | No | Adequate |
| GemmaCodePanel (orchestrator) | Yes (9) | No | No | **Gap** -- 9 tests for 1,079 LOC |
| Session list panel | No | No | No | **Critical Gap** -- no tests |
| Extension entry point | Yes (3) | No | Yes (1) | Minimal |
| Python: prompt assembly | Yes (29) | No | No | Adequate (100% coverage) |
| Python: Ollama service | Yes (9) | No | No | Adequate (88% coverage) |
| Python: chat endpoint | No | Yes (5) | No | Adequate (100% coverage) |
| Python: health endpoint | No | Yes (2) | No | Adequate (100% coverage) |
| Python: models endpoint | No | No | No | **Gap** -- 54% coverage |
| Python: config/settings | No | No | No | **Gap** -- 84% coverage, no direct tests |

#### Use Case and Edge Case Coverage Matrix

| Workflow | Happy Path | Invalid Input | Auth Failure | Boundary Conditions | External Failure | Concurrent Access |
|----------|------------|---------------|--------------|---------------------|-----------------|-------------------|
| Send chat message | Yes | Yes (empty) | N/A (local) | Partial (token limits) | Yes (Ollama down) | Not tested |
| Tool execution loop | Yes | Yes (bad params) | N/A | Yes (max iterations) | Partial | Not tested |
| File read/write/edit | Yes | Yes (missing file) | N/A | Yes (line limits) | N/A | Not tested |
| Terminal execution | Yes | Yes (blocked cmds) | N/A | Yes (timeout) | N/A | Not tested |
| Web search | Yes | Yes (empty query) | N/A | Yes (max results) | Not tested | Not tested |
| Context compaction | Yes | Partial | N/A | Yes (threshold) | Partial (LLM fail) | Not tested |
| Memory save/search | **Failing** | **Failing** | N/A | **Failing** | **Failing** | Not tested |
| Session load/save | **Failing** | **Failing** | N/A | **Failing** | **Failing** | Not tested |
| MCP connection | Yes | Yes (bad config) | N/A | Partial | Yes (server crash) | Not tested |
| Plan mode | Yes | Yes (invalid step) | N/A | Yes (step numbering) | N/A | Not tested |
| Slash commands | Yes | Yes (unknown cmd) | N/A | Yes | N/A | Not tested |

#### IQ/OQ/PQ Validation Assessment

| Qualification Level | Status | Gap Description |
|--------------------|--------|-----------------|
| IQ (Installation) | Partial | NSIS installer exists for Windows with component selection (Ollama, Python backend, model download). No post-install smoke test. No Linux/macOS installer. No automated validation that Ollama + model are functional after install. |
| OQ (Operational) | Partial | Functional tests cover happy paths for most features. Missing: security edge cases, concurrent access, session persistence (blocked by native module issue). Ping command (`gemma-code.ping`) provides manual verification. |
| PQ (Performance) | Partial | 6 benchmark files exist (5 TS + 1 Python) covering TTFT, compaction, rendering, skill loading, tool execution, and prompt assembly. No committed baseline numbers for regression detection. No memory or CPU profiling. No load testing of the streaming endpoint. |

#### Traceability Matrix

| Requirement / Capability | Source | Test ID(s) | Test Type | Status |
|--------------------------|--------|------------|-----------|--------|
| Chat with Gemma 4 via Ollama | README | StreamingPipeline.test.ts, client.test.ts | Unit | Covered |
| Agentic tool execution loop | README | AgentLoop.test.ts | Unit | Covered |
| Read/write/edit files | README | filesystem.test.ts | Unit | Covered (happy path) |
| Terminal command execution | README | terminal.test.ts | Unit | Covered (happy path) |
| Web search (DuckDuckGo) | README | webSearch.test.ts | Unit | Covered |
| Path traversal prevention | SECURITY.md SEC-03 | filesystem.test.ts | Unit | **Not Covered** -- no attack vector tests |
| SSRF prevention | SECURITY.md SEC-01 | webSearch.test.ts | Unit | Partial -- basic blocking tested |
| Command injection prevention | SECURITY.md SEC-02 | terminal.test.ts | Unit | Partial -- blocklist tested, no bypasses |
| Context compaction (5 strategies) | ARCHITECTURE.md | CompactionStrategy.test.ts | Unit | Covered |
| Persistent chat history | README | ChatHistoryStore.test.ts | Unit | **Blocked** -- native module failure |
| Cross-session memory | README | MemoryStore.test.ts | Unit | **Blocked** -- native module failure |
| Semantic search (embeddings) | README | MemoryStore.test.ts, EmbeddingClient.test.ts | Unit | **Blocked** (MemoryStore) / Covered (EmbeddingClient) |
| MCP client/server support | README | McpClient.test.ts, McpManager.test.ts, McpServer.test.ts | Unit | Covered |
| Sub-agent orchestration | README | SubAgentManager.test.ts, SubAgentPrompts.test.ts | Unit | Covered |
| Plan mode (numbered plans) | README | PlanMode.test.ts | Unit | Covered |
| Slash commands | README | CommandRouter.test.ts | Unit | Covered |
| Gemma 4 native tool protocol | ARCHITECTURE.md | Gemma4ToolFormat.test.ts | Unit | Covered |
| Dynamic prompt building | ARCHITECTURE.md | PromptBuilder.test.ts | Unit | Covered |
| Skill loading (YAML frontmatter) | README | SkillLoader.test.ts | Unit | Covered |
| 80% test coverage gate | CI | ci.yml coverage-gate job | CI | Covered |
| Python prompt assembly | Backend API | test_prompt.py | Unit | Covered (100%) |
| Python Ollama integration | Backend API | test_ollama_service.py | Unit | Covered (88%) |
| SSE streaming endpoint | Backend API | test_chat_endpoint.py | Integration | Covered |

#### Test Quality Findings

**[P1] better-sqlite3 native module version mismatch blocks 44 tests**
- **Location**: `tests/unit/storage/MemoryStore.test.ts`, `tests/unit/storage/ChatHistoryStore.test.ts`
- **Issue**: `better-sqlite3` was compiled against NODE_MODULE_VERSION 135 but the current Node.js requires version 137. All 44 tests in these two files fail with `ERR_DLOPEN_FAILED`. This blocks verification of the entire persistence layer (sessions + memory).
- **Recommendation**: Run `npm rebuild better-sqlite3` or reinstall with `npm install better-sqlite3 --build-from-source` to recompile against the current Node.js version.

**[P1] No security-focused test cases for validated attack vectors**
- **Location**: `tests/unit/tools/handlers/filesystem.test.ts`, `terminal.test.ts`, `webSearch.test.ts`
- **Issue**: The filesystem tests verify happy-path operations but include no test cases for path traversal attempts (e.g., `../../etc/passwd`, `..\\..\\windows\\system32`). The terminal tests verify the blocklist works but do not test bypass attempts (e.g., encoded characters, unusual whitespace). The web search tests verify SSRF blocking for basic cases but do not test edge cases (e.g., DNS rebinding, hex-encoded IPs, IPv6-mapped IPv4).
- **Recommendation**: Add a dedicated `describe("security")` block in each handler test file with attack-vector test cases.

**[P2] GemmaCodePanel has only 9 tests for 1,079 LOC**
- **Location**: `tests/unit/panels/GemmaCodePanel.test.ts`
- **Issue**: The most complex class in the codebase has minimal test coverage. The 9 tests likely cover only basic message handling. The builtin command handler (380 lines), memory commands, MCP lifecycle, and plan mode integration are untested through this class.
- **Recommendation**: After decomposing GemmaCodePanel (see Section 3.5), write focused tests for each extracted class.

#### Recommended Test Pipeline

| Test Type | Purpose | Triggers On | Estimated Duration |
|-----------|---------|-------------|-------------------|
| Unit (fast) | Logic correctness for all modules | Every commit, every PR | < 5 sec |
| Unit (SQLite) | Persistence layer correctness | Every commit, every PR | < 2 sec (after native module fix) |
| Integration | Ollama health, skill execution | Every PR | < 30 sec (requires Ollama) |
| Security | Attack vector regression tests | Every PR | < 2 sec |
| E2E | Extension load and basic workflow | Pre-merge to main | < 60 sec |
| Benchmarks | Performance regression detection | Nightly | < 30 sec |
| Smoke | Post-install verification | Post-deploy (manual) | < 10 sec |

The recommended pipeline gates PR merges on unit + security tests passing. Integration and E2E tests run as pre-merge checks. Benchmarks run nightly with committed baselines for regression detection.

---

### 3.5 Restructuring Opportunities

#### Architecture

**[P1] Decompose GemmaCodePanel into focused collaborators**
- **Current state**: `src/panels/GemmaCodePanel.ts` (1,079 LOC) handles all extension orchestration in a single class with 14 fields, 20+ methods, and a 143-line constructor.
- **Proposed state**: Extract 3 classes:
  - `CommandHandler` (lines 383-762) -- handles `/help`, `/clear`, `/history`, `/plan`, `/compact`, `/model`, `/memory`, `/think`, `/mode`
  - `ToolRegistryFactory` (lines 230-249) -- builds tool registry from settings and confirmation gate
  - `WebviewStateManager` -- consolidates postHistory, postTokenCount, postMemoryStatus, postMcpStatus, postThinkingModeStatus
  - `GemmaCodePanel` becomes a thin coordinator (~300 LOC) that delegates to these.
- **Expected benefit**: Each class is independently testable, has a single reason to change, and can be understood in isolation. Test coverage for the orchestrator path increases dramatically.
- **Estimated effort**: Medium (1-3 days)
- **Risk**: Message routing between the extracted classes needs careful design. Use an event bus or direct delegation pattern.

#### Module Boundaries

**[P2] Split webview/index.ts into composable template units**
- **Current state**: `src/panels/webview/index.ts` (1,567 LOC) generates the entire HTML/CSS/JS UI as a single template literal.
- **Proposed state**: Split into `webview/styles.ts`, `webview/scripts.ts`, `webview/templates.ts`, composed in `webview/index.ts`.
- **Expected benefit**: Each template segment can be tested in isolation, linted separately, and modified without risk of breaking unrelated UI sections.
- **Estimated effort**: Medium (1-2 days)
- **Risk**: Low -- the existing CSP nonce injection pattern works identically with composed strings.

#### Dependency Coupling

**[P2] Extract shared constants and utility module**
- **Current state**: `CHARS_PER_TOKEN = 4` defined in 4 files. `postWithRender` pattern duplicated 3+ times. `buildOllamaTools()` duplicated between GemmaCodePanel and SubAgentManager.
- **Proposed state**: Create `src/config/constants.ts` for shared constants. Add `_createPostWithRender()` as a private method on GemmaCodePanel. Move `buildOllamaToolDefinitions()` to `src/tools/ToolCatalog.ts`.
- **Expected benefit**: Single source of truth for shared values; reduces risk of inconsistent changes.
- **Estimated effort**: Low (< 1 day)
- **Risk**: None -- straightforward extraction.

#### Developer Workflow

**[P3] Add Windows and macOS CI matrix testing**
- **Current state**: CI runs only on `ubuntu-latest` with Node 20. The project ships a Windows NSIS installer but never tests on Windows in CI.
- **Proposed state**: Add `os: [ubuntu-latest, windows-latest]` matrix to `ci.yml` test jobs. macOS can be deferred.
- **Expected benefit**: Catches platform-specific issues (path separator handling, native module compilation) before release.
- **Estimated effort**: Low (< 1 day)
- **Risk**: Windows CI is slower. Mitigate by running Windows matrix only on PR merges, not every push.

---

### 3.6 Simplification and Optimization Opportunities

#### Over-Engineering

No significant YAGNI violations found. The architecture is appropriate for the project's actual complexity. The 5-strategy compaction pipeline, while sophisticated, is justified by the constrained token budget of local models.

#### Dependency Rationalization

**[P1] Vitest/Vite dev dependencies have 5 moderate vulnerabilities**
- **Location**: `package.json` dev dependencies, `npm audit` output
- **Issue**: `npm audit` reports 5 moderate severity vulnerabilities in the vitest/vite dependency chain. These are development-time only and do not affect the packaged extension.
- **Recommendation**: Update vitest to the latest version (`npm install vitest@latest @vitest/coverage-v8@latest`). If the vulnerabilities persist upstream, document them as accepted dev-only risk.

#### Configuration Simplification

**[P2] Duplicate initialization patterns should be consolidated**
- **Location**: `src/panels/GemmaCodePanel.ts:100-111,338-350,451-462` (postWithRender), `GemmaCodePanel.ts` + `SubAgentManager.ts` (OllamaTools builder)
- **Issue**: ~80 lines of duplicated initialization logic across the codebase. Preserves behavior -- this is purely a maintenance improvement.
- **Recommendation**: Extract as described in Section 3.1. This is the same recommendation as the duplication finding, consolidated here for completeness.

**[P3] Empty placeholder directories add no value**
- **Location**: `examples/.gitkeep`, `lib/.gitkeep`
- **Issue**: These directories have been empty since project inception. They occupy space in the directory listing and suggest planned content that does not exist.
- **Recommendation**: Remove both directories and their `.gitkeep` files. Re-create them when actual content is ready.

**[P3] CLAUDE.md references unimplemented components**
- **Location**: `CLAUDE.md` tech stack section
- **Issue**: Lists Rust ("performance components") and Go ("CLI/tooling") as part of the tech stack, but no Rust or Go source code exists. This could mislead contributors or tools reading the project configuration.
- **Recommendation**: Move Rust and Go to a "Planned" section, or remove until implemented.

---

## Section 4: Findings by Priority

### P0 -- Critical

None.

### P1 -- High

| # | Phase | Location | Title |
|---|-------|----------|-------|
| 1 | Code Quality | `src/panels/GemmaCodePanel.ts:50-762` | GemmaCodePanel is a god object (1,079 LOC, 14 fields, 6+ responsibilities) |
| 2 | Code Quality | `src/panels/webview/index.ts:1-1567` | Webview UI is a monolithic template literal (untestable, unmaintainable) |
| 3 | Testing | `tests/unit/storage/MemoryStore.test.ts`, `ChatHistoryStore.test.ts` | better-sqlite3 native module version mismatch blocks 44 tests |
| 4 | Testing | `tests/unit/tools/handlers/filesystem.test.ts`, `terminal.test.ts`, `webSearch.test.ts` | No security-focused test cases for validated attack vectors |
| 5 | Dependencies | `package.json` dev dependencies | 5 moderate npm audit vulnerabilities in vitest/vite chain |

### P2 -- Medium

| # | Phase | Location | Title |
|---|-------|----------|-------|
| 6 | Code Quality | `src/panels/GemmaCodePanel.ts:100-111,338-350,451-462` | Duplicate postWithRender closure (3+ instances) |
| 7 | Code Quality | `GemmaCodePanel.ts` + `SubAgentManager.ts` | Duplicate OllamaTools builder logic |
| 8 | Code Quality | 4 files across TS and Python | Magic constant CHARS_PER_TOKEN = 4 duplicated |
| 9 | Code Quality | `src/panels/GemmaCodePanel.ts:73-216` | Constructor performs all initialization (143 lines, untestable) |
| 10 | Security | `src/backend/src/backend/routers/chat.py:46-47` | No rate limiting on /chat/stream endpoint |
| 11 | Security | `src/backend/src/backend/routers/chat.py:46` | No request body size limit (unbounded messages list) |
| 12 | Security | `src/mcp/McpClient.ts:52-56` | Environment variable leakage to MCP child processes |
| 13 | Performance | `src/storage/MemoryStore.ts:179-181` | Semantic search O(n) full table scan with in-memory cosine similarity |
| 14 | Testing | `tests/unit/panels/GemmaCodePanel.test.ts` | Only 9 tests for 1,079 LOC orchestrator class |
| 15 | Restructuring | `src/panels/webview/index.ts` | Decompose into composable template units |

### P3 -- Low

| # | Phase | Location | Title |
|---|-------|----------|-------|
| 16 | Security | `src/mcp/McpManager.ts` | MCP config file lacks schema validation |
| 17 | Security | `src/tools/handlers/terminal.ts:18-33` | Terminal blocklist is deny-by-pattern (inherently incomplete) |
| 18 | Performance | `src/storage/ChatHistoryStore.ts:61` | FTS5 index rebuild on every store instantiation |
| 19 | Performance | 4 files | Token estimation heuristic rough for code-heavy content |
| 20 | Restructuring | `.github/workflows/ci.yml` | No Windows/macOS CI matrix testing despite shipping Windows installer |
| 21 | Simplification | `examples/.gitkeep`, `lib/.gitkeep` | Empty placeholder directories add no value |
| 22 | Simplification | `CLAUDE.md` tech stack | References unimplemented Rust/Go components |
| 23 | Testing | `configs/vitest.config.ts:19-24` | Coverage exclusions undocumented (BackendManager, extension.ts, utils) |

---

## Section 5: Export

*Available on request via Next Steps option 7.*

---

## Metrics Snapshot

### TypeScript

| Metric | Value |
|--------|-------|
| Source files | 42 |
| Production LOC | ~6,250 |
| Lint errors | 0 |
| Lint warnings | 13 (no-console, missing return types) |
| Build | Clean (zero errors) |
| Test files | 35 (loaded) |
| Test cases | 451 (405 passed, 44 failed, 2 skipped) |
| Test failures | 44 (all in MemoryStore + ChatHistoryStore, native module issue) |
| Coverage gate | 80% lines, 75% branches (enforced in CI) |
| npm audit | 5 moderate vulnerabilities (dev deps only) |

### Python

| Metric | Value |
|--------|-------|
| Source files | 8 (+ 4 `__init__.py`) |
| Production LOC | ~535 |
| Lint (ruff) | All checks passed |
| Lint (mypy strict) | No issues found in 12 files |
| Test files | 6 |
| Test cases | 41 (all passed) |
| Overall coverage | 91% |
| Lowest coverage | `routers/models.py` at 54%, `main.py` at 73% |

### Git

| Metric | Value |
|--------|-------|
| Total commits | 29 |
| Authors | 1 (Benjamin Dourthe) |
| Current branch | main |
| Working tree | Clean |

---

## Next Steps

Found **23 issues** (P0: 0, P1: 5, P2: 10, P3: 8) plus **4 restructuring recommendations** and **4 simplification opportunities**.

**How would you like to proceed?**

1. **Fix all** -- Implement all suggested fixes across all severity levels
2. **Fix P0/P1 only** -- Address critical and high-priority issues (rebuild native module, add security tests, begin GemmaCodePanel decomposition, update vitest)
3. **Fix specific items** -- Tell me which issues to address by number (1-23)
4. **Apply restructuring recommendations** -- Implement structural changes (GemmaCodePanel decomposition, webview split, shared constants, CI matrix)
5. **Apply simplification recommendations** -- Implement simplification opportunities
6. **Build out the test pipeline** -- Implement missing tests according to the recommended pipeline
7. **Export report** -- Generate Markdown and Word (.docx) versions of this report
8. **No changes** -- Review complete, no implementation needed

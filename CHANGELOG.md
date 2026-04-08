# Changelog

All notable changes to Gemma Code will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] — 2026-04-07

First stable release of Gemma Code — a fully offline, agentic coding assistant for VS Code powered by Google's Gemma 4 via Ollama.

### Added

**Phase 1 — Extension Skeleton & Ollama Client**
- VS Code extension scaffold with TypeScript, tsconfig, ESLint, and Vitest
- `OllamaClient` with streaming chat support (`streamChat`), health check (`checkHealth`), and model listing (`listModels`)
- Extension activation/deactivation lifecycle with an Output channel ("Gemma Code")
- `gemma-code.ping` command for verifying Ollama connectivity
- Unit tests for the Ollama client; integration smoke test for live Ollama health checks

**Phase 2 — Chat Engine & Streaming UI**
- `ConversationManager` maintaining ordered message history with token-count trimming and `onDidChange` events
- Webview chat panel (`GemmaCodePanel`) registered as a VS Code sidebar view
- Bidirectional postMessage protocol between extension host and webview
- Streaming token pipeline: each Ollama chunk is relayed to the webview in real time
- Vanilla TypeScript webview UI with streaming bubbles, Shift+Enter newlines, and auto-scroll
- Retry on stream failure within the first 3 tokens

**Phase 3 — Agentic Tool Layer**
- Tool-call protocol: model emits `<tool_call>` XML blocks; extension parses, executes, and injects `<tool_result>` messages
- Tool handlers: `read_file`, `write_file`, `create_file`, `delete_file`, `edit_file`, `list_directory`, `grep_codebase`, `run_terminal`, `web_search`, `fetch_page`
- Path traversal protection on all file system tools (workspace-root boundary check)
- `ConfirmationGate` for user-approved tool execution (edit and terminal)
- `AgentLoop` with configurable `maxAgentIterations` (default 20) and stop-signal on overflow
- Tool progress indicators in the webview ("Using tool: …")
- Web search via DuckDuckGo HTML endpoint (no API key required)

**Phase 4 — Skills, Commands & DevAI-Hub Integration**
- `SkillLoader` parsing SKILL.md frontmatter; hot-reloads from `~/.gemma-code/skills/`
- Built-in skill catalog: `commit`, `review-pr`, `generate-readme`, `generate-changelog`, `generate-tests`, `analyze-codebase`, `setup-project`
- `CommandRouter` parsing slash commands and routing to built-in handlers or skill executor
- Built-in commands: `/help`, `/clear`, `/history`, `/plan`, `/compact`, `/model`
- Inline autocomplete popup for slash commands in the webview chat input
- `PlanMode` with numbered-plan detection heuristic and step-by-step approval workflow

**Phase 5 — Advanced UX Features**
- SQLite-backed chat history (`ChatHistoryStore`) with session create/save/list/search/delete
- `/history` command showing past sessions; click to resume
- `ContextCompactor` with 80%-threshold auto-compact and `/compact` command
- Token count indicator in the webview header (X / Y tokens, colour-coded)
- Three edit modes: Auto, Ask (diff editor + confirmation), Manual (display only)
- Edit mode selector in the webview header
- Markdown rendering with `marked` and syntax highlighting with `highlight.js` (both bundled, no CDN)
- Code block "Copy" button and collapsible tool-result blocks
- Incremental streaming render: raw text during stream, full Markdown after completion

**Phase 6 — Python Backend & Inference Optimisation**
- FastAPI backend (`src/backend/`) with `/health`, `/models`, and `/chat/stream` (SSE) endpoints
- Gemma chat template formatting (`<start_of_turn>user … <end_of_turn>`) applied server-side
- `BackendManager` in TypeScript: auto-starts the Python process on activation, falls back to direct Ollama on failure
- `gemma-code.useBackend`, `gemma-code.backendPort`, and `gemma-code.pythonPath` settings

**Phase 7 — Installer & Distribution**
- VSIX build pipeline (`scripts/build-vsix.ps1`) producing `gemma-code-0.1.0.vsix`
- NSIS installer script (`scripts/installer/setup.nsi`) for Windows 10/11
  - Installs Ollama silently if not present
  - Installs the VSIX via `code --install-extension`
  - Sets up a Python virtual environment for the backend
  - Optional Gemma model download with progress display
  - Adds Start Menu shortcut and Add/Remove Programs entry
  - Uninstaller removes the venv and VS Code extension
- GitHub Actions workflows: `ci.yml` (lint + test + coverage gate), `release.yml` (VSIX + installer + GitHub Release), `nightly.yml` (integration tests + benchmarks)
- CI documentation in `docs/v0.1.0/ci-setup.md`
- E2E smoke test verifying the extension loads in VS Code without a running Ollama instance

**Phase 8 — Hardening, CI/CD & Release**
- Global `unhandledRejection` handler in `extension.ts` — logs to the Output channel instead of crashing the extension host
- Ollama availability poller: polls every 5 seconds; posts a recovery notification when Ollama comes back online; posts an error banner when it goes offline
- Startup health check with actionable error messaging and a "Pull model" quick action
- SSRF protection in `FetchPageTool`: rejects localhost, loopback, link-local, and all RFC-1918 private IP ranges; blocks non-HTTP(S) schemes
- Terminal blocklist hardening: blocklist now checks every shell-metacharacter-separated segment to prevent chain-bypass attacks
- `GemmaCodePanel.postStatus()` and `postError()` public methods for external error signalling
- Python backend crash detection with VS Code notification and graceful fallback to direct Ollama
- Performance benchmark suite: `time-to-first-token`, `context-compaction`, `tool-execution`, `skill-loading`, `markdown-rendering` — all integrated into nightly CI
- Security audit documentation (`docs/v0.1.0/security-audit.md`) with findings and remediations
- Performance benchmark documentation (`docs/v0.1.0/performance-benchmarks.md`)
- Architecture documentation (`docs/v0.1.0/architecture.md`) with component descriptions and data-flow diagrams
- Comprehensive README with installation guide, quick start, configuration reference, and troubleshooting section
- Error regression tests in `tests/unit/errors/`

### Changed

- Default model switched from `gemma3:27b` to `gemma4` (Gemma 4 e4b, 128K context, native function calling)
- Default `maxTokens` increased from 8192 to 32768 to take advantage of Gemma 4's larger context window
- Ollama requests now pass `num_ctx` and `temperature` options to the server for consistent context handling
- Nightly CI uses `gemma4:e2b` (smallest Gemma 4 variant) instead of `gemma3:2b`
- Windows installer model download updated to `gemma4` (~9.6 GB, down from ~15 GB for gemma3:27b)
- Removed duplicate `configs/eslint.config.mjs` (dead file; canonical ESLint config is at project root)

### Known Limitations

- The Rust performance components and Go CLI tooling described in the tech stack are placeholders for future phases; v0.1.0 uses TypeScript and Python only.
- The GrepCodebaseTool uses VS Code's `workspace.findFiles` API and may be slow on very large repositories (>10 000 files). A ripgrep-based implementation is planned.
- The web search tool fetches DuckDuckGo's HTML endpoint; result quality varies and the endpoint is rate-limited by IP.
- macOS and Linux installer scripts are not yet implemented; manual VSIX installation is required on non-Windows platforms.
- The E2E test suite requires a VS Code instance and is not run in the standard CI matrix; it runs manually or in the nightly workflow.

---

## [Unreleased]

- Rust performance components for file indexing and grep
- Go CLI tooling for project scaffolding
- macOS and Linux installer packages
- ripgrep-backed GrepCodebaseTool
- Extension Marketplace publication

[Unreleased]: https://github.com/bendourthe/Gemma-Code/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bendourthe/Gemma-Code/releases/tag/v0.1.0

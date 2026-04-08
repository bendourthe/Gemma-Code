# Gemma Code — Progress Dashboard

**Branch:** `main`

---

## Scores (update after each sprint)

| Metric | Current | Target | Delta |
|--------|---------|--------|-------|
| Tasks done / total | 13 / 21 | 21 / 21 | -8 |

---

## Sprint 1 — Completed Work [DONE]

- [x] Bootstrap VS Code extension scaffold with TypeScript, tsconfig, ESLint, and Vitest (Phase 1)
- [x] Implement OllamaClient with streaming chat, health check, and model listing (Phase 1)
- [x] Build chat engine with ConversationManager and streaming webview UI (Phase 2)
- [x] Implement agentic tool layer with 10 tool handlers and confirmation gate (Phase 3)
- [x] Add skill loader, command router, and plan mode with slash command autocomplete (Phase 4)
- [x] Add persistent SQLite chat history, auto-compact, and edit modes (Phase 5)
- [x] Implement Python inference backend with FastAPI and Gemma chat template (Phase 6)
- [x] Build BackendManager with auto-start and graceful fallback to direct Ollama (Phase 6)
- [x] Build Windows NSIS installer with Ollama, VSIX, venv, and model download (Phase 7)
- [x] Set up CI/CD workflows: ci.yml, release.yml, nightly.yml (Phase 7)
- [x] Fix SSRF vulnerability in FetchPageTool and harden terminal blocklist (Phase 8)
- [x] Add performance benchmark suite and error handling hardening (Phase 8)
- [x] Write comprehensive README, CHANGELOG, and architecture documentation (Phase 8)

## Sprint 2 — Active

- [ ] Implement ripgrep-backed GrepCodebaseTool to replace slow workspace.findFiles approach (CHANGELOG Known Limitations)
- [ ] Build macOS and Linux installer packages (CHANGELOG Known Limitations)
- [ ] Publish extension to VS Code Marketplace (CHANGELOG Unreleased)
- [ ] Implement Rust performance components for file indexing and grep (CHANGELOG Unreleased)
- [ ] Implement Go CLI tooling for project scaffolding (CHANGELOG Unreleased)

## Sprint 3 — Upcoming

- [ ] *(suggested)* Improve web search backend to reduce rate-limiting and improve result quality (DuckDuckGo HTML scraping is fragile)
- [ ] *(suggested)* Add E2E test suite to the standard CI matrix for pre-merge validation
- [ ] *(suggested)* Add multi-model support for running different Ollama models per task type

---

## Functionality Matrix

### Tool Handlers

| Feature | Status | File/Location | Sprint |
|---------|--------|---------------|--------|
| read_file | Done | `src/tools/handlers/` | -- |
| write_file | Done | `src/tools/handlers/` | -- |
| create_file | Done | `src/tools/handlers/` | -- |
| delete_file | Done | `src/tools/handlers/` | -- |
| edit_file | Done | `src/tools/handlers/` | -- |
| list_directory | Done | `src/tools/handlers/` | -- |
| grep_codebase | Partial | `src/tools/handlers/` | Sprint 2 |
| run_terminal | Done | `src/tools/handlers/terminal.ts` | -- |
| web_search | Done | `src/tools/handlers/webSearch.ts` | Sprint 3 |
| fetch_page | Done | `src/tools/handlers/webSearch.ts` | -- |

### Platform Installers

| Platform | Status | File/Location | Sprint |
|----------|--------|---------------|--------|
| Windows (NSIS) | Done | `scripts/installer/setup.nsi` | -- |
| macOS | Missing | -- | Sprint 2 |
| Linux | Missing | -- | Sprint 2 |
| VS Code Marketplace | Missing | -- | Sprint 2 |
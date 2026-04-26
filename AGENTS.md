# AGENTS.md — Gemma Code Agent Directive

This file is the canonical agent-agnostic directive for working in this repository. Any AI coding agent (Cursor, Copilot, Gemini CLI, Claude Code, future agents, or Gemma Code itself running against this repository) should read this file to understand project conventions, constraints, and the expected cognitive workflow.

Gemma Code is an independent local agentic coding assistant. Claude Code is its inspiration, but every file and convention in this repository uses generic agent-agnostic naming — there is no `CLAUDE.md`, no Claude-specific instructions, no Anthropic-bound assumptions in product files. (Development-time tooling such as `.claude/`, `.vscode/`, or `.idea/` directories that individual contributors may keep locally are personal IDE/agent configuration, not part of Gemma Code's identity, and are not committed to the repository.)

## Project Overview

Gemma Code is a local, agentic coding assistant for VS Code powered by Google's Gemma 4, running entirely offline via Ollama. It delivers a codebase-wide editing, terminal execution, and multi-file reasoning workflow without any external API calls or data leaving the developer's machine. Built for individual developers who want a privacy-first AI coding companion with no subscription, no latency from remote calls, and full control over the model.

## Tech Stack

- **Language**: TypeScript (VS Code extension), Python (inference backend), Rust (performance components), Go (CLI/tooling)
- **Inference**: Ollama (local Gemma 4 server via `ollama pull gemma4`)
- **Package Managers**: npm/pnpm (TypeScript), uv/pip (Python), cargo (Rust), go modules (Go)
- **Build**: tbd per component
- **Test**: Vitest (TypeScript), pytest (Python), cargo test (Rust), go test (Go)
- **Lint/Format**: ESLint + Prettier (TypeScript), ruff (Python), clippy (Rust), golangci-lint (Go)

## Project Layout

```
src/        VS Code extension TypeScript source
tests/      Unit, integration, and e2e test suites
docs/       Architecture docs, guides, API references
configs/    Linter configs, VS Code launch configs, environment templates
scripts/    Build, package, and utility scripts
assets/     Extension icons, images, fonts
examples/   Sample usage and demo workflows
lib/        Shared utilities across components
```

## Key Commands

```bash
# TypeScript extension
# npm run build
# npm run test

# Python backend
# uv run pytest
# uv run ruff check . && uv run ruff format .

# Rust components
# cargo build
# cargo test
# cargo clippy

# Go tooling
# go build ./...
# go test -race ./...
# golangci-lint run
```

## Non-Obvious Tooling

- Ollama must be running locally (`ollama serve`) before the extension will function
- The Gemma 4 model must be pulled before first use: `ollama pull gemma4`
- The VS Code extension communicates with Ollama's local REST API (default: `http://localhost:11434`)

## Communication Style

- Place punctuation outside quotation marks (logical punctuation)
- No em-dashes; use parentheses, commas, or separate sentences
- Professional teaching tone
- Never hard-wrap paragraph text at a fixed column width; write each paragraph or bullet point as a single continuous line and let the editor or terminal handle visual wrapping

## Critical Rules

- Verify work before marking complete
- Find root causes; no temporary fixes
- Destructive git commands (force-push, hard reset, branch deletion, history rewrites) require explicit user confirmation
- Never add `Co-Authored-By` lines, AI attribution footers, or AI-generated signatures to commit messages
- Commit messages must be ASCII-only: no em-dashes, en-dashes, curly quotes, ellipsis characters, or other Unicode punctuation. Use hyphens, straight quotes, and `...` instead. This prevents encoding corruption on Windows.
- **MANDATORY**: Shell-execution tool calls must include a plain-text description of the command. Do not add borders, boxes, `#` characters, padding, or manual formatting around the description — keep it as a single sentence or short paragraph.
- **MANDATORY**: Every file-read, file-glob, and content-search tool call must be preceded by a one-sentence plain-language explanation of what file or path is being accessed and why. No exceptions.
- Ask clarifying questions before coding if requirements are ambiguous. Batch all clarifying questions into the first turn rather than asking one at a time; surface multiple interpretations and acceptance criteria together so the user can answer them in a single round-trip. State any assumptions explicitly before acting.
- Every changed line must trace directly to the user's request; do not clean up adjacent code, pre-existing dead code, or style issues outside the stated scope.

## Cognitive Workflow

Every non-trivial task should follow this rhythm. The agent does not need to recite the steps; it should embody them.

1. **ANALYZE** — Identify the actual problem; restate the user's request in your own words; enumerate constraints; reference relevant code paths.
2. **PLAN** — Sketch the changes you intend to make; identify which files will be touched, which will not, and why; propose a verification approach.
3. **EXECUTE** — Make the planned changes incrementally with frequent local checks (lint, build, test) between meaningful units.
4. **VERIFY** — Run the full test suite + lint + build; manually exercise the changed behavior end-to-end where possible; capture any residual risks.
5. **PROPAGATE** — Update related documentation (README, ARCHITECTURE.md, CHANGELOG.md, relevant `docs/v0.X.0/` files) so the change is discoverable by the next contributor.

The workflow is iterative — looping back to ANALYZE when EXECUTE reveals an unmodelled constraint is normal and expected.

## Output Minimization

- Suppress verbose progress bars, banners, and informational logs from commands unless they indicate an error
- Prefer `--quiet`, `--silent`, or `-q` flags when running package managers, build tools, and test runners
- Summarize long command output rather than echoing it in full; report only counts, errors, and key results

## Module Authorship Contract

This contract documents which module owns which kind of write. It is the spirit of the rules in [configs/dependency-cruiser.cjs](configs/dependency-cruiser.cjs); when in doubt, the dependency-cruiser config is authoritative because CI gates on it.

- **`src/llm/`** is the **only module that may import or call Ollama directly.** Every other module consumes the vendor-neutral port at [src/llm/types.ts](src/llm/types.ts). Baseline exceptions (`EmbeddingClient`, `GemmaCodePanel`, `extension.ts`) are grandfathered with a v0.6.0 ratchet and listed in `configs/dependency-cruiser.cjs`.
- **`src/storage/`** is the **only module that may open SQLite databases.** Tool handlers, panels, sub-agents, and the agent loop consume `MemoryStore`, `ChatHistoryStore`, `ToolOutputCache`, and `UnifiedMemoryRetriever` as their public APIs.
- **`src/tools/handlers/`** are the **only modules that perform side-effecting operations** (filesystem mutations, terminal commands, network requests through `web_search` / `fetch_page`). Every handler routes through `pathGuard.ts`, `secretPaths.ts`, and `ConfirmationGate.ts`.
- **`src/panels/`** never imports `src/storage/` directly; communication goes through [src/panels/messages.ts](src/panels/messages.ts) so the webview sandbox cannot bypass guardrails. Pre-baseline panels (`GemmaCodePanel`, `SessionListPanel`, `TraceDashboardPanel`) are grandfathered.
- **Memory writes** are owned by `MemoryStore` and `MemoryConsolidator`; tool handlers must not insert memory rows themselves.
- **Confirmation prompts** are owned by `ConfirmationGate.ts`; individual tool handlers do not raise prompts of their own.
- **Trace events** are emitted via `MetricsCollector.ts` / `Tracer.ts`; modules never write directly to `TraceStore`.
- **Settings** are read through `src/config/settings.ts`; modules must not call `vscode.workspace.getConfiguration` directly except inside the settings module.

Forward reference: the same rules drive the mermaid module-dependency diagram in [ARCHITECTURE.md](ARCHITECTURE.md). When a refactor changes a boundary, update `configs/dependency-cruiser.cjs`, the mermaid diagram, and this section together.

## Optional Developer Harness

Gemma Code ships three agent-agnostic harness scripts under `scripts/hooks/` that you can wire into your personal agent harness (Claude Code, Cursor, husky pre-commit, or any other shell-callable hook surface). The repository does not commit any agent-specific wiring. See [docs/harness-integration.md](docs/harness-integration.md) for example wirings and the workspace-local override schema.

| Script | Purpose |
| --- | --- |
| `scripts/hooks/check-tool-permission.mjs` | Defense-in-depth check on Bash/Write/Edit against the secret-path denylist and workspace boundary |
| `scripts/hooks/check-git-control-plane.mjs` | Refuse to start a session on `main`/`master` or with a too-dirty working tree |
| `scripts/hooks/check-prompt-policy.mjs` | Reject prompts containing accidentally-pasted secrets (AWS keys, GitHub PATs, JWTs, SSH/PEM headers, Slack tokens) |

Each script reads a JSON event payload from stdin, exits 0 to allow, exits 2 with `BLOCKED: <reason>` on stderr to deny. All three target less than 50 ms p99 wall-clock on benign payloads; the benchmark `tests/benchmarks/hooks.bench.ts` enforces this.

## Tool Catalogue and Help Discovery

The agent's help-discovery surface is [src/tools/ToolCatalog.ts](src/tools/ToolCatalog.ts), projected into the system prompt by [src/chat/PromptBuilder.ts](src/chat/PromptBuilder.ts) on every turn. The catalogue is the in-extension `--help`: name, one-line description with a usage example, parameter map, required flags. When an agent emits a tool call by an unknown name, [src/tools/ToolRegistry.ts](src/tools/ToolRegistry.ts) returns a structured error pointing the agent at `get_tool_schema` so it can recover without a re-prompt. See [docs/v0.5.0/tool-audit.md](docs/v0.5.0/tool-audit.md) for the per-tool severity audit and [ARCHITECTURE.md](ARCHITECTURE.md#tool-catalogue-and-help-discovery) for the long-form description.

## Sub-Agent Specialists

Sub-agent system prompts and tool scopes are loaded from `assets/specialists/<role>.md` Markdown files (one per role: `research`, `verification`, `planning`, `orchestration`). Each file declares its `modelTier` and `toolScope` in YAML frontmatter.

A workspace-local override at `.gemma-code/specialists/<role>.md` takes precedence over the bundled file, which in turn takes precedence over a hardcoded fallback in `src/agents/SubAgentPrompts.ts`. Overrides are validated against a Zod schema; malformed overrides log a warning and fall through to the bundled file.

# AGENTS.md — Nexus Agent Directive

This file is the canonical agent-agnostic directive for working in this repository. Any AI coding agent (Cursor, Copilot, Gemini CLI, Claude Code, future agents, or the Nexus Agentic AI Coding module running against this repository itself) should read this file to understand project conventions, constraints, and the expected cognitive workflow.

Nexus is an independent local AI studio. It is the successor product to **Gemma Code** (v0.1.0 - v0.22.x), the local agentic coding VS Code extension that this repository has shipped since April 2026. The v1.0.0 cycle pivots the codebase into a four-module native desktop application (Agentic AI Coding, Local Chatbot Explorer, Image Studio, Video Lab) while preserving the existing coding engine, memory layers, plan mode, and skill catalog as the foundation of the Agentic AI Coding module. Claude Code is one of several agent harnesses that can read this repository's `.claude/agents/` and `.claude/commands/` Markdown artifacts; every file and convention in this repository uses generic agent-agnostic naming — there is no `CLAUDE.md`, no Claude-specific instructions, no Anthropic-bound assumptions in product files. Development-time tooling such as `.vscode/` or `.idea/` directories, and most of `.claude/` (hooks, settings.local.json, scheduled_tasks.lock), is personal IDE/agent configuration and is not committed. Two `.claude/` subdirectories are exceptions, carved out in `.gitignore` and tracked in-repo as agent-agnostic markdown artifacts: `.claude/agents/` (subagent prompt definitions) and `.claude/commands/` (slash-command definitions). They are written in plain Markdown, read by Claude Code today, and could be consumed by any other agent harness without translation; see the "Claude Code addenda" section at the bottom of this file for the per-file inventory.

## Project Overview

**Nexus** (target product, v1.0.0+) is a local-first native desktop application bundling four generative AI pillars — agentic coding, organized local chat, image generation/editing, and short-form video synthesis — behind a single cohesive UI. Everything runs on the host machine against open-source local models, sized for a laptop with a single consumer GPU.

**Gemma Code** (the engine that currently lives in `src/`, versions v0.1.0 - v0.22.x) is a local, agentic coding assistant for VS Code powered by Google's Gemma 4, running entirely offline via Ollama. It delivers a codebase-wide editing, terminal execution, and multi-file reasoning workflow without any external API calls or data leaving the developer's machine. Under the Nexus pivot this engine becomes the **Agentic AI Coding** module; the VS Code extension surface is preserved as an optional shipping target alongside the desktop app.

Both target the same audience: developers, creators, and data scientists who want a privacy-first AI workspace with no subscription, no latency from remote calls, and full control over the models they run.

## Tech Stack

- **Language**: TypeScript (VS Code extension + desktop shell), Python (PyQt5 installer), Rust (Tauri shell), Node 20+
- **Desktop shell**: Tauri 2.x + React 19 + Vite + Tailwind v4 (in `desktop/`)
- **Inference**: Ollama (local Gemma 4 server via `ollama pull gemma4`), LM Studio (alt backend)
- **Package Managers**: npm (TypeScript), uv/pip (Python installer), cargo (Rust)
- **Build**: tsc (extension), `tauri build` (shell), PyInstaller (installer)
- **Test**: Vitest (TypeScript), pytest (Python installer)
- **Lint/Format**: ESLint + Prettier (TypeScript), ruff (Python), clippy (Rust)

## Project Layout

```
core/                       v1.0.0 shared-core surfaces (Phase 2.3 + 2.6)
  registry/ModelRegistry.ts  models: list / install / remove / inspect
  memory/MemoryHub.ts        4-layer memory facade
  memory/chunkers/           AST-aware chunker for memory ingest (v1.2.0 Phase 4)
  memory/PrunedDenseIndex.ts LEANN-derived graph-pruned index (v1.2.0 Phase 4)
  telemetry/TelemetryBus.ts  in-process pub/sub (GPU + module events)
  skills/SkillCatalog.ts     skills: list / load / hot-reload
  storage/                   ~/.nexus/ paths + StorageMigration (Phase 2.2)
  observability/             CommandCompressor (v1.2.0 Phase 2) + redactSecrets
  codegraph/                 SQLite + FTS5 symbol/call-edge graph plus 8-tool
                              in-process MCP server (v1.2.0 Phase 3); Coding
                              pillar prefers `codegraph_*` over grep for
                              symbol queries
  config/MemoryStorageTier.ts Standard / Pruned memory tier policy (v1.2.0 Phase 4)
  coding/SubAgentPolicy.ts   read-only `intent: 'explore'` policy +
                              specialist linter (v1.2.0 Phase 5)
  lifecycle/HookBus.ts        13-event lifecycle bus (Phase 4 + Phase 5 adds
                              `lifecycle.session.reflection`)
  lifecycle/SessionReflectionHook.ts reference reflection hook implementation
                              (v1.2.0 Phase 5)
  storage/NexusIgnore.ts      shared `.nexusignore` parser (v1.2.0 Phase 5)
  storage/PermissionsDeny.ts  per-tool `.nexus/permissions.deny` parser
                              (v1.2.0 Phase 5)
  storage/FileWatcher.ts      OS-native file-watcher abstraction with 2s
                              debounce + `.nexusignore` honoring
                              (v1.2.0 Phase 6)
  codegraph/scanner/WatchedRepoScanner.ts
                              incremental codegraph re-scan driven by
                              `FileWatcher` (v1.2.0 Phase 6)
  coding/lsp/LspClient.ts     minimal LSP client (initialize / didOpen /
                              definition / references) for TS / Python /
                              Rust over JSON-RPC stdio (v1.2.0 Phase 6)
  coding/lsp/LspMcpServer.ts  MCP adapter exposing `lsp_definition` and
                              `lsp_references` tools (v1.2.0 Phase 6)

modules/                    per-pillar code (one folder per pillar)
  coding/                    Agentic AI Coding (engine still in src/ during the
                              one-cycle compat window)

src/                        VS Code extension TypeScript source (Coding engine
                              host during v1.0.0 compat window)
desktop/                    Tauri shell + Node sidecar (Phase 1)
scripts/installer/pyqt/     Nexus installer (Python, renamed from gemma_installer)
bin/nexus-check.mjs         deterministic-checks CLI (renamed from gemma-check)
tests/                      Unit / integration / e2e test suites
docs/                       Architecture docs, plans, history, known gaps
configs/                    Linter configs, dep-cruiser, vitest config
lib/                        Shared utilities (nexus-check rule helpers)
```

Boundary rule (enforced by [`configs/dependency-cruiser.cjs`](configs/dependency-cruiser.cjs)):
`core/**` MUST NOT import from `modules/**`; modules MUST NOT import from each other.

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

### Code-graph MCP (v1.2.0 Phase 3)

The `core/codegraph/` module ships a SQLite + FTS5 symbol-and-call-edge graph plus an in-process MCP server exposing eight tools (`codegraph_search`, `codegraph_context`, `codegraph_trace`, `codegraph_callers`, `codegraph_callees`, `codegraph_impact`, `codegraph_node`, `codegraph_explore`, plus the file enumerator `codegraph_files`). The Coding pillar's tool-selection prompt is instructed to prefer `codegraph_*` over `grep` / `Bash` for symbol-level questions (callers, callees, impact radius, signature lookup). The server is in-process only and never binds a network port. The graph DB lives at `~/.nexus/codegraph/<repo-fingerprint>.db`; the scanner respects `.gitignore` AND `.nexusignore` (see Phase 5.3 below).

### MemoryStorageTier policy (v1.2.0 Phase 4)

`core/config/MemoryStorageTier.ts` declares two tiers: `Standard` (the existing `DenseIndex`, full float32 embeddings on disk) and `Pruned` (`PrunedDenseIndex`, HNSW-shaped graph + chunk text only, embeddings recomputed on the search path with an in-memory LRU cache). The tier defaults to `Standard` until per-host benchmarks justify the switch; a one-way migration script lives at `scripts/migrate-dense-index-to-pruned.mjs` and is idempotent. The Phase 7.2 cycle-end benchmark shows -81.32% on-disk size for the dense index alone at the 2k-chunk CI scale ([docs/versions/v1/v1.2.0/benchmarks/memory-storage-size-2026-05-26.md](docs/versions/v1/v1.2.0/benchmarks/memory-storage-size-2026-05-26.md)). The tier sits alongside the existing `DiffusionTier` from v1.1.0 Phase 3.

### Sub-agent intent restrictions (v1.2.0 Phase 5)

Sub-agents dispatched with `intent: 'explore'` are restricted to a read-only tool allowlist (Read, Glob, Grep, `codegraph_*`, plus a configurable Bash allowlist of read-only commands). Edit / Write / side-effecting Bash calls from an `explore` sub-agent are rejected at the dispatch layer (`core/coding/SubAgentPolicy.ts`); a linter rule fires when a sub-agent definition declares `intent: 'explore'` while requesting a write tool. The 13th lifecycle hook position `lifecycle.session.reflection` fires once at session end and is wired through `core/lifecycle/SessionReflectionHook.ts`.

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
- Use hooks for deterministic automation (lint, format, pre-commit, file-write guards). Use prompts only for non-deterministic guidance (cognitive workflow, code style, communication tone). If a rule can be enforced by a script that runs without the model in the loop, ship it as a hook, not as a prompt. See [`.claude/agents/hooks-over-prompts-inventory.md`](.claude/agents/hooks-over-prompts-inventory.md) for the inventory of current prompt-based rules ranked by the enforcement-determinism gain of moving them to hooks; the actual migrations land in the v1.2.0 Phase 5 agent-loop policy work.

## Cognitive Workflow

Every non-trivial task should follow this rhythm. The agent does not need to recite the steps; it should embody them.

1. **ANALYZE** — Identify the actual problem; restate the user's request in your own words; enumerate constraints; reference relevant code paths.
2. **PLAN** — Sketch the changes you intend to make; identify which files will be touched, which will not, and why; propose a verification approach.
3. **EXECUTE** — Make the planned changes incrementally with frequent local checks (lint, build, test) between meaningful units.
4. **VERIFY** — Run the full test suite + lint + build; manually exercise the changed behavior end-to-end where possible; capture any residual risks.
5. **PROPAGATE** — Update related documentation (README, ARCHITECTURE.md, CHANGELOG.md, relevant `docs/v0.X.0/` files) so the change is discoverable by the next contributor.

The workflow is iterative — looping back to ANALYZE when EXECUTE reveals an unmodelled constraint is normal and expected.

## AGENTS.md review cadence

AGENTS.md is reviewed every 6 months against current model behavior; the next scheduled review is 2026-11-26. See [docs/todos.md](docs/todos.md) for the canonical date.

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

## Startup Rules

Run the lifecycle bootstrap before any work begins on a fresh clone or after a long pause:

- POSIX (Linux/macOS): `bash scripts/init.sh`
- Windows: `pwsh scripts/init.ps1`

The bootstrap runs five verified steps -- `npm ci`, `npm run lint`, `npm run build`, harness-files check, specialist-assets check -- and exits 0 only when all pass. Both scripts are idempotent. See [scripts/init.sh](scripts/init.sh) / [scripts/init.ps1](scripts/init.ps1) for the full step list.

## Optional Developer Harness

Gemma Code ships three agent-agnostic harness scripts under `scripts/hooks/` that you can wire into your personal agent harness (Claude Code, Cursor, husky pre-commit, or any other shell-callable hook surface). The repository does not commit any agent-specific wiring. See [docs/harness-integration.md](docs/harness-integration.md) for example wirings and the workspace-local override schema.

| Script | Purpose |
| --- | --- |
| `scripts/hooks/check-tool-permission.mjs` | Defense-in-depth check on Bash/Write/Edit against the secret-path denylist and workspace boundary |
| `scripts/hooks/check-git-control-plane.mjs` | Refuse to start a session on `main`/`master` or with a too-dirty working tree |
| `scripts/hooks/check-prompt-policy.mjs` | Reject prompts containing accidentally-pasted secrets (AWS keys, GitHub PATs, JWTs, SSH/PEM headers, Slack tokens) |

Each script reads a JSON event payload from stdin, exits 0 to allow, exits 2 with `BLOCKED: <reason>` on stderr to deny. All three target less than 50 ms p99 wall-clock on benign payloads; the benchmark `tests/benchmarks/hooks.bench.ts` enforces this.

## Tool Catalogue and Help Discovery

The agent's help-discovery surface is [src/tools/ToolCatalog.ts](src/tools/ToolCatalog.ts), projected into the system prompt by [src/chat/PromptBuilder.ts](src/chat/PromptBuilder.ts) on every turn. The catalogue is the in-extension `--help`: name, one-line description with a usage example, parameter map, required flags. When an agent emits a tool call by an unknown name, [src/tools/ToolRegistry.ts](src/tools/ToolRegistry.ts) returns a structured error pointing the agent at `get_tool_schema` so it can recover without a re-prompt. See [docs/archive/versions/v0/v0.5.0/tool-audit.md](docs/archive/versions/v0/v0.5.0/tool-audit.md) for the per-tool severity audit and [ARCHITECTURE.md](ARCHITECTURE.md#tool-catalogue-and-help-discovery) for the long-form description.

## Sub-Agent Specialists

Sub-agent system prompts and tool scopes are loaded from `assets/specialists/<role>.md` Markdown files (one per role: `research`, `verification`, `planning`, `orchestration`). Each file declares its `modelTier` and `toolScope` in YAML frontmatter.

A workspace-local override at `.gemma-code/specialists/<role>.md` takes precedence over the bundled file, which in turn takes precedence over a hardcoded fallback in `src/agents/SubAgentPrompts.ts`. Overrides are validated against a Zod schema; malformed overrides log a warning and fall through to the bundled file.

## Onboarding for New Contributors

First-time contributors: read [CONTRIBUTING-BEGINNERS.md](CONTRIBUTING-BEGINNERS.md) for an end-to-end first-PR walkthrough (pick an issue, run `npm run work <num>`, write tests, push, open the PR). The general contributor guide remains [CONTRIBUTING.md](CONTRIBUTING.md); the beginners doc layers on the first-day specifics without duplicating the conventions.

## Claude Code addenda (v0.9.0)

The repository tracks a small number of agent-agnostic Markdown artifacts under `.claude/agents/` and `.claude/commands/`. Despite the directory name, these files are plain Markdown -- they contain no agent-specific runtime hooks. Claude Code is the harness that reads them today; any future harness that maps subagent-prompt / slash-command files to its own format can consume them without translation. The rest of `.claude/` (hooks/, settings.local.json, scheduled_tasks.lock) remains personal-only and is gitignored.

The "no `CLAUDE.md`" tool-agnostic invariant is preserved: this file (AGENTS.md) remains the single canonical agent directive. Nothing under `.claude/` overrides repository-level conventions; the files below extend them with PR-ops / issue-orchestration helpers.

| Path | Role | One-line description |
| --- | --- | --- |
| `.claude/agents/pr-manager.md` | Subagent | Iteratively addresses existing reviewer comments on an open PR -- fetches `gh pr view` comments + `gh api pulls/<n>/comments`, applies in-scope fixes, replies to / dismisses out-of-scope ones, resolves threads via the GraphQL `resolveReviewThread` mutation, commits, pushes. Read-write, plain `gh` only; never calls a third-party review-as-service. |
| `.claude/agents/pr-manager-lite.md` | Subagent | Trimmed variant of `pr-manager` for fast iterations. Same comment-fetch + comment-reply flow, but skips the thread-resolution mutations to cut round-trips. Use when speed matters and resolution can be done by hand at the end. |
| `.claude/agents/taskmaster.md` | Subagent | Read-only over the repo except for `docs/todos.md`. Refreshes the progress tracker by ingesting recent commits, open issues, merged PRs, and known-gaps files; ticks completed items, adds newly identified work, never deletes a row, always cites the source SHA / issue number / known-gaps ID. |
| `.claude/agents/hooks-over-prompts-inventory.md` | Reference doc | Not a subagent. Inventory of the current AGENTS.md prompt-based rules ranked by the enforcement-determinism gain of converting each to a hook. Authored in v1.2.0 Phase 1.3; consumed by the Phase 5 agent-loop policy work that performs the migrations. Plain Markdown with no subagent frontmatter, so no harness loads it as a runnable agent. |
| `.claude/commands/ship-and-babysit.md` | Slash command | Autonomous PR loop: commits, pushes to origin, opens a PR against `bendourthe/Gemma-Code:main`, then polls Gemma-Code's own CI every ~270 s up to a hard cap of 12 ticks, resolves failures, and exits when checks are green. Explicit exclusion of CodeRabbit / OpenHuman / any third-party review-as-service polling. Complements `npm run review` (the imperative cousin); see [README.md](README.md) PR lifecycle section. |

When the cycle author adds a new file under `.claude/agents/` or `.claude/commands/`, add it to the table above in the same commit and confirm the `prompt-*` rule globs in `lib/checks/prompt-oversized.mjs` cover the new path (currently scoped to `src/chat/prompts` and `src/skills/catalog`; extension to `.claude/` is tracked under [docs/archive/versions/v0/v0.9.0/known-gaps.md](docs/archive/versions/v0/v0.9.0/known-gaps.md) 10.N.H).

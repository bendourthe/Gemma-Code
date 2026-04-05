# Project: Gemma Code

## Overview

Gemma Code is a local, agentic coding assistant for VS Code powered by Google's Gemma 4, running entirely offline via Ollama. It delivers a Claude Code-style workflow — codebase-wide editing, terminal execution, and multi-file reasoning — without any external API calls or data leaving the developer's machine. Built for individual developers who want a privacy-first AI coding companion with no subscription, no latency from remote calls, and full control over the model.

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
- Destructive git commands require user confirmation
- Never add `Co-Authored-By` lines, AI attribution footers, or AI-generated signatures to commit messages
- **MANDATORY**: When using the Bash tool, always provide a `description` as plain text only. Do NOT add borders, boxes, `#` characters, padding, or any manual formatting to the description.
- **MANDATORY**: Every Read, Glob, and Grep tool call MUST be preceded by a one-sentence plain-language explanation of what file or path is being accessed and why.
- Ask clarifying questions before coding if requirements are ambiguous

## Output Minimization

- Suppress verbose progress bars, banners, and informational logs from commands unless they indicate an error
- Prefer `--quiet`, `--silent`, or `-q` flags when running package managers, build tools, and test runners
- Summarize long command output rather than echoing it in full; report only counts, errors, and key results

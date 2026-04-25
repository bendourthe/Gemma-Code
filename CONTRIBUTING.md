# Contributing to Gemma Code

Thanks for your interest in improving Gemma Code. This document covers the minimum you need to know to land a change.

## Project tour

- TypeScript VS Code extension under [src/](./src). Composition root is [src/extension.ts](./src/extension.ts) -> [src/runtime/GemmaRuntime.ts](./src/runtime/GemmaRuntime.ts) -> [src/panels/GemmaCodePanel.ts](./src/panels/GemmaCodePanel.ts).
- Vendor-neutral LLM port at [src/llm/types.ts](./src/llm/types.ts); the Ollama adapter at [src/llm/OllamaClient.ts](./src/llm/OllamaClient.ts).
- Pre-execution safety layer at [src/guardrails/](./src/guardrails) (action classification, loop detection, git checkpoints, permission tiers).
- Local trace store + dashboard at [src/observability/](./src/observability).
- Tests mirror source layout under [tests/unit/](./tests/unit), [tests/integration/](./tests/integration), and [tests/golden/](./tests/golden).

For deeper architecture see [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/v0.4.0/](./docs/v0.4.0/). The canonical agent directive is [AGENTS.md](./AGENTS.md).

## One-command setup

```bash
# macOS / Linux
./scripts/dev-setup.sh

# Windows
powershell -ExecutionPolicy Bypass -File scripts/dev-setup.ps1
```

The script verifies Node.js 18+, installs dependencies, regenerates the golden-task index, and compiles TypeScript. Re-running is safe.

To run the extension at runtime you need [Ollama](https://ollama.com/download) and the Gemma 4 model:

```bash
ollama serve            # in one terminal
ollama pull gemma4      # one time
```

## Daily loop

```bash
npm run dev             # tsc --watch (rebuilds on change)
npm test                # unit + integration tests via Vitest
npm run lint            # ESLint
npm run package         # build the .vsix (release-style)
```

To debug the extension live, press `F5` in VS Code; this launches the Extension Development Host with the current sources.

## Conventions

- TypeScript strict mode is on. New code must compile without `any` and without disabling rules.
- No `console.*` calls inside `src/` -- use [src/utils/logger.ts](./src/utils/logger.ts).
- User-facing error strings go through [`formatForUser`](./src/utils/errors.ts); developer log strings go through `formatForLog`. The former redacts paths and known secret patterns.
- Validate external inputs with Zod at the boundary; see [src/llm/types.ts](./src/llm/types.ts) and [src/mcp/McpManager.ts](./src/mcp/McpManager.ts) for examples.
- Keep behavioral commits separate from refactor commits.
- Never weaken pre-commit hooks (`--no-verify`) or skip ESLint rules without an inline `// eslint-disable-next-line ...` comment that explains why.

## Testing

- Unit tests: `npm test` (Vitest, ~1s per file).
- Integration tests: `npm run test:integration`.
- Add tests next to the unit you change. Mirror source paths under `tests/unit/`.
- New tracing/runtime work must use a per-test `new Tracer()` instance -- the singleton was retired in v0.4.0.
- Tests that depend on environment variables or upstream services must follow the Smoke-Test Classification Rubric in [docs/v0.5.0/test-pyramid.md](./docs/v0.5.0/test-pyramid.md). Use `skipIfNoOllama()` / `skipIfMissingEnv()` from [tests/helpers/factories.ts](./tests/helpers/factories.ts); do not write bare `if (!process.env.X) return;` early returns.

## Filing changes

- Open a draft PR early. Smaller PRs land faster.
- Cite the relevant Phase / sub-task from `docs/<version>/implementation-plan.md` in the PR description when applicable.
- Update [docs/DEVLOG.md](./docs/DEVLOG.md) for user-visible changes; update [CHANGELOG.md](./CHANGELOG.md) when you bump the version.
- ASCII-only commit messages (no em-dashes, curly quotes, ellipsis characters); use `-`, `'`, and `...` instead. Pre-commit hooks enforce this.

## Where to ask

Open a GitHub issue for design questions; tag with `discussion`. Day-to-day code questions belong in PR review threads.

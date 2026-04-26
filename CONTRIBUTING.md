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

## Local git hooks

`npm install` runs `husky` automatically and wires two repository-managed hooks:

- **pre-commit** runs `npx lint-staged` against staged `src/**/*.ts`, failing on any lint error or warning. Scope is small so the hook stays under one second on a typical change-set.
- **commit-msg** runs [scripts/hooks/check-commit-msg.mjs](./scripts/hooks/check-commit-msg.mjs) and rejects any commit message containing non-ASCII bytes (em-dashes, curly quotes, ellipsis, CJK). The hook prints the offending U+ codepoints so you can locate them.

`git commit --no-verify` skips both hooks. Reserve it for hot-fix scenarios; do not normalize bypassing the hooks for routine work.

## TypeScript suppressions

`@typescript-eslint/ban-ts-comment` is configured at error severity. `@ts-expect-error`, `@ts-ignore`, and `@ts-nocheck` are all `allow-with-description` with a 20-character minimum description length:

```ts
// @ts-expect-error TypeScript inference fails because <reason>; tracked in issue #N
```

Aim to remove suppressions once the upstream issue is resolved. The 20-char minimum permits legitimate notes ("Type from upstream is wrong (issue #42)") but rejects "fix later".

## Module boundary rules

`configs/dependency-cruiser.cjs` codifies the architecture's module boundaries. CI runs `npm run deps:check` on every push; local checks via `npm run deps:check`, local SVG render via `npm run deps:graph` (requires graphviz). Hard rules (error severity): `no-llm-outside-llm-folder`, `no-panels-from-tools`, `no-tools-from-storage`, `no-storage-from-panels`. Pre-existing violations are grandfathered with a documented `BASELINE-2026-04-25; ratchet by v0.6.0` annotation; new violations always fail CI.

## Dependency updates

[`.github/dependabot.yml`](./.github/dependabot.yml) opens grouped weekly PRs every Monday at 06:00 UTC across three ecosystems: `npm` (split into dev-dependencies and runtime-dependencies groups so the noise stays at ~2 PRs/week), `github-actions` (bumps the SHA pin and the version-tag comment in the same PR), and `pip` (PyQt5 installer venv). Auto-merge is intentionally disabled; let CI run, review the PR, then merge. Major-version bumps for `vscode` and `@types/vscode` are ignored by config -- they require manual coordination with `engines.vscode`. GitHub Actions are pinned to commit SHAs (40-char hex, with the version tag preserved as a trailing comment for readability); a meta-test asserts every `uses:` reference satisfies the SHA-pin rule.

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

## Optional developer harness

`scripts/hooks/` contains three Node ESM scripts you can wire into your personal agent harness (Claude Code, Cursor, husky pre-commit, or any other shell-callable hook surface). The repository deliberately does not commit any agent-specific wiring. See [docs/harness-integration.md](docs/harness-integration.md) for full instructions and the workspace-local override schema for `check-prompt-policy.mjs`.

The git control-plane hook respects `GEMMA_HOOK_DIRTY_LIMIT` (default 50) for the maximum tolerated dirty-file count at session start.

## Sub-agent specialists

Sub-agent system prompts and tool scopes live in `assets/specialists/<role>.md` (one file per role). The runtime priority chain is:

1. `<workspace>/.gemma-code/specialists/<role>.md` (workspace override; not committed)
2. `<extension>/assets/specialists/<role>.md` (bundled with the extension)
3. Hardcoded fallback in `src/agents/SubAgentPrompts.ts`

Workspace overrides are validated via Zod at load time. A malformed override logs a warning and falls through to the bundled file; the agent harness layer (the optional developer harness above) is the place to enforce policy on what an override may contain.

## Where to ask

Open a GitHub issue for design questions; tag with `discussion`. Day-to-day code questions belong in PR review threads.

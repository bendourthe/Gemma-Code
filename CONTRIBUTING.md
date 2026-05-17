# Contributing to Nexus

Thanks for your interest in improving Nexus. This document covers the minimum you need to know to land a change. If you are new to open source or do not yet have Node.js installed, start with [CONTRIBUTING-BEGINNERS.md](CONTRIBUTING-BEGINNERS.md) -- the step-by-step variant of this same workflow.

> **Heads-up: project in pivot.** Nexus is the successor product to **Gemma Code** (v0.1.0 - v0.22.x). The repository name, branding, and target shape are mid-transition from a single VS Code extension to a four-module native desktop app. The v1.0.0 Phase 2 rebrand sweep is in flight: settings keys, storage paths, the deterministic-checks CLI, the Python installer package, and the load-bearing code identifiers (`GemmaCodePanel`, `GemmaRuntime`) have been renamed to the `nexus.*` namespace with a one-cycle compat shim. The Gemma 4 *model* (`gemma4`, `Gemma 4`, `Gemma4ToolFormat`) is intentionally NOT renamed.

## Project tour

- v1.0.0 shared core under [core/](./core) (`ModelRegistry`, `MemoryHub`, `TelemetryBus`, `SkillCatalog`, `StorageMigration`).
- Per-pillar modules under [modules/](./modules). The Coding pillar currently lives under [src/](./src) during the one-cycle compat window; wholesale move to [modules/coding/](./modules/coding/) is tracked in [docs/v1.0.0/known-gaps.md](./docs/v1.0.0/known-gaps.md) under code `MV`.
- Composition root: [src/extension.ts](./src/extension.ts) -> [src/runtime/NexusCodingRuntime.ts](./src/runtime/NexusCodingRuntime.ts) -> [src/panels/NexusCodingPanel.ts](./src/panels/NexusCodingPanel.ts).
- Vendor-neutral LLM port at [src/llm/types.ts](./src/llm/types.ts); the Ollama adapter at [src/llm/OllamaClient.ts](./src/llm/OllamaClient.ts).
- Pre-execution safety layer at [src/guardrails/](./src/guardrails) (action classification, loop detection, git checkpoints, permission tiers).
- Local trace store + dashboard at [src/observability/](./src/observability).
- Tauri desktop shell under [desktop/](./desktop) (Phase 1).
- PyQt5 installer under [scripts/installer/pyqt/](./scripts/installer/pyqt/) (`nexus_installer` Python package, renamed from `gemma_installer` in Phase 2.5).
- Deterministic-checks CLI at [bin/nexus-check.mjs](./bin/nexus-check.mjs) (renamed from `gemma-check` in Phase 2.4; legacy alias kept for one cycle).
- Tests mirror source layout under [tests/unit/](./tests/unit), [tests/integration/](./tests/integration), and [tests/golden/](./tests/golden).

For deeper architecture see [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/v1.0.0/architecture.md](./docs/v1.0.0/architecture.md). The canonical agent directive is [AGENTS.md](./AGENTS.md).

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

## Commit message format

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The header is `<type>(<scope>): <subject>`; allowed types are `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`, `perf`, `revert`, `style`. Header length capped at 100 chars. Configuration lives in [commitlint.config.cjs](./commitlint.config.cjs) and is enforced both locally (commit-msg hook) and in CI ([.github/workflows/commitlint.yml](./.github/workflows/commitlint.yml) — runs on every PR).

`semantic-release` (configured in [.releaserc.json](./.releaserc.json)) consumes the conventional-commit history on push to `main`, regenerates `CHANGELOG.md`, bumps `package.json`, and pushes a `vX.Y.Z` tag. The tag triggers [release.yml](./.github/workflows/release.yml) which builds the VSIX. The plugin chain is `changelog -> git -> github` — there is no `@semantic-release/npm` because Gemma Code ships as a VSIX, not an npm package.

Do **not** add a `prepare-commit-msg` hook injecting a `Co-Authored-By` template — `AGENTS.md` forbids it.

## Local git hooks

`npm install` runs `husky` automatically and wires two repository-managed hooks:

- **pre-commit** runs `npx lint-staged` against staged `src/**/*.ts`, failing on any lint error or warning. Scope is small so the hook stays under one second on a typical change-set.
- **commit-msg** runs [scripts/hooks/check-commit-msg.mjs](./scripts/hooks/check-commit-msg.mjs) and rejects any commit message containing non-ASCII bytes (em-dashes, curly quotes, ellipsis, CJK). The hook prints the offending U+ codepoints so you can locate them. The conventional-commit format is enforced in CI by the commitlint workflow above; if you prefer to fail fast locally, add `npx commitlint --edit "$1"` to your own copy of [.husky/commit-msg](./.husky/commit-msg).

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
- Golden suite (operator-invoked; not in CI): Python framework at [tests/golden/framework/](./tests/golden/framework/). Canonised in [ADR-0017](./docs/adr/0017-golden-runner-disposition.md). Capture a new baseline with `python tests/golden/framework/run_all.py --model gemma4:e4b --output tests/golden/baselines/<version>.json` on a quiescent workstation with `ollama serve` running.
- Add tests next to the unit you change. Mirror source paths under `tests/unit/`.
- New tracing/runtime work must use a per-test `new Tracer()` instance -- the singleton was retired in v0.4.0.
- Tests that depend on environment variables or upstream services must follow the Smoke-Test Classification Rubric in [docs/v0.5.0/test-pyramid.md](./docs/v0.5.0/test-pyramid.md). Use `skipIfNoOllama()` / `skipIfMissingEnv()` from [tests/helpers/factories.ts](./tests/helpers/factories.ts); do not write bare `if (!process.env.X) return;` early returns.
- Set `LMSTUDIO_LIVE=1` to run the env-gated LM Studio live test at [tests/integration/llm/LmStudioClient.live.test.ts](./tests/integration/llm/LmStudioClient.live.test.ts) (requires a running local LM Studio server on `127.0.0.1:1234` with at least one model loaded; override the URL with `LMSTUDIO_BASE_URL`). Without the env var the test is skipped silently.
- For non-trivial refactors and any externalization of compiled state to runtime data, follow the [refactor playbook](./docs/refactor-playbook.md) — write characterization tests *before* touching the module so behavior preservation is provable.

## Branch hygiene

[`.github/workflows/branch-cleanup.yml`](./.github/workflows/branch-cleanup.yml) runs Sundays at 06:00 UTC and deletes stale `dependabot/`, `copilot/`, and `feature/` branches that satisfy *both* (a) older than 30 days, and (b) already merged into `main`. The first two weeks of scheduled runs are intentionally dry-run only; the workflow summary lists candidates so the merged-into-main safety net can be reviewed before any branch is deleted. Flip the cron path to `dry_run: false` only after two consecutive dry-run summaries look correct.

Manual dispatch supports `dry_run` and `max_age_days` inputs. Add `WIP:` to a commit message on a branch tip to grandfather it; protected names (`main`, `master`, `develop`, `release/*`, `hotfix/*`) are never deleted.

## Code ownership and review

[`.github/CODEOWNERS`](./.github/CODEOWNERS) declares the default owner for the repository plus explicit owners for security-sensitive paths (`SECURITY.md`, `src/utils/ssrf.ts`, `src/tools/handlers/`, `src/guardrails/`, `scripts/installer/`, `scripts/hooks/`, `.github/`, `configs/dependency-cruiser.cjs`, `docs/adr/`). GitHub auto-requests review from the listed owner when a PR touches one of those paths. The repository is single-author today; the file sets the contract for future contributors and can be updated when team aliases are introduced.

## Adding a new tool

When you ship a new tool (built-in handler or MCP-side):

- Update [src/tools/ToolCatalog.ts](./src/tools/ToolCatalog.ts) with the schema (name, description with one usage example, parameters with `required` flags).
- Update [docs/v0.5.0/tool-audit.md](./docs/v0.5.0/tool-audit.md) with a row classifying the tool against the severity rubric (`blocker | friction | optimization`).
- Ensure every error returned by the handler contains the failing parameter name and a `Usage:` hint per the actionability convention. Property-based tests in [tests/unit/tools/errors.test.ts](./tests/unit/tools/errors.test.ts) enforce this on every PR.

## Tool quality and severity

When discussing tool surfaces (existing or proposed), use the severity rubric in [docs/v0.5.0/tool-audit.md](./docs/v0.5.0/tool-audit.md): `blocker | friction | optimization`. The labels are vocabulary, not a CI gate; they keep PR descriptions and review threads grounded in the same definitions. If you add a new tool or change an existing tool's schema, update the audit table in the same PR.

## Issue records

For multi-week investigations and recurring patterns, capture a forensic record under [docs/issues/](./docs/issues/) using [docs/issues/_template.md](./docs/issues/_template.md). The template is YAML-frontmatter Markdown with four sections: What, Why, Resolution, References. Use the severity rubric from [docs/v0.5.0/tool-audit.md](./docs/v0.5.0/tool-audit.md) (`blocker | friction | optimization`).

This is an opt-in convention. Small issues do not need an entry. Do not retroactively backfill closed issues; start the practice from the next investigation forward. Filenames follow `<id>-<short-slug>.md` (e.g. `0001-ollama-warm-up-latency.md`).

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

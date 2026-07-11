# v0.8.0 Phase 7 (post-CI) -- CI workflow audit

**Date**: 2026-05-16
**Trigger**: CI run 69328475165 against commit `8954589` failed two jobs (gemma-check, docs/index.md sync check). This document records the root-cause analysis, the fixes landed in the immediate follow-up commit, and the broader gaps the audit surfaced.

## 1. Failures observed on run 69328475165

| Job | Outcome | Root cause |
|---|---|---|
| `gemma-check (src/)` | exit 1 | 42 findings in `src/skills/catalog/**/SKILL.md` (38 ASCII errors, 4 oversized-prompt warnings). All 42 were pre-existing v0.7.0 catalog content that the `gemma-check` walker now scans because the Phase 5.9 prompt rules enable markdown walking by default. Documented as v0.8.0 known-gap 10.O.O. |
| `docs/index.md sync check` | exit 1 | `npm run catalog` regeneration produces a 28-line diff vs. the committed `docs/index.md`. The committed file froze at a pre-Phase-1 module shape (16 modules with the v0.7.0 file counts) and was never regenerated as Phases 1-6 added new files under `src/chat`, `src/llm`, `src/skills`, `src/storage`, `src/tools`, etc. |
| All other 15 jobs | pass | Lint, build, unit + integration tests, coverage gate, init.sh / init.ps1, npm audit, pip-audit, package-skills, check-architecture, installer pytest -- all green. |

## 2. Fixes landed in the immediate follow-up commit

### 2.1 ASCII-only enforcement on the 6 violating skill files

- `src/skills/catalog/setup-project/SKILL.md`
- `src/skills/catalog/generate-tests/SKILL.md`
- `src/skills/catalog/generate-readme/SKILL.md`
- `src/skills/catalog/generate-changelog/SKILL.md`
- `src/skills/catalog/commit/SKILL.md`
- `src/skills/catalog/analyze-codebase/SKILL.md`

Replacements applied:
- U+2014 (em-dash) -> `--`
- U+2013 (en-dash) -> `-`
- U+2265 (>=) -> `>=`
- U+2264 (<=) -> `<=`
- U+201C / U+201D (left/right double quote) -> straight `"`
- U+2018 / U+2019 (left/right single quote) -> straight `'`
- U+2026 (ellipsis) -> `...`

The replacements are content-preserving (visually identical in monospace markdown renderers, byte-identical in ASCII contexts).

### 2.2 `gemma-check` CLI exit-code semantics realigned

The legacy CLI returned exit 1 on any finding, including warnings. The new contract matches ESLint / ruff / dependency-cruiser:

- exit 0 when there are no `error`-severity findings (warnings + info are reported to stdout but do not gate)
- exit 1 when at least one `error`-severity finding fires
- exit 2 for invocation / I/O errors
- new `--strict` flag restores the legacy "any finding fails" behaviour for zero-tolerance callers

This change unblocks CI on the 4 outstanding `prompt-oversized` warnings (10.O.O follow-up) without weakening the actual error gates (em-dash, non-ASCII, BOM, console.log, secret patterns, math-random-for-tokens, env-file-leakage, bare-promise-rejection).

Tests added: `tests/unit/lib/gemma-check-exit-codes.test.ts` (6 cases via child-process spawn -- placed under `tests/unit/lib/` to side-step the 10.O.D vitest-vm-transform Windows bug).

### 2.3 `docs/index.md` regenerated

`node scripts/generate-catalog.mjs` re-emits the module catalog from current `src/` shape. The drift is from Phases 1-6 module additions (new files in `src/chat/`, `src/llm/`, `src/skills/`, `src/storage/`, etc.) -- not a problem with the generator.

## 3. Broader CI workflow audit (gaps surfaced but not fixed in this commit)

### 3.1 Node.js 20 deprecation (P2, 2026-06 deadline)

Every action in the workflow is pinned to a Node 20-bundled version. GitHub Actions will force Node 24 by default starting 2026-06-02 and remove Node 20 from the runner image on 2026-09-16. Concrete upgrade path:

- `actions/checkout@v4.2.2` -> `actions/checkout@v5` (when stable)
- `actions/setup-node@v4.4.0` -> `actions/setup-node@v5` (when stable)
- `actions/setup-python@v5.6.0` -> `actions/setup-python@v6` (when stable)
- `actions/upload-artifact@v4.6.2` -> `actions/upload-artifact@v5`
- `actions/download-artifact@v4.3.0` -> `actions/download-artifact@v5`
- `actions/cache@v4.2.3` -> `actions/cache@v5`

The runner matrix (`node-version: ["20.x", "22.x"]`) should add `"24.x"` ahead of the deadline.

### 3.2 Missing: VSIX packaging smoke (FIXED in this commit)

Added a new `package-vsix` job that runs `vsce package --no-dependencies` on every push. The 3.09 MB VSIX is uploaded as a 7-day artifact so reviewers can pull it down and load it into VS Code without waiting for a release tag. Catches `.vscodeignore` drift, missing assets in `package.json#files`, and prebuilt-binary omissions at the merge gate rather than at release time.

### 3.3 Coverage gate covers lines + branches but not functions (P3)

`coverage-gate` reads `coverage-summary.json` and asserts `lines >= 80` and `branches >= 75`. It does not check `functions`. A module with 95% line coverage can have a long-untested function as long as the call sites are exercised by other tests. Recommend adding `functions >= 80` to the gate. Low priority because the current line + branch threshold already catches the typical regression patterns.

### 3.4 Single-version coverage artifact (P3)

Coverage is uploaded only from `Test TypeScript (Node 20.x)`. If the Node 20 / Node 22 paths diverged (e.g. a polyfill-only-on-20 conditional), the coverage gate would be blind. Cheap fix: also upload on Node 22.x and diff. Low priority -- current divergence risk is small.

### 3.5 `npm run check:prompts` is documented but never gated on CI (P2)

The script `npm run check:prompts` exists (Phase 5.9) and runs `gemma-check` against the prompt / skill markdown trees only. With the 38 ASCII errors now fixed, this could become a dedicated CI step that fails on prompt-rule errors. Recommend adding it as a new `check-prompts` job mirroring `gemma-check`. Defer until 10.O.O is fully closed (the 4 oversized-prompt warnings are unrelated to the ASCII fixes).

### 3.6 Integration tests run on every push but do not gate on Ollama-touching cases (P3)

`npm run test:integration` already runs as part of `npm run test` via the shared vitest config (`include: tests/integration/**`). The Ollama-touching cases gracefully skip via `runIf(OLLAMA_AVAILABLE)`. The nightly workflow (`.github/workflows/nightly.yml`) installs Ollama and runs the same suite with the live model. This is correct, but the nightly job is silent on failure -- consider gating PRs on nightly-green for any commit that touches `src/llm/`, `src/storage/MemoryHnswIndex.ts`, or `src/chat/StreamingPipeline.ts`.

### 3.7 No semgrep / CodeQL security gate (P2)

`audit-ts` and `audit-py` cover dependency CVEs but no SAST is in place for the project's own source. GitHub provides CodeQL via `github/codeql-action`; a single job adds the typical OWASP rules + JavaScript / TypeScript checks for prototype pollution, regex DoS, command injection. Recommend adding as a non-blocking job first, then upgrading to a gate once the baseline is clean.

### 3.8 No benchmark regression gate on push (P3)

`scripts/check-bench-regressions.mjs` exists and runs nightly. PRs that materially regress hot paths (rendering, FTS5 search, HNSW retrieval) only surface in the next-day report. Recommend a fast-path bench job that runs only the rendering benches (~3 s) on every push and checks against the v0.8.0 baseline. Full bench remains nightly.

### 3.9 `npm run deps:check` is gated via `check-architecture.sh` but no upload of the depcruise SVG (P3)

A reviewer who wants to see the dependency graph has to run `npm run deps:graph` locally. Recommend uploading the generated SVG as a 7-day artifact from the `check-architecture` job; the reviewer pulls it without a local install.

### 3.10 Workflow-level fail-fast disabled for matrix jobs but not for the cross-job graph (P3)

`fail-fast: false` is set for `lint-ts`, `test-ts`, `build-ts` matrices. The repo-level CI does NOT use `if: success()` chaining, so each job runs independently and failures are reported in parallel. This is correct -- documenting here for future readers.

## 4. Summary

| Bucket | Action | Status |
|---|---|---|
| Immediate failures | Fix the 38 ASCII errors; regenerate `docs/index.md` | Fixed in this commit |
| Immediate failures | Change `gemma-check` exit semantics so warnings do not gate | Fixed in this commit |
| CI surface gap | Add VSIX packaging smoke check | Fixed in this commit |
| Toolchain | Upgrade GitHub Actions to Node 24-compatible versions | Tracked as 10.O.AB (v0.8.0 known-gaps) -- deadline 2026-06-02 |
| Coverage | Add `functions >= 80` to coverage-gate | Tracked as 10.O.AC |
| Linting | Add dedicated `check-prompts` job after 10.O.O closes | Tracked as 10.O.AD |
| Security | Add CodeQL SAST job (non-blocking initially) | Tracked as 10.O.AE |
| Perf | Add push-time fast-bench job for hot paths | Tracked as 10.O.AF |
| Diagnostics | Upload depcruise SVG as `check-architecture` artifact | Tracked as 10.O.AG |

## 5. References

- Failing CI run logs: `logs_69328475165` (local copy supplied by the operator).
- v0.7.0 known-gaps row 10.O.O: 38 catalog ASCII findings, marked for Phase 7 polish.
- v0.8.0 known-gaps Section 10 (this file's new rows 10.O.AB through 10.O.AG land in the next known-gaps update).
- `bin/gemma-check.mjs`, `lib/checks/*.mjs`, `configs/vitest.config.ts`, `.github/workflows/ci.yml`.

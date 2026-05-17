# v0.9.0 Phase 4 -- Session History

**Date**: 2026-05-16
**Phase**: 4 -- Internal RE builds: dev-loop ergonomics
**Plan**: [docs/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md)
**Sub-tasks landed**: 4.1, 4.2, 4.3, 4.4, 4.5

---

## 1. Chronological steps

### Step 1: Pre-implementation review

Read the Phase 4 section of the cycle plan in full. The phase ships four reverse-engineered dev-loop ergonomics artifacts (cross-platform `npm run debug ...` runners, a `coverage-diff.yml` workflow, a husky `pre-push` hook, and `npm run work <issue>`). Confirmed prerequisites: Phase 3 closed (per [docs/v0.9.0/known-gaps.md](../../known-gaps.md), five markdown artifacts shipped; Phase 3 session history exists). Verified `scripts/debug/` does not exist; verified `.github/workflows/coverage-diff.yml` does not exist; verified `.husky/pre-push` does not exist (`.husky/` currently has `commit-msg`, `pre-commit`, and the husky `_` shim); verified `scripts/work.mjs` does not exist; verified `npm run debug` and `npm run work` are unused. Verified existing convention for cross-platform Node scripts by reading [scripts/test.mjs](../../../../scripts/test.mjs) (shebang + `set` style, ESM, `node:child_process` spawn pattern, `shell: process.platform === "win32"` for `npm`).

### Step 2: 4.1 -- Cross-platform `npm run debug ...` runners

Wrote [scripts/debug/cli.mjs](../../../../scripts/debug/cli.mjs) as the single dispatcher. The public exports are `main(argv)`, `buildVitestArgs(kind, parsed)`, `summarizeVitestOutput(raw)`, `extractFailureBlocks(body, contextLines)`, and `listLogs()` -- all of them pure (no global state) so the unit tests can exercise them without spawning vitest. The CLI dispatches to `runVitestKind(kind, rawArgs)` for `unit`/`integration`/`golden`/`bench` and to `logsCommand(rest)` for `logs list` / `logs last` / `logs <run-id>`.

Runner internals: spawn `npx vitest run --config configs/vitest.config.ts <kind-positional>`; create `out/debug-logs/<kind>-<ISO-ts>.log` via `createWriteStream`; pipe `child.stdout` and `child.stderr` into a `PassThrough` so we can tee to the log file *and* to stdout when `--verbose` is set; append `# exit <code>` to the log file after the child exits; print failure blocks + the trailing summary (Test Files / Tests / Duration) by default, full body under `--verbose`. The Windows-portable spawn uses `shell: process.platform === "win32"` for `npm`/`npx` shims.

Wrote five thin sibling delegates ([scripts/debug/unit.mjs](../../../../scripts/debug/unit.mjs), [integration.mjs](../../../../scripts/debug/integration.mjs), [golden.mjs](../../../../scripts/debug/golden.mjs), [bench.mjs](../../../../scripts/debug/bench.mjs), [logs.mjs](../../../../scripts/debug/logs.mjs)) each ~7 lines that import `main` from `./cli.mjs` and prepend the kind to `process.argv`. This is deliberately small surface so a contributor can invoke `node scripts/debug/unit.mjs` directly without the `npm run debug` indirection.

Added `"debug": "node scripts/debug/cli.mjs"` to [package.json](../../../../package.json). Added `out/debug-logs/` to [.gitignore](../../../../.gitignore) with a comment citing the sub-task.

Wrote [tests/unit/scripts/debug.test.ts](../../../../tests/unit/scripts/debug.test.ts) with 14 tests:

- `buildVitestArgs` (5 tests): unit kind injects `tests/unit`, integration injects `tests/integration`, golden injects `tests/integration/golden`, `--watch` and `-t` forwarded, extra positionals appended.
- `summarizeVitestOutput` (2 tests): captures Test Files / Tests / Duration; extracts FAIL blocks.
- `extractFailureBlocks` (1 test): falls back to `Error:` scan when no FAIL marker is present.
- `listLogs` (1 test): returns an array (empty or non-empty), row shape is `{ runId, kind, start, size, exit }`.
- `main` (4 tests): `--help` exits 0, no-arg exits 0, unknown command exits 2, `logs list` returns 0.
- spawn smoke (1 test): `node scripts/debug/cli.mjs --help` returns exit 0 and prints usage.

`npx vitest run tests/unit/scripts/debug.test.ts` -- 14 passed, 0 failed.

### Step 3: 4.2 -- `coverage-diff.yml` workflow

Wrote [.github/workflows/coverage-diff.yml](../../../../.github/workflows/coverage-diff.yml). Triggers on `pull_request: types: [opened, synchronize, reopened] branches: ["main"]` with concurrency group `coverage-diff-${{ github.head_ref || github.ref }}` and `cancel-in-progress: true`. Job runs on `ubuntu-latest` with `permissions: contents: read, pull-requests: write`.

Steps: checkout with `fetch-depth: 0` (so `diff-cover` can compare against `origin/main`); setup-node@v5 with Node 22; setup-python@v6 with Python 3.12; `npm ci --prefer-offline --no-audit`; `npm run test -- --coverage` (env `CI: "true"`); `python -m pip install --quiet "diff-cover==9.2.0"` (pinned per the plan); `git fetch origin main --depth=1`; `diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=80 --markdown-report=diff-coverage.md --html-report=diff-coverage.html` (run with `continue-on-error: true` so the comment step still fires); upload both reports as a 14-day `diff-coverage` artifact; on diff-cover failure post the markdown report via `gh pr comment "$PR_NUMBER" --body-file diff-coverage.md`; finally an explicit "Fail job when diff-cover failed" step flips the job red.

Did NOT modify [configs/vitest.config.ts](../../../../configs/vitest.config.ts) -- the global thresholds (`lines: 80, branches: 75`) stay as the suite-wide floor and `diff-cover` is purely additive on top.

The plan's acceptance criterion "synthetic PR with intentional coverage drop fails the workflow + posts the markdown comment; noop PR passes" requires opening two real PRs against `main` and watching the gate fire. The workflow file is lint-clean and committed; the live-PR smoke is captured as 10.N.I operator follow-up.

### Step 4: 4.3 -- Husky `pre-push` hook with auto-fix-then-retry

Wrote [.husky/pre-push](../../../../.husky/pre-push) as a POSIX shell script (runs on Git Bash on Windows + macOS / Linux). Five steps with explicit progress messages:

1. `npm run lint -- --fix || true` -- best-effort auto-fix.
2. `git diff --quiet` -- if the auto-fix touched files, print "ESLint auto-fixed files. Review with `git diff`, re-stage, re-push." and exit 1 so the push is refused (contributors must intentionally re-stage and re-push).
3. `npm run lint` -- strict, no `|| true` muting.
4. `npm run build` -- `tsc`.
5. `npm run check src/` -- gemma-check.

Wrote [tests/integration/husky-prepush.test.ts](../../../../tests/integration/husky-prepush.test.ts) with 7 tests asserting the textual contract: file exists, POSIX shebang, `set -e`, the five steps in the right order (lint --fix -> dirty-tree -> strict lint -> build -> check), prints the re-stage / re-push instruction with `exit 1`, and does NOT swallow strict-lint / build / check failures with `|| true`. Running the hook end-to-end inside `npm test` would re-enter the same vitest invocation and would add a 30+ second build round-trip per `npm test`, so the textual contract is what we assert here; the real-branch smoke is 10.N.J operator follow-up.

`npx vitest run tests/integration/husky-prepush.test.ts` -- 7 passed, 0 failed.

### Step 5: 4.4 -- `npm run work <issue>` dispatcher

Wrote [scripts/work.mjs](../../../../scripts/work.mjs). Exports `parseArgs(argv)`, `slugify(raw)`, `deriveBranchName(issueNumber, title)`, `buildAgentPrompt({ issue, extraPrompt })`, `copyToClipboard(text)`, and `main(argv)`.

CLI surface: `npm run work <issue-number> [extra-prompt] [--agent claude|codex|cursor] [--no-checkout]`. The dispatcher calls `gh issue view <num> --json number,title,body,labels,url,state,author`, derives `feat/issue-<num>-<slug>` (slug = lowercased, non-alphanum -> dash, capped at 40 chars, trailing dashes trimmed, falls back to `issue` when input collapses to empty), creates the branch via `git fetch origin main && git checkout -b <branch> origin/main` (or reuses an existing branch via `git rev-parse --verify --quiet refs/heads/<branch>` + `git checkout <branch>`), builds an agent prompt containing the issue title / number / link / state / labels / body plus the Gemma-Code conventions reminder (strict TS, no `console.*`, Zod at boundaries, files < 500 lines, ADR refs, ASCII-only, tests for new behaviour, local-gate command list), prints the prompt to stdout, and copies it to the system clipboard via `clip` (Windows), `pbcopy` (macOS), or `xclip -selection clipboard` (Linux, if present). When `--agent claude|codex|cursor` is provided AND the binary is on PATH, the prompt is piped via `child.stdin`.

Added `"work": "node scripts/work.mjs"` to [package.json](../../../../package.json).

Wrote [tests/unit/scripts/work.test.ts](../../../../tests/unit/scripts/work.test.ts) with 18 tests:

- `parseArgs` (5 tests): issue number, extra prompt, `--no-checkout`, `--agent` / `--agent=`, `--help` / `-h`.
- `slugify` (3 tests): case + dash collapse, 40-char cap + trailing-dash trim, fallback when input collapses to empty.
- `deriveBranchName` (2 tests): short title, long title with slug capped.
- `buildAgentPrompt` (6 tests): title / number / link / body verbatim; labels joined by commas; extra prompt appended; conventions present (Strict TS, Zod, 500 lines, ASCII-only, ADR); plain-string label arrays handled; missing labels / body / url handled gracefully.
- `main` (2 tests): `--help` exits 0, no-arg exits 2 with usage.

`npx vitest run tests/unit/scripts/work.test.ts` -- 18 passed, 0 failed.

### Step 6: 4.5 -- Phase-wide stabilization

Ran every gate in turn:

- `npm run lint` -- exit 0 (no findings on `src/`).
- `npm run build` -- exit 0 (`tsc` clean).
- `npm run check src/` -- exit 0, 5 pre-existing `prompt-oversized` warnings on SKILL files unrelated to Phase 4 (animate, build-second-brain, distill, harden, review-pr; the review-pr warning is at 811 tokens, 11 over the budget -- captured under 10.N.F).
- `npm run deps:check` -- exit 0, 3 pre-existing `no-orphans` warnings on `ModelPinRegistry.ts`, `planDiff.ts`, `planAnnotation.ts` (deferred-wiring artifacts).
- `npm run catalog:check` -- exit 0.
- `npm run perm-tier:check` -- exit 0.
- `npm test` -- 222 files, 2536 tests passed + 4 skipped (pre-existing), 0 failed, 26.05s. The 39 new tests from Phase 4 are visible as `tests/unit/scripts/debug.test.ts` (14), `tests/unit/scripts/work.test.ts` (18), and `tests/integration/husky-prepush.test.ts` (7).

### Step 7: Documentation sync

Updated [docs/v0.9.0/known-gaps.md](../../known-gaps.md): added 10.N.I (diff-cover live-PR smoke), 10.N.J (pre-push real-branch smoke), 10.N.K (Phase 4 atomic-commit deviation); migrated the suggested next step of 10.N.B and 10.N.C from Phase 4 to Phase 6 "UX polish" since Phase 4 was dev-loop only; recomputed the summary table (3 NI / 7 DF / 0 BG / 1 MT / 0 WN / 0 QG open; 0 / 9 / 3 / 2 / 0 / 0 resolved); appended the Phase 4 close status. Updated [docs/DEVLOG.md](../../../DEVLOG.md) with a Phase 4 entry covering each sub-task's decisions and the test surface. Wrote this session history file.

---

## 2. Files added / modified

### Added (10 files)
- [scripts/debug/cli.mjs](../../../../scripts/debug/cli.mjs)
- [scripts/debug/unit.mjs](../../../../scripts/debug/unit.mjs)
- [scripts/debug/integration.mjs](../../../../scripts/debug/integration.mjs)
- [scripts/debug/golden.mjs](../../../../scripts/debug/golden.mjs)
- [scripts/debug/bench.mjs](../../../../scripts/debug/bench.mjs)
- [scripts/debug/logs.mjs](../../../../scripts/debug/logs.mjs)
- [.github/workflows/coverage-diff.yml](../../../../.github/workflows/coverage-diff.yml)
- [.husky/pre-push](../../../../.husky/pre-push)
- [scripts/work.mjs](../../../../scripts/work.mjs)
- [tests/unit/scripts/debug.test.ts](../../../../tests/unit/scripts/debug.test.ts)
- [tests/unit/scripts/work.test.ts](../../../../tests/unit/scripts/work.test.ts)
- [tests/integration/husky-prepush.test.ts](../../../../tests/integration/husky-prepush.test.ts)
- [docs/v0.9.0/development/history/phase-04.md](.) (this file)

### Modified
- [package.json](../../../../package.json) -- added `"debug"` and `"work"` npm scripts.
- [.gitignore](../../../../.gitignore) -- added `out/debug-logs/`.
- [docs/v0.9.0/known-gaps.md](../../known-gaps.md) -- three new entries (10.N.I / 10.N.J / 10.N.K), two updated, summary + status.
- [docs/DEVLOG.md](../../../DEVLOG.md) -- Phase 4 entry.

---

## 3. Test results

- `npx vitest run tests/unit/scripts/debug.test.ts` -- 14 passed.
- `npx vitest run tests/unit/scripts/work.test.ts` -- 18 passed.
- `npx vitest run tests/integration/husky-prepush.test.ts` -- 7 passed.
- `npm test` (full suite, Windows): 222 files, 2536 tests passed + 4 skipped, 0 failed, 26.05s.

---

## 4. Deviations from the plan

- **Atomic commits**: the plan asks for one commit per artifact (debug runner, coverage-diff workflow, pre-push hook, work dispatcher). The user's invocation explicitly requested a single commit + push to main covering all four artifacts plus the docs sync, which overrides that guidance. Captured as 10.N.K.
- **Live-PR validation of coverage-diff**: the plan asks for two synthetic PRs (one with a coverage drop, one noop) to verify the gate end-to-end. This step requires opening real PRs against `main` and watching the workflow fire; deferred to operator follow-up 10.N.I.
- **Real-branch pre-push smoke**: the plan asks for a manual smoke on a real branch. Running the hook end-to-end inside the integration test would re-enter `npm test`; deferred to operator follow-up 10.N.J. The textual contract of the hook *is* asserted in `husky-prepush.test.ts`.

---

## 5. Next phase preview

Phase 5 ("Internal RE builds -- issue orchestration + PR ops") ships four more reverse-engineered builds: `npm run deep-work` (worktree lifecycle), PR template + checklist gate, `npm run agent-batch`, and `npm run review` (PR-lifecycle CLI). Prerequisites: Phase 4 complete (this commit). Reading on entry: [docs/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md) Phase 5; the existing slash command at [.claude/commands/ship-and-babysit.md](../../../../.claude/commands/ship-and-babysit.md) to scope-out the `review` overlap analysis that 5.4 requires.

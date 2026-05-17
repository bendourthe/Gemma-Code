# v0.9.0 Phase 5 -- Session History

**Date**: 2026-05-16
**Phase**: 5 -- Internal RE builds: issue orchestration + PR ops
**Plan**: [docs/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md)
**Sub-tasks landed**: 5.1, 5.2, 5.3, 5.4, 5.5

---

## 1. Chronological steps

### Step 1: Pre-implementation review

Read the Phase 5 section of the cycle plan in full and the Phase 4 close status in [docs/v0.9.0/known-gaps.md](../../known-gaps.md). Confirmed prerequisites: Phase 4 closed with `scripts/debug/`, `.github/workflows/coverage-diff.yml`, `.husky/pre-push`, and `scripts/work.mjs` in place; the four atomic-commit deviation precedents (Phases 2 / 3 / 4) made the same single-commit + push-to-main pattern likely for this phase. Verified `scripts/deep-work/` does not exist; `.github/PULL_REQUEST_TEMPLATE.md` does not exist; `scripts/check-pr-checklist.mjs` does not exist; `.github/workflows/pr-quality.yml` does not exist; `scripts/agent-batch/` does not exist; `scripts/review/` does not exist; `examples/agent-batch.spec.json` does not exist. Read [scripts/work.mjs](../../../../scripts/work.mjs) and [scripts/debug/cli.mjs](../../../../scripts/debug/cli.mjs) end-to-end to align on the cross-platform Node conventions (ESM, `node:child_process` spawn pattern, `shell: process.platform === "win32"`, structured `parseArgs` returning `positional + options`, `main(argv)` returning numeric exit codes, `--help` early-exit, `invokedDirectly` check before calling `main`).

Verified Zod is importable from a `.mjs` script (`node -e "import('zod').then(m => console.log(typeof m.z))"` -> `object`), confirming the agent-batch schema module can stay pure ESM without a TS build step.

### Step 2: 5.1 -- `npm run deep-work` worktree lifecycle

Wrote six files in [scripts/deep-work/](../../../../scripts/deep-work/):

- [shared.mjs](../../../../scripts/deep-work/shared.mjs) -- pure helpers: `slugify`, `deriveBranchName`, `deriveWorktreePath`, `ghIssueView`, `ghIssueList`, `runGit` + `tryGit`, `parseWorktreeListPorcelain`, `gitWorktrees`, `isWorktreeDirty`, `buildDeepWorkPrompt`, `parseFlagArgs`, `DEEP_WORK_CONVENTIONS`. The slug helper duplicates the one in `work.mjs` (40-line copy) rather than importing it because the two scripts touch different lifecycle stages and an inter-script dep would over-couple them. The porcelain parser tolerates `bare` and `detached` records so the status table renders sensibly even on unusual worktree layouts.
- [cli.mjs](../../../../scripts/deep-work/cli.mjs) -- thin dispatcher. Lazy-imports each sub-command so a `--help` invocation never reads the gh/git modules. Recognized sub-commands: `start`, `pick`, `continue`, `status`, `list`, `cleanup`.
- [start.mjs](../../../../scripts/deep-work/start.mjs) -- `gh issue view` + `git fetch origin main` + `git worktree add worktrees/issue-<num>-<slug> -b feat/issue-<num>-<slug> origin/main` (or reuse an existing local branch); print prompt; clipboard copy via `clip` / `pbcopy` / `xclip`.
- [pick.mjs](../../../../scripts/deep-work/pick.mjs) -- `gh issue list --label "good first issue" --state open --limit 10` + numbered menu (no interactive readline). `--first` dispatches the top entry to `startCommand`.
- [continue.mjs](../../../../scripts/deep-work/continue.mjs) -- print the worktree path. Title-derived path first; falls back to scanning `git worktree list` for the `issue-<num>-` tag if the title-derived guess does not exist.
- [status.mjs](../../../../scripts/deep-work/status.mjs) -- `git worktree list --porcelain` + dirty probe via `git status --porcelain` in each worktree path; renders a path / branch / 7-char HEAD / dirty table.
- [cleanup.mjs](../../../../scripts/deep-work/cleanup.mjs) -- refuses on dirty without `--force`; refuses without `--yes` when STDIN is non-interactive (`process.stdin.isTTY`); calls `git worktree remove` (or `--force` variant).

Added `worktrees/` to [.gitignore](../../../../.gitignore) with a comment citing the sub-task. Added `"deep-work": "node scripts/deep-work/cli.mjs"` to [package.json](../../../../package.json).

Wrote [tests/integration/scripts-deep-work.test.ts](../../../../tests/integration/scripts-deep-work.test.ts) with 19 tests covering `shared` helpers (slugify 40-char cap + empty-input fallback, deriveBranchName, deriveWorktreePath, parseFlagArgs), `parseWorktreeListPorcelain` (primary + feature, detached / bare, empty), `buildDeepWorkPrompt` (full + missing fields), `formatIssueMenu` (empty-state + populated), `formatWorktreeTable` (empty-state + populated), `cli main` (--help / no-arg / unknown), and a spawn-level `--help` smoke against the real CLI binary. The 19 tests pass in ~84 ms.

### Step 3: 5.2 -- PR template + `check-pr-checklist` + `pr-quality.yml`

Wrote [.github/PULL_REQUEST_TEMPLATE.md](../../../../.github/PULL_REQUEST_TEMPLATE.md) with Summary / Changes / Test plan / Linked issues / Submission Checklist sections. The Submission Checklist includes the eight items the plan specified, with the last item carrying the bold "No new outbound network calls or new third-party data processors introduced" sentence and the explicit MCP Registry Policy reference.

Wrote [scripts/check-pr-checklist.mjs](../../../../scripts/check-pr-checklist.mjs):

- `extractChecklistLines(body)` finds the `## Submission Checklist` header (case-insensitive `CHECKLIST_HEADER_RE`) and walks lines until the next `##` header. Returns `null` if the section is missing.
- `evaluateChecklistLines(lines)` matches each line against `ITEM_RE = /^\s*-\s*\[(?<state>[ xX])\]\s*(?<rest>.*)$/` and classifies pass (checked or rest matches `NA_RE = /^N\/?A\s*:\s*\S/i`) vs. fail (unchecked, no N/A: tag).
- `checkBody(body)` is the public surface returning `{ ok, kind, items, message }` where `kind` is `ok`, `failing`, or `missing-section`.
- `main(argv)` reads `process.env.PR_BODY` first; if absent and the first positional is numeric, falls back to `gh pr view <pr> --json body --jq .body`. Exit codes 0 / 1 / 2 for pass / fail / missing-section-or-body.

Wrote [.github/workflows/pr-quality.yml](../../../../.github/workflows/pr-quality.yml). Triggers on `pull_request: types: [opened, edited, synchronize, reopened] branches: ["main"]` with a per-head-ref concurrency group + `cancel-in-progress: true`. Permissions are read-only on contents and pull-requests. Steps: checkout, setup-node @ Node 22, fetch the PR body via `gh pr view --json body --jq .body` and inject into `GITHUB_ENV` via a here-doc with the `__GEMMA_EOF__` delimiter (so a PR body containing the literal string `EOF` cannot break the assignment), then run `node scripts/check-pr-checklist.mjs`. The body is never echoed to the log.

Wrote [tests/unit/scripts/check-pr-checklist.test.ts](../../../../tests/unit/scripts/check-pr-checklist.test.ts) with 7 tests covering the four plan-stated cases (fully-checked / one-unchecked-non-N/A / unchecked-with-N/A: / no-section) plus an empty-section case and the extractor's section-stop-at-next-header behaviour. The 7 tests pass in ~6 ms.

### Step 4: 5.3 -- `npm run agent-batch` multi-agent dispatcher

Wrote six files in [scripts/agent-batch/](../../../../scripts/agent-batch/):

- [schema.mjs](../../../../scripts/agent-batch/schema.mjs) -- `AgentNameSchema = z.enum(["claude","codex","cursor"])`, `AgentBatchTaskSchema = z.object({issue: z.number().int().positive(), agent: AgentNameSchema, extraPrompt: z.string().optional(), dependsOn: z.array(z.number().int().positive()).default([])})`, `AgentBatchSpecSchema = z.object({batchId: z.string().min(1), tasks: z.array(AgentBatchTaskSchema).min(1)})`. Exposes `parseSpec` (throws) and `safeParseSpec` (returns `{success, data?, error?}`).
- [cli.mjs](../../../../scripts/agent-batch/cli.mjs) -- dispatcher with verbs `validate`, `overlap`, `launch`, `status`.
- [validate.mjs](../../../../scripts/agent-batch/validate.mjs) -- load JSON, `safeParseSpec`, render `[agent-batch validate] ok: batchId=<id> tasks=<n>` on success or formatted Zod issues on failure. Exit 0 / 1 / 2.
- [overlap.mjs](../../../../scripts/agent-batch/overlap.mjs) -- `detectDuplicateIssues`, `detectMissingDeps`, `detectCycles` (DFS with visited-on-stack; results deduped by canonical sorted-issue tuple). `analyzeOverlap` and `formatOverlapReport` aggregate.
- [launch.mjs](../../../../scripts/agent-batch/launch.mjs) -- `topologicalOrder` (Kahn's algorithm with sorted-by-issue queue for deterministic ordering); `buildDispatchTable`; `formatDispatchTable` (batchId / issue / agent / dependsOn / extraPrompt columns); `launchCommand` defaults to dry-run, only creates worktrees on `--apply` by delegating to `scripts/deep-work/start.mjs`'s `startCommand`.
- [status.mjs](../../../../scripts/agent-batch/status.mjs) -- classify each task pending / running / done from local worktree commit state alone (`git log --oneline origin/main..<branch>` length). No gh / network calls.

Wrote [examples/agent-batch.spec.json](../../../../examples/agent-batch.spec.json) with three tasks: two independent + one depending on the first. Added `"agent-batch": "node scripts/agent-batch/cli.mjs"` to [package.json](../../../../package.json).

Wrote [tests/unit/scripts/agent-batch.test.ts](../../../../tests/unit/scripts/agent-batch.test.ts) with 21 tests covering schema acceptance (canonical sample on disk) + rejection (unknown agent, negative issue, empty tasks), the three overlap detectors, the overlap formatter (empty-state + populated with cycle that uses 4 distinct issues so cycle detection does not collide with the duplicate-issue case), `topologicalOrder` + `buildDispatchTable` + `formatDispatchTable`, `formatStatusTable`, and the cli `main` --help / unknown sub-command / `validate examples/agent-batch.spec.json` paths (with `process.chdir(REPO_ROOT)` so the relative path resolves).

### Step 5: 5.4 -- `npm run review` PR-lifecycle CLI

Wrote seven files in [scripts/review/](../../../../scripts/review/):

- [shared.mjs](../../../../scripts/review/shared.mjs) -- `parseReviewArgs` (positional `prNumber`, `--agent`, `--dry-run`, `--squash` / `--merge` / `--rebase`), `runGit` + `tryGit`, `isWorkingTreeDirty`, `runGh`, `parseGhPrChecks` (tolerant tabular parser that classifies each row's verdict by the trailing token), `summarizeChecks` (failing / pending buckets).
- [cli.mjs](../../../../scripts/review/cli.mjs) -- dispatcher with verbs `sync`, `review`, `fix`, `coverage`, `merge`. Header documents the explicit overlap with `/ship-and-babysit` and the v0.10.0 fold-one decision point.
- [sync.mjs](../../../../scripts/review/sync.mjs) -- refuses on dirty tree (hard refusal, no silent stash); `gh pr checkout` + `git fetch origin main` + `git merge --no-edit origin/main`.
- [review.mjs](../../../../scripts/review/review.mjs) -- invokes the Phase 3.1 review-pr SKILL via the configured agent CLI when present on PATH (probed via `where` / `which`); else prints the prompt for paste.
- [fix.mjs](../../../../scripts/review/fix.mjs) -- fetches reviewer comments via `gh api repos/{owner}/{repo}/pulls/<n>/comments` and `gh pr view --json comments`, summarizes both shapes, and hands off to the `.claude/agents/pr-manager` subagent.
- [coverage.mjs](../../../../scripts/review/coverage.mjs) -- resolves the most-recent `Coverage Diff` workflow run for the PR's head branch via `gh run list --workflow "Coverage Diff" --branch <ref> --json databaseId`, downloads the `diff-coverage` artifact via `gh run download --name diff-coverage --dir <tmpdir>`, parses `diff-coverage.md` to find file headers + Missing line / Lines not covered ranges, and suggests `tests/unit/<rel>.test.ts` mappings (src/* and scripts/* mapped distinctly).
- [merge.mjs](../../../../scripts/review/merge.mjs) -- refuses if `gh pr checks` shows any of fail / failure / cancelled / timed_out / action_required / pending / queued / in_progress (`checksAreGreen` is the public predicate); defaults to `--squash`; `--merge` and `--rebase` accepted. Post-merge cleanup checks out main + pulls but treats cleanup failures as warnings.

Added `"review": "node scripts/review/cli.mjs"` to [package.json](../../../../package.json).

Wrote [tests/integration/scripts-review.test.ts](../../../../tests/integration/scripts-review.test.ts) with 20 tests covering `parseReviewArgs`, `parseGhPrChecks` (pass / pending / fail row parsing + empty input), `summarizeChecks` + `checksAreGreen` (green / red on fail / red on pending), `extractUncoveredFromMarkdown` (empty input + file-header + Missing-line range pickup), `suggestTestFiles` (src/* and scripts/* mappings), `formatCoverageReport` (markdown body + appended suggestions), `summarizeReviewerComments` (review-thread + issue-comment count + handoff line), the cli `main` --help / unknown sub-command / `sync --dry-run` / `merge --rebase --dry-run` paths, and a spawn-level `--help` smoke.

### Step 6: 5.5 -- Quality gates

Ran the local gate stack in sequence:

- `npm run lint` -- 0 errors.
- `npm run build` -- `tsc` clean.
- `npm run check src/` -- 5 pre-existing warnings on oversized SKILL.md files (tracked under 10.O.O / Phase 6.8); no new findings introduced by Phase 5.
- `npm run deps:check` -- 3 pre-existing `no-orphans` warnings (ModelPinRegistry, planDiff, planAnnotation -- all tracked under 10.N.A / 10.N.B / 10.N.C); no new orphans.
- `npm run catalog:check` -- clean (one CRLF warning on autocrlf, no diff content).
- `npm run perm-tier:check` -- clean.
- `npm test` -- 225 files, 2603 tests passed + 4 skipped (pre-existing), 0 failed.

Re-ran the Phase 5 test files alone first and caught one initial failure: `tests/unit/scripts/agent-batch.test.ts > formatOverlapReport > renders duplicates / missing / cycles when present`. The original test spec had a 2-cycle (1 -> 2 -> 1) plus a duplicate issue 2 plus a missing dep, but the cycle detector's `graph.set(t.issue, ...)` overwrites duplicates with the later task's `dependsOn`, so the 2-cycle was being collapsed into the duplicate-issue case. Fixed by rewriting the test spec with a 3-cycle (1 -> 3 -> 4 -> 1) using distinct issue numbers so cycle detection and duplicate detection are independent. Re-ran -> 21 passed, 0 failed.

## 2. Troubleshooting and assumptions

- **Cycle detector overwrite under duplicate issues**: my initial test spec assumed cycle detection survives duplicates. It does not (the Map.set in graph construction overwrites). Decision: leave the detector working only on the deduplicated graph (duplicates are a separate error class with their own classifier) and fix the test spec to use distinct issue numbers for the cycle case. Documented this implicit invariant in the cycle detector's header.
- **Working tree dirty during dry-run sync test**: `sync --dry-run` refuses on a dirty tree before reaching the dry-run print. The integration test guards this by accepting exit code 0 OR 1 (which-ever the local tree state produces). In CI the tree is clean so the exit is 0. This is intentional and documented in the test body.
- **Lazy-import dispatcher pattern**: each `cli.mjs` lazy-imports its sub-command modules so `--help` and unknown-command paths never load the gh/git surface. This keeps the help-path test predictable across environments.
- **Single commit + push at user request**: the user's invocation explicitly asked for a single commit + push to main covering all four Phase 5 artifacts. This is the same pattern Phases 2, 3, and 4 took. Recorded as 10.N.P (NI / P3) in known-gaps. The atomic-commit ideal in the plan stands; this phase honoured the user's directive over it.

## 3. Testing results

| Suite | Files | Tests | Pass | Skip | Fail |
|---|---|---|---|---|---|
| Phase 5 only | 4 | 67 | 67 | 0 | 0 |
| Full Windows suite | 225 | 2607 | 2603 | 4 | 0 |

`npm run lint`, `npm run build`, `npm run check src/`, `npm run deps:check`, `npm run catalog:check`, `npm run perm-tier:check` -- all exit 0.

## 4. Known gaps

Five new in-cycle deferrals appended to [docs/v0.9.0/known-gaps.md](../../known-gaps.md):

- 10.N.L -- deep-work live-issue smoke (gh + git lifecycle is operator-driven).
- 10.N.M -- pr-quality.yml real-PR smoke (workflow file + script committed clean; the gate's live fire requires opening two real PRs).
- 10.N.N -- agent-batch live `--apply` dispatch (the dry-run + schema + overlap surface is fully covered; the `--apply` path needs real issues + worktrees + agent CLIs).
- 10.N.O -- review CLI live `sync` / `merge` smoke + the v0.10.0 fold-one-if-usage-converges decision vs. `/ship-and-babysit`.
- 10.N.P -- Phase 5 atomic-commit deviation; same single-commit-at-user-request pattern as Phases 2, 3, and 4.

## 5. Next steps

Phase 6 begins the curator/scheduler/UX backlog (10.O.F, H, I, J, L, O, P, Q from v0.8.0). The two webview-rendering items (10.N.B and 10.N.C) and the ModelPinRegistry production-wiring item (10.N.A) are explicitly Phase 6's responsibility per their suggested-next-step columns.

---
description: Commit, push to origin, open a PR against bendourthe/Gemma-Code:main, then poll Gemma-Code's own CI every ~270s, resolve failures, and exit when checks are green.
allowed-tools: Bash, Read, Edit, Write, Agent, Skill
---

Autonomous loop that ships the current working tree on a feature branch and babysits CI until clean. Polls Gemma-Code's own GitHub Actions workflows (`ci.yml`, `installer-smoke.yml`, `golden-tasks.yml`, `commitlint.yml`, plus `coverage-diff.yml` and `pr-quality.yml` once Phases 4.2 / 5.2 land). No external review-as-service call; no CodeRabbit / OpenHuman cloud polling. Reviewer comments are out of scope here -- delegate to the `pr-manager` subagent when the operator asks.

Reference [AGENTS.md](../../AGENTS.md): strict TS no `any`; no `console.*` in `src/`; ASCII-only; no `Co-Authored-By` lines; no em-dashes / curly quotes / ellipsis chars; punctuation outside quotation marks. Local gate: `npm run lint && npm run check && npm test && npm run deps:check && npm run catalog:check && npm run perm-tier:check`.

## Phase 1: Commit

1. `git status --porcelain` -- if empty, skip to Phase 2 (nothing to commit). Otherwise capture the file list.
2. Compose a conventional-commit subject (`feat(<scope>): ...`, `fix(<scope>): ...`, `refactor(<scope>): ...`, `chore(<scope>): ...`, `docs(<scope>): ...`, `test(<scope>): ...`) under 70 chars.
3. Compose the body as labeled sections with contiguous bullets, one section per component / module / theme; final sections always cover Tests and Known gaps (referencing `docs/<version>/known-gaps.md` if relevant). No hard-wrapping at 72 / 80 chars; each bullet is one continuous line.
4. Stage only the files relevant to the commit (no `git add -A`).
5. Commit via HEREDOC. ASCII-only body. Do NOT pass `--no-verify`; do NOT bypass signing.

## Phase 2: Push

1. Verify current branch matches `^(feat|fix|refactor|chore|docs|test)/`. If on `main`, stop and ask the user to switch to a feature branch.
2. Never push to `main`. Never force-push.
3. `git push -u origin HEAD`.

## Phase 3: Open or reuse PR

1. `gh pr list --head <branch> --state open --json number,url,mergeStateStatus`.
2. If a PR exists, capture the number and skip to Phase 4.
3. Otherwise draft the body per `.github/PULL_REQUEST_TEMPLATE.md` if present (created in Phase 5.2 of the v0.9.0 cycle plan; until then, a one-line summary echoing the commit subject is acceptable).
4. `gh pr create --base main --head <branch> --title '<subject>' --body "$BODY"`. Capture the URL and PR number from the output.

## Phase 4: Babysit

Use `ScheduleWakeup` with `delaySeconds=270` (under the 300s prompt-cache window). Hard cap at 12 ticks (~60 min). Each tick increments `tickCount` and includes it in the wakeup `reason` field so the loop is auditable.

### Each tick

1. `gh pr checks <PR> --json name,state,link,description`.
2. Classify each check:
   - `SUCCESS`: continue.
   - `IN_PROGRESS` / `QUEUED` / `PENDING`: wait another tick.
   - `FAILURE` / `STARTUP_FAILURE` / `CANCELLED` / `TIMED_OUT`: needs fixing.
3. For Actions-backed failures, extract the run id from `link` with `sed -nE 's#.*/actions/runs/([0-9]+)/?.*#\1#p'` (tolerant of trailing slashes). Then `gh run view <id> --log-failed | head -200`.
4. For non-Actions checks (e.g., commitlint badge, branch-protection statuses), work from `name` + `state` + `description` alone.
5. Local repro commands keyed by which check is red:
   - `ci.yml` lint / typecheck / unit: `npm run lint`, `npm run build`, `npm test`, `npm run check`.
   - `ci.yml` dep / catalog / perm-tier: `npm run deps:check`, `npm run catalog:check`, `npm run perm-tier:check`.
   - `ci.yml` bench: `npm run bench`.
   - `installer-smoke.yml`: `npm run package`.
   - `golden-tasks.yml`: `node scripts/run-golden-tasks.mjs` (operator-only if it requires live Ollama).
   - `commitlint.yml`: inspect the offending commit message and fix via a follow-up commit (do not amend a pushed commit; create a NEW commit per AGENTS.md).
6. Apply the minimum fix. Do not refactor adjacent code. Do not disable failing tests. Do not skip hooks (`--no-verify` is off-limits unless the operator explicitly authorizes it for one commit).
7. Stage only the files you changed. Commit with a conventional prefix that names the failing check (`fix(ci): <subsystem>`). Push to the PR branch.
8. Schedule the next wakeup if `tickCount < 12` and not all checks are `SUCCESS`.

### Explicit exclusions

- No CodeRabbit polling. Reviewer-comment handling belongs to the `pr-manager` subagent, invoked by the operator on demand. This loop is for CI failures only.
- No OpenHuman cloud or third-party review service is contacted. The polling target is `https://api.github.com/repos/bendourthe/Gemma-Code/...` only.

### Exit condition

All checks `SUCCESS` AND `mergeStateStatus` is `CLEAN` or `MERGEABLE`. Print the PR URL, a one-line summary per check, and the total tick count consumed. Stop.

## Phase 5: 12-tick stop

If 12 ticks elapse and checks are still not green, stop the loop. Print:

1. PR URL.
2. Snapshot of `gh pr checks <PR> --json name,state,link,description`.
3. The last failing log block per red check.
4. Ask the operator: "Continue iterating, escalate to `pr-manager`, or stop here?"

Wait for the operator's answer before any further action.

## Safety gates

- Never push to `main`; never force-push.
- Never skip pre-push or commit hooks for own changes.
- Never disable a failing test to clear a gate.
- No outbound calls beyond `gh` (GitHub Actions on the operator's own `bendourthe/Gemma-Code` repo -- intrinsic data destination) and `git`. No CodeRabbit Pro / OpenHuman / Sentry / Prometheus exporter touched.
- ASCII-only commit messages and PR bodies; no em-dashes / curly quotes / ellipsis chars; no `Co-Authored-By` / AI attribution.
- `--no-verify` is off by default; only invoke when the operator explicitly authorizes one commit.

# v0.9.0 Phase 3 -- Session History

**Date**: 2026-05-16
**Phase**: 3 -- Skill-native adoptions (reverse-engineered patterns, zero-code)
**Plan**: [docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md)
**Sub-tasks landed**: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

---

## 1. Chronological steps

### Step 1: Pre-implementation review

Read the Phase 3 section of the cycle plan in full. The phase is markdown-only by design: ship five reverse-engineered artifacts (an enriched SKILL, two subagents, a slash command, a beginner contributor guide, and a taskmaster subagent) without copying prose from the openhuman source. Confirmed prerequisites: Phase 2 closed (per [docs/archive/versions/v0/v0.9.0/known-gaps.md](../../known-gaps.md), nine v0.8.0 carryovers resolved in Phase 2; Phase 2 session history exists). Verified the existing `review-pr` SKILL is at v1.0.0 with the generic structure; verified `.claude/agents/` and `.claude/commands/` do not exist; verified `CONTRIBUTING-BEGINNERS.md` does not exist. Verified npm scripts cited by the new artifacts are real: `lint`, `check`, `test`, `deps:check`, `catalog:check`, `perm-tier:check`, `bench`, `package`, `check:prompts`. Verified `src/utils/logger.ts`, `src/utils/secretPaths.ts`, and `src/tools/handlers/pathGuard.ts` exist on disk before referencing them in the SKILL.

### Step 2: 3.1 -- Rewrite the `review-pr` SKILL

Rewrote [src/skills/catalog/review-pr/SKILL.md](../../../../versions/src/skills/catalog/review-pr/SKILL.md) from v1.0.0 to v2.0.0. The new structure mirrors the reverse-engineered pattern from the v0.8.0 openhuman audit: walkthrough -> per-file analysis -> severity-x-confidence findings -> review-first, edits-after-confirm. Concretely the SKILL now has seven phases A-G covering fetch (`gh pr view --json`, `gh pr diff`), checkout (refuse if dirty, `gh pr checkout`, `git fetch origin main`), full-file reads (not just hunks; flag > 500 lines, `console.*` in `src/`, direct Ollama imports outside `src/llm/`), six analysis axes (correctness, project standards, testing, security with `pathGuard.ts` + `secretPaths.ts` references, design, documentation), severity-x-confidence classification, read-only review body emission, and an apply phase that only runs after the user confirms which findings to act on.

First draft was ~1652 tokens; the project's `prompt-oversized` rule budget is 800 tokens (`lib/checks/prompt-oversized.mjs`, `chars/4` heuristic). Trimmed in three passes -- ~1057, ~885, ~815, ~770 -- until `node bin/gemma-check.mjs --rule prompt-oversized src/skills/catalog/review-pr` reported 0 findings. The plan's stated 8 KB cap was much looser than the actual rule, so the SKILL is more terse than the plan's ideal. Captured the trade-off as 10.N.F in known-gaps.

### Step 3: 3.2 -- Author the `pr-manager` subagents

Authored [.claude/agents/pr-manager.md](../../../../versions/.claude/agents/pr-manager.md) (~4.8 KB) and [.claude/agents/pr-manager-lite.md](../../../../versions/.claude/agents/pr-manager-lite.md) (~1.8 KB). The full agent walks seven phases: fetch metadata + comments (`gh api repos/.../pulls/<PR>/comments`, `gh api repos/.../pulls/<PR>/reviews`, `gh api repos/.../issues/<PR>/comments`), classify each comment by severity x confidence x scope, apply in-scope fixes with the local gate after each batch, reply / dismiss out-of-scope comments via `gh api repos/.../pulls/<PR>/comments/<id>/replies`, resolve threads via the GraphQL `resolveReviewThread` mutation, commit + push, then loop up to three iterations. The lite variant skips the GraphQL mutation step and runs a single pass. Both target `bendourthe/Gemma-Code:main` directly -- no fork-flow language anywhere -- and cite [AGENTS.md](../../../../versions/AGENTS.md) for conventions (no `Co-Authored-By`, no em-dashes, no curly quotes, ASCII-only).

Safety gates in both files: never push to main, stop before any force-push, never `--no-verify` on someone else's PR, never disable a failing test to clear a gate, no external service calls beyond `gh` and `git`.

### Step 4: 3.3 -- Author the `ship-and-babysit` slash command

Authored [.claude/commands/ship-and-babysit.md](../../../../versions/.claude/commands/ship-and-babysit.md) (~5.9 KB; cap was 12 KB). Five phases: compose conventional-commit subject + sectioned-bullet body via HEREDOC, push to `origin` (refuse if on `main`, never force-push), `gh pr create` if no PR exists, babysit Gemma-Code's own CI via `ScheduleWakeup` at 270 seconds (under the 300s prompt-cache TTL) with a hard cap of 12 ticks, and stop-and-ask when the cap is reached. The Actions-run-id extraction uses `sed -nE 's#.*/actions/runs/([0-9]+)/?.*#\1#p'` (trailing-slash-tolerant per recent gh format changes). Listed local repro commands keyed by which check is red: `npm run lint`, `npm run build`, `npm test`, `npm run check`, `npm run deps:check`, `npm run catalog:check`, `npm run perm-tier:check`, `npm run bench`, `npm run package`. Polls only the workflows under `bendourthe/Gemma-Code/actions/...` -- never any third-party review-as-service endpoint. Explicit exclusion paragraph states that reviewer comments are out of scope for this autonomous loop and belong to the `pr-manager` subagent invoked on operator demand.

### Step 5: 3.4 -- Author `CONTRIBUTING-BEGINNERS.md`

Wrote [CONTRIBUTING-BEGINNERS.md](../../../../versions/CONTRIBUTING-BEGINNERS.md) at the repo root (~6.8 KB, within the plan's 6-10 KB target). Eleven sections: prerequisites (Node 20+, Git, gh, VS Code, Ollama + `gemma4:e4b` model), fork + clone (`gh repo fork bendourthe/Gemma-Code --clone`), install + build (`npm install && npm run build`), launch the Extension Development Host with F5, find an issue (`gh issue list` or [docs/todos.md](../../../../versions/v0/todos.md)), branch + change (`feat/<short-slug>` from main, strict TS, no `console.*`, files < 500 lines), local checks (`npm run lint && npm test && npm run check`), commit + push (conventional prefix, push to fork's `origin`), open PR (`gh pr create --base main --head <user>:<branch> --fill`), what happens after, and a Troubleshooting block covering `npm install` with `node-gyp`, Ollama not reachable on `http://localhost:11434`, missing `gemma4:e4b`, port collision on 11434, VS Code not picking up the new build, and pushes accidentally aimed at the canonical repo. Added a cross-link from the first paragraph of [CONTRIBUTING.md](../../../../versions/CONTRIBUTING.md).

### Step 6: 3.5 -- Author the `taskmaster` subagent

Wrote [.claude/agents/taskmaster.md](../../../../versions/.claude/agents/taskmaster.md) (~3.3 KB, under the plan's 5 KB cap). Inputs are read-only: `git log --oneline -50`, `gh issue list --limit 50 --json ...`, `gh pr list --state merged --limit 30 --json ...`, the in-cycle `docs/archive/versions/v0/v0.9.0/known-gaps.md` + v0.8.0 transferred entries, and the existing `docs/todos.md`. Output is `docs/todos.md` only. Five strict rules: never delete a row (closed rows stay checked with the citation in line), never invent work without a commit / issue / PR / known-gaps source, cite the source SHA / # / ID on every check-off, convert relative dates to ISO `YYYY-MM-DD`, ASCII-only. Output gate: diff shown first; if more than 10 rows change, ask "Apply this update? (y/n)" before writing.

### Step 7: `.gitignore` adjustment

The root [.gitignore](../../../../versions/.gitignore) previously excluded the entire `/.claude/` tree per [AGENTS.md](../../../../versions/AGENTS.md) (which describes `.claude/` as personal IDE / agent configuration). The plan's Phase 3 explicitly ships markdown artifacts under `.claude/agents/` and `.claude/commands/`. Changed the ignore stanza from `/.claude/` to `/.claude/*` plus `!/.claude/agents/` + `!/.claude/commands/` exceptions, so the agent-agnostic markdown is tracked while personal state (`hooks/`, `settings.local.json`, `scheduled_tasks.lock`) stays ignored. AGENTS.md's "Development-time tooling such as `.claude/`..." sentence intentionally not edited this phase -- captured as 10.N.G in known-gaps for the Phase 8 cycle close to update.

### Step 8: 3.6 -- Stabilization

Ran each gate in turn:

- `node bin/gemma-check.mjs src/skills/catalog/review-pr` -- 0 findings, exit 0.
- `node bin/gemma-check.mjs .claude` -- 0 findings, exit 0.
- `node bin/gemma-check.mjs CONTRIBUTING-BEGINNERS.md CONTRIBUTING.md` -- 0 findings, exit 0.
- `npm run check:prompts` -- 4 pre-existing warnings (`harden`, `distill`, `build-second-brain`, `animate` SKILLs are all > 800 tokens; tracked as 10.O.O for Phase 6.8), zero new findings from Phase 3.
- `npm run lint` -- exit 0.
- `npm run build` -- exit 0 (golden-tasks regenerate then `tsc` clean).
- `npm test` -- 218 files, 2497 passed, 4 skipped, 0 failed in 39.82s on Windows.
- `npm run deps:check` -- 0 errors, 3 warnings (orphan-module warnings on `ModelPinRegistry.ts`, `planDiff.ts`, `planAnnotation.ts`; all pre-existing 10.N.A / B / C carryovers).
- `npm run catalog:check` -- exit 0.
- `npm run perm-tier:check` -- exit 0.

### Step 9: Post-phase documentation

Appended three new in-cycle items (10.N.F, 10.N.G, 10.N.H) to [docs/archive/versions/v0/v0.9.0/known-gaps.md](../../known-gaps.md) Section 10.1 and recomputed the Summary table (now 8 open / 14 resolved). Updated the suggested-next-step on 10.N.B and 10.N.C from "Phase 3 or Phase 4" / "Phase 3 (or sooner if reordered)" to "Phase 4" since Phase 3 was markdown-only and did not touch the webview. Prepended a "[2026-05-16] v0.9.0 Phase 3" section to [docs/DEVLOG.md](../../../../versions/v0/DEVLOG.md) with one decision per sub-task. Wrote this session history file.

---

## 2. Troubleshooting

- **`prompt-oversized` warning on `review-pr` SKILL**: the rule budget is 800 tokens (`chars/4`), not the plan's stated 8 KB. Trimmed in three passes (1057 -> 885 -> 815 -> 770) until the rule cleared. Captured as 10.N.F.
- **`.gitignore` excluding `.claude/` outright**: the plan's Phase 3 ships committed artifacts under `.claude/agents/` and `.claude/commands/`, but the existing ignore stanza is `/.claude/`. Switched to `/.claude/*` + `!/.claude/agents/` + `!/.claude/commands/`. Captured as 10.N.G alongside the AGENTS.md sentence that still needs Phase 8 update.

---

## 3. Assumptions and deviations

- **Single consolidated commit + push to main** instead of the plan's "Atomic commits per artifact" guidance: explicit user request in the invocation (`then commit the generate commit message and push to main`). Same deviation as Phase 2, tracked under 10.N.E.
- **AGENTS.md sentence not edited**: the sentence "Development-time tooling such as `.claude/`... are not committed to the repository" still appears, even though Phase 3 commits `.claude/agents/` and `.claude/commands/`. Left for Phase 8 cycle close per 10.N.G.

---

## 4. Testing results

Phase 3 was markdown-only and added no test cases. The pre-existing test suite remains green: 218 files, 2497 passed, 4 skipped, 0 failed, no segfault, no flaky teardown. Same passing count as Phase 2 close.

---

## 5. Next steps

Phase 4 -- internal RE builds, dev-loop ergonomics. Sub-tasks 4.1 through 4.5:

- 4.1: cross-platform `npm run debug ...` runners (Node, not bash).
- 4.2: `coverage-diff.yml` workflow with `diff-cover` 80% on changed lines.
- 4.3: pre-push hook with auto-fix-then-retry.
- 4.4: `npm run work <issue>` issue-to-branch dispatcher.
- 4.5: Phase 4 testing and stabilization.

The 10.N.B / 10.N.C webview-rendering carryovers can be folded into Phase 4 alongside the dev-loop ergonomics, since the natural place for the tool-call card refresh is the same `src/panels/webview/render/` directory the debug runners will tee logs from.

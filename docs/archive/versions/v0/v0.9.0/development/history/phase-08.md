# v0.9.0 Phase 8 -- Session History

**Date**: 2026-05-16
**Phase**: 8 -- Cycle close
**Plan**: [docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md)
**Sub-tasks landed**: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7 (commit-and-push-to-main override)
**Sub-tasks deferred**: 8.6 (optional v0.8.0 cycle CHANGELOG narrative -- tracked under 10.N.Z)
**Carryovers closed**: v0.9.0 10.N.G (AGENTS.md carve-out for `.claude/agents/` + `.claude/commands/`) + v0.8.0 10.O.EE (explicitly deferred)
**Commit invocation**: user instructed "implement-phase 8 of v0.9.0-cycle.md then commit the generate commit message and push to main" (overrides sub-task 8.7's `/ship-and-babysit` direction)

---

## 1. Chronological steps

### Step 1: Pre-implementation review

Read the Phase 8 section of the cycle plan and the current state of: [README.md](../../../../README.md), [AGENTS.md](../../../../AGENTS.md), [docs/archive/versions/v0/v0.8.0/known-gaps.md](../../../v0.8.0/known-gaps.md), [docs/archive/versions/v0/v0.9.0/known-gaps.md](../../known-gaps.md), [docs/DEVLOG.md](../../../DEVLOG.md), [package.json](../../../../package.json), and the v0.9.0 development history directory.

Phase 7 close was 25 open / 30 resolved in `docs/archive/versions/v0/v0.9.0/known-gaps.md` (after the 6 Phase 7 closures). Confirmed: all 7 prior phase histories exist under `docs/archive/versions/v0/v0.9.0/development/history/phase-0N.md`, all 7 phase commits exist on `main`, the cycle-close artifacts are docs-only -- no source code in `src/` is touched in Phase 8. Test results from Phase 7 close (227 files, 2636 passed, 5 skipped, 0 failed) remain the cycle baseline.

### Step 2: 8.1 -- README.md and AGENTS.md updates

Added a "v0.9.0 Highlights" section to [README.md](../../../../README.md) directly under the introductory blockquote with four bullets: (1) "37 v0.8.0 in-cycle gaps cleared" with cross-links to the v0.8.0 Resolved table and the v0.9.0 known-gaps file; (2) reverse-engineered dev-loop tooling list (`npm run debug` / `work` / `deep-work` / `agent-batch` / `review` plus the four CI workflow surfaces); (3) skill-native artifacts list (review-pr SKILL, pr-manager + pr-manager-lite + taskmaster subagents, ship-and-babysit command, CONTRIBUTING-BEGINNERS.md); (4) CI hardening summary (Node `["22.x", "24.x"]` matrix, functions >= 80 coverage gate, new check-prompts / fast-bench / codeql.yml jobs, dep-graph SVG artifact). The highlights are scannable -- no lower-level "what files changed" detail; readers follow the cross-links for that.

Added three subsections under the existing "Development" section:

- "Bounded-output test runners (v0.9.0)" with the `npm run debug <kind>` invocation surface and `out/debug-logs/` log inspection helpers.
- "Working with issues (v0.9.0)" listing the `npm run work` one-shot, the `npm run deep-work` full lifecycle (`start` / `pick` / `continue` / `status` / `list` / `cleanup`), and the `npm run agent-batch` Zod-validated dispatcher. Cross-link to `examples/agent-batch.spec.json`.
- "PR lifecycle (v0.9.0)" side-by-side describing `npm run review` (imperative CLI cousin of `/ship-and-babysit`) and `.claude/commands/ship-and-babysit.md` (autonomous slash command). Explicit overlap note referencing 10.N.O's v0.10.0 fold-one-if-usage-converges decision; explicit non-call to CodeRabbit / any third-party review-as-service.

Rewrote the "Contributing" section to lead with the CONTRIBUTING-BEGINNERS.md first-PR walkthrough, falling back to CONTRIBUTING.md for the general contributor guide. Updated the CI gate line to reflect the new functions >= 80 threshold from Phase 7.

Edited [AGENTS.md](../../../../AGENTS.md) header sentence: replaced the "Development-time tooling such as `.claude/`, `.vscode/`, or `.idea/` directories ... are personal IDE/agent configuration, not part of Gemma Code's identity, and are not committed to the repository" sentence with a longer carve-out: "Development-time tooling such as `.vscode/` or `.idea/` directories, and most of `.claude/` (hooks, settings.local.json, scheduled_tasks.lock), is personal IDE/agent configuration and is not committed. Two `.claude/` subdirectories are exceptions, carved out in `.gitignore` and tracked in-repo as agent-agnostic markdown artifacts: `.claude/agents/` (subagent prompt definitions) and `.claude/commands/` (slash-command definitions). They are written in plain Markdown, read by Claude Code today, and could be consumed by any other agent harness without translation; see the 'Claude Code addenda' section at the bottom of this file for the per-file inventory." This closes 10.N.G.

Appended two new sections at the bottom of AGENTS.md:

- "Onboarding for New Contributors" with the CONTRIBUTING-BEGINNERS.md cross-link.
- "Claude Code addenda (v0.9.0)" with the four-row table inventorying `pr-manager.md`, `pr-manager-lite.md`, `taskmaster.md`, and `ship-and-babysit.md` with one-line descriptions. Reaffirms the "no `CLAUDE.md`" tool-agnostic invariant ("AGENTS.md remains the single canonical agent directive; nothing under `.claude/` overrides repository-level conventions"). Cross-links 10.N.H (the `.claude/`-glob extension to the `prompt-*` rules in `lib/checks/prompt-oversized.mjs`).

Verified: `npm run check src/` exits 0 with the one pre-existing warning (`review-pr/SKILL.md ~811 tokens`, 10.N.F). `npm run lint` exits 0. `npm run build` exits 0.

### Step 3: 8.2 -- Catalog regeneration

Ran `npm run catalog` -- regenerated [docs/index.md](../../../index.md) (16 modules; minor table cell churn around the four trimmed Phase 6 SKILL.md files). Ran `npm run perm-tier` -- "[generate-tool-permission-table] No changes" (no permission-table drift). Ran `npm run catalog:check` -- exit 0 (the CRLF autocrlf warning is cosmetic; content diff is empty). Ran `npm run perm-tier:check` -- exit 0.

### Step 4: 8.3 -- Finalize docs/archive/versions/v0/v0.8.0/known-gaps.md

Edited the `Status:` line: flipped from `transferred-to-v0.9.0 (all 37 open items ... ingested as scope into ...; the v0.9.0 cycle close (Phase 8.3) will flip this to finalized)` to `finalized (cycle closed by docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md Phase 8.3 on 2026-05-16; 28 in-cycle items Resolved in v0.9.0, 9 operator-only items Transferred to docs/archive/versions/v0/v0.9.0/operator-actions.md and tracked under v0.9.0/known-gaps.md Section 1)`.

Updated the Section 10 `**Last updated**:` line with the Phase 8.3 close stanza.

For each of the 9 still-open rows in Section 10.1 (10.O.A / B / C / X / AA / BB / CC / DD / EE), appended an inline `(transferred to docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md sub-task <N.M>)` footer to the Reason column with the specific sub-task pointer: rows A through DD point at sub-task 1.3 (operator-actions tracking; the per-section pointer in [operator-actions.md](../../operator-actions.md) is added inline as "Section 1" / "Section 4" / etc.), and row EE points at sub-task 8.6 (optional cycle CHANGELOG narrative, explicitly deferred).

Rewrote the Section 10.3 Summary table from a two-column (Open / Resolved) format to a three-column (Open / Resolved-in-v0.9.0 / Transferred-to-operator) format with a Total column. New totals: 0 Open, 42 Resolved, 9 Transferred, 51 grand total. Added an inline "Resolved-in-v0.9.0 includes..." / "Transferred-to-operator includes..." paragraph below the table enumerating the IDs in each bucket.

Inserted a new "**Status (v0.9.0 Phase 8.3 close / v0.8.0 cycle finalized, 2026-05-16)**:" stanza at the top of the Status block (immediately before the "**Post-CI audit (2026-05-16, after run 69328475165 ...)**" stanza). The Phase 8.3 stanza summarizes the 42-resolved / 9-transferred state and notes that v0.10.0 inherits zero v0.8.0 in-cycle scope (only the operator-action items remain open).

### Step 5: 8.4 -- v0.9.0/known-gaps.md update

The file was already authored phase-by-phase through Phase 7 (Phase 0 had created the in-progress scaffold; Phases 1 through 7 had each appended their own closures and deferrals). Phase 8 added the following changes:

- `Status:` updated from "in-progress (the cycle is mid-flight; entries below were added phase-by-phase and will be re-graded at Phase 8.3 close)" to "in-progress (the cycle is closed for v0.9.0 -- Phase 8 shipped on 2026-05-16; this file will be flipped to `finalized` at v0.10.0 cycle close, mirroring the v0.8.0 -> v0.9.0 transition handled by Phase 8.3)".
- `**Last updated**:` extended to "Phase 8 close: 8.1 README + AGENTS.md updates, 8.2 catalog regen, 8.3 v0.8.0 known-gaps finalized, 8.4 this file, 8.5 DEVLOG cycle entry, 8.6 deferred per 10.O.EE, 8.7 committed-and-pushed-to-main per user override".
- Removed the 10.N.G open row from Section 10.1 (AGENTS.md carve-out was the next-step; Phase 8.1 landed it).
- Appended 10.N.G to Section 10.2 Resolved with `Resolved in: v0.9.0 Phase 8.1` and a description of the AGENTS.md and README.md updates.
- Appended 10.N.Y to Section 10.1 tracking the Phase 8.7 commit-and-push-to-main override (instead of `/ship-and-babysit`).
- Appended 10.N.Z to Section 10.1 tracking the explicit Phase 8.6 deferral of `docs/archive/versions/v0/v0.8.0/CHANGELOG-CYCLE.md`.
- Appended 10.O.EE (v0.8.0) to Section 10.2 Resolved with `Resolved in: v0.9.0 Phase 8.6 (deferred)` and the rationale referencing 10.N.Z.
- Recomputed Section 10.3 Summary: NI rows now Open=7 (was 6, +1 net for 10.N.Y + 10.N.Z added and 10.N.G moved out) / Resolved=4 (was 3, +1 for 10.N.G); DF Resolved=18 (was 17, +1 for 10.O.EE deferral); grand total 25 Open / 30 Resolved.
- Prepended a "**Status (Phase 8 close, 2026-05-16)**:" stanza at the top of the Status block, narrating the seven Phase 8 sub-tasks landed and the cycle-close state.

### Step 6: 8.5 -- DEVLOG entry for v0.9.0 cycle

Prepended a new entry to [docs/DEVLOG.md](../../../DEVLOG.md) above the Phase 7 entry: `## [2026-05-16] v0.9.0 cycle close (Phase 8) -- 37 in-cycle gaps cleared, reverse-engineered dev-loop tooling, Node 24 + CodeQL CI`. Sections: Goal, What changed (one paragraph per Phase 1 through Phase 8 listing the closures and the new tooling), Why (three mandates: honour the v0.8.0 module-without-wiring contract, reverse-engineer the OpenHuman dev-loop ergonomics without introducing outbound dependencies, beat the 2026-09-16 Node 20 deadline), Test results (per-phase suite counts with the Phase 8 docs-only note), Coverage delta (lines 85.53% / branches 81.85% / functions 88.94% all above the new gate thresholds), Bench delta (operator-driven, not re-measured this cycle), Decisions and notable deviations (one-commit-per-phase, vitest 2.x over env-gating, complementary `npm run review` + `/ship-and-babysit`, Phase 8.6 deferred, Phase 8.7 commit-and-push-to-main override), Known gaps (cross-link to the v0.9.0/known-gaps.md aggregate).

ASCII-only, well under the 20 KB cap. The entry quotes the eight sub-task numbers per phase verbatim from the cycle plan so a future reader can map each bullet back to the plan.

### Step 7: 8.6 -- Optional CHANGELOG narrative (explicit defer)

Skipped per 10.O.EE rationale (the per-phase v0.8.0 history files plus the v0.8.0 Resolved table already preserve the same content; `semantic-release` continues to author the per-commit `CHANGELOG.md`; not a release blocker). The defer is documented inline in 10.N.Z and cross-referenced in the DEVLOG decisions section.

### Step 8: Quality gate

Ran the final gate suite on the Phase 8 docs-only diff:

- `npm run lint` -- exit 0.
- `npm run build` -- exit 0 (tsc clean).
- `npm run check src/` -- exit 0; 1 pre-existing warning (`src/skills/catalog/review-pr/SKILL.md` 811 tokens vs 800 budget, tracked under 10.N.F).
- `npm run deps:check` -- exit 0; 3 pre-existing orphan warnings (`planDiff.ts` / `planAnnotation.ts` -- pre-Phase-8 catalog state).
- `npm run catalog:check` -- exit 0.
- `npm run perm-tier:check` -- exit 0.
- `npm test` -- not re-run inside Phase 8 because no source-code or test files were modified; Phase 7 baseline (227 files, 2636 passed, 5 skipped, 0 failed on Windows) remains the cycle-close test record.

### Step 9: 8.7 -- Commit and push to main (user override of `/ship-and-babysit`)

Per the user's invocation ("then commit the generate commit message and push to main"), Phase 8 ships as a single direct-to-main commit rather than via the autonomous `/ship-and-babysit` PR loop. All CI gates still fire on the push: the Phase 7 `coverage-diff.yml` / `pr-quality.yml` / `check-prompts` / `fast-bench` / `codeql.yml` / `package-vsix` / `lint-ts` / `test-ts` / `build-ts` / `check-architecture` jobs are configured to run on `push` (in addition to `pull_request`), and the `tests/unit/workflow-discipline.test.ts` SHA-pinning gate is exercised on the push too. The decision is documented under 10.N.Y.

The autonomous `/ship-and-babysit` skill at `.claude/commands/ship-and-babysit.md` remains the recommended path for future cycle-close phases that follow the plan's default direction.

---

## 2. Troubleshooting and assumptions

- **Assumption (8.1 readability)**: Prepended the v0.9.0 Highlights section as the first content after the introductory blockquote rather than under the "Features" list, because the highlights are cycle-level deltas, not feature additions. The Features list keeps its existing v0.8.0-flagged entries and gains nothing from Phase 8.
- **Assumption (8.3 transferred mapping)**: The Section 10.1 introductory banner ("Transferred to v0.9.0 plan: ...") already documents that every row was ingested into the cycle plan at v0.8.0 close. The Phase 8.3 footer note on each of the 9 still-open rows is a more specific per-row pointer to the actual sub-task number in `v0.9.0-cycle.md`, layered on top of the banner.
- **Assumption (8.6 defer rationale)**: 10.O.EE's original "Not a release blocker" stance carries forward. The per-phase v0.8.0 history files plus the v0.8.0 known-gaps Resolved table already preserve the same content the consolidated narrative would have captured; `semantic-release` continues to author the per-commit `CHANGELOG.md`. Reopening 10.O.EE in v0.10.0 remains a no-cost option.
- **No troubleshooting required**: Phase 8 is a docs-only phase. No code lint / build / test failures to chase. The `catalog:check` CRLF warning is a Windows autocrlf cosmetic on `docs/index.md` and content-identically green.

---

## 3. Testing results

| Gate | Phase 8 outcome | Notes |
|---|---|---|
| `npm run lint` | exit 0 | Clean. |
| `npm run build` | exit 0 | tsc clean. |
| `npm run check src/` | exit 0 | 1 pre-existing warning (review-pr/SKILL.md, tracked under 10.N.F). |
| `npm run deps:check` | exit 0 | 3 pre-existing orphan warnings (planDiff.ts / planAnnotation.ts, pre-Phase-8 state). |
| `npm run catalog:check` | exit 0 | Cosmetic autocrlf warning on Windows; content matches. |
| `npm run perm-tier:check` | exit 0 | No drift. |
| `npm test` | Not re-run | No source-code / test files modified. Phase 7 cycle baseline (227 files, 2636 passed, 5 skipped, 0 failed on Windows) remains the test record. |

---

## 4. Next steps

- **Operator follow-ups** (tracked under [docs/archive/versions/v0/v0.9.0/operator-actions.md](../../operator-actions.md)): live-Ollama capture (Section 1), v0.8.0 post-tag exit verify (Section 2), package-lock + HNSW cross-host (Section 3), m-series.json live capture (Section 4), Stryker mutation re-run (Section 5), pen-test re-run (Section 6), v0.8.0 release publication (Section 7). None block v0.9.0 cycle close; all complete on operator schedule.
- **v0.10.0 inheritance**: 25 in-cycle items carry forward from v0.9.0/known-gaps.md plus the 9 still-open v0.8.0 operator-action items. Notable shortlist: 10.N.A / Q (ModelPinRegistry + IdleTimeScheduler production-wiring composition roots), 10.N.B / C (webview rendering of new protocol message types and proposed-skills cards), 10.N.O (`/ship-and-babysit` vs `npm run review` fold decision based on cycle usage), 10.N.T (per-file function-coverage backfill or `*.types.ts` exclusion), 10.N.U (CodeQL flip-to-blocking after one clean week).
- **No release tag work inside Phase 8.** Per 10.O.DD, the release tag decision (whether to skip the `v0.9.0` git tag or cut a parallel `v0.9.0-cycle` tag pointing at the post-Phase-8 commit) is operator-only.

---

## 5. References

- Plan: [docs/archive/versions/v0/v0.9.0/plans/v0.9.0-cycle.md](../../plans/v0.9.0-cycle.md) Phase 8 sub-tasks 8.1 -- 8.8.
- Prior phase histories: [phase-01.md](phase-01.md), [phase-02.md](phase-02.md), [phase-03.md](phase-03.md), [phase-04.md](phase-04.md), [phase-05.md](phase-05.md), [phase-06.md](phase-06.md), [phase-07.md](phase-07.md).
- v0.9.0 known-gaps: [docs/archive/versions/v0/v0.9.0/known-gaps.md](../../known-gaps.md) Section 10 (Phase 8 close stanza).
- v0.8.0 known-gaps (finalized in Phase 8.3): [docs/archive/versions/v0/v0.8.0/known-gaps.md](../../../v0.8.0/known-gaps.md) Section 10 (cycle-finalized stanza).
- DEVLOG entry: [docs/DEVLOG.md](../../../DEVLOG.md) (top of file).

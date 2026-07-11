# Plan -- v0.7.0 Adoption from Multi-Source Comparison

**Project**: Gemma Code
**Version**: v0.7.0
**Slug**: adoption-multi-source
**Plan Type**: Feature / Enhancement
**Created**: 2026-05-04
**Goal**: Close every P1 carryover from [docs/archive/versions/v0/v0.7.0/known-gaps.md](../known-gaps.md) (Sections 1-4) and adopt the P0+P1+P2 capability gaps surfaced in [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../comparison-multi-source.md) -- model-callable compaction, user-editable memory file architecture, Claude-Code-grade webview UI, expanded skill catalog, and supporting infrastructure -- while preserving the local-only thesis and the AGENTS.md module-authorship contract.

## Overview

This plan has two halves. **Phase 0** discharges the operator-action items and P1 carryovers from v0.6.0 -- live-Ollama baseline capture, post-tag exit verification, the panel decomposition / ChatController construction-graph hoist that v0.6.0 Phase 6 left at 935 lines (target was < 400), the `marked` v4 -> v12 migration deferred from v0.6.0 Phase 7, the optional filesystem-tool-handler split, mutation-testing gap fixes for the highest-impact survivors surfaced by v0.6.0 Phase 7's focused Stryker pass, and a fresh pre-cycle benchmark baseline. **Phases 1-9** then operationalize 22 adoption candidates (C12-C32, C34, C36) drawn from six external sources (an X post, a memory-architecture article, four GitHub repositories, and a Claude Code UI screenshot corpus). The split is intentional: Phase 0 closes obligations the v0.6.0 cycle made; Phases 1-9 build new product surface on a clean foundation.

This plan is the formal `/generate-plan` companion to the higher-level cycle plan at [docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md](v0.7.0-cycle.md); both target the same v0.7.0 release. Where the cycle plan is organized for readability across phases, this plan emphasizes self-contained executable prompts per sub-task suitable for `/implement-phase` execution.

Phase sequencing follows the MCP Registry Policy decision tree (reverse-engineer-first) for Phases 1-8. Phase 0 is foundational and runs before adoption work begins. See Section 9.4 of the source comparison for the ordering rationale: skill-native items ship first (Phase 1), then re-full builds in dependency order (Phases 2-8), then the release gate (Phase 9). No `vendor-intrinsic` items are adopted; six `drop-outright` items appear in the out-of-scope appendix, plus an additional set of v0.6.0 known-gaps Section 7 carryovers explicitly deferred to v0.8.0+.

The user-visible v0.7.0 delta is large: a measurably more presentable webview, a memory architecture the user can edit on disk, model-driven context compression that recovers from long sessions without global truncation, and a richer skill set for design/polish/critique workflows. The internal-developer-visible delta is moderate: one new tool handler, one new storage module, an expanded webview render protocol, six new skills, a multi-harness export script, and an optional HNSW vector-index swap with linear-scan fallback. Success is measured through three artifacts: `tests/golden/baselines/v0.7.0.json` regression-clean vs v0.6.0; `tests/benchmarks/baselines/v0.7.0.json` within +5 ms tool-execution p99 vs v0.6.0; a manual UX walkthrough confirming the seven Claude Code UI primitives are observable in a fresh session.

## Phases at a Glance

| Phase | Title | Outcome | Source |
|---|---|---|---|
| 0 | v0.6.0 close-out + carryovers | Operator-action items closed; P1 carryovers landed (panel hoist, marked v12, mutation-test gap fixes); pre-cycle benchmark baseline captured | known-gaps Sections 1-4 |
| 1 | Skill-native expansion | 6 new skills land as static MD before any code change | C28, C36 |
| 2 | Deterministic compaction strategies + per-model limits + /compact stats | Two new strategies plug into CompactionPipeline; per-model context limits configurable; /compact context+stats commands functional | C13, C14, C15, C16 |
| 3 | Memory file architecture | Instructions/Memory/Context/Archive at ~/.gemma-code/memory/<workspaceId>/; PromptBuilder consumes it; /memory init+archive+edit functional; ADR-0007 lands | C17 (+ unblocks C36 from Phase 1) |
| 4 | Model-callable compress tool | compress_range and (flag-gated) compress_message tools; CompressionState; /compact sweep+decompress+recompress+manual; ADR-0006 lands | C12 (+ underpins /compact lifecycle commands) |
| 5 | Webview render protocol overhaul | Inline diff cards, action-type tags, numbered permission prompts, todo blocks, thought-for-Xs meta-rows, queued-message field, completion-report block; ADR-0008 lands | C21, C22, C23, C24, C25, C26, C27 |
| 6 | Memory polish | /memory forget+export+import; MemoryPanel webview tab | C18, C19, C20 |
| 7 | Multi-harness skill packaging + gemma-check CLI | scripts/package-skills.mjs emits dist/{cursor,claude-code,opencode,gemini-cli}/; bin/gemma-check ships 4-5 deterministic checks | C29, C30 |
| 8 | HNSW vector index + background workers | hnswlib-node optional dep with linear-scan fallback; audit + testgaps workers post-N-edits | C32, C34 |
| 9 | Release gate + ADRs + CHANGELOG + baselines | v0.7.0 baselines captured; regression check green; CHANGELOG honest; version bump; tag pushed | release-gate |

---

## Phase 0: v0.6.0 close-out + carryovers

**Goal**: Discharge every P1 obligation in [docs/archive/versions/v0/v0.7.0/known-gaps.md](../known-gaps.md) Sections 1-4 before v0.7.0 feature work begins. This phase covers two operator-action items pending from v0.6.0 (live-Ollama baselines, post-tag exit verification), the panel decomposition / ChatController construction-graph hoist that v0.6.0 Phase 6 left at 935 lines (target was < 400), the `marked` v4 -> v12 migration deferred from v0.6.0 Phase 7, the optional filesystem-tool-handler split, mutation-testing gap fixes for the highest-impact survivors from the focused v0.6.0 Stryker pass, and a fresh pre-cycle benchmark baseline capture.

**Prerequisites**: v0.6.0 tag exists on origin/main. Without it, this phase has nothing to close out.

**Stability Gate**:
- `tests/golden/baselines/v0.4.0.json`, `tests/golden/baselines/v0.6.0.json`, `tests/benchmarks/baselines/v0.6.0.json` (post-Phase-7 regeneration) all captured against live Ollama `gemma4:e4b`.
- Post-tag exit verification re-run clean against the v0.6.0 tag (`npm ci` + lint + build + test + test:integration + bench + deps:check + catalog:check + perm-tier:check + `npm audit --production --audit-level=moderate`, all zero errors / zero warnings); pen-test Attack Path A simulation reproduced negative against v0.6.0 source.
- The three v0.7.0 cycle-plan files staged and committed (`comparison-multi-source.md`, `adoption-multi-source.md`, `v0.7.0-cycle.md`).
- `GemmaCodePanel.ts` reaches the original < 400 lines target after a ChatController-owned construction-graph hoist; ADR-0009 "OllamaClient injection pattern" lands.
- `marked` bumped from `^4.3.0` to `^12.0.0` with all three custom renderers (`code`, `heading`, `link`) rewritten against the token-object API; DOMPurify chain still strips script/style/event-handler tags; streaming partial-render preserved; `MarkdownRenderer.test.ts` corpus byte-identical or with documented whitespace-only diffs.
- (Optional) `filesystem.ts` split into per-tool files with stable re-export from `filesystem/index.ts`; deferral logged if not landed.
- Mutation-testing gap fixes: orchestration test re-included in Stryker; targeted regression tests for top 5-10 ActionClassifier survivors and top 5-10 terminal.ts survivors; identified no-coverage clusters in filesystem.ts get error-path tests; overall focused-runner mutation score > 60% (up from v0.6.0's 50.64%).
- `tests/benchmarks/baselines/v0.7.0-precycle.json` captured to establish a clean baseline before v0.7.0 feature work.
- All tests green; `npm run deps:check` clean; CHANGELOG `### v0.5.0 retrospective note` block updated with the measured token-savings number.

### Sub-tasks

#### 0.1 -- Live-Ollama golden + benchmark baseline capture (operator action)

**Objective**: Close v0.6.0 known-gaps Section 1.1 + 3.1 + 3.2 + 3.3.

**Prompt**:
> The operator runs the following on a quiescent dev workstation with `ollama serve` running and `gemma4:e4b` pulled:
> 1. Regenerate post-Phase-7 benchmark baseline: `npm run bench -- --update-baseline`. Output: `tests/benchmarks/baselines/v0.6.0.json`.
> 2. Capture v0.6.0 golden baseline: `python tests/golden/framework/run_all.py --model gemma4:e4b --output tests/golden/baselines/v0.6.0.json`.
> 3. Capture v0.4.0 golden baseline via worktree:
>    ```powershell
>    git worktree add ../Gemma-Code-v0.4.0 v0.4.0
>    Copy-Item -Recurse tests/golden/framework ../Gemma-Code-v0.4.0/tests/golden/framework -Force
>    cd ../Gemma-Code-v0.4.0 && npm ci
>    python tests/golden/framework/run_all.py --model gemma4:e4b --output ../Gemma-Code/tests/golden/baselines/v0.4.0.json
>    cd ../Gemma-Code && git worktree remove ../Gemma-Code-v0.4.0
>    ```
>    The framework copy is what makes the comparison apples-to-apples.
> 4. Run `node scripts/check-bench-regressions.mjs` against v0.5.0 and v0.4.0 baselines; document deltas back into [docs/archive/versions/v0/v0.6.0/development/history/2026-04_phase-2-test-pipeline.md](../../v0.6/development/history/2026-04_phase-2-test-pipeline.md) Section 2.6 placeholder (or a Phase 8 history doc when it lands).
> 5. Update [CHANGELOG.md](../../../../CHANGELOG.md) `### v0.5.0 retrospective note` block with the measured token-savings number against the v0.4.0 long-arc compare. If the measured number is below 40%, write the actual figure plus the gap rationale.
> 6. Decide v0.5.0.json policy: either consolidate `v0.5.0+memory-hygiene.json` and `v0.5.0+agent-friendly.json` into a single `v0.5.0.json`, or document the scoped split as canonical in `tests/golden/baselines/README.md`.
>
> Acceptance: 3 baseline files exist; regression check green; CHANGELOG retrospective note updated; v0.5.0 baseline policy documented.

---

#### 0.2 -- Post-tag exit verification (operator action)

**Objective**: Close v0.6.0 known-gaps Section 1.2.

**Prompt**:
> After the v0.6.0 tag exists on origin/main, the operator checks it out clean and runs the full gate:
> ```powershell
> git checkout v0.6.0
> npm ci
> npm run lint && npm run build && npm run test && npm run test:integration && npm run bench && npm run deps:check && npm run catalog:check && npm run perm-tier:check && npm audit --production --audit-level=moderate
> ```
> All commands must produce zero errors and zero warnings. Verify the GitHub release artifact contains the VSIX. Re-run the pen-test Attack Path A simulation against the v0.6.0 source tree (symlinked workspace + `permissionOverrides[run_terminal] = 0`); confirm both legs of the chain refuse the attack.
>
> Acceptance: full gate green; VSIX present in release artifacts; Attack Path A reproduced negative.

---

#### 0.3 -- Stage and commit the v0.7.0 cycle-plan files

**Objective**: Close v0.6.0 known-gaps Section 5.3.

**Prompt**:
> Three files appeared in the working tree before v0.6.0 Phase 8 began (likely from a parallel exploration session) and v0.6.0 Phase 8 explicitly did NOT stage them per scope discipline:
> - `docs/archive/versions/v0/v0.7.0/comparison-multi-source.md`
> - `docs/archive/versions/v0/v0.7.0/plans/adoption-multi-source.md`
> - `docs/archive/versions/v0/v0.7.0/plans/v0.7.0-cycle.md`
>
> Now that v0.6.0 is tagged, review the files; if accepted as the formal v0.7.0 cycle kickoff, stage and commit them with `feat(v0.7.0): cycle plan kickoff`. If rejected or to be replaced, reset and regenerate. Update [docs/archive/versions/v0/v0.7.0/known-gaps.md](../known-gaps.md) Section 5.3 to reflect the resolution.
>
> Acceptance: files committed (or formally reset); known-gaps.md Section 5.3 closed.

---

#### 0.4 -- Panel decomposition completion + ChatController construction-graph hoist

**Objective**: Close v0.6.0 known-gaps Sections 2.3 + 2.4. Reach the original panel < 400 lines target.

**Prompt**:
> [src/panels/GemmaCodePanel.ts](../../../../src/panels/GemmaCodePanel.ts) shipped v0.6.0 at 935 lines (46% reduction from the v0.5.0 baseline of 1,724 but short of the < 400 lines plan target). The remaining bulk is constructor wiring + init factories. Hoisting the agent-loop / pipeline / orchestrator construction into `ChatController` (the "full ownership" split per ADR-0008) requires re-architecting the `OllamaClient` injection pattern -- the construction graph shares a single `OllamaClient` across five layers; restructuring it for controller ownership is a larger commit than v0.6.0 Phase 6 had budget for.
>
> Steps:
> 1. Write `docs/adr/0009-ollama-client-injection.md` documenting the new injection pattern (factory-supplied vs root-owned). Reference v0.6.0 ADR-0008 (panel decomposition) and the AGENTS.md module-authorship contract.
> 2. Refactor [src/runtime/GemmaRuntime.ts](../../../../src/runtime/GemmaRuntime.ts) to own the OllamaClient and supply it via factory to ChatController.
> 3. Move the construction logic for AgentLoop, CompactionPipeline, and Orchestrator from `GemmaCodePanel` into `ChatController` (`buildAgentLoop`, `buildCompactionPipeline`, `buildOrchestrator`).
> 4. Verify the panel reaches < 400 lines target. Update v0.6.0 Phase 6 history notes with a cross-link to the resolution.
> 5. Run the full test gate. Add `tests/unit/runtime/GemmaRuntime.test.ts` if it does not yet exist, asserting the OllamaClient is supplied by a factory and not directly constructed inside the panel.
>
> Acceptance: ADR-0009 merged; panel < 400 lines; tests green; no module-boundary violations.

---

#### 0.5 -- marked v4 -> v12 migration

**Objective**: Close v0.6.0 known-gaps Section 2.1.

**Prompt**:
> v12 reshapes the `Renderer` API to a single token-object argument. The three custom renderer methods overridden in [src/utils/MarkdownRenderer.ts](../../../../src/utils/MarkdownRenderer.ts) (`code`, `heading`, `link`) all need rewrites. Steps:
> 1. Bump `marked` from `^4.3.0` to `^12.0.0` in [package.json](../../../../package.json).
> 2. Rewrite each custom renderer against the new signature: `renderer.code({text, lang, escaped})` instead of `renderer.code(text, lang)`. Same shape for `heading({text, depth, raw, tokens})` and `link({href, title, text, tokens})`.
> 3. Verify `headerIds` and `mangle` v12 defaults match the prior v4 behavior; configure explicitly via `marked.use({...})` if not.
> 4. Run [tests/unit/utils/MarkdownRenderer.test.ts](../../../../tests/unit/utils/MarkdownRenderer.test.ts); assert byte-identical HTML output for all existing fixtures, or document any whitespace-only diffs in the test snapshots.
> 5. Verify the streaming pipeline in [src/chat/StreamingPipeline.ts](../../../../src/chat/StreamingPipeline.ts) still surfaces partial-render fragments correctly; add a streaming integration test if one does not exist.
> 6. Verify the CSP and DOMPurify chain still strip `<script>`, `<style>`, and event-handler attributes (no security regression -- DOMPurify is the source of sanitization, marked's built-in is just a backstop we don't rely on).
>
> Acceptance: marked at ^12; renderer test corpus green; streaming partial-render preserved; sanitization chain intact.

---

#### 0.6 -- (Optional) Filesystem tool handler split

**Objective**: Close v0.6.0 known-gaps Section 2.2.

**Prompt**:
> [src/tools/handlers/filesystem.ts](../../../../src/tools/handlers/filesystem.ts) ships v0.6.0 with all 7 handlers (`read_file`, `write_file`, `edit_file`, `create_file`, `delete_file`, `list_directory`, `grep_codebase`). Optional split into per-tool files:
> 1. Create `src/tools/handlers/filesystem/{read.ts, write.ts, edit.ts, create.ts, delete.ts, list.ts, grep.ts}`. Each imports `pathGuard.resolveInsideWorkspace` and exports its handler.
> 2. Create `src/tools/handlers/filesystem/index.ts` re-exporting all 7 handlers; consumers continue to import from `./filesystem` (no breaking change).
> 3. Move shared helpers (`resolveWorkspacePath`, common error formatting) into `filesystem/internal.ts`.
> 4. Keep [tests/unit/tools/handlers/](../../../../tests/unit/tools/handlers) unchanged; update import paths only.
> 5. Verify [configs/dependency-cruiser.cjs](../../../../configs/dependency-cruiser.cjs) does not need new rules; the per-file boundary is identical to the per-folder boundary.
>
> This sub-task is optional; if Phase 0 is time-constrained, defer to v0.8.0 and log the deferral in CHANGELOG carryovers + known-gaps.md Section 2.2 with a status update. Acceptance: split lands cleanly with all tests green, OR explicit deferral logged.

---

#### 0.7 -- Mutation-testing gap fixes (high-impact survivors)

**Objective**: Close v0.6.0 known-gaps Sections 4.1, 4.2, 4.3, 4.4, 4.5. Targeted, not exhaustive.

**Prompt**:
> v0.6.0 Phase 7 sub-task 7.6 ran a focused Stryker pass and reported 50.64% overall mutation score across 1,878 mutants. Targeted fixes:
> 1. **policy.ts (gap 4.1)**: add a behavioural lookup test in `tests/unit/guardrails/policy.test.ts` asserting each tier value is what the public API returns for known tool names; this catches table-value mutations.
> 2. **ActionClassifier.ts (gap 4.2)**: identify the top 10 highest-impact survivors from the Stryker HTML report (those that change classifier output for a real agent input). Add targeted regression tests in [tests/unit/guardrails/](../../../../tests/unit/guardrails).
> 3. **terminal.ts (gap 4.3)**: identify the top 10 survivors that change allowlist verdicts or bypass the segment-check denylist from v0.1.0 Phase 8. Add targeted tests in `tests/unit/tools/handlers/terminal.test.ts`.
> 4. **filesystem.ts (gap 4.4)**: identify the no-coverage clusters (likely create_file / delete_file / list_directory error branches) and add error-path tests.
> 5. **Orchestrator.test.ts (gap 4.5)**: rewrite `expect(totalTimeMs).toBeGreaterThan(0)` to `expect(totalTimeMs).toBeGreaterThanOrEqual(0)` so the test is Stryker-safe; re-include `src/orchestration/` in the [configs/stryker.config.json](../../../../configs/stryker.config.json) runner.
>
> Re-run focused Stryker; target overall mutation score > 60% (up from 50.64%). Document the new score in the Phase 0 history doc. Acceptance: targeted survivors closed; orchestration directory back in Stryker; mutation score improved.

---

#### 0.8 -- Capture pre-cycle benchmark baseline

**Objective**: Establish a clean v0.7.0 starting point.

**Prompt**:
> After 0.4-0.7 land, run `npm run bench -- --update-baseline` to capture `tests/benchmarks/baselines/v0.7.0-precycle.json`. This is the baseline against which all v0.7.0 feature phases will measure regression. Verify the file exists and run `node scripts/check-bench-regressions.mjs --base v0.6.0 --candidate v0.7.0-precycle`; the cycle's structural changes (panel hoist, marked v12) should appear without any quality regression past the v0.6.0 thresholds (hooks p99 < 50 ms, tool-execution p99 within +5 ms vs v0.5.0).
>
> Acceptance: file exists; regression check green or any regression documented and accepted.

---

#### 0.9 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 0.

**Prompt**:
> Run the full gate: `npm run lint && npm run build && npm run test && npm run test:integration && npm run bench && npm run deps:check && npm run catalog:check && npm run perm-tier:check && npm audit --production --audit-level=moderate`. Fix any regressions surfaced by the panel hoist or marked migration. Verify all v0.6.0 known-gaps Section 1-4 P1 items are closed; update [docs/archive/versions/v0/v0.7.0/known-gaps.md](../known-gaps.md) Sections 1-4 with status notes (Closed in v0.7.0 Phase 0 sub-task X.Y). After green, run `/generate-session-history` for Phase 0.

---

### Phase 0 Exit Checklist

- [ ] Live-Ollama baselines (v0.4.0 + v0.6.0 golden + v0.6.0 benchmark post-Phase-7) captured
- [ ] Post-tag v0.6.0 exit verification green; Attack Path A reproduced negative
- [ ] v0.7.0 cycle-plan files staged + committed
- [ ] Panel < 400 lines after ChatController hoist; ADR-0009 merged
- [ ] marked at ^12 with all three custom renderers rewritten; sanitization chain intact
- [ ] (Optional) filesystem split landed or deferral logged
- [ ] Mutation-testing targeted survivors closed; orchestration back in Stryker; score > 60%
- [ ] v0.7.0 pre-cycle benchmark baseline captured
- [ ] CHANGELOG retrospective note updated with measured token-savings
- [ ] known-gaps.md Sections 1-4 P1 items marked closed
- [ ] All tests passing
- [ ] Session history generated for Phase 0

---

## Phase 1: Skill-native expansion

**Goal**: Ship 6 new skills as static MD files before any infrastructure work, so the catalog change is the first thing visible on a v0.7.0 install.

**Prerequisites**: Phase 0 close-out complete (v0.6.0 obligations discharged; pre-cycle baseline captured).

**Stability Gate**:
- Six new directories exist under `src/skills/catalog/`: `polish`, `critique`, `distill`, `harden`, `animate`, `build-second-brain`.
- All six SKILL.md files parse via [src/skills/SkillLoader.ts](../../../../src/skills/SkillLoader.ts); a unit test asserts each loads.
- The `/help` builtin lists all 13 skills (7 existing + 6 new).
- `npm run lint && npm run test && npm run deps:check` green.

### Sub-tasks

#### 1.1 -- Add `polish`, `critique`, `distill`, `harden`, `animate` skills

**Objective**: Adopt comparison report C28. Provide a domain-rich vocabulary for code/UI improvement workflows, modelled on impeccable's command shape but generalized to all-domain code, not frontend-design only.

**Prompt**:
> In `src/skills/catalog/`, create five new directories: `polish/`, `critique/`, `distill/`, `harden/`, `animate/`. Each contains a single `SKILL.md` with YAML frontmatter (`name`, `description`, `argument-hint`) and a body. Use the existing skill structure from [src/skills/catalog/commit/SKILL.md](../../../../src/skills/catalog/commit/SKILL.md) as the schema reference; do NOT copy impeccable's structure verbatim (Apache 2.0 + frontend-specific). For each skill define the prompt text from scratch with these scopes:
> - `polish`: Final-pass quality cleanup. Tighten naming, remove dead branches, improve docstrings, run linters/formatters, ensure tests pass. Argument: optional file or area.
> - `critique`: Structured code review against a small explicit rubric (correctness, readability, performance, security, test coverage). Output a numbered list of findings with severity tags. No code edits.
> - `distill`: Strip a piece of code or a function to its essence. Remove indirection, simplify conditionals, collapse abstractions with only one consumer. Behaviour-preserving.
> - `harden`: Add error handling, input validation, edge-case coverage, retry/timeout where appropriate. Each addition must trace to a specific risk.
> - `animate`: Introduce purposeful motion / interactivity to UI elements. Restricted to webview / extension UI surfaces (not generic). Argument: target file or component.
>
> Each skill's body includes a 1-2 sentence usage example. Add a unit test in `tests/unit/skills/SkillLoader.test.ts` asserting each new skill loads with non-empty `description` and `prompt`. Update [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md) with a one-line description of each. Run `npm run lint && npm run test`. Acceptance: 5 new skills load; `/help` lists all 12 (7 + 5; build-second-brain lands in 1.2).

---

#### 1.2 -- Add `build-second-brain` skill

**Objective**: Adopt C36. Bootstraps the user's Memory.md / Context.md from existing notes once Phase 3 lands the file architecture. Adopted as a SKILL, not a hardcoded system-prompt addition.

**Prompt**:
> Create `src/skills/catalog/build-second-brain/SKILL.md`. Frontmatter: `name: build-second-brain`, `description: "Help the user populate Instructions.md / Memory.md / Context.md from existing notes, project docs, or interview prompts."`, `argument-hint: "[path-to-existing-notes]"`. Body: a structured prompt walking the agent through (a) detecting whether `~/.gemma-code/memory/<workspace-id>/{Instructions,Memory,Context}.md` exist (if not, fail with a pointer to `/memory init`), (b) interviewing the user briefly about role, project, and conventions when no input notes are provided, (c) extracting Preferences/Corrections/Patterns/Decisions from input notes when provided, (d) writing structured sections back to the four files using the schema documented in [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md) "Memory file architecture" section. Reference the schema from architecture.md explicitly so the skill stays consistent if the schema evolves. Add a unit test asserting the skill loads. The skill is non-functional until Phase 3 lands; mark this in the description with `(requires Phase 3 memory file architecture).` Acceptance: skill present; documentation cross-link in place.

---

#### 1.3 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 1. Iterate until stable.

**Prompt**:
> Run `npm run lint && npm run test && npm run deps:check`. Confirm: (a) the SkillLoader unit test loads all 6 new skills with non-empty fields; (b) `/help` listing test (if present) reflects 13 skills; (c) the 12 token-estimation tests carried over from v0.5.0 known-gaps section 1.1 are not regressed by these changes (they should not touch Phase 1, but verify). If any failure: fix, re-run. Do not advance to Phase 2 until green. After all tests pass, run `/generate-session-history` to document Phase 1.

---

### Phase 1 Exit Checklist

- [ ] 6 new SKILL.md files under `src/skills/catalog/<name>/`
- [ ] Unit test asserts all 6 load
- [ ] `/help` lists 13 skills
- [ ] All tests passing
- [ ] No regressions from v0.6.0
- [ ] Session history generated for Phase 1

---

## Phase 2: Deterministic compaction strategies + per-model context limits + /compact stats

**Goal**: Land the two deterministic compaction strategies (deduplication, purge-errors) ahead of the model-callable compress tool, plus per-model context limits and the read-only /compact context+stats commands.

**Prerequisites**: Phase 1.

**Stability Gate**:
- New strategies `src/chat/strategies/deduplication.ts` and `src/chat/strategies/purgeErrors.ts` plug into [src/chat/CompactionPipeline.ts](../../../../src/chat/CompactionPipeline.ts) as additional pipeline steps before the sliding window.
- New setting `gemma-code.compactionProtectedTools: string[]` (default = the protected list documented below) is consulted by both strategies.
- New setting `gemma-code.compactionErrorPurgeTurns: number` (default 4, range 1-50) for the purge-errors strategy.
- New setting `gemma-code.contextLimitsPerModel: Record<string, { maxTokens?: number; minContextLimit?: number }>` honored by the budget allocator.
- New `/compact context` and `/compact stats` builtins land; the existing bare `/compact` keeps its behavior.
- All tests green; no regression in [tests/integration/](../../../../tests/integration) compaction tests.

### Sub-tasks

#### 2.1 -- Deduplication strategy

**Objective**: Adopt C13. Eliminate same-tool-same-args repeated outputs from the conversation history.

**Prompt**:
> Create `src/chat/strategies/deduplication.ts` exporting a pure function `deduplicate(messages: Message[], state: CompactionState, config: { protectedTools: string[]; protectedFilePatterns: string[] }): Message[]`. Algorithm:
> 1. Walk messages newest-to-oldest, building Map<signature, idx>. `signature = toolName + ":" + canonicalizeArgs(args)`. canonicalizeArgs sorts object keys, trims string whitespace, JSON-stringifies.
> 2. For tool-result messages whose signature already maps to a more-recent message, replace older content with `[deduplicated -- see message #${recentIdx}]`.
> 3. Skip protected tools and tool calls whose args contain a path matching `protectedFilePatterns`.
> 4. Never deduplicate errored tool calls.
> 5. Return a new message array; do NOT mutate input.
>
> Wire into [src/chat/CompactionPipeline.ts](../../../../src/chat/CompactionPipeline.ts) as a new step before the sliding window. Source the protectedTools list from the new `gemma-code.compactionProtectedTools` setting (default: `["compress_range", "compress_message", "verify", "research", "memory", "write_file", "edit_file", "create_file", "delete_file", "update_todos"]`). Add `tests/unit/chat/strategies/deduplication.test.ts` covering: (a) two identical `read_file('/foo.ts')` -> older replaced; (b) `read_file('/foo.ts')` then `read_file('/bar.ts')` -> both kept; (c) protected pattern `/foo.ts` -> both kept; (d) errored call kept verbatim. Run `npm run mutate -- src/chat/strategies/deduplication.ts` and confirm survival score above existing baseline. Acceptance: feature green; no regression in `tests/integration/compaction.test.ts`.

---

#### 2.2 -- Purge-errors strategy

**Objective**: Adopt C14. Drop the input of errored tool calls after N turns; keep the error message verbatim.

**Prompt**:
> Create `src/chat/strategies/purgeErrors.ts` exporting `purgeErrors(messages: Message[], state: CompactionState, config: { protectedTools: string[]; errorPurgeTurns: number }): Message[]`. Algorithm:
> 1. Identify tool-result messages where `result.error === true` (or tagged as error during agent-loop execution).
> 2. For each errored tool call older than `errorPurgeTurns` user-message turns, replace its `args` field in the matching tool-call message with `{ purged: true, purgedAt: <turn>, originalSize: <bytes> }`. The error result stays.
> 3. Skip tools in protectedTools.
>
> Add setting `gemma-code.compactionErrorPurgeTurns: number` (default 4, range 1-50) in [package.json](../../../../package.json). Wire into [CompactionPipeline.ts](../../../../src/chat/CompactionPipeline.ts) as a step after deduplication. Add `tests/unit/chat/strategies/purgeErrors.test.ts` covering: (a) errored read_file 5 turns ago with purge-turns=4 -> args purged, error preserved; (b) errored write_file 2 turns ago -> args kept; (c) errored protected-tool -> args kept regardless of age. Acceptance: feature green.

---

#### 2.3 -- Per-model context-limit overrides

**Objective**: Adopt C15. Different Gemma 4 sizes have different context windows (E2B/E4B 128K vs 26B/31B 256K); the pipeline should respect per-model overrides.

**Prompt**:
> Add to [package.json](../../../../package.json):
> ```json
> "gemma-code.contextLimitsPerModel": {
>   "type": "object",
>   "default": {},
>   "description": "Per-model overrides for max context tokens. Keys are model names (e.g. 'gemma4:e4b'); values are objects with optional 'maxTokens' (number) and 'minContextLimit' (number). Per-model values win over the global gemma-code.maxTokens."
> }
> ```
> In [src/config/](../../../../src/config), extend the budget allocator to consult this map first; fall back to global `gemma-code.maxTokens` if no model-specific override. Add `tests/unit/config/contextLimitsPerModel.test.ts`. Document in [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md). Acceptance: setting honored, tests green.

---

#### 2.4 -- `/compact context` and `/compact stats` commands

**Objective**: Adopt C16. Surface the existing observability data via two new compaction subcommands.

**Prompt**:
> Extend the `/compact` builtin in [src/commands/CommandRouter.ts](../../../../src/commands/CommandRouter.ts) to accept a verb argument:
> - `/compact` (no verb) -- preserve legacy behavior (force a sliding-window compaction).
> - `/compact context` -- show a token-usage breakdown by category (system prompt, file memory, SQL memory, conversation, tool results) and percentage of compaction headroom remaining. Backed by [src/observability/MetricsCollector.ts](../../../../src/observability/MetricsCollector.ts).
> - `/compact stats` -- cumulative pruning stats across sessions (total tokens saved by deduplication, by purgeErrors, by compress tool when it lands in Phase 4, by sliding-window). Backed by metrics aggregation.
>
> Add `src/commands/compactStatusCommand.ts` and `src/commands/compactStatsCommand.ts` (one file per verb). Add unit tests for argument parsing and verb dispatch in `tests/unit/commands/compactCommand.test.ts`. The `compress` tool stat will report `0` until Phase 4 lands -- that is acceptable. Acceptance: both verbs functional.

---

#### 2.5 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 2.

**Prompt**:
> Run unit + integration tests for the new strategies, command verbs, and per-model context limits. Verify mutation-test discipline survives. Verify no regression in [tests/integration/compaction.test.ts](../../../../tests/integration/compaction.test.ts). After green, run `/generate-session-history` for Phase 2.

---

### Phase 2 Exit Checklist

- [ ] Deduplication + purge-errors strategies wired into CompactionPipeline
- [ ] Per-model context limits honored
- [ ] /compact context and /compact stats verbs functional
- [ ] All tests passing
- [ ] Session history generated

---

## Phase 3: Memory file architecture

**Goal**: Land the user-editable Instructions.md / Memory.md / Context.md / Archive directory structure under `~/.gemma-code/memory/<workspaceId>/`, wire PromptBuilder to consume it on every turn, and provide a `/memory archive` command for snapshots.

**Prerequisites**: Phase 1 (build-second-brain skill exists but is non-functional until this phase lands).

**Stability Gate**:
- New module `src/storage/MemoryFiles.ts` owns the four files; reads cached by mtime.
- On first session per workspace, the four files are auto-scaffolded with placeholder sections; `/memory init --force` re-scaffolds.
- PromptBuilder consumes the merged content of Instructions.md + Memory.md + Context.md as a system-prompt augmentation. On conflict between file-memory and SQL-memory, file wins.
- `/memory archive` snapshots the four files into `~/.gemma-code/memory/<workspaceId>/Archive/<YYYY-MM-DD>/`. Setting `gemma-code.memoryAutoArchive: "off"|"weekly"|"monthly"` (default off) auto-fires on session start when the most recent archive is older than the threshold.
- Path-guard applies on all four files; secret-path denylist applies on writes.
- ADR-0007 lands documenting precedence and lifecycle.
- All tests green.

### Sub-tasks

#### 3.1 -- Build `MemoryFiles` storage module

**Objective**: Adopt C17. Provide read/write/archive/scaffold for the four-file architecture.

**Prompt**:
> Create `src/storage/MemoryFiles.ts` exporting a `MemoryFiles` class with constructor `(workspaceId: string, baseDir = path.join(os.homedir(), ".gemma-code", "memory"))`. Methods:
> - `init(force?: boolean): { created: string[]; skipped: string[] }` -- creates `<base>/<workspaceId>/{Instructions,Memory,Context}.md` with section scaffolds. Instructions: "Who you are / What you do / Rules / What good outputs look like" + a footer line `Update Memory.md with my preferences over time`. Memory: "Preferences / Corrections / Patterns / Decisions". Context: "About this project / Audience / Tools and stack / Important background". If `force=false` (default) and any file exists, skip it.
> - `read(): { instructions: string; memory: string; context: string; instructionsPath: string; memoryPath: string; contextPath: string }`. Cached by mtime; re-reads if any file's mtime advanced.
> - `archive(): { archivedPath: string; archivedAt: Date }` -- copies the three files into `<base>/<workspaceId>/Archive/<YYYY-MM-DD>/`.
> - `appendToMemory(section: "Preferences"|"Corrections"|"Patterns"|"Decisions", line: string): void`.
> - `removeFromMemory(pattern: string | RegExp): { removedLines: number }`. Reject catastrophic patterns (`.*` without anchors).
>
> Apply secret-path denylist via [src/utils/secretPaths.ts](../../../../src/utils/secretPaths.ts) helper to all writes. Reject paths outside `<base>/<workspaceId>/`. Write `tests/unit/storage/MemoryFiles.test.ts` covering init scaffolds, init force overwrites, read mtime cache, archive copies, appendToMemory, removeFromMemory pattern rejection. Acceptance: module + tests green.

---

#### 3.2 -- Wire MemoryFiles into PromptBuilder

**Objective**: Adopt C17. PromptBuilder must inject merged file content as system-prompt augmentation.

**Prompt**:
> In [src/chat/PromptBuilder.ts](../../../../src/chat/PromptBuilder.ts), find the budget-allocation logic around the system-prompt reservation. Add a `MemoryFiles | null` field to the constructor. Inject the read result between the bundled system prompt and the SQL-backed memory injection. Merge order:
> 1. Bundled system prompt (verbatim).
> 2. Instructions.md (verbatim).
> 3. Context.md (verbatim).
> 4. SQL-backed memories filtered to those NOT shadowed by anything in Memory.md.
> 5. Memory.md (verbatim, last so the model sees the user's most-recent editing).
>
> Track file-memory tokens against the existing `systemPromptBudgetPercent` reserve. If file-memory exceeds 50% of system-prompt budget, truncate at section boundaries (drop oldest Memory.md entries first) and emit a warning via `getLogger()`. Add `tests/integration/memory-files-prompt-merge.test.ts` covering: (a) seeded SQL fact `prefer Conventional Commits`; (b) seeded Memory.md with `Always squash-merge before tagging`; (c) prompt built for "open a release PR"; (d) assert both facts present and Memory.md text appears AFTER SQL-backed text. Acceptance: integration test green; budget honored.

---

#### 3.3 -- `/memory init`, `/memory archive`, `/memory edit` commands

**Objective**: Surface the file architecture via slash commands.

**Prompt**:
> Extend the `/memory` builtin in [src/commands/CommandRouter.ts](../../../../src/commands/CommandRouter.ts) to accept verbs `init [--force]`, `archive`, `edit [section]`. In `src/commands/memoryCommand.ts`, route each verb:
> - `init` -- calls `MemoryFiles.init(force)`; reports paths created/skipped.
> - `archive` -- calls `MemoryFiles.archive()`; reports the archived path.
> - `edit` -- opens the requested file via `vscode.window.showTextDocument`. Section is one of `instructions`, `memory`, `context`. Default `memory`.
>
> Add setting `gemma-code.memoryAutoArchive: "off" | "weekly" | "monthly"` (default `"off"`). When set to `weekly` or `monthly`, on session start the runtime checks whether the most recent archive in `Archive/` is older than 7 or 30 days; if so, silently runs `MemoryFiles.archive()`. Document in [package.json](../../../../package.json) and [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md). Add unit tests for command parsing and an integration test that fakes a stale Archive/ and asserts `weekly` triggers auto-archive. Acceptance: commands functional; auto-archive honors schedule.

---

#### 3.4 -- ADR-0007: memory file architecture

**Objective**: Document precedence and lifecycle.

**Prompt**:
> Create `docs/adr/0007-memory-file-architecture.md` following [docs/adr/template.md](../../../versions/docs/adr/template.md). Sections: Context (S2 article reference; existing 4-layer SQL memory has no user-editor; user feedback friction with `/memory save`); Decision (introduce file architecture; on conflict file wins; archive on schedule); Consequences (positive: user owns memory, file-text is direct LLM input, simple backup story; negative: LLM now reads two memory layers and must understand precedence -- mitigated by deterministic merge order in PromptBuilder). Reference [comparison-multi-source.md](../comparison-multi-source.md) Section 9.3 entry C17. Acceptance: ADR present, status `accepted`, linked from CHANGELOG.

---

#### 3.5 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 3.

**Prompt**:
> Run unit + integration tests for MemoryFiles, PromptBuilder integration, command verbs, and ADR-0007 link. Verify the build-second-brain skill from Phase 1 now functions when invoked. After green, run `/generate-session-history` for Phase 3.

---

### Phase 3 Exit Checklist

- [ ] MemoryFiles module + tests
- [ ] PromptBuilder consumes file architecture with documented precedence
- [ ] /memory init+archive+edit functional
- [ ] gemma-code.memoryAutoArchive schedule honored
- [ ] ADR-0007 merged
- [ ] build-second-brain skill verified end-to-end
- [ ] Session history generated

---

## Phase 4: Model-callable compress tool

**Goal**: Adopt the heart of S5's contribution -- a model-callable `compress` tool with two modes (range, message) -- plus the four lifecycle commands `/compact sweep | decompress | recompress | manual`.

**Prerequisites**: Phase 2 (deterministic strategies and `gemma-code.compactionProtectedTools` setting).

**Stability Gate**:
- New module `src/chat/state/CompressionState.ts` tracks block IDs (`b1`, `b2`, ...) and message IDs (`m0001`, ...) durably across sessions; nested compressions resolve correctly.
- New tool handler `src/tools/handlers/compress.ts` registers two variants:
  - `compress_range` (always available)
  - `compress_message` (gated on `gemma-code.compactExperimentalMessageMode: boolean`, default `false`)
- Both tools have `permission_tier: 0` (auto-approve, read-only of conversation state); they NEVER touch files, terminal, or network.
- Tool prompt descriptions live in `src/chat/prompts/compress-range.md` and `src/chat/prompts/compress-message.md` -- written from scratch (S5 is AGPL-3.0; we cannot copy verbatim).
- Compaction lifecycle commands `/compact sweep [n] | decompress <id> | recompress <id> | manual on|off` functional.
- ADR-0006 lands documenting trade-offs vs deterministic-only compaction.

### Sub-tasks

#### 4.1 -- CompressionState module + block-ID allocation

**Objective**: Build the durable state underpinning the compress tool.

**Prompt**:
> Create `src/chat/state/CompressionState.ts` exporting `CompressionState` with fields: `messageIds: Map<MessageRef, string>` (msg ref -> stable ID like `m0001`), `blockIds: Map<BlockRef, string>` (block ref -> `b1`), `compressionRuns: CompressionRun[]` where `CompressionRun = { runId: string; topic: string; mode: "range"|"message"; blockSummaries: { blockId: string; startId: string; endId: string; summary: string; nestedBlockIds: string[] }[]; createdAt: number; decompressed: boolean }`. Methods: `allocateMessageId(msg)`, `allocateBlockId()`, `recordRun(run)`, `decompressBlock(blockId): { restoredMessages: Message[] }`, `recompressBlock(blockId): { rerunCompression: CompressionRun }`. Persistence: serialise into existing chat-history SQLite table (new column `compression_state` JSON, with idempotent migration). On session reload, deserialise. Add `tests/unit/chat/state/CompressionState.test.ts` covering: monotonic ID allocation; record-and-list run; decompress restores prior message array; recompress re-applies prior compression. Acceptance: module + tests + migration green.

---

#### 4.2 -- `compress_range` tool handler

**Objective**: Adopt C12 (range mode).

**Prompt**:
> Create `src/tools/handlers/compress.ts` exporting `compressRangeHandler`. Register in [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts) with `permission_tier: 0`, `category: "compaction"`. Schema (Zod):
> ```typescript
> {
>   topic: string;     // 3-5 word label, displayed in /compact context
>   ranges: Array<{
>     startId: string;   // m0005 or b3
>     endId: string;
>     summary: string;
>   }>;
> }
> ```
> Algorithm:
> 1. Validate args. Reject empty ranges. Reject ranges where startId index > endId index. Reject overlapping ranges in a single call.
> 2. For each range, allocate a block ID; replace messages in `[startId..endId]` with a placeholder of role `system` and content `[BLOCK ${blockId}: ${topic}]\n${summary}`. If the range overlaps an earlier block, embed that block's summary inside the new summary (resolveOverlap helper).
> 3. Append protected user messages to the end of the summary block (per `protectUserMessages` setting; default false).
> 4. Append protected tool outputs to the end (per `compactionProtectedTools`).
> 5. Record a CompressionRun in CompressionState.
> 6. Return success metadata `{ blockIds: string[]; tokensSaved: number }`.
>
> Write `src/chat/prompts/compress-range.md` from scratch. The prompt explains: when to compress (after task completion, before context-pressure rather than after); what to summarise (key decisions, file references, error states; not chit-chat); the format the model must emit (JSON matching the Zod schema). Document in [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md) the schema and lifecycle.
>
> Tests in `tests/unit/tools/handlers/compress-range.test.ts`: (a) three messages compressed, placeholder visible; (b) overlapping ranges in same call -> rejected; (c) range overlapping a prior block -> nested correctly; (d) protected tool output preserved verbatim at end of summary; (e) tool reported with permission_tier 0. Acceptance: feature green; mutation tests pass.

---

#### 4.3 -- `compress_message` tool handler (experimental, gated)

**Objective**: Adopt C12 (message mode), gated behind an experimental flag because S5 itself marks it experimental.

**Prompt**:
> In `src/tools/handlers/compress.ts`, add `compressMessageHandler` accepting `{ compressions: Array<{ messageId: string; summary: string }> }`. Algorithm: replace each named message with a placeholder containing the summary; record in CompressionState as a one-message run. Reject if compressing only one of a tool-call/tool-result pair (orphans the other side). Register only if `gemma-code.compactExperimentalMessageMode === true` (new setting in [package.json](../../../../package.json), default `false`, description notes the trade-off: more surgical compaction; risk of fragmenting causally-linked tool sequences). Write `src/chat/prompts/compress-message.md` from scratch. Tests in `tests/unit/tools/handlers/compress-message.test.ts` cover: (a) basic compression; (b) tool-call/result pair rejected if only one side compressed; (c) compressed message round-trips through decompress correctly; (d) handler not registered when flag false. Acceptance: feature green; gate works.

---

#### 4.4 -- Compaction lifecycle commands `/compact sweep | decompress | recompress | manual`

**Objective**: Surface the compress tool's lifecycle to the user.

**Prompt**:
> Extend the `/compact` builtin in [src/commands/CommandRouter.ts](../../../../src/commands/CommandRouter.ts) (which already accepts `context` and `stats` from Phase 2) to add four more verbs:
> - `/compact sweep [n]` -- manually issue a `compress_range` call covering the last N tool results since the last user message (default N = 10).
> - `/compact decompress <blockId>` -- restore a block via `CompressionState.decompressBlock`. Listing form: `/compact decompress` with no arg shows available block IDs, token sizes, and topics.
> - `/compact recompress <blockId>` -- re-apply a previously-decompressed compression. Listing form like decompress.
> - `/compact manual on|off` -- toggle a session-scoped flag DISABLING the model's ability to call the compress tool autonomously. Deterministic strategies (deduplication, purgeErrors) still run.
>
> Each command writes a structured response into the chat. Add unit tests per verb in `tests/unit/commands/compactCommand.test.ts`. Acceptance: 4 verbs functional; existing `context` and `stats` from Phase 2 unaffected.

---

#### 4.5 -- ADR-0006: compress tool design

**Objective**: Document the trade-offs.

**Prompt**:
> Create `docs/adr/0006-model-callable-compress-tool.md`. Sections: Context (S5 evidence, scope of v0.6.0 compaction problem); Decision (introduce range and message modes; keep deterministic strategies; gate message mode experimental); Consequences (positive: surgical compression, less data loss; negative: cache-invalidation cost on providers with prefix caching, but irrelevant for Ollama; risk of mis-ordering compress with file-edit tool calls -- mitigated by protected-tools list). Reference [comparison-multi-source.md](../comparison-multi-source.md) Section 9.3 entry C12 for the RE classification rationale. Acceptance: ADR present, status `accepted`.

---

#### 4.6 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 4.

**Prompt**:
> Run unit + integration tests. Add `tests/integration/compaction-pipeline-with-compress-tool.test.ts` end-to-end exercising a session that hits the context limit, lets the model issue a compress_range call, and verifies the prompt rebuilds with the placeholder. Verify the v0.6.0 baselines (`tests/golden/baselines/v0.6.0.json`) still pass; run `npm run bench` and confirm no perf regression past v0.6.0 thresholds. After green, run `/generate-session-history` for Phase 4.

---

### Phase 4 Exit Checklist

- [ ] CompressionState + migration
- [ ] compress_range tool registered
- [ ] compress_message gated on flag, registered when on
- [ ] Compaction lifecycle commands functional
- [ ] ADR-0006 merged
- [ ] All tests passing
- [ ] No perf regression
- [ ] Session history generated

---

## Phase 5: Webview render protocol overhaul

**Goal**: Adopt the seven UI primitives observed in S7 (Claude Code VS Code extension): inline diff cards, action-type tags, numbered permission prompts, todo blocks, thought-for-Xs meta-rows, queued-message field, completion-report block.

**Prerequisites**: Phase 4 (the agent loop must emit structured `tool_call_started / tool_call_succeeded / tool_call_failed / todo_update / compaction_event / completion` events; Phase 4's tool registration provides the trigger surface).

**Stability Gate**:
- The webview message protocol [src/panels/messages.ts](../../../../src/panels/messages.ts) gains 7 new message types: `RenderToolCallStarted`, `RenderToolCallCompleted`, `RenderToolCallFailed`, `RenderTodoUpdate`, `RenderCompactionEvent`, `RenderCompletionReport`, `RenderThoughtMetaRow`.
- The runtime in [src/panels/webview/runtime.ts](../../../../src/panels/webview/runtime.ts) renders each new type via dedicated helpers (one new file per primitive in `src/panels/webview/render/`).
- All new HTML feeds through [src/utils/MarkdownRenderer.ts](../../../../src/utils/MarkdownRenderer.ts) DOMPurify wrapper.
- New numbered permission prompt is a drop-in replacement for the existing modal in [src/tools/ConfirmationGate.ts](../../../../src/tools/ConfirmationGate.ts); legacy "Yes/No" labels remain as keyboard aliases.
- ADR-0008 lands documenting the render protocol.

### Sub-tasks

#### 5.1 -- Inline diff cards

**Objective**: Adopt C21. Render side-by-side red-strikethrough / green-add diff blocks inline for `edit_file`, `write_file`, `create_file` tool calls.

**Prompt**:
> The `diff` package is already a dep. Create `src/panels/webview/render/diffCard.ts` exporting `renderDiffCard(beforeText: string, afterText: string, filePath: string): HTMLElement`. Use `diff.diffLines` to compute the delta; render two columns side-by-side with classed lines (`.diff-line.added`, `.diff-line.removed`, `.diff-line.context`). Cap each side at 80ch with horizontal scroll. Add styles in [src/panels/webview/styles.ts](../../../../src/panels/webview/styles.ts): `.diff-card`, `.diff-card-header` (file path + "Added N lines / Removed M lines" badge), `.diff-line.added` (background `var(--vscode-diffEditor-insertedTextBackground)`), `.diff-line.removed` (background `var(--vscode-diffEditor-removedTextBackground)`). Wire into runtime: when `RenderToolCallCompleted` arrives with `tool: "edit_file" | "write_file" | "create_file"` and a non-empty diff, render the card. Add `tests/unit/panels/webview/render/diffCard.test.ts` covering: 5-line edit, 200-line edit truncated with horizontal scroll wrapper present, DOMPurify invoked. Acceptance: feature green; manual screenshot smoke-test against S7 reference.

---

#### 5.2 -- Action-type tag rendering

**Objective**: Adopt C22.

**Prompt**:
> Create `src/panels/webview/render/actionTag.ts` exporting `renderActionTag(toolName: string, params: object, status: "started" | "completed" | "failed"): HTMLElement`. Map toolName to display label: `read_file -> "Read"`, `write_file -> "Write"`, `edit_file -> "Edit"`, `create_file -> "Write"`, `run_terminal -> "Bash"`, `grep_codebase -> "Grep"`, `list_directory -> "Ls"`, `delete_file -> "Delete"`, `web_search -> "Search"`, `fetch_page -> "Fetch"`, `compress_range -> "Compress"`, others -> tool name in PascalCase. Render `<div class="action-tag"><span class="action-label">${label}</span><span class="action-target">${target}</span><span class="action-badge">${badge}</span></div>` where target = truncated absolute path (or query for grep) and badge = size hint (`Added 128 lines` for edits, `5.16s` for run_terminal completed, `Lines 23-150` for read_file, etc.). Wire from existing tool-call render path in runtime.ts; replace current collapsed-block rendering. Add `tests/unit/panels/webview/render/actionTag.test.ts`. Acceptance: feature green.

---

#### 5.3 -- Numbered permission prompts

**Objective**: Adopt C23.

**Prompt**:
> In [src/tools/ConfirmationGate.ts](../../../../src/tools/ConfirmationGate.ts), change the prompt-emission protocol to send a `RenderPermissionPrompt` message with payload `{ toolName: string; description: string; commandEcho: string | null; options: Array<{ key: "1"|"2"|"3"|"4"; label: string; value: "yes"|"yes-for-all"|"no"|"freeform"; aliases: string[] }> }`. Four standard options:
> - 1 -- Yes (aliases: `y`, `Enter`)
> - 2 -- Yes, allow ${toolName} for all projects (aliases: `a`)
> - 3 -- No (aliases: `n`, `Esc`)
> - 4 -- Tell Gemma what to do instead (aliases: `t`; opens freeform input)
>
> In `src/panels/webview/render/permissionPrompt.ts`, render as a non-modal inline element (NOT a modal overlay) with keyboard handler responding to digits + aliases + Esc + Enter. Element traps focus until resolved. Add `tests/unit/panels/webview/render/permissionPrompt.test.ts` covering: all four shortcuts trigger correct value; aliases work; Esc rejects; element traps focus until resolved; command echo and description render. Document keyboard contract in [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md) "Permission prompt UX" section.
>
> Note: `Yes-for-all` historically meant "for this session". v0.7.0 changes it to "for this workspace" (persists in `.vscode/settings.json` under `gemma-code.permissionOverrides`). The v0.6.0 Phase 1.2 floor (tier-2 tools clamp to >=1) MUST still be enforced; add an explicit test for "Yes-for-all on run_terminal" -> persists at tier 1, not tier 0. Document the semantic shift in CHANGELOG. Acceptance: feature green; v0.6.0 floor preserved.

---

#### 5.4 -- Todo block render + `update_todos` tool

**Objective**: Adopt C24.

**Prompt**:
> The agent loop today has no internal todo channel; it inherits "Update Todos" only by system-prompt convention. Make this explicit:
> 1. Add tool `update_todos` to [src/tools/ToolCatalog.ts](../../../../src/tools/ToolCatalog.ts) with `permission_tier: 0`. Args: `{ todos: Array<{ content: string; activeForm: string; status: "pending"|"in_progress"|"completed" }> }`. Handler emits `RenderTodoUpdate`; stores latest list in [src/chat/ConversationManager.ts](../../../../src/chat/ConversationManager.ts) for diffing.
> 2. Render `src/panels/webview/render/todoBlock.ts`: each todo as `<li>` with checkbox (filled = completed, hollow = pending, asterisk + glow = in_progress); strikethrough on completed text; activeForm shown when status is `in_progress`.
> 3. Document the tool in the bundled system prompt; encourage use for any non-trivial multi-step task.
>
> Add `tests/unit/panels/webview/render/todoBlock.test.ts` covering: initial 5-todo render; update marking #2 completed -> strikethrough; update marking #3 in_progress -> asterisk + activeForm; DOMPurify invoked. Acceptance: tool registered; render works; system prompt updated.

---

#### 5.5 -- Thought-for-Xs meta-rows

**Objective**: Adopt C25.

**Prompt**:
> Today's `<div id="thinking">` (animated three dots) does not show duration. Replace with a meta-row showing "Thinking..." while streaming and finalising to "Thought for ${seconds}s" once the thinking phase ends. Wire from the existing thinking-mode hook in [src/chat/StreamingPipeline.ts](../../../../src/chat/StreamingPipeline.ts): emit `RenderThoughtMetaRow` with `{ status: "thinking" | "complete"; durationMs: number | null }`. In `src/panels/webview/render/thoughtMetaRow.ts`, render a subdued bullet-point row that updates per event. Add `tests/unit/panels/webview/render/thoughtMetaRow.test.ts`. Acceptance: feature green; subdued styling matches S7.

---

#### 5.6 -- Queued-message field during streaming

**Objective**: Adopt C26.

**Prompt**:
> In runtime.ts, when a stream is active, replace the standard input area with a `Queue another message...` field plus `+` attach button and stop button (replaces send arrow). Queued messages buffer in [src/chat/ConversationManager.ts](../../../../src/chat/ConversationManager.ts) and dispatch as the next user turn once the active stream completes. Stop button drops the queued buffer. Add setting `gemma-code.allowQueuedMessages: boolean` (default `true`). Add `tests/unit/panels/webview/render/queuedMessageField.test.ts` covering: field visible during stream; field hidden after stream end; queued message dispatched on next turn; stop drops queue. Acceptance: feature green; UX matches S7.

---

#### 5.7 -- Completion-report block

**Objective**: Adopt C27.

**Prompt**:
> The agent loop ends a task either by explicit `done()` (sub-agent) or by returning control to the user (top-level). On task end, dispatch `RenderCompletionReport` with `{ items: Array<{ field: string; value: string; href?: string }> }`. Construct via new helper `buildCompletionReport(state)` that scans the most recent `update_todos` payload + recent tool calls (which files edited; which tests run; which commit if any). Render in `src/panels/webview/render/completionReport.ts` as a compact key:value table with monospace SHAs (clickable when href provided). Add `tests/unit/panels/webview/render/completionReport.test.ts` covering: basic 4-field report; clickable commit SHA; empty-state suppression (no report when no todos and no edits). Acceptance: feature green; UX matches S7.

---

#### 5.8 -- ADR-0008: webview render protocol

**Objective**: Document the new render-message-types protocol.

**Prompt**:
> Create `docs/adr/0008-webview-render-protocol.md`. Sections: Context (Phase 5 motivation; S7 reference; growing render surface area in v0.6.0 Phase 6 panel decomposition); Decision (typed render messages; one render helper per primitive; all primitives go through DOMPurify; renderer state lives in runtime.ts not panel host); Consequences (positive: typed protocol enables future React/Svelte port; negative: every new primitive needs a message-type addition + render file + test). Acceptance: ADR present, status `accepted`.

---

#### 5.9 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 5.

**Prompt**:
> Run unit tests for all 7 render helpers + ConfirmationGate protocol change. Add `tests/integration/webview-render-flow.test.ts` driving an end-to-end session through a full set of tool calls (Read, Edit, Bash with permission prompt, todo update, completion) and asserting the rendered DOM contains all primitives. Manual smoke-test: capture a screenshot of a fresh session and compare to S7 reference. After green, run `/generate-session-history` for Phase 5.

---

### Phase 5 Exit Checklist

- [ ] 7 render primitives implemented and tested
- [ ] ConfirmationGate uses numbered prompts with v0.6.0 floor preserved
- [ ] update_todos tool registered
- [ ] System prompt encourages todo use
- [ ] ADR-0008 merged
- [ ] All tests passing
- [ ] Manual UX walkthrough matches S7
- [ ] Session history generated

---

## Phase 6: Memory polish

**Goal**: Round out memory commands (`/memory forget`, `/memory export`, `/memory import`) and ship the manual MemoryPanel webview tab.

**Prerequisites**: Phase 3 (file architecture) and Phase 5 (webview render protocol patterns).

**Stability Gate**:
- All memory commands functional.
- New `MemoryPanel` webview registered alongside chat and trace dashboards.
- The MemoryPanel: views/edits Instructions/Memory/Context; lists SQL-backed memories with promote-to-file action; lists archive snapshots with restore action.

### Sub-tasks

#### 6.1 -- `/memory forget`, `/memory export`, `/memory import`

**Objective**: Adopt C18, C19.

**Prompt**:
> In `src/commands/memoryCommand.ts`, add three subcommands:
> - `/memory forget <pattern>` -- removes matching lines from Memory.md via `MemoryFiles.removeFromMemory(pattern)`. With `--include-sql`, also deletes matching SQL-backed memories (confirmation prompt required).
> - `/memory export <path>` -- writes JSON dump of file-memory + SQL-memory + provenance markers (`source: "file"|"sql"`).
> - `/memory import <path> [--mode=merge|replace]` -- reads JSON or MD; merges or replaces file-memory; for SQL-memory, prompts the user before importing (no silent SQL writes from foreign exports).
>
> Path-guard applies on all read/write paths. Reject paths outside the workspace unless explicitly confirmed via the confirmation gate. Add unit tests in `tests/unit/commands/memoryCommand.test.ts`. Acceptance: 3 verbs functional; path-guard preserved.

---

#### 6.2 -- MemoryPanel webview tab

**Objective**: Adopt C20.

**Prompt**:
> Add to [package.json](../../../../package.json) a new view `gemma-code.memoryPanel` of type `webview` in the existing `gemma-code-sidebar` viewsContainer. Create `src/panels/MemoryPanel.ts` mirroring the existing GemmaCodePanel composition; create `src/panels/webview/memoryView/{index.ts,bodyMarkup.ts,styles.ts,runtime.ts}` for the webview surface. Render five tabs:
> - "Instructions" -- syntax-highlighted markdown of Instructions.md + "Open in editor" button.
> - "Memory" -- same for Memory.md.
> - "Context" -- same for Context.md.
> - "SQL-backed" -- list SQL-backed memories grouped by type with "Promote to Memory.md" action (writes to Memory.md, deletes from MemoryStore).
> - "Archive" -- list archive snapshots with "Restore" action.
>
> All buttons go through the panel-runtime message protocol (no direct storage imports per AGENTS.md module-authorship contract). Add unit tests in `tests/unit/panels/MemoryPanel.test.ts`. Document in [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md). Acceptance: panel registered, all tabs functional, no module-boundary violations.

---

#### 6.3 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 6.

**Prompt**:
> Run unit tests for the 3 new memory verbs and MemoryPanel. Run `npm run deps:check` to confirm MemoryPanel does not violate the no-panels-from-storage boundary. Add an integration test for the promote-to-file path. After green, run `/generate-session-history` for Phase 6.

---

### Phase 6 Exit Checklist

- [ ] /memory forget+export+import functional
- [ ] MemoryPanel registered with 5 tabs
- [ ] No module-boundary violations
- [ ] All tests passing
- [ ] Session history generated

---

## Phase 7: Multi-harness skill packaging + standalone deterministic-checks CLI

**Goal**: Package gemma-code's skill catalog so users of other harnesses (Claude Code, Cursor, OpenCode, Gemini CLI) can install gemma-code's skills there; ship a standalone CLI for deterministic checks that don't need an LLM.

**Prerequisites**: Phase 1 (skill catalog must be complete).

**Stability Gate**:
- New script `scripts/package-skills.mjs` emits `dist/{cursor,claude-code,opencode,gemini-cli}/`. Output is in `.gitignore`; release-time artifact only.
- New CI job `ci-package-skills` runs the script and uploads four ZIP bundles as release artifacts.
- New `bin/gemma-check` runs deterministic checks against a directory or single file, with `--json` for machine output. Initial check set: 4-5 rules.

### Sub-tasks

#### 7.1 -- Multi-harness skill packaging script

**Objective**: Adopt C29.

**Prompt**:
> Create `scripts/package-skills.mjs` (Node ESM). Inputs: `src/skills/catalog/`. Outputs:
> - `dist/claude-code/.claude/skills/<skill-name>/SKILL.md` -- copy as-is.
> - `dist/cursor/.cursor/rules/<skill-name>.md` -- transform: prepend a Cursor-specific frontmatter `---\nrule: SKILL\n---\n` (consult Cursor's actual schema; if it differs significantly from a 1:1 mapping, document the diff in the script and emit a warning).
> - `dist/opencode/.opencode/skills/<skill-name>/SKILL.md` -- copy as-is.
> - `dist/gemini-cli/.gemini/skills/<skill-name>/SKILL.md` -- copy as-is.
>
> Each output dir gets a `README.md` explaining "These are Gemma Code skills, exported for use in <harness>. Updates are mirrored on each gemma-code release; do not edit in place." Add a CI job in [.github/workflows/ci.yml](../../../../.github/workflows/ci.yml) that runs the script and uploads `dist/{cursor,claude-code,opencode,gemini-cli}/*.zip` as artifacts. Document in [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md). Add `dist/` to [.gitignore](../../../versions/.gitignore). Acceptance: script runs deterministically; CI uploads artifacts.

---

#### 7.2 -- Standalone deterministic-checks CLI

**Objective**: Adopt C30.

**Prompt**:
> Create `bin/gemma-check.mjs` as a Node CLI (no compilation, ESM). Add `bin: { "gemma-check": "./bin/gemma-check.mjs" }` to [package.json](../../../../package.json). The CLI accepts a directory or file argument; runs the rule set sequentially; emits findings to stdout in human-readable format by default, JSON with `--json`. Initial rules:
> 1. `no-committed-console-log`: regex match `console\.log\(` outside test files.
> 2. `no-math-random-for-tokens`: regex match `Math\.random` in files whose name contains `auth|token|crypto|secret`.
> 3. `no-env-file-leakage`: detect `.env` references in non-test, non-example files.
> 4. `no-secret-patterns`: regex match the gitleaks-derived patterns from [scripts/hooks/check-prompt-policy.mjs](../../../../scripts/hooks/check-prompt-policy.mjs).
> 5. (Optional) `no-bare-promise-rejection`: regex match `\.catch\(\s*\)` (empty catch).
>
> Each rule lives in `lib/checks/<rule-name>.mjs` exporting `{ id, severity, scan(filePath, contents): Finding[] }`. Add tests under `tests/unit/cli/gemma-check.test.ts`. Document in [README.md](../../../../README.md) and architecture.md. Acceptance: `npx gemma-check src/` runs cleanly on the gemma-code codebase, exits non-zero only on a real finding.

---

#### 7.3 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 7.

**Prompt**:
> Run unit tests for the packaging script and the gemma-check rules. Manual: trigger a CI run on a feature branch and confirm the four ZIP artifacts attach. After green, run `/generate-session-history` for Phase 7.

---

### Phase 7 Exit Checklist

- [ ] scripts/package-skills.mjs deterministic
- [ ] CI job attaches 4 ZIPs
- [ ] bin/gemma-check ships 4-5 rules
- [ ] All tests passing
- [ ] Session history generated

---

## Phase 8: HNSW vector index + background workers (P2, time-permitting)

**Goal**: Adopt C32 (HNSW vector index) and C34 (background workers). Both are P2; if Phases 1-7 + 9 push the cycle past 8 weeks, defer Phase 8 to v0.8.0.

**Prerequisites**: All earlier phases.

**Stability Gate**:
- `hnswlib-node` added as `optionalDependency`. Linear-scan fallback works when the native binary fails to load.
- HNSW index rebuilds on startup if absent; persisted to `~/.gemma-code/<workspaceId>/memory.hnsw`.
- New auto-trigger workers extending the verification pattern: `audit` (post-N-edits, runs `bin/gemma-check` on changed files), `testgaps` (post-N-edits, runs vitest coverage and reports uncovered branches in changed files). Both off by default.

### Sub-tasks

#### 8.1 -- HNSW vector index

**Objective**: Adopt C32.

**Prompt**:
> Add `hnswlib-node@^3.0.0` as an `optionalDependency` (NOT `dependency` -- linear-scan fallback must work when native binary fails). In [src/storage/MemoryStore.ts](../../../../src/storage/MemoryStore.ts), wrap the search path with a feature-detect: if `hnswlib-node` is loadable AND entry count exceeds `gemma-code.memoryHnswThreshold` (default 1000), build/load HNSW from `~/.gemma-code/<workspaceId>/memory.hnsw` and use it; otherwise fall back to linear scan + FTS5 pre-filter. Index rebuilds on insert/update/delete (incremental for inserts; full rebuild every 1000 mutations). Add `tests/integration/memory-hnsw.test.ts` covering: index built when threshold exceeded; recall delta vs linear scan within 5%; load failure falls back gracefully. Acceptance: feature green; fallback works.

---

#### 8.2 -- Background workers (audit + testgaps)

**Objective**: Adopt C34.

**Prompt**:
> Extend [src/agents/SubAgentManager.ts](../../../../src/agents/SubAgentManager.ts) with two new sub-agent types: `audit-worker` and `testgaps-worker`. Each follows the verification-sub-agent pattern (post-N-edits trigger). The audit worker calls `bin/gemma-check --json` on changed files and reports findings via the new render protocol from Phase 5. The testgaps worker runs `vitest --coverage --json` on test files matching changed source files and reports uncovered branches in changed lines. Both off by default; gated on `gemma-code.workers.audit.enabled` and `gemma-code.workers.testgaps.enabled`. Workers MUST NOT fire on a timer; only post-N-edits. Add unit tests for each worker's trigger logic. Acceptance: workers fire post-edit; output rendered; timer-based triggers explicitly forbidden.

---

#### 8.3 -- Testing and Stabilization

**Objective**: Generate and run all tests for Phase 8.

**Prompt**:
> Run unit + integration tests for HNSW + workers. Verify the linear-scan fallback path is exercised in CI (test environment without the native binary). Confirm no perf regression on small-corpus searches (<1000 entries) where linear scan still runs. After green, run `/generate-session-history` for Phase 8.

---

### Phase 8 Exit Checklist

- [ ] HNSW indexed search at >1000 entries
- [ ] Linear-scan fallback functional
- [ ] audit + testgaps workers functional
- [ ] No timer-based triggers
- [ ] All tests passing
- [ ] Session history generated

---

## Phase 9: Release gate + ADRs + CHANGELOG + v0.7.0 baselines

**Goal**: Capture v0.7.0 baselines, confirm regression check, ensure all ADRs and CHANGELOG entries are in place, bump version, tag.

**Prerequisites**: All earlier phases.

**Stability Gate**:
- `tests/golden/baselines/v0.7.0.json` exists; regression check vs `v0.6.0.json` passes.
- `tests/benchmarks/baselines/v0.7.0.json` exists; p99 hooks < 50 ms; p99 tool-execution within +5 ms vs v0.6.0; new `compress` tool latency p99 < 200 ms (model-bound).
- ADR-0006, ADR-0007, ADR-0008 all merged with status `accepted`.
- CHANGELOG.md v0.7.0 entry summarises every adopted C-item plus the explicit drops (N1-N6).
- package.json version bumped to `0.7.0`.
- Manual UX smoke-test: a fresh session in a fresh workspace exhibits the seven S7 primitives observably.

### Sub-tasks

#### 9.1 -- Capture v0.7.0 golden + benchmark baselines

**Objective**: Confirm no regression vs v0.6.0.

**Prompt**:
> Run `npm run bench` on a quiescent dev workstation; save to `tests/benchmarks/baselines/v0.7.0.json`. Run `scripts/check-bench-regressions.mjs --base v0.6.0 --candidate v0.7.0` and confirm thresholds met. For golden baselines, run the TS-native golden runner (assumed to exist by v0.7.0 per v0.6.0 Phase 2 sub-task; if not yet built, this is the cycle to build it). Save to `tests/golden/baselines/v0.7.0.json`. Acceptance: baselines captured, regression check green.

---

#### 9.2 -- CHANGELOG entry

**Objective**: Honest summary of v0.7.0.

**Prompt**:
> Add the v0.7.0 entry to [CHANGELOG.md](../../../../CHANGELOG.md) with sections:
> - **Added**: each adopted C-item as a one-line bullet (compress tool, memory file architecture, deduplication strategy, purge-errors strategy, per-model context limits, /compact context+stats+sweep+decompress+recompress+manual, /memory forget+export+import+archive+edit+init, MemoryPanel, 6 new skills, multi-harness packaging, gemma-check CLI, HNSW vector index, audit + testgaps workers, completion report block, todo block, inline diff cards, action-type tags, numbered permission prompts, thought-for-Xs meta-rows, queued-message field).
> - **Changed**: numbered permission prompts replace Yes/No modal (Yes/No remains as keyboard alias); per-model context limits override global maxTokens; `Yes-for-all` now persists to workspace settings instead of session.
> - **Deprecated**: none.
> - **Removed**: none (no breaking removals; v0.6.0's deferred deletions stay deferred unless explicitly listed by the implementer).
> - **Fixed**: v0.6.0 carryovers closed in Phase 0 -- panel < 400 lines after ChatController hoist (ADR-0009); marked v4 -> v12 migration; (optional) filesystem.ts split; targeted mutation-testing gap fixes (policy.ts, ActionClassifier.ts, terminal.ts, filesystem.ts no-coverage clusters); Orchestrator.test.ts re-included in Stryker. Live-Ollama baselines captured (v0.4.0, v0.6.0 golden + benchmark) -- the >=40% token-savings claim against v0.4.0 is now measured.
> - **Security**: the new compress tool is permission-tier 0 by design; no new auth surface; the v0.6.0 Phase 1 path-guard contract is preserved.
> - **Explicitly NOT in v0.7.0**: list N1-N6 from the comparison report (federation; multi-provider routing; hosted UI; Notion/Obsidian connectors; browser-extension surface; cross-platform sandbox).
>
> Verify ASCII-only (no em-dashes, en-dashes, curly quotes, ellipsis chars). Verify conventional-commit-friendly headlines for each section. Acceptance: entry present.

---

#### 9.3 -- Version bump and release tag

**Objective**: Tag v0.7.0.

**Prompt**:
> Bump [package.json](../../../../package.json) version to `0.7.0`. Bump any version constants in source. Verify the conventional-commit log since v0.6.0 supports a minor bump (no breaking changes; new features). Create release commit `chore(release): v0.7.0` and tag `v0.7.0`. Push. Verify the semantic-release workflow either no-ops (existing v0.7.0 tag wins) or produces no surprises. Acceptance: tag present; CI green; semantic-release does not duplicate.

---

#### 9.4 -- Final stabilization + manual UX walkthrough

**Objective**: Confirm the seven S7 primitives observable in a fresh session.

**Prompt**:
> In a fresh workspace, install the freshly-built v0.7.0 VSIX. Walk through a non-trivial task end-to-end:
> 1. Issue a request that triggers a Bash, Read, Edit sequence.
> 2. Confirm action-type tags render with bold prefix + path + size badge.
> 3. Confirm the Bash invocation prompts with numbered 1/2/3/4 options; verify keyboard shortcut behaviour.
> 4. Confirm the Edit renders an inline side-by-side diff card.
> 5. Confirm the agent's todo block appears with completed/in-progress/pending states visualized correctly.
> 6. Confirm thinking-mode shows "Thought for Xs" meta-rows.
> 7. While streaming, type into the queued-message field; confirm it dispatches on next turn.
> 8. On task end, confirm the completion-report block renders with structured key:value rows.
> 9. Open MemoryPanel; confirm five tabs render and edit-in-VS-Code works.
> 10. Trigger `/compact context`; confirm the breakdown table renders.
> 11. Trigger `/compact sweep 5`; confirm the model issues a compress_range call and the placeholder block renders.
>
> Capture screenshots; attach to the v0.7.0 release notes. After green, run `/generate-session-history` for Phase 9 and tag the release.

---

### Phase 9 Exit Checklist

- [ ] v0.7.0 baselines captured
- [ ] Regression check green vs v0.6.0
- [ ] ADRs 0006/0007/0008 merged
- [ ] CHANGELOG v0.7.0 entry honest and ASCII-only
- [ ] Version bumped, tag pushed
- [ ] Manual UX walkthrough captured (screenshots)
- [ ] Session history generated

---

## Items explicitly NOT adopted (security / policy reasons)

Per the comparison report Section 13, these items are dropped this cycle. They appear here as the formal `drop-outright` appendix.

**N1. Federation / cross-machine agent collaboration (S6 ruflo)**
*Policy grounds*: Violates the offline-first thesis (AGENTS.md project overview). Federation requires outbound network calls, mTLS, ed25519 keys, trust-graph backing store. Per MCP Registry Policy step 5: drop.

**N2. Multi-provider routing (Claude / GPT / Gemini / Cohere) (S6 ruflo)**
*Policy grounds*: Local-only thesis. Gemma's LLM port is vendor-neutral on purpose; Ollama is the only adapter shipped intentionally. Per MCP Registry Policy step 5: drop.

**N3. Hosted web UI / Goal Planner front-end (S6 ruflo `flo.ruv.io`)**
*Policy grounds*: Local-only thesis. The VS Code extension is the canonical surface. Per MCP Registry Policy step 5: drop.

**N4. Notion / Obsidian connectors (S2 Layer 3)**
*Policy grounds*: Both require third-party data processors. Notion is cloud-only. Obsidian's "Select Folder" pattern is desktop-app-only and not analogous to a VS Code extension architecture. Per MCP Registry Policy step 5: drop.

**N5. Browser-extension surface (S3)**
*Policy grounds*: Hard Constraint #1 (no new product surface) inherited from v0.6.0. The S3 architecture is a useful reference but the extension itself is out of scope.

**N6. Cross-platform sandbox for yolo-mode (S1 CCO)**
*Policy grounds*: CCO is Mac-only. Windows + Linux equivalents are non-trivial and have very different invocation models. Cost-of-build dwarfs benefit-to-user until telemetry on yolo-mode usage exists. Document existing risk in [docs/archive/versions/v0/v0.7.0/architecture.md](../architecture.md) and revisit in v0.8.0. Per MCP Registry Policy step 5: drop for now.

**Deferred (not dropped) to v0.8.0**:
- C33 GOAP-style state-space planner (high effort; gemma's PlannerAgent is single-shot but functional)
- C35 ONNX MiniLM in-process embedding fallback (native dep + ~50-200 MB model file; cross-platform validation; gemma's heuristic embedder is acceptable for v0.7.0 unless quality complaints surface)

### Cross-version carryovers from v0.6.0 known-gaps Section 7 (deferred to v0.8.0+)

These items were explicitly off the v0.6.0 cycle's hard-constraint list and remain off v0.7.0's. They are recorded here so v0.8.0 plan authors can decide which to address. Source: [docs/archive/versions/v0/v0.7.0/known-gaps.md](../known-gaps.md) Section 7.

| Item | Origin | Notes |
|---|---|---|
| LSTM predictive caching | v0.5.0 architecture §12; v0.6.0 ADR-0009 | ADR-0009 closed the ARIMA prototype; future predictive layer needs a fresh ADR. |
| Multi-provider LLM proxy | v0.5.0 architecture §12 | Out of scope (overlaps with N2). Current `OllamaClient` is the only provider. |
| Voice transcription | v0.5.0 architecture §12 | Out of scope. |
| Distributed cache | v0.5.0 architecture §12 | Out of scope. |
| `/memory prune --apply`, `/memory lint --apply` | v0.5.0 architecture §12 | Write-side memory cleanup. Read-side commands ship; write-side deferred. v0.7.0 lands `/memory forget` which is adjacent but narrower. |
| `format=json` on `read_file` and `run_terminal` | v0.5.0 architecture §12 | Tool-output structured-format extension. |
| Severity-rubric CI gate that fails builds | v0.5.0 architecture §12 | Currently informational; gating decision deferred. |
| Streaming reads for files > 1 MB | v0.5.0 architecture §12 | Current 1 MB pagination ceiling assumed sufficient. |
| Auto-merge for Dependabot PRs | v0.5.0 architecture §12 | Manual merge today; no automation. |
| Rust performance components | README, v0.1.0 plan | "Future phases" placeholder; not started. |
| Go CLI tooling for project scaffolding | README, v0.1.0 plan | Same. |
| ripgrep-backed `GrepCodebaseTool` | v0.1.0 known limitations | Current implementation uses `vscode.workspace.findFiles`. |
| Extension Marketplace publication | v0.5.0 release notes | VSIX ships; Marketplace listing not yet pursued. |
| Tree-sitter AST parsing | v0.5.0 deferred list | Semantic code understanding for retrieval. |
| SSE transport for MCP server | v0.5.0 known limitations | Current MCP transport is stdio only. |

These are not policy-grounded drops (they do not violate the local-only thesis); they are scope-grounded deferrals that keep v0.7.0 focused on the multi-source adoption work. v0.8.0 should re-evaluate.

### v0.6.0 known-gaps cosmetic / P3 items (no v0.7.0 action)

The following P3 items are documented but require no v0.7.0 action:
- Native-cleanup segfault on Node 24 + better-sqlite3 (known-gaps 5.1) -- track upstream; pin Node 22 in `.nvmrc` if the issue isn't resolved upstream by mid-v0.7.0.
- CRLF/LF line-ending normalization warnings on Windows (known-gaps 5.2) -- cosmetic only.
- v0.6.0 codebase cleanups (known-gaps 7.3) -- tsconfig location, catalog-sync hook integration, secret-paths sync between `scripts/hooks/lib/` and `src/tools/handlers/` (intentional duplication; sync test enforces equality).

---

_Plan generated 2026-05-04 from [docs/archive/versions/v0/v0.7.0/comparison-multi-source.md](../comparison-multi-source.md). Reverse-engineer-first ordering applied per AGENTS.md MCP Registry Policy decision tree. Companion to higher-level [v0.7.0-cycle.md](v0.7.0-cycle.md). Phase 0 carryovers integrated 2026-05-05 from [docs/archive/versions/v0/v0.7.0/known-gaps.md](../known-gaps.md)._

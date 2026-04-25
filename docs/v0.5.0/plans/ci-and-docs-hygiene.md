# Plan — CI and Documentation Hygiene

**Project**: Gemma Code
**Version**: v0.5.0
**Slug**: ci-and-docs-hygiene
**Plan Type**: Feature / Enhancement
**Created**: 2026-04-24
**Source Comparison**: [docs/v0.5.0/comparison-free-claude-code.md](../comparison-free-claude-code.md)
**Scope Filter**: `all` (P0 + P1 + P2 + P3)
**Hard Constraint**: 100% offline-first single-GPU. No runtime network egress, no cloud APIs. **Do not adopt** the multi-provider proxy / `BaseProvider` abstraction (conflicts with offline-first thesis); Discord/Telegram messaging integration; voice transcription via Whisper local + Riva/NIM (multi-GB dep).

**Goal**: Adopt all 8 in-scope items from the free-claude-code comparison so that Gemma Code's project-level discipline matches the patterns of agent-aware open-source repositories: a canonical `AGENTS.md` agent-agnostic directive as the **sole** source of truth (with `CLAUDE.md` deleted entirely — Gemma Code is an independent local system that uses generic naming and does not carry Claude-specific filenames); a documented smoke-test classification rubric; Dependabot weekly toolchain updates; an ESLint rule rejecting un-justified `@ts-ignore`; SHA-pinned GitHub Actions; concurrency cancellation on long workflows; and a mermaid module-dependency diagram in `ARCHITECTURE.md`.

## Overview

This plan adopts the 8 in-scope items from [docs/v0.5.0/comparison-free-claude-code.md](../comparison-free-claude-code.md) plus a **structural strengthening**: based on user direction, `AGENTS.md` becomes the canonical agent-agnostic directive file and `CLAUDE.md` is **deleted entirely**. Gemma Code is an independent local system inspired by Claude Code but is not a Claude dependent — its identity and naming conventions are generic and agent-agnostic. Any AI coding agent (Claude Code, Cursor, Copilot, Gemini CLI, future agents, or Gemma Code itself running against this repo) reads `AGENTS.md`. Claude Code's own auto-discovery convention reads `CLAUDE.md` by default; users running Claude Code against this repository can either point Claude Code at `AGENTS.md` via its session-start convention, or simply paste `AGENTS.md` into context — the project does not bend its naming to accommodate any single agent's discovery convention.

The user-visible delta is a small set of CI tightening (Dependabot opens weekly PRs; superseded CI runs cancel; `@ts-ignore` without an issue link fails lint; action versions are SHA-pinned), one structural file move (rules migrate from `CLAUDE.md` to `AGENTS.md`; `CLAUDE.md` is deleted), and one documentation addition (the cognitive-workflow stanza is appended to `AGENTS.md`, encoding ANALYZE → PLAN → EXECUTE → VERIFY as the project's expected agent rhythm). The smoke-test rubric reclassifies existing integration tests so contributors know exactly when a test should skip vs. fail. The mermaid module-dependency diagram is coordinated with the parallel `routa-harness-adoption` plan: whichever plan lands first writes the diagram; the other checks it off. None of these changes touches runtime behavior.

Success is measured against four artifacts: an `AGENTS.md` that contains every rule previously in `CLAUDE.md` plus the new cognitive-workflow stanza; **no `CLAUDE.md` file in the repository** (deleted entirely); a `docs/v0.5.0/test-pyramid.md` addendum describing the smoke-test rubric; a CI run that fails on a deliberately-introduced `@ts-ignore` without justification AND on a broken Dependabot dep bump (canary check); and a SHA-pinned, concurrency-cancelling workflow set verified via `gh workflow run` dry-runs.

## Phases at a Glance

| Phase | Title | Outcome | Items |
|-------|-------|---------|-------|
| 1 | Agent-directive consolidation | `AGENTS.md` is the canonical agent-agnostic directive; `CLAUDE.md` is deleted entirely; cognitive-workflow stanza added | P1-1, P2-4 (restructured per user direction — generic naming, no Claude-specific files) |
| 2 | Test discipline | Smoke-test classification rubric (`missing_env` / `upstream_unavailable` / `product_failure` / `harness_bug`) documented in `docs/v0.5.0/test-pyramid.md`; existing integration tests reclassified | P1-2 |
| 3 | CI hardening | Dependabot weekly config; ESLint `@ts-ignore` rule with linked-issue justification; SHA-pinned GitHub Actions; `concurrency: cancel-in-progress` on long workflows | P2-1, P2-2, P3-1, P3-2 |
| 4 | Documentation cross-references | Mermaid module-dependency diagram in `ARCHITECTURE.md` (coordinated with routa-harness-adoption Phase 4.5 — whichever lands first writes; other checks off) | P2-3 |

**Explicitly out of scope** (filtered by hard constraint):

- Multi-provider proxy / `BaseProvider` abstraction — direct conflict with offline-first thesis
- Discord / Telegram messaging integration — out of scope (offline-first, in-IDE focus)
- Voice transcription (Whisper local + Riva/NIM) — multi-GB dependency footprint, conflicts with installer size

---

## Phase 1: Agent-Directive Consolidation

**Goal**: Make `AGENTS.md` the canonical agent-agnostic directive file. Migrate every rule currently in `CLAUDE.md` to `AGENTS.md`. **Delete `CLAUDE.md` entirely** — Gemma Code is an independent local system; nothing in the repository should carry Claude-specific naming. Add the cognitive-workflow stanza to `AGENTS.md`.

**Prerequisites**: None.

**Stability Gate**: `AGENTS.md` exists with all migrated rules + cognitive workflow; `CLAUDE.md` does not exist in the repository; the file renders correctly on GitHub preview; agent behavior on a representative golden task is unchanged from the pre-migration baseline.

### Sub-tasks

#### 1.1 — Create `AGENTS.md` as canonical agent-agnostic directive; delete `CLAUDE.md`

**Objective**: Migrate all current `CLAUDE.md` content (rewriting tool-specific rules to be tool-agnostic) into a new `AGENTS.md` at the project root; add the cognitive-workflow stanza; **delete `CLAUDE.md`**.

**Prompt**:
> You are working on Gemma Code v0.5.0 (TypeScript VS Code extension; offline-first; uses Ollama + Gemma 4). Migrate the project's agent directive to a canonical `AGENTS.md` file. Gemma Code is an independent local system inspired by Claude Code but not bound to it — every file and convention in this repository must use generic agent-agnostic naming. **`CLAUDE.md` will be deleted; do not preserve it as a pointer.**
>
> Steps:
>
> 1. **Read the current `CLAUDE.md`** at the project root. Identify every rule and section. The migration must preserve every rule semantically.
>
> 2. **Create a new `AGENTS.md` at the project root** with the following structure (rewrite all content to be agent-agnostic — replace any reference to Claude or Claude Code with generic agent terminology where possible):
>
>    ```markdown
>    # AGENTS.md — Gemma Code Agent Directive
>
>    This file is the canonical agent-agnostic directive for working in this repository.
>    Any AI coding agent (Cursor, Copilot, Gemini CLI, Claude Code, future agents,
>    or Gemma Code itself running against this repository) should read this file to
>    understand project conventions, constraints, and the expected cognitive workflow.
>
>    Gemma Code is an independent local agentic coding assistant. Claude Code is its
>    inspiration, but every file and convention in this repository uses generic
>    agent-agnostic naming — there is no `CLAUDE.md`, no Claude-specific instructions,
>    no Anthropic-bound assumptions in product files. (Development-time tooling such as
>    `.claude/` directories, where they exist, are local IDE/agent configuration for
>    contributors, not part of Gemma Code's identity — analogous to `.vscode/` or
>    `.idea/`.)
>
>    ## Project Overview
>    [Migrate the existing "Overview" section.]
>
>    ## Tech Stack
>    [Migrate.]
>
>    ## Project Layout
>    [Migrate.]
>
>    ## Key Commands
>    [Migrate.]
>
>    ## Non-Obvious Tooling
>    [Migrate. Reference Ollama + gemma4 model pull etc.]
>
>    ## Communication Style
>    [Migrate.]
>
>    ## Critical Rules
>    [Migrate. Rewrite tool-specific rules to be tool-agnostic where possible.
>    For genuinely tool-specific rules (e.g. "Bash tool requires a description parameter"),
>    rephrase generically: "Shell-execution tool calls must include a plain-text description."
>    Goal: a non-Claude agent reading this file should understand and apply every rule.]
>
>    ## Cognitive Workflow
>    Every non-trivial task should follow this rhythm. The agent does not need to recite
>    the steps; it should embody them.
>
>    1. **ANALYZE** — Identify the actual problem; restate the user's request in your own words;
>       enumerate constraints; reference relevant code paths.
>    2. **PLAN** — Sketch the changes you intend to make; identify which files will be touched,
>       which will not, and why; propose a verification approach.
>    3. **EXECUTE** — Make the planned changes incrementally with frequent local checks
>       (lint, build, test) between meaningful units.
>    4. **VERIFY** — Run the full test suite + lint + build; manually exercise the changed
>       behavior end-to-end where possible; capture any residual risks.
>    5. **PROPAGATE** — Update related documentation (README, ARCHITECTURE.md, CHANGELOG.md,
>       relevant docs/v0.X.0/ files) so the change is discoverable by the next contributor.
>
>    The workflow is iterative — looping back to ANALYZE when EXECUTE reveals an unmodelled
>    constraint is normal and expected.
>
>    ## Output Minimization
>    [Migrate.]
>
>    ## Module Authorship Contract
>    [If the parallel memory-hygiene plan has landed and added this section, migrate it here.
>    Otherwise, skip — it will be added by that plan when it lands.]
>    ```
>
> 3. **Delete `CLAUDE.md`**: `git rm CLAUDE.md`. Do NOT preserve it as a pointer file.
>
> 4. **Update cross-references**: search the repository for any reference to `CLAUDE.md` (likely `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, code comments, and any `.gemma-code/`-style docs). Replace every reference with `AGENTS.md`. Use `git grep -i 'CLAUDE\.md\|CLAUDE\.MD'` to find them all.
>
> 5. **Snapshot test for migration completeness**: add `tests/unit/docs/AGENTS-md.test.ts` with tests asserting:
>    - `AGENTS.md` exists and contains the substrings:
>      - `Gemma Code Agent Directive`
>      - `Cognitive Workflow`
>      - `ANALYZE`, `PLAN`, `EXECUTE`, `VERIFY`, `PROPAGATE`
>      - `Critical Rules`
>      - `Output Minimization`
>      - `Tech Stack`
>    - **`CLAUDE.md` does NOT exist** in the repository root (use `fs.existsSync('CLAUDE.md')` and assert false).
>
> Constraints:
> - Do not delete any rule semantically. Every behavior previously enforced by `CLAUDE.md` must be enforced by `AGENTS.md`. The deletion of `CLAUDE.md` is structural (file rename), not a removal of rules.
> - Generic naming everywhere: avoid "Claude" in section titles, headers, or examples in `AGENTS.md`. Tool brand names appear only when they are factually necessary (e.g. listing Claude Code as one of several agents that can read this file).
> - Users running Claude Code against this repository can configure Claude Code to read `AGENTS.md` (most modern Claude Code setups support an explicit `additionalDirectories` or `instructions` config). The project does not bend its naming to accommodate any single agent's auto-discovery convention.
>
> Acceptance: full Vitest suite green; snapshot test green; manual review confirms no rule was lost; `CLAUDE.md` is gone; `AGENTS.md` is comprehensive; no remaining repository references to `CLAUDE.md`.

---

#### 1.2 — Phase 1 testing and stabilization

**Objective**: Verify the migration preserved every rule; verify agent behavior is unchanged on a golden task; iterate until stable.

**Prompt**:
> Generate and run comprehensive verification for Phase 1 of the ci-and-docs-hygiene adoption (`docs/v0.5.0/plans/ci-and-docs-hygiene.md`). Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`. Fix every failure.
> 2. Run the snapshot test for `AGENTS.md` and `CLAUDE.md`; confirm green.
> 3. **Migration completeness audit**: diff the rules. Take the original `CLAUDE.md` (from `git show HEAD~1:CLAUDE.md`); for each non-blank, non-comment line, grep `AGENTS.md` to confirm it (or its rewritten equivalent) appears. Report any line that did NOT migrate; restore the rule if it was accidentally dropped.
> 4. **Reference sweep**: run `git grep -i 'CLAUDE\.md\|CLAUDE\.MD'` and confirm zero matches in the repository (excluding the comparison report `docs/v0.5.0/comparison-free-claude-code.md` and this plan file, which legitimately reference the historical filename for traceability — exclude those two paths from the grep).
> 5. **Agent-behavior baseline**: pick one representative task from `tests/golden/tasks/` (e.g. a multi-file edit). Run it twice through the golden-task framework — once with the new `AGENTS.md` (CLAUDE.md gone), once with the pre-migration `CLAUDE.md` (use `git worktree` or a temporary branch checkout). Compare the agent's behavior (tool-call count, tokens, success). They must be statistically equivalent (within the existing baseline tolerance).
> 6. Manually verify on GitHub preview: `AGENTS.md` renders correctly; the file shows up in the repo root listing; no broken links anywhere referencing `CLAUDE.md`.
> 7. Update `README.md`, `CONTRIBUTING.md`, and `ARCHITECTURE.md` to reference `AGENTS.md` as the canonical directive (no remaining mentions of `CLAUDE.md` outside the comparison report and this plan file).
> 7. After all checks pass, run `/generate-session-history` to document Phase 1.
>
> Do not advance to Phase 2 until every step above is fully verified.

---

### Phase 1 Exit Checklist

- [ ] `AGENTS.md` exists with all migrated rules + cognitive-workflow stanza
- [ ] `CLAUDE.md` is **deleted** (`git rm`); `tests/unit/docs/AGENTS-md.test.ts` asserts non-existence
- [ ] No remaining repository references to `CLAUDE.md` (except inside the comparison report and this plan file, which preserve historical naming)
- [ ] Cross-references in `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md` updated to point at `AGENTS.md`
- [ ] Snapshot test for `AGENTS.md` green; non-existence test for `CLAUDE.md` green
- [ ] Migration audit confirms no rule lost
- [ ] Agent-behavior baseline is statistically equivalent
- [ ] `AGENTS.md` renders correctly on GitHub preview
- [ ] Session history generated

---

## Phase 2: Test Discipline

**Goal**: Document the smoke-test classification rubric (`missing_env`, `upstream_unavailable`, `product_failure`, `harness_bug`); reclassify existing integration tests so the skip-vs-fail decision is explicit per test.

**Prerequisites**: None (independent of Phase 1).

**Stability Gate**: `docs/v0.5.0/test-pyramid.md` includes a "Smoke-Test Classification Rubric" section; every test in `tests/integration/` is annotated with its skip-condition class; no test silently skips for unknown reasons.

### Sub-tasks

#### 2.1 — Document the smoke-test classification rubric

**Objective**: Add a "Smoke-Test Classification Rubric" section to `docs/v0.5.0/test-pyramid.md` defining the four categories.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 2 step 1.
>
> Extend `docs/v0.5.0/test-pyramid.md` with a new section: `## Smoke-Test Classification Rubric`.
>
> Content:
>
> Four categories for any test that may not be runnable in every environment:
>
> 1. **`missing_env`** — Required environment variable / credential / configuration is absent.
>    - Action: SKIP with a clear reason. Do NOT fail.
>    - Example: a test that requires `OLLAMA_URL` to be set; if unset, skip.
>    - Implementation: Vitest `it.skipIf(!process.env.OLLAMA_URL)` or a `beforeAll` skip.
>
> 2. **`upstream_unavailable`** — A required external dependency is reachable in principle but down right now (Ollama not responding, model not pulled).
>    - Action: SKIP with a clear reason in the test output.
>    - Example: probe `OLLAMA_URL/api/tags` in `beforeAll`; if probe fails, skip the whole suite.
>    - Distinction from `missing_env`: env is configured, but the upstream service is not currently usable.
>
> 3. **`product_failure`** — The test exposed a real bug in Gemma Code.
>    - Action: FAIL. Do NOT skip.
>    - This is the default for any unexpected assertion failure.
>
> 4. **`harness_bug`** — The test itself is broken (flaky setup, race condition, fixture out of sync).
>    - Action: FAIL — but tag the test with `@harness-bug` in the title and open a tracking issue.
>    - The fix path is to repair the test, not to skip it.
>
> Document the matching helper utilities (likely in `tests/helpers/factories.ts` already): `skipIfNoOllama()`, `skipIfMissingEnv(...keys)`, etc.
>
> Reference Trevin Chow's Blocker / Friction / Optimization rubric (from `docs/v0.5.0/comparison-7-principles-for-agent-friendly-clis.md`) and explain the relationship: that rubric is for tool-output quality; this rubric is for test-suite stability. Both vocabulary tools, both worth using.
>
> Cross-reference from `CONTRIBUTING.md` "Testing" section.
>
> Constraints:
> - Section under 500 words.
> - Cite the actual helper file path.
>
> Acceptance: section present in `docs/v0.5.0/test-pyramid.md`; cross-referenced from `CONTRIBUTING.md`; renders on GitHub preview.

---

#### 2.2 — Reclassify existing integration tests

**Objective**: Walk every test in `tests/integration/`; tag each with its skip-condition class; update any silent skip to use the documented helpers.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 2 step 2.
>
> Audit and reclassify integration tests:
>
> 1. Inventory every file in `tests/integration/`. For each test, identify whether it currently skips under any condition. Common candidates:
>    - `tests/integration/ollama-client.test.ts` (depends on Ollama)
>    - `tests/integration/ollama-health.test.ts` (depends on Ollama)
>    - Any test that probes external state.
>
> 2. For each conditional skip, classify it as `missing_env` or `upstream_unavailable`. Update the test to use the documented helpers from `tests/helpers/factories.ts`:
>
>    Example: replace
>    ```ts
>    if (!process.env.OLLAMA_URL) return;
>    ```
>    with
>    ```ts
>    skipIfNoOllama(); // missing_env
>    ```
>
> 3. Tests with no skip condition default to `product_failure` semantics — leave them alone.
>
> 4. If you find a test using `it.skip` with no condition (i.e. permanently disabled), open an issue and add a `// TODO(harness-bug): <issue link>` comment. Do NOT silently leave a `it.skip`.
>
> 5. Add a meta-test at `tests/unit/test-discipline.test.ts` that walks `tests/integration/**/*.test.ts` and asserts:
>    - No `it.skip(` or `describe.skip(` without an adjacent comment containing `TODO(harness-bug)` or `TODO(missing_env)`.
>    - No bare `if (!process.env...)` early returns; use the helpers instead.
>
> Constraints:
> - This is a labelling pass; do not change test logic.
> - The meta-test should be skippable via `SKIP_TEST_DISCIPLINE_LINT=1` for emergency triage.
>
> Tests:
> - The meta-test from step 5.
> - Run the integration suite with Ollama up (`OLLAMA_URL` set, Ollama running): all tests run.
> - Run the integration suite with Ollama down: tests skip with `upstream_unavailable` reasons in the output.
> - Run with `OLLAMA_URL` unset: tests skip with `missing_env` reasons.
>
> Acceptance: full Vitest suite green; meta-test green; manual smoke under all three environment states confirms correct skip behavior.

---

#### 2.3 — Phase 2 testing and stabilization

**Objective**: Verify rubric is documented, classification is applied, and the meta-test catches regressions; iterate until stable.

**Prompt**:
> Generate and run comprehensive verification for Phase 2 of the ci-and-docs-hygiene adoption. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Verify the rubric section renders on GitHub preview.
> 3. Verify the meta-test catches a deliberately-introduced bare `if (!process.env...)` early return; restore.
> 4. Run integration suite under three states (Ollama up; Ollama down; `OLLAMA_URL` unset) and confirm correct skip messaging.
> 5. After all checks pass, run `/generate-session-history` to document Phase 2.
>
> Do not advance to Phase 3 until every step above is fully verified.

---

### Phase 2 Exit Checklist

- [ ] `docs/v0.5.0/test-pyramid.md` includes "Smoke-Test Classification Rubric" section
- [ ] Cross-referenced from `CONTRIBUTING.md`
- [ ] Every integration test uses the documented helpers; no bare env-var early returns
- [ ] Meta-test at `tests/unit/test-discipline.test.ts` catches regressions
- [ ] Skip messages are clear under each environment state
- [ ] Session history generated

---

## Phase 3: CI Hardening

**Goal**: Add Dependabot weekly toolchain updates; add an ESLint rule rejecting `@ts-ignore` / `@ts-expect-error` without a linked issue; pin all GitHub Actions to commit SHAs; add `concurrency: cancel-in-progress` to long workflows.

**Prerequisites**: None (independent of Phases 1 and 2 — but easier to land after them so the CI changes don't conflict with file moves).

**Stability Gate**: Dependabot opens a real PR within one weekly cycle; CI fails on a deliberately-introduced un-justified `@ts-ignore`; all 5 workflow files reference actions by commit SHA; superseded CI runs cancel automatically.

### Sub-tasks

#### 3.1 — Dependabot weekly config

**Objective**: Add `.github/dependabot.yml` configuring weekly checks for npm dependencies and GitHub Actions.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 3 step 1.
>
> Create `.github/dependabot.yml`:
>
> ```yaml
> version: 2
> updates:
>   - package-ecosystem: "npm"
>     directory: "/"
>     schedule:
>       interval: "weekly"
>       day: "monday"
>       time: "06:00"
>       timezone: "UTC"
>     open-pull-requests-limit: 10
>     labels:
>       - "dependencies"
>       - "auto-update"
>     groups:
>       dev-dependencies:
>         dependency-type: "development"
>       runtime-dependencies:
>         dependency-type: "production"
>     ignore:
>       # Do not auto-bump major versions of vscode or @types/vscode (engines pinned to 1.90)
>       - dependency-name: "vscode"
>         update-types: ["version-update:semver-major"]
>       - dependency-name: "@types/vscode"
>         update-types: ["version-update:semver-major"]
>
>   - package-ecosystem: "github-actions"
>     directory: "/"
>     schedule:
>       interval: "weekly"
>       day: "monday"
>       time: "06:00"
>       timezone: "UTC"
>     open-pull-requests-limit: 5
>     labels:
>       - "dependencies"
>       - "github-actions"
> ```
>
> Document in `CONTRIBUTING.md` under a new "Dependency updates" section:
> - Dependabot opens PRs every Monday at 06:00 UTC.
> - Grouped: dev-dependencies in one PR, runtime-dependencies in another.
> - Do not auto-merge; let CI run; review before merging.
> - Major-version vscode bumps are ignored intentionally — they need manual coordination with `engines.vscode`.
>
> Constraints:
> - The grouping is the key for low-noise. Without it, Dependabot can open 30+ PRs at once. With it, you get 1-2 grouped PRs/week.
> - Do not enable auto-merge; the project's CI is comprehensive but not a substitute for human review on dependency bumps.
>
> Tests:
> - The first weekly cycle is the test. Wait one Monday after merge; confirm at least one Dependabot PR is opened.
> - Pre-merge canary: in a fixture branch, simulate a broken dep bump (e.g. `eslint@99.0.0`) and confirm CI fails.
>
> Acceptance: file present; documented in `CONTRIBUTING.md`; first Dependabot run opens a PR within one week of merge.

---

#### 3.2 — ESLint rule rejecting un-justified `@ts-ignore`

**Objective**: Configure `@typescript-eslint/ban-ts-comment` to require a linked-issue justification for any `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 3 step 2.
>
> Configure ESLint to require justifications on TypeScript suppression comments:
>
> Update `eslint.config.mjs`:
>
> ```js
> {
>   rules: {
>     '@typescript-eslint/ban-ts-comment': ['error', {
>       'ts-expect-error': 'allow-with-description',
>       'ts-ignore': 'allow-with-description',
>       'ts-nocheck': 'allow-with-description',
>       'ts-check': false,
>       minimumDescriptionLength: 20  // forces a real explanation, not just "fix later"
>     }],
>   },
> }
> ```
>
> The `allow-with-description` mode permits suppressions when followed by a description. The `minimumDescriptionLength: 20` requires a meaningful comment — short enough to allow `// @ts-ignore: Type from upstream is wrong (issue #42)` and long enough to reject `// @ts-ignore`.
>
> Establish a baseline: run `npm run lint`. Expect violations on the existing codebase. For each violation, either:
> 1. **Fix the underlying type problem** (preferred — the suppression was a regression).
> 2. **Add a justification comment** including a linked issue:
>    ```ts
>    // @ts-expect-error TypeScript inference fails here because <reason>; tracked in issue #N
>    ```
>
> Document in `CONTRIBUTING.md` under a new "TypeScript suppressions" section:
> - Suppressions require a linked issue.
> - Aim to remove suppressions when the upstream issue is resolved.
> - The 20-char minimum is intentional: short enough for legitimate notes, long enough to reject "fix later".
>
> Tests:
> - Add a small fixture file at `tests/fixtures/eslint-suppression.ts` with two cases: one good suppression, one bad. Verify ESLint passes the good and rejects the bad.
> - Add a meta-test at `tests/unit/lint-discipline.test.ts` that runs ESLint programmatically against the fixtures and asserts the expected pass/fail.
>
> Constraints:
> - Do not raise the project's overall lint warnings count. The new rule replaces an `off` or weaker config; the violation count post-baseline must be 0 (every existing suppression is either fixed or justified).
> - Be patient with `// @ts-expect-error` patterns in test files — those often suppress deliberate test fixtures (e.g. testing wrong-type input). Each one still needs a justification.
>
> Acceptance: rule configured; baseline cleaned; meta-test green; documented in `CONTRIBUTING.md`.

---

#### 3.3 — SHA-pin GitHub Actions

**Objective**: Replace tag references in all 5 workflow files with commit SHA references for supply-chain hardening.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 3 step 3.
>
> SHA-pin every action used in the 5 workflow files in `.github/workflows/`:
> - `ci.yml`
> - `nightly.yml`
> - `golden-tasks.yml`
> - `release.yml`
> - `installer-smoke.yml`
>
> For each `uses: <action>@<version>` line, replace `<version>` with the corresponding commit SHA. Use the format `<owner>/<action>@<sha>  # <version-tag>` so the version is still readable.
>
> Example:
> ```yaml
> # Before
> - uses: actions/checkout@v4
>
> # After
> - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
> ```
>
> To resolve SHAs:
> - Use `gh api repos/<owner>/<action>/git/refs/tags/<tag>` to find the commit SHA each tag points at.
> - Or visit the action's GitHub release page and copy the SHA.
>
> Configure Dependabot's GitHub Actions ecosystem (added in 3.1) to bump SHAs along with version tags — this is the default behavior in Dependabot v2.
>
> Document in `CONTRIBUTING.md` under "Dependency updates":
> - Actions are SHA-pinned for supply-chain hardening.
> - Dependabot bumps both the SHA and the version-tag comment in the same PR.
> - Manual workflow edits should use SHA references.
>
> Tests:
> - `npm run build` is unaffected.
> - Push a branch and confirm CI runs successfully against the SHA-pinned actions.
> - Add a meta-test at `tests/unit/workflow-discipline.test.ts` that walks `.github/workflows/*.yml`, regex-matches every `uses: ` line, and asserts the version is a 40-character hex SHA (allowing comment after `#`).
>
> Constraints:
> - Do not break existing CI runs. Push to a fixture branch first; verify green; then merge.
> - Dependabot will continue to surface bumps as actions get updated upstream.
>
> Acceptance: every action SHA-pinned; meta-test green; CI runs successfully on the pinned references.

---

#### 3.4 — Workflow concurrency cancellation

**Objective**: Add `concurrency: cancel-in-progress` to long-running workflows so superseded pushes do not waste CI minutes.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 3 step 4.
>
> Add concurrency cancellation to the four long-running workflows (skip `installer-smoke.yml` if it's only weekly-scheduled):
>
> Add to the top level of each workflow file:
> ```yaml
> concurrency:
>   group: ${{ github.workflow }}-${{ github.ref }}
>   cancel-in-progress: true
> ```
>
> Apply to:
> - `.github/workflows/ci.yml` (push + PR; long-ish)
> - `.github/workflows/nightly.yml` (long; runs Ollama integration)
> - `.github/workflows/golden-tasks.yml` (long; runs Python framework)
> - `.github/workflows/release.yml` (rare but slow; cancel only if the same tag is pushed twice)
>
> The `installer-smoke.yml` workflow is weekly-scheduled and not push-triggered; skip unless that changes.
>
> For `release.yml`, use `cancel-in-progress: false` since cancelling a release mid-build can leave broken artifacts. (Or omit `concurrency` entirely there.)
>
> Tests:
> - Push a commit; observe in GitHub Actions UI that a prior run on the same branch is cancelled.
> - For release: tag two test releases in quick succession; confirm BOTH complete (no cancellation).
>
> Acceptance: concurrency block present in 3 workflows; CI cancellation observable in the UI on consecutive pushes to a feature branch.

---

#### 3.5 — Phase 3 testing and stabilization

**Objective**: Verify all CI hardening; iterate until stable.

**Prompt**:
> Generate and run comprehensive verification for Phase 3 of the ci-and-docs-hygiene adoption. Specifically:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Run the meta-tests: `tests/unit/lint-discipline.test.ts` and `tests/unit/workflow-discipline.test.ts`. Confirm green.
> 3. Push to a fresh feature branch; confirm CI runs against SHA-pinned actions; push a second commit; observe the first run cancelled.
> 4. Manually introduce a bad `// @ts-ignore` (no justification); push; confirm CI fails on lint. Restore.
> 5. Manually introduce a deliberately-broken dep bump in `package.json` (e.g. `vitest@99.0.0`); push; confirm CI fails. Restore.
> 6. Wait for the first scheduled Dependabot run (or manually trigger via the dependabot UI); confirm a PR is opened.
> 7. Update `CHANGELOG.md` with the CI hardening entry.
> 8. After all checks pass, run `/generate-session-history` to document Phase 3.
>
> Do not advance to Phase 4 until every step above is fully verified.

---

### Phase 3 Exit Checklist

- [ ] `.github/dependabot.yml` present with grouped weekly config
- [ ] `eslint.config.mjs` configured with `ban-ts-comment` `allow-with-description`
- [ ] All existing `@ts-ignore` / `@ts-expect-error` either removed or justified
- [ ] All 5 workflows SHA-pinned
- [ ] 3 long workflows have `concurrency: cancel-in-progress`
- [ ] Meta-tests green
- [ ] First Dependabot run opens a PR within one weekly cycle
- [ ] `CONTRIBUTING.md` updated with the three new sections
- [ ] `CHANGELOG.md` entry present
- [ ] Session history generated

---

## Phase 4: Documentation Cross-References

**Goal**: Ensure the mermaid module-dependency diagram in `ARCHITECTURE.md` exists. **This may already be in place** if the parallel routa-harness-adoption plan (Phase 4 sub-task 4.5) lands first.

**Prerequisites**: Phases 1–3.

**Stability Gate**: `ARCHITECTURE.md` includes a mermaid module-dependency diagram showing the major top-level modules and the forbidden edges from `configs/dependency-cruiser.cjs`; the diagram renders correctly on GitHub preview.

### Sub-tasks

#### 4.1 — Mermaid module-dependency diagram (coordinated)

**Objective**: Add a mermaid module-dependency diagram to `ARCHITECTURE.md`. Coordinate with the routa-harness-adoption plan: whichever lands first writes the diagram; the other plan checks it off.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 4 step 1 (coordinated).
>
> Coordination check first:
>
> 1. Read `docs/v0.5.0/plans/routa-harness-adoption.md` Phase 4 sub-task 4.5. If that plan has already landed (check `git log -- ARCHITECTURE.md` for a commit referencing the diagram), the diagram is in place — skip directly to Phase 4 stabilization.
>
> 2. If neither plan has landed the diagram yet, write it now per the routa-harness-adoption sub-task 4.5 spec (reproduced verbatim below for self-containment):
>
> ---
>
> Add a mermaid module-dependency diagram to `ARCHITECTURE.md`:
>
> - Insert under a new heading `## Module Dependency Graph`, after the existing high-level diagram.
> - Use mermaid `flowchart LR` or `flowchart TD` (whichever reads better at typical viewport widths).
> - Include the major top-level modules: `extension.ts`, `panels/` (webview), `runtime/GemmaRuntime`, `chat/` (PromptBuilder, StreamingPipeline, CompactionStrategy, ContextCompactor), `agents/` (SubAgentManager, SpecialistLoader if added), `orchestration/` (Orchestrator, PlannerAgent, DAGExecutor, ReflexionEngine), `tools/` (AgentLoop, ToolRegistry, OutputRedirector, handlers/), `commands/CommandRouter`, `mcp/`, `storage/` (MemoryStore, UnifiedMemoryRetriever, ChatHistoryStore, GraphMemory; plus ToolOutputCache if the parallel token-optimizer-adoption has landed it), `llm/` (OllamaClient, OllamaHttp), `guardrails/` (ActionClassifier, ConfirmationGate, GitSafetyNet, LoopDetector, BudgetEnforcer, PermissionTiers), `observability/` (Tracer, TraceStore, MetricsCollector, OtlpExporter), `config/`, `utils/`, `evaluation/GoldenTaskSuite`, `skills/SkillLoader`.
> - Show the **forbidden** edges as dashed red arrows annotated with the rule name (e.g. `panels --x storage [no-storage-from-panels]`). This makes the rules visible in the diagram. (If `configs/dependency-cruiser.cjs` from the routa-harness-adoption plan has not landed yet, document the rules inline in the diagram caption and remove the cross-reference.)
> - Keep the diagram readable at one screen height; group related modules into subgraphs (e.g. `subgraph Storage`).
>
> Update the existing `ARCHITECTURE.md` ToC if present.
>
> ---
>
> Constraints:
> - Mermaid renders in GitHub by default; do not rely on external tooling.
> - If the parallel routa-harness-adoption plan has landed, just verify the diagram is correct and move on.
>
> Tests:
> - Manual GitHub preview confirms the diagram renders.
>
> Acceptance: `ARCHITECTURE.md` contains a mermaid module-dependency diagram.

---

#### 4.2 — Phase 4 testing and stabilization (final adoption gate)

**Objective**: Run the full test, lint, and CI suite; verify all 8 adoption items have shipped; document the final state.

**Prompt**:
> Gemma Code v0.5.0 ci-and-docs-hygiene adoption — Phase 4 (FINAL stabilization).
>
> Generate and run comprehensive verification for the entire adoption:
>
> 1. Run `npm run lint`, `npm run build`, `npm run test`, `npm run test:integration`. Fix every failure.
> 2. Run all meta-tests:
>    - `tests/unit/docs/AGENTS-md.test.ts` (Phase 1)
>    - `tests/unit/test-discipline.test.ts` (Phase 2)
>    - `tests/unit/lint-discipline.test.ts` (Phase 3)
>    - `tests/unit/workflow-discipline.test.ts` (Phase 3)
> 3. Push to a fresh feature branch and observe:
>    - SHA-pinned action references resolve correctly.
>    - `concurrency: cancel-in-progress` cancels the prior run on a second push.
>    - Lint catches a deliberate `@ts-ignore` regression.
> 4. Confirm the mermaid module-dependency diagram in `ARCHITECTURE.md` renders on GitHub preview.
> 5. Verify all 8 adoption items have shipped:
>    - P1-1: Cognitive workflow stanza (Phase 1.1; in `AGENTS.md`)
>    - P1-2: Smoke-test classification rubric (Phase 2.1)
>    - P2-1: Dependabot config (Phase 3.1)
>    - P2-2: `@ts-ignore` ESLint rule (Phase 3.2)
>    - P2-3: Mermaid module-dependency diagram (Phase 4.1; possibly already landed via routa-harness-adoption)
>    - P2-4: CLAUDE.md / AGENTS.md split (Phase 1.1; restructured per user direction — AGENTS.md is canonical)
>    - P3-1: SHA-pinned GitHub Actions (Phase 3.3)
>    - P3-2: `concurrency: cancel-in-progress` (Phase 3.4)
> 6. Update `CHANGELOG.md` with the ci-and-docs-hygiene adoption entry.
> 7. Run `/generate-session-history` to document Phase 4.
> 8. Run `/update-devlog` to capture the final summary.
>
> Do not declare the adoption complete until all 8 items are landed, all meta-tests pass, the CI hardening is observable in real CI runs, and the CHANGELOG is updated.

---

### Phase 4 Exit Checklist

- [ ] Mermaid module-dependency diagram present in `ARCHITECTURE.md`
- [ ] All 8 adoption items shipped
- [ ] All four meta-tests green
- [ ] CI hardening observable on real runs (SHA pin, concurrency, lint, Dependabot)
- [ ] `CHANGELOG.md` entry present
- [ ] Session history + devlog updated

---

## Definition of Done (Plan-Level)

The adoption is complete when **all** of the following hold:

1. **Discipline & rubric**: cognitive-workflow stanza is present in `AGENTS.md`; smoke-test classification rubric is documented in `docs/v0.5.0/test-pyramid.md` and applied to existing integration tests; `AGENTS.md` is the canonical agent-agnostic directive; **`CLAUDE.md` is deleted from the repository** and no remaining references to it exist outside the historical comparison report and this plan file.
2. **CI hardening**: Dependabot weekly schedule active and producing PRs; ESLint rejects `@ts-ignore` without linked-issue comment (≥ 20 chars); all 5 workflows SHA-pinned; long workflows cancel-in-progress on supersession.
3. **Documentation**: mermaid module-dependency diagram present in `ARCHITECTURE.md` (whether landed here or via the parallel routa-harness-adoption plan).
4. The 8 in-scope adoption items are all landed.
5. No runtime network egress added by any change.
6. `CHANGELOG.md` reflects the ci-and-docs-hygiene adoption.

---

## Out of Scope (Recorded for Future Versions)

- Multi-provider proxy / `BaseProvider` abstraction — direct conflict with offline-first thesis
- Discord / Telegram messaging integration — out of scope (offline-first, in-IDE focus)
- Voice transcription via Whisper local + Riva/NIM — multi-GB dep footprint conflicts with installer
- semantic-release + commitlint — parked for the token-optimizer-adoption plan, Phase 5 step 2
- Auto-merge for Dependabot PRs — too aggressive without a stronger CI baseline
- Action-pinning to vendor-namespace mirrors (e.g. `step-security/harden-runner`) — useful supply-chain layer but a separate evaluation; not landed here

# Plan — Adopt claude-code-harness patterns + close known gaps + sync Nexus-Hub (v1.4.0)

**Project**: Nexus
**Version**: v1.4.0
**Slug**: adoption-claude-code-harness
**Plan Type**: Feature / Enhancement
**Created**: 2026-05-30
**Goal**: Land all 12 adoption items (A1-A12) from the claude-code-harness comparison, resolve every remaining known gap and deferred task, and bring Nexus-AI fully in sync with the parallel Nexus-Hub upgrade, with updated unit / static / integration / e2e / CI testing passing at strong coverage.

**Source comparison**: [../../v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md)

## Overview

This is the v1.4.0 cycle plan. Its first six phases adopt the 12 in-scope items (A1-A12) surfaced by the cross-project comparison against [claude-code-harness](https://github.com/Chachamaru127/claude-code-harness): the safety-hardening and workflow-discipline patterns worth importing from that project, reimplemented in Nexus's existing TypeScript/Node stack rather than by importing its Go engine or per-CLI plugin trees. The harness is itself local-first and zero-outbound at its core, so every adopted pattern reduces trust surface or is pure local workflow tooling; nothing introduces a new outbound call, credential, or third-party processor.

Phase sequencing follows the MCP Registry Policy decision tree (reverse-engineer-first). See Section 9.4 of the source comparison for the ordering rationale: `skill-native` items ship first (Phase 1), then the `re-full` / `re-partial` internal builds (Phases 2-6), then the `drop-outright` items (N1-N8) are recorded in the out-of-scope appendix and never implemented.

After the adoption phases, Phases 7-8 resolve every remaining known gap and deferred task carried forward across the prior cycles. This plan ingests 36 open item(s) carried forward from prior known-gaps files: see sub-tasks tagged `[from … known-gaps: …]`. The carryforward spans v1.3.0 (4 items: T002.P2.A, T012.P2.C, T013.P3.D, T017.P3.E), v1.2.0 (~30 items including the lone P1 `7.x.P1.D` protobufjs CVE chain, the Tree-sitter scanner swap `3.3.P2.G`, the HNSW upgrade `4.2.P3.K`, `permissions.deny` wiring `5.3.P2.R`, and the live hook-wiring deferrals), and the v1.1.0 architectural carryforward (`1.1.P1.A` TypeScript project references and `1.4.P1.B` the 12-sub-tree `src/` -> `modules/coding/` move).

Phase 9 is the mandated final phase: it inspects the Nexus-Hub repository at its latest version and latest features, ensures every Nexus-Hub functionality is integrated or accounted for in Nexus-AI (Nexus consumes the catalog via the `nexus skills sync` CLI), closes the Nexus-Hub-dependent gaps, and runs the whole-plan acceptance gate. Nexus-Hub is being upgraded in parallel as a universal harness that makes any agentic platform better and smarter, so Nexus-AI must finish this cycle in lock-step with it.

**Definition of pass (whole-plan acceptance gate, verified in Phase 9):**
1. All 12 adoption items (A1-A12) implemented.
2. All ingested known gaps and deferred tasks resolved or implemented.
3. Nexus-Hub latest updates accounted for and integrated.
4. Updated testing across unit, static (`nexus-check`), integration, e2e, and CI/CD with strong coverage, all passing.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No constitution file found at docs/versions/v1/v1.4.0/constitution.md - skipping check. Recommend running /constitution to establish project principles.

## Phases at a Glance

| Phase | Title | Outcome |
|-------|-------|---------|
| 1 | Skill-native adoptions (A3, A7, A12, A11) | Zero-code workflow/discipline skills + conventions shipped |
| 2 | Network & subprocess hardening (A4, A5) | Egress denylist in the SSRF guard + run_terminal env scrubbing |
| 3 | Static-analysis & CI gates (A2, A9) | Test-tampering nexus-check rules + OpenSSF Scorecard workflow |
| 4 | Safety config SSOT (A1) | `nexus.security.toml` SSOT generating safety surfaces + drift gate |
| 5 | Operator tooling & lifecycle (A6, A8) | `nexus doctor` migration report + PreCompact WIP-detection hook |
| 6 | Parallel agent execution (A10) | Optional worktree-isolated sub-agent execution |
| 7 | Known-gaps: architectural carryforward | src->modules/coding move, TS project refs, Tree-sitter swap, HNSW |
| 8 | Known-gaps: wiring, deferrals & the P1 CVE | protobufjs CVE, permissions.deny + hook wiring, hygiene, benchmarks |
| 9 | FINAL: Nexus-Hub sync + whole-plan acceptance gate | Nexus-Hub integration + definition-of-pass verification |

---

## Phase 1: Skill-native adoptions

**Goal**: Ship the four `skill-native` adoption items as conventions/skills with no runtime code change.
**Prerequisites**: None.
**Stability Gate**: Each new skill/convention is documented and discoverable; `nexus-check --rule skill-duplicate-name` passes; no `core/` or `modules/` code changed in this phase.

### Sub-tasks

#### 1.1 — A3: Pre-commit/pre-PR self-review checklist

- [x] T001 Author a self-review-checklist skill/convention in docs/versions/v1/v1.4.0/development/self-review-checklist.md

**Objective**: Adopt the harness's worker self-review gate (A3, skill-native) as a reusable Nexus checklist.

**Prompt**:
> Implement adoption item A3 from [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md). Source: claude-code-harness `harness.toml [worker.self_review] default_rules`. Author a pre-commit/pre-PR self-review checklist as a Nexus convention (a Markdown doc at `docs/versions/v1/v1.4.0/development/self-review-checklist.md`, and optionally a Nexus-Hub skill if the catalog is the better home). The checklist must encode these gates, adapted to Nexus: DRY-violation-none, all-declared-symbols-called, definition-of-done items verified with evidence, no-existing-test-regression, and (when TDD applies) red-evidence-attached. Acceptance: the checklist is referenced from the husky pre-push flow or the PR template; no runtime code changes. Effort: Low. Risk: None.

---

#### 1.2 — A7: "not_observed != absent" evidence + support-tier convention

- [x] T002 [P] Document the evidence/support-tier convention in docs/versions/v1/v1.4.0/development/evidence-and-support-tiers.md

**Objective**: Adopt the harness's evidence philosophy and explicit capability tiers (A7, skill-native).

**Prompt**:
> Implement adoption item A7 from the source comparison. Source: claude-code-harness `docs/distribution-scope.md`, `docs/tool-capability-matrix.md`. Write a convention doc at `docs/versions/v1/v1.4.0/development/evidence-and-support-tiers.md` establishing (a) the "not_observed != absent" rule (missing local proof means "not proven here", not "impossible" or "supported") and (b) an explicit capability/support-tier vocabulary (supported / internal-compatible / candidate / future) for Nexus features and integrations. Tie it into the known-gaps wording conventions. Acceptance: the convention is documented and referenced from AGENTS.md or the known-gaps template. Effort: Low. Risk: None.

---

#### 1.3 — A12: Evidence-pack discipline for PR/release

- [x] T003 Extend the shipping/release checklist with verified-only evidence-pack discipline in docs/versions/v1/v1.4.0/development/evidence-pack.md

**Objective**: Adopt verified-only evidence packaging for PR/release (A12, skill-native). Depends on A3 (T001).

**Prompt**:
> Implement adoption item A12 from the source comparison. Source: claude-code-harness `docs/evidence/work-all.md`, `harness-release` skill. Document an evidence-pack discipline at `docs/versions/v1/v1.4.0/development/evidence-pack.md`: only verified output (passing tests, lint, build, coverage) may be packaged into a PR or release artifact, and "PR ready is not release ready". Reference the A3 self-review checklist (T001) as the upstream gate. Wire the discipline into the existing release flow / RELEASE_NOTES convention. Acceptance: the discipline is documented and referenced from the release process. Effort: Low. Risk: None.

---

#### 1.4 — A11: Stakeholder HTML surfaces skill

- [x] T004 [P] Author a stakeholder-HTML-surfaces reporting skill emitting local HTML in docs/versions/v1/v1.4.0/development/stakeholder-surfaces.md

**Objective**: Adopt the harness's cognitive-load HTML surfaces (A11, skill-native) as a local-HTML reporting skill.

**Prompt**:
> Implement adoption item A11 from the source comparison. Source: claude-code-harness `harness-plan-brief`, `harness-progress`, `harness-accept` skills. Author a Nexus reporting skill/convention (documented at `docs/versions/v1/v1.4.0/development/stakeholder-surfaces.md`) that emits local, self-contained HTML surfaces for (a) a plan brief, (b) a progress tracker, and (c) an acceptance/handoff decision, for non-engineer stakeholder review. Reuse Nexus's existing local HTML-output conventions (the html-output-conventions Hub skill); no outbound calls. Acceptance: the skill produces the three HTML surfaces from local inputs. Effort: Medium. Risk: None.

---

#### 1.5 — Testing and Stabilization

- [x] T005 Run and stabilize Phase 1 checks in tests/

**Objective**: Verify the skill-native deliverables are conformant and discoverable.

**Prompt**:
> Validate Phase 1: run `node bin/nexus-check.mjs --rule skill-duplicate-name` and the prompt/skill checks; if any new skill landed in the Nexus-Hub catalog, run `python scripts/validate_skills.py` against it. Confirm no `core/` or `modules/` source changed. Fix all failures and iterate until clean. After all checks pass, run /generate-session-history to document Phase 1.

---

### Phase 1 Exit Checklist

- [x] All sub-tasks completed
- [x] All checks passing
- [x] No known regressions from prior phases
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 2

---

## Phase 2: Network & subprocess hardening

**Goal**: Adopt the harness's egress denylist and subprocess env scrubbing into Nexus's existing guards.
**Prerequisites**: None.
**Stability Gate**: `npm run test`, `npm run lint`, `npm run check-architecture` clean; new SSRF and terminal tests pass; existing terminal behavior preserved under the env-scrub allowlist.

### Sub-tasks

#### 2.1 — A4: Network-egress denylist in the SSRF guard

- [ ] T006 Add the cloud-metadata + paste-site egress denylist to src/utils/ssrf.ts

**Objective**: Adopt A4 (re-full): a named exfil-destination denylist layered onto the existing SSRF guard.

**Prompt**:
> Implement adoption item A4 from [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md). Source: claude-code-harness `harness.toml [safety.sandbox.network] deniedDomains`. Extend `src/utils/ssrf.ts` (the DNS-resolving SSRF guard with per-hop redirect re-validation) with a named-destination denylist covering cloud-metadata endpoints (169.254.169.254, metadata.google.internal, metadata.azure.com) and paste/file-host sites (pastebin.com, transfer.sh, 0x0.st, paste.ee, termbin.com, ix.io). The denylist must apply to FetchPageTool, WebSearchTool, and the optional OTLP exporter, and re-check on every redirect hop. Make the list extensible via a setting. Acceptance: unit tests prove each denied destination is blocked pre- and post-redirect; private-range blocking still works. Effort: Low. Risk: None.

---

#### 2.2 — A5: Subprocess env scrubbing for run_terminal

- [ ] T007 [P] Add child-process env scrubbing to the run_terminal handler in src/tools/handlers/terminal.ts

**Objective**: Adopt A5 (re-full): strip sensitive env vars from terminal subprocesses.

**Prompt**:
> Implement adoption item A5 from the source comparison. Source: claude-code-harness `harness.toml [env] CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = "1"`. Modify the run_terminal handler (`src/tools/handlers/terminal.ts`) to scrub sensitive environment variables (API keys, tokens, secrets, cloud credentials) from the env passed to child processes, reusing the secret patterns from `core/observability/redactSecrets.ts` where possible. Gate behind an allowlist so commands that legitimately need a variable can opt in (mitigates the risk that scrubbing breaks a command). Default the feature on but reversible via setting. Acceptance: unit tests prove sensitive vars are absent from the child env while allowlisted vars pass through; existing terminal tests stay green. Effort: Low-Medium. Risk: Low.

---

#### 2.3 — Testing and Stabilization

- [ ] T008 Run and stabilize Phase 2 tests in tests/unit/utils/ and tests/unit/tools/handlers/

**Objective**: Generate and run all tests for the hardening changes; iterate until stable.

**Prompt**:
> Generate comprehensive unit tests for the A4 egress denylist (`tests/unit/utils/ssrf.test.ts`) and the A5 env scrubbing (`tests/unit/tools/handlers/terminal.test.ts`). Run `npm run test`, `npm run lint`, `npm run check-architecture`; fix all failures and iterate until every test passes. Do not advance to Phase 3 until this phase is fully verified. After all tests pass, run /generate-session-history to document Phase 2.

---

### Phase 2 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 3

---

## Phase 3: Static-analysis & CI gates

**Goal**: Add test-tampering detection to `nexus-check` and an OpenSSF Scorecard CI workflow.
**Prerequisites**: None.
**Stability Gate**: `node bin/nexus-check.mjs --list-rules` shows the new rules; the new rules fire on tampered fixtures and pass clean code; Scorecard workflow validates.

### Sub-tasks

#### 3.1 — A2: Test-tampering detection rules

- [x] T009 Add test-tampering detection rules to lib/checks/ consumed by bin/nexus-check.mjs

**Objective**: Adopt A2 (re-full): the harness's T01-T12 anti-tampering family reimplemented as deterministic nexus-check rules.

**Prompt**:
> Implement adoption item A2 from [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md). Source: claude-code-harness `go/internal/guardrail/tampering.go` (rules T01-T12; "Beagle" test-tampering patterns). Reimplement the behaviors as new deterministic, LLM-free rules under `lib/checks/` consumed by `bin/nexus-check.mjs`: detect skipped/disabled tests added without justification, hardcoded test results, weakened assertions, disabled CI checks, and falsified evidence in diffs. Reuse the existing rule-loading mechanism (`lib/checks/index.mjs` RULES array). Do NOT port Go; reimplement in TS/Node. Wire the new rules into the husky pre-push `npm run check` and CI. Acceptance: rules fire on tampered fixtures and pass on clean fixtures; `--list-rules` shows them. Effort: Medium. Risk: Low.

---

#### 3.2 — A9: OpenSSF Scorecard CI workflow

- [x] T010 [P] Add the OpenSSF Scorecard workflow at .github/workflows/scorecard.yml

**Objective**: Adopt A9 (re-full): supply-chain posture scoring alongside the existing CodeQL workflow.

**Prompt**:
> Implement adoption item A9 from the source comparison. Source: claude-code-harness `.github/workflows/scorecard.yml`. Add `.github/workflows/scorecard.yml` using the official `ossf/scorecard-action`, scheduled (e.g. weekly cron) plus on push to the default branch, uploading SARIF results. Mirror the conventions of the existing `.github/workflows/codeql.yml`. Acceptance: the workflow file is valid YAML and the action is pinned by SHA per the repo's SHA-pin policy. Effort: Low. Risk: Low.

---

#### 3.3 — Testing and Stabilization

- [x] T011 Run and stabilize Phase 3 checks in tests/unit/checks/

**Objective**: Verify the new static rules and CI workflow.

**Prompt**:
> Generate unit tests for the A2 test-tampering rules (`tests/unit/checks/`) covering tampered and clean fixtures. Run `npm run test`, `npm run lint`, and `node bin/nexus-check.mjs --list-rules`. Validate the Scorecard workflow YAML. Fix all failures and iterate until clean. After all tests pass, run /generate-session-history to document Phase 3.

---

### Phase 3 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing
- [x] No known regressions from prior phases
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 4

---

## Phase 4: Safety config SSOT

**Goal**: Introduce a single source of truth for safety surfaces that regenerates the egress denylist, permission table, and secret-path denylist.
**Prerequisites**: Phases 2-3 (the surfaces it will generate must exist first).
**Stability Gate**: The generator is idempotent; CI drift gate fails on hand-edits; generated surfaces match the runtime guards.

### Sub-tasks

#### 4.1 — A1: `nexus.security.toml` SSOT + generator

- [x] T012 Create the safety SSOT and generator extending scripts/generate-tool-permission-table.mjs

**Objective**: Adopt A1 (re-full): one config SSOT generating safety files, modeled on `harness.toml` + `harness sync`.

**Prompt**:
> Implement adoption item A1 from [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md). Source: claude-code-harness `harness.toml` + `bin/harness sync`. Introduce a safety SSOT (`nexus.security.toml`, or extend the existing config) capturing the permission tiers, the A4 egress denylist, and the secret-path denylist. EXTEND the existing `scripts/generate-tool-permission-table.mjs` generator (do NOT introduce a competing source of truth for permissions — see Section 13 of the comparison) so it regenerates all safety surfaces from the SSOT. Keep `src/guardrails/PermissionTiers.ts` as the canonical tier definition or generate it from the SSOT — pick one and document it. Acceptance: running the generator twice is idempotent. Effort: Medium. Risk: Low.

---

#### 4.2 — Wire generated surfaces + CI drift gate

- [x] T013 Wire generated safety surfaces into the runtime guards and add a CI drift gate in .github/workflows/

**Objective**: Ensure the generated artifacts are the ones the runtime enforces and that hand-edits fail CI. Depends on T012.

**Prompt**:
> Building on T012, wire the generated safety surfaces so the runtime guards (SSRF egress list from A4, secret-path denylist in `core/observability/redactSecrets.ts` / `src/tools/handlers/pathGuard.ts`, and the permission table) read from the SSOT-generated artifacts. Add a CI drift gate (extend the existing `perm-tier:check` pattern) that fails when a generated artifact diverges from the SSOT. Acceptance: editing a generated file by hand fails CI; regenerating fixes it. Effort: Medium. Risk: Low.

---

#### 4.3 — Testing and Stabilization

- [x] T014 Run and stabilize Phase 4 tests in tests/unit/ and the drift gate

**Objective**: Verify SSOT generation and the drift gate end-to-end.

**Prompt**:
> Generate tests for the SSOT generator (idempotency, round-trip) and the drift gate. Run `npm run test`, `npm run lint`, `npm run perm-tier:check` (and the new drift gate). Fix all failures and iterate until clean. After all tests pass, run /generate-session-history to document Phase 4.

---

### Phase 4 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing
- [x] No known regressions from prior phases
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 5

---

## Phase 5: Operator tooling & lifecycle

**Goal**: Add a non-destructive `nexus doctor` inventory and a PreCompact WIP-detection hook.
**Prerequisites**: None.
**Stability Gate**: `nexus doctor --migration-report` runs read-only; the PreCompact hook fires on the lifecycle bus and warns on WIP without blocking.

### Sub-tasks

#### 5.1 — A6: `nexus doctor --migration-report`

- [x] T015 Add the doctor subcommand to bin/nexus.mjs

**Objective**: Adopt A6 (re-full): a non-destructive inventory of stale state.

**Prompt**:
> Implement adoption item A6 from the source comparison. Source: claude-code-harness `bin/harness doctor --migration-report`. Add a `nexus doctor` subcommand to `bin/nexus.mjs` that inventories stale caches, legacy `~/.gemma-code/` state, duplicate skills, old symlinks, and memory state under `~/.nexus/`, WITHOUT deleting anything (read-only by contract; `--migration-report` for the full inventory). Acceptance: integration tests prove it reports without mutating disk. Effort: Medium. Risk: None.

---

#### 5.2 — A8: PreCompact WIP-detection + checkpoint hook

- [x] T016 [P] Add a PreCompact WIP-detection handler on core/lifecycle/HookBus.ts

**Objective**: Adopt A8 (re-full): warn on in-flight work before context compaction.

**Prompt**:
> Implement adoption item A8 from the source comparison. Source: claude-code-harness `hooks.json` PreCompact/PostCompact handlers. Add a PreCompact handler wired to `core/lifecycle/HookBus.ts` that detects work-in-progress (uncommitted edits, in-flight tasks) and emits a non-blocking warning before context compaction, plus a state checkpoint that PostCompact can restore. Reuse the existing 13-event lifecycle bus. Acceptance: unit tests prove the hook fires on the PreCompact event and warns without blocking compaction. Effort: Medium. Risk: Low.

---

#### 5.3 — Testing and Stabilization

- [x] T017 Run and stabilize Phase 5 tests in tests/integration/ and tests/unit/lifecycle/

**Objective**: Verify the doctor CLI and PreCompact hook.

**Prompt**:
> Generate tests for `nexus doctor` (integration: read-only assertion) and the PreCompact WIP hook (`tests/unit/lifecycle/`). Run `npm run test`, `npm run lint`, `npm run check-architecture`. Fix all failures and iterate until clean. After all tests pass, run /generate-session-history to document Phase 5.

---

### Phase 5 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing
- [x] No known regressions from prior phases
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 6

---

## Phase 6: Parallel agent execution

**Goal**: Add optional worktree-isolated parallel sub-agent execution (the largest, P3, re-partial adoption).
**Prerequisites**: None (but benefits from a stable test harness).
**Stability Gate**: Parallel sub-agents run in isolated worktrees without file conflicts; isolation is opt-in and defaults off; the worktree is cleaned up when unchanged.

### Sub-tasks

#### 6.1 — A10: Worktree-isolated parallel sub-agent execution

- [x] T018 Add optional worktree isolation to src/agents/SubAgentManager.ts

**Objective**: Adopt A10 (re-partial): ship worktree isolation; defer full Breezing-style orchestration.

**Prompt**:
> Implement adoption item A10 from [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../v1.3.0/comparison-claude-code-harness.md). Source: claude-code-harness `agents/worker.md` + `go/internal/breezing/`. Add optional git-worktree isolation to `src/agents/SubAgentManager.ts` so concurrently-dispatched sub-agents that mutate files run in their own worktree and cannot conflict. Isolation is opt-in (default off) given the disk/orchestration cost flagged as the only Medium-risk item in the comparison. Defer the full team-orchestration (Planner/Critic/Worker) layer; document the deferral. Acceptance: a test proves two parallel write-capable sub-agents do not collide when isolation is enabled, and the worktree is removed when unchanged. Effort: High. Risk: Medium.

---

#### 6.2 — Testing and Stabilization

- [x] T019 Run and stabilize Phase 6 tests in tests/integration/agents/

**Objective**: Verify worktree isolation under parallel dispatch.

**Prompt**:
> Generate integration tests for worktree-isolated parallel sub-agent execution (`tests/integration/agents/`). Run `npm run test`, `npm run lint`, `npm run check-architecture`. Fix all failures and iterate until clean. After all tests pass, run /generate-session-history to document Phase 6.

---

### Phase 6 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing
- [x] No known regressions from prior phases
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 7

---

## Phase 7: Known-gaps — architectural carryforward

**Goal**: Close the heavy structural deferrals carried from v1.1.0 and v1.2.0.
**Prerequisites**: Phases 1-6 (do the additive adoption before the large structural moves).
**Stability Gate**: `tsc -b` builds in dependency order; `npm run check-architecture` clean; full `npm run test` green after the move.

### Sub-tasks

#### 7.1 — Complete the src/ -> modules/coding/ move

- [x] T020 [from v1.1.0 known-gaps: 1.4.P1.B] Migrate the 12 remaining src/ sub-trees into modules/coding/

**Objective**: Resolve `1.4.P1.B` (DF, P1): finish the wholesale `src/` -> `modules/coding/` move.

**Prompt**:
> Resolve known-gap `1.4.P1.B` (from [docs/versions/v1/v1.1.0/known-gaps.md](../../v1.1.0/known-gaps.md)). Reason: the wholesale `src/` -> `modules/coding/` move was only partially closed (only `src/utils/` migrated in v1.1.0 Phase 3); 12 sub-trees remain (`config`, `llm`->merge into `core/llm`, `observability`, `orchestration`, `guardrails`, `mcp`, `commands`, `agents`, `chat`, `evaluation`, `skills`, `runtime`). Suggested next step: drive each `git mv` cluster with `scripts/dev/rewrite-imports.mjs`, one sub-tree per commit, running `npm test` + `npm run check-architecture` after each. The `src/runtime/` move unlocks `1.10.P1.F` (NexusCodingRuntime sidecar wiring). Acceptance: all 12 sub-trees moved, all importers rewritten, architecture boundary (`core/**` MUST NOT import `modules/**`) intact, full test suite green.

---

#### 7.2 — TypeScript project-references wiring

- [x] T021 [from v1.1.0 known-gaps: 1.1.P1.A] Wire tsc -b project references across core/, modules/coding/, desktop/sidecar/ via core/tsconfig.json

**Objective**: Resolve `1.1.P1.A` (DF, P1): land the project-references build.

**Prompt**:
> Resolve known-gap `1.1.P1.A` (from [docs/versions/v1/v1.1.0/known-gaps.md](../../v1.1.0/known-gaps.md)). Reason: the shared-core ADR chose project references with `composite: true` on `core/`, but the wiring was deferred because it conflicts with the pre-move root tsconfig double-emit. Now that T020 has landed the `src/` -> `modules/coding/` move, do: (a) narrow root `tsconfig.json` include, (b) add `core/tsconfig.json` with `composite: true`, (c) add `references` arrays to the root and `desktop/tsconfig.json`, (d) switch `npm run build` to `tsc -b`, (e) verify `npm run check-architecture`. Acceptance: `tsc -b` builds `core/`, `modules/coding/`, and `desktop/sidecar/` in dependency order with no double-emit. Effort: Medium. Depends on T020.

---

#### 7.3 — Tree-sitter scanner swap (+ dependents)

- [x] T022 [from v1.2.0 known-gaps: 3.3.P2.G] Swap the regex extractor for a Tree-sitter scanner behind core/codegraph/scanner/index.ts

**Objective**: Resolve `3.3.P2.G` (DF, P2) and inherit into `4.1.P2.J` and `6.1.P3.V`.

**Prompt**:
> Resolve known-gap `3.3.P2.G` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)). Reason: the codegraph scanner ships a regex extractor instead of Tree-sitter because the native bindings were not available; it misses multi-line declarations, property-method assignments, and computed names. Add the `tree-sitter-typescript`/`-python`/`-rust`/`-go` bindings and implement a Tree-sitter scanner behind the existing `core/codegraph/scanner/index.ts` re-export (keep `extractSymbols(source, language)` as the stable boundary). This automatically upgrades `AstChunker` (`4.1.P2.J`) and `WatchedRepoScanner` (`6.1.P3.V`) since both consume `extractSymbols`. Acceptance: the 4 language fixtures plus the previously-missed edge cases parse correctly; codegraph integration tests pass. Mark `3.3.P2.G`, `4.1.P2.J`, `6.1.P3.V` resolved.

---

#### 7.4 — Multi-layer HNSW PrunedDenseIndex

- [x] T023 [P] [from v1.2.0 known-gaps: 4.2.P3.K] Port PrunedDenseIndex to multi-layer HNSW in core/memory/PrunedDenseIndex.ts

**Objective**: Resolve `4.2.P3.K` (DF, P3): replace the O(N^2) single-layer kNN graph build.

**Prompt**:
> Resolve known-gap `4.2.P3.K` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)). Reason: `core/memory/PrunedDenseIndex.ts` ships a single-layer kNN graph with an all-pairs O(N^2) `compact()` build, capping practical scale at ~50k nodes. Port the graph build to true multi-layer HNSW (the save/load format already has a `version` field for forward-compat; `hnswlib-node` is an existing optional dependency). Acceptance: the index scales past ~50k nodes without quadratic compact time; recall on the 2k-chunk fixture is preserved; the 100k sweep (see T030) completes. Effort: High. Risk: Low.

---

#### 7.5 — Testing and Stabilization

- [x] T024 Run and stabilize Phase 7 tests across tests/ after the architectural move

**Objective**: Prove the structural changes preserve behavior.

**Prompt**:
> After T020-T023, run the full suite: `tsc -b` (or `npm run build`), `npm run test`, `npm run lint`, `npm run check-architecture`, and the codegraph + memory integration tests. Fix every failure and iterate until green. Update `docs/versions/v1/v1.4.0/known-gaps.md` marking `1.4.P1.B`, `1.1.P1.A`, `3.3.P2.G`, `4.1.P2.J`, `6.1.P3.V`, `4.2.P3.K` resolved. After all tests pass, run /generate-session-history to document Phase 7.

---

### Phase 7 Exit Checklist

- [x] All sub-tasks completed
- [x] All tests passing
- [x] No known regressions from prior phases
- [x] Session history generated for this phase
- [x] Ready to advance to Phase 8

---

## Phase 8: Known-gaps — wiring, deferrals & the P1 CVE

**Goal**: Resolve every remaining open known-gap: the lone P1 protobufjs CVE, the unwired parsers/hooks, the documented deferrals, and the benchmarks.
**Prerequisites**: Phase 7 (architecture settled).
**Stability Gate**: `npm run check:audit-prod` clean with no remaining inherited high/critical advisory; all referenced gap IDs marked resolved; full suite green.

### Sub-tasks

#### 8.1 — Resolve the protobufjs CVE chain (P1)

- [ ] T025 [from v1.2.0 known-gaps: 7.x.P1.D] Resolve the protobufjs CVE chain via @xenova/transformers in package.json

**Objective**: Resolve `7.x.P1.D` (BG, P1): the only P1 carryforward.

**Prompt**:
> Resolve known-gap `7.x.P1.D` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)). Reason: 5 protobufjs CVEs (one critical) reach production via `@xenova/transformers@2.17.2` -> `onnxruntime-web` -> `onnx-proto` -> `protobufjs@6.x`. Evaluate, in order: (a) upgrade `@xenova/transformers` to a release that pulls a newer `onnxruntime-web` (and thus `protobufjs >=7.5.8`); (b) migrate to the `@huggingface/transformers` v4.x line; (c) keep the allowlist mitigation if no upstream fix exists. Re-run `npm run check:audit-prod` and the local embedder tests (`LocalEmbedder`) to confirm ONNX model loading still works. Acceptance: no inherited high/critical advisory remains, or the carryforward is re-justified with a tightened allowlist. Effort: Medium. Risk: Medium (touches the embedder backbone).

---

#### 8.2 — Wire permissions.deny + unify the codegraph ignore parser

- [ ] T026 [from v1.2.0 known-gaps: 5.3.P2.R, 5.3.P3.S, 6.1.P3.W] Wire PermissionsDeny into the tool gate and unify RepoScanner ignore parsing onto core/storage/NexusIgnore.ts

**Objective**: Resolve `5.3.P2.R` (WN, P2), `5.3.P3.S` (DF, P3), `6.1.P3.W` (DF, P3).

**Prompt**:
> Resolve known-gaps `5.3.P2.R`, `5.3.P3.S`, `6.1.P3.W` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)). (1) `core/storage/PermissionsDeny.ts` is implemented and tested but has no caller; route every write-capable tool invocation through `evaluateDeny(toolName, subject, parsedDeny)` after the existing path-guard and ALLOWED_COMMANDS checks (start with `run_terminal`). (2) Replace the inline `loadIgnorePatterns`/`isIgnored` in `core/codegraph/scanner/RepoScanner.ts` with the shared `core/storage/NexusIgnore.ts` parser so the full-scan and watcher paths share one parser. Acceptance: per-tool denials are enforced; codegraph integration tests confirm ignore-parity; the `no-orphans` warning on `PermissionsDeny.ts` clears.

---

#### 8.3 — Live-wire deferred lifecycle hooks & explore policy

- [ ] T027 [P] [from v1.2.0 known-gaps: 5.4.P3.T, 5.2.P3.Q, 5.1.P2.P, 5.1.P2.O] Live-wire session-reflection, path-scope reevaluation, and explore-MCP classification in core/coding/ and src/agents/

**Objective**: Resolve `5.4.P3.T`, `5.2.P3.Q`, `5.1.P2.P`, `5.1.P2.O`.

**Prompt**:
> Resolve known-gaps `5.4.P3.T`, `5.2.P3.Q`, `5.1.P2.P`, `5.1.P2.O` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)). (1) `5.4.P3.T`: call `attachSessionReflectionHook(hookBus)` once at session construction and emit `lifecycle.session.reflection` from the session-end handler. (2) `5.2.P3.Q`: have the Coding-pillar agent loop call `catalog.reevaluatePathScope(activeEditPath)` on focus change and activate/deactivate skills accordingly. (3) `5.1.P2.P`: auto-classify read-only MCP tools (no write verbs in the name) into the explore allowlist in `core/coding/SubAgentPolicy.ts`. (4) `5.1.P2.O`: if T020 moved the dispatcher into `modules/coding/`, port the explore policy wiring to the new dispatcher. Acceptance: integration tests prove each wiring fires in production paths. Mark all four resolved.

---

#### 8.4 — LSP installer bundling, broader LSP, desktop sanitiser

- [ ] T028 [P] [from v1.2.0 known-gaps: 6.2.P2.X, 6.2.P3.Y, 6.3.P2.Z] Add LSP-server install prompts in core/coding/lsp/LspClient.ts and adopt DOMPurify in desktop/src/components/InteractiveArtifact.tsx

**Objective**: Resolve `6.2.P2.X` (DF, P2), `6.2.P3.Y` (DF, P3), `6.3.P2.Z` (DF, P2).

**Prompt**:
> Resolve known-gaps `6.2.P2.X`, `6.2.P3.Y`, `6.3.P2.Z` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)). (1) `6.2.P2.X`: add opt-in per-platform installer prompts for `typescript-language-server`, `python-lsp-server`, `rust-analyzer` so the LSP path is not silently absent. (2) `6.2.P3.Y`: broaden `core/coding/lsp/LspClient.ts` beyond definition/references only if a consumer needs it (otherwise document the intentional minimal subset and close as won't-expand). (3) `6.3.P2.Z`: add `isomorphic-dompurify` to the desktop workspace and switch `desktop/src/components/InteractiveArtifact.tsx` from the inline sanitiser to DOMPurify. Acceptance: installer-smoke surfaces the LSP prompts; desktop tests pass with DOMPurify. Effort: Medium.

---

#### 8.5 — Remaining hygiene & low-severity deferrals

- [ ] T029 [P] [from v1.2.0 known-gaps: 2.4.P2.E, 2.4.P3.F, 4.3.P3.M, 4.x.P3.N, 3.4.P3.H, 3.5.P3.I, 6.1.P3.U] Clear remaining deferrals across src/tools/handlers/, core/memory/, and core/storage/

**Objective**: Resolve the remaining v1.2.0 P2/P3 hygiene deferrals.

**Prompt**:
> Resolve known-gaps `2.4.P2.E`, `2.4.P3.F`, `4.3.P3.M`, `4.x.P3.N`, `3.4.P3.H`, `3.5.P3.I`, `6.1.P3.U` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)). (1) `2.4.P2.E`: delete dead `src/tools/handlers/preToolHook.ts` + its test. (2) `2.4.P3.F`: surface the most-recent tee footer in the next-turn system prompt via PromptBuilder and drop the tool-result `footer` field. (3) `4.3.P3.M`: rename the migration wrapper to `.ts` only if a `tsconfig.scripts.json` lands, else document closure. (4) `4.x.P3.N`: route code-aware ingest through `HybridRetriever.ingestFile()`. (5) `3.4.P3.H`: leave codegraph in-process (document as won't-do) or expose read-only stdio if a consumer needs it. (6) `3.5.P3.I`: add a system-prompt warning when codegraph tools are trimmed under the 15-tool cap. (7) `6.1.P3.U`: keep `fs.watch` (document) or add opt-in `chokidar`. Acceptance: each gap is either implemented or explicitly closed with rationale; `npm run test` + `check-architecture` green.

---

#### 8.6 — Benchmarks + v1.3.0 audit deferrals

- [ ] T030 [P] [from v1.2.0 known-gaps: 4.4.P2.L, 7.1.P2.A; from v1.3.0 known-gaps: T012.P2.C, T013.P3.D] Run the 100k benchmark + skills-audit multi-root scan in tests/ and benchmarks/

**Objective**: Resolve `4.4.P2.L` (MT, P2), `7.1.P2.A` (DF, P2), `T012.P2.C` (DF, P2), `T013.P3.D` (DF, P3).

**Prompt**:
> Resolve known-gaps `4.4.P2.L`, `7.1.P2.A` (from [docs/versions/v1/v1.2.0/known-gaps.md](../../v1.2.0/known-gaps.md)) and `T012.P2.C`, `T013.P3.D` (from [docs/versions/v1/v1.3.0/known-gaps.md](../../v1.3.0/known-gaps.md)). (1) `4.4.P2.L`: run the 100k-chunk memory-tier sweep (`NEXUS_PHASE4_BENCH_SIZE=100000`) with the real embedder and publish recall + ratio under `docs/versions/v1/v1.4.0/benchmarks/`. (2) `7.1.P2.A`: optionally upgrade the token-usage benchmark to a live worktree-vs-HEAD replay, or document the deterministic synthesis as canonical. (3) `T012.P2.C`: widen `scanUsage` to accept multiple skill roots so the Unused report spans user + devai-hub roots. (4) `T013.P3.D`: add a MinHash/LSH pre-filter before the exact Jaccard pass if the full-catalog benchmark shows similarity as a cost driver. Acceptance: benchmarks published; multi-root usage scan tested. Effort: Medium.

---

#### 8.7 — Testing and Stabilization + known-gaps ledger update

- [ ] T031 Run and stabilize Phase 8 tests and recompute docs/versions/v1/v1.4.0/known-gaps.md

**Objective**: Prove every wiring/deferral closed and the audit gate clean.

**Prompt**:
> After T025-T030, run `npm run test`, `npm run lint`, `npm run check-architecture`, `npm run check:audit-prod`, and the full integration suite. Fix every failure. Update `docs/versions/v1/v1.4.0/known-gaps.md`: move every resolved carryforward item to Resolved and recompute the summary; keep open only items genuinely blocked on Nexus-Hub (handled in Phase 9). After all tests pass, run /generate-session-history to document Phase 8.

---

### Phase 8 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to advance to Phase 9

---

## Phase 9: FINAL — Nexus-Hub sync + whole-plan acceptance gate

**Goal**: Bring Nexus-AI fully in sync with the parallel Nexus-Hub upgrade, close the Nexus-Hub-dependent gaps, and verify the whole-plan definition of pass.
**Prerequisites**: Phases 1-8.
**Stability Gate**: The definition-of-pass (all four criteria) holds with fresh evidence; the full test matrix passes; the release is ready.

### Sub-tasks

#### 9.1 — Inspect Nexus-Hub latest version & features

- [ ] T032 Produce a Nexus-Hub integration delta at docs/versions/v1/v1.4.0/development/nexus-hub-integration-delta.md

**Objective**: Determine what the parallel Nexus-Hub upgrade added that Nexus-AI must integrate.

**Prompt**:
> Inspect the Nexus-Hub repository (https://github.com/bendourthe/Nexus-Hub) at its latest version and latest release tag. Enumerate its current catalog (skills, commands, hooks, agents, language rules, internal MCP servers) and its version/feature set. Diff that against what Nexus-AI currently consumes via `nexus skills sync` and the `DevAIHubSyncer` (`core/skills/DevAIHubSyncer.ts`). Write the integration delta to `docs/versions/v1/v1.4.0/development/nexus-hub-integration-delta.md`: every Nexus-Hub functionality, whether it is already integrated/wired in Nexus-AI, and the work needed to integrate the rest. Treat Nexus-Hub as the universal harness Nexus-AI must stay in lock-step with. Acceptance: the delta lists every Hub functionality with an integrated / not-integrated verdict and a file-path-cited integration step.

---

#### 9.2 — Integrate Nexus-Hub functionality + close Hub-dependent gaps

- [ ] T033 Wire the Nexus-Hub catalog into Nexus-AI via bin/nexus.mjs skills sync and close Hub-dependent known-gaps

**Objective**: Integrate every Nexus-Hub functionality and resolve `1.1.P2.A`, `1.1.P3.B`, `T017.P3.E`, `T002.P2.A`. Depends on T032.

**Prompt**:
> Using the T032 delta, integrate every Nexus-Hub functionality into Nexus-AI: ensure `nexus skills sync` / `skills list` surface the full upgraded catalog (skills, commands, hooks, agents) and that any new Hub capability has a wired consumer in Nexus-AI. In the course of this, close the Nexus-Hub-dependent known-gaps: `1.1.P2.A` (run `make build-catalog` in Nexus-Hub and rebuild `data/skills.json` + `SKILL_INDEX.md`), `1.1.P3.B` (cut a Nexus-Hub release tag, then `node bin/nexus.mjs skills sync --apply` + `skills list` to confirm the new skills flow through), `T017.P3.E` (drain the `validate_skills.allowlist.json` over-long-description entries), and `T002.P2.A` (grandfather or fix the 7 secret-scan false positives). Acceptance: `nexus skills sync --apply` succeeds against the upgraded Nexus-Hub release and lists all current skills including any authored in Phase 1; the four Hub-dependent gaps are resolved.

---

#### 9.3 — Whole-plan acceptance gate (definition of pass)

- [ ] T034 Verify the definition of pass with fresh evidence across the full test matrix in tests/

**Objective**: Prove all four pass criteria hold.

**Prompt**:
> Run the whole-plan acceptance gate and record fresh evidence for each criterion: (1) all 12 adoption items A1-A12 implemented (cross-check Phases 1-6); (2) all ingested known gaps resolved (cross-check `docs/versions/v1/v1.4.0/known-gaps.md` shows the 36 carryforward items closed or explicitly re-justified); (3) Nexus-Hub latest updates integrated (T032/T033); (4) updated testing — run `npm run build` (`tsc -b`), `npm run lint`, `npm run check-architecture`, `npm run check`, `npm run check:audit-prod`, `npm run test` with coverage, the integration suite, and the e2e/golden-task suite; confirm strong coverage and zero failures, and that CI workflows (`ci.yml`, `codeql.yml`, new `scorecard.yml`, `coverage-diff.yml`) are green. Fix every failure and iterate. Acceptance: all four criteria pass with cited evidence.

---

#### 9.4 — Final documentation & release readiness

- [ ] T035 Finalize docs/versions/v1/v1.4.0/known-gaps.md, RELEASE_NOTES.md, and the version bump

**Objective**: Close the cycle: finalize known-gaps, write release notes, prepare the version bump.

**Prompt**:
> Finalize the v1.4.0 cycle: set `docs/versions/v1/v1.4.0/known-gaps.md` Status to finalized with a recomputed summary; write `docs/versions/v1/v1.4.0/RELEASE_NOTES.md` summarizing the 12 adoptions, the closed carryforward gaps, and the Nexus-Hub sync; refresh README.md / AGENTS.md / ARCHITECTURE.md for any new surfaces; prepare the version bump per the semantic-release flow. Acceptance: docs consistent, release notes complete, version bump staged. After completion, run /generate-session-history to document Phase 9.

---

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | Constitution Check emitted the informational no-file note; no MUST principles to violate. | — |

---

## Items explicitly NOT adopted (security / policy reasons)

These `drop-outright` items from Section 13 of the source comparison are out of scope by design and never appear as plan sub-tasks. Each cites the MCP Registry Policy (`AGENTS.md`) grounds for rejection.

- **N1 — `notebookLM` skill (Google NotebookLM API).** Outbound generation-as-service; violates the MCP Registry Policy hard-no on generation-as-service and the local-first runtime contract.
- **N2 — `deploy` skill (Vercel / Netlify / AWS Lambda / CloudRun).** Out of Nexus's domain; each target is third-party-vendor-intrinsic; MCP Registry Policy bucket 5 (drop).
- **N3 — `auth` skill (Clerk / Supabase / Firebase).** Third-party-vendor-intrinsic, out of Nexus's domain.
- **N4 — `harness-mem` companion daemon.** Nexus's four-layer hybrid-retrieval memory strictly supersedes it; adoption is negative-value.
- **N5 — Committing prebuilt cross-platform binaries.** Supply-chain / repo-hygiene anti-pattern; conflicts with Nexus's build-from-source posture.
- **N6 — Bilingual EN/JA documentation duplication.** No audience need; doubles maintenance burden.
- **N7 — The Go-native guardrail engine rewrite.** Nexus is TS/Rust; adopt the rule behaviors (A2) not the language.
- **N8 — Per-CLI plugin distribution (`.codex-plugin/`, `.cursor-plugin/`, `setup-*.sh`).** Conflicts with Nexus's deliberate agent-agnostic stance documented in `docs/harness-integration.md`.

---

### Phase 9 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (unit, static, integration, e2e, CI/CD) with strong coverage
- [ ] All 12 adoption items (A1-A12) implemented
- [ ] All ingested known gaps resolved or explicitly re-justified
- [ ] Nexus-Hub latest updates integrated and accounted for
- [ ] known-gaps.md finalized; RELEASE_NOTES.md written; version bump staged
- [ ] Session history generated for this phase
- [ ] Definition of pass verified with fresh evidence

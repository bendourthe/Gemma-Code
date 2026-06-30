# v1.7.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: in progress (Phase 1 of 6 closed 2026-06-29). v1.7.0 is the "local skill self-optimization loop + opencode harness hardening" cycle ([plans/adoption-self-optimizing-skills.md](plans/adoption-self-optimizing-skills.md), derived from [comparison-self-optimizing-skills.md](comparison-self-optimizing-skills.md) (primary, S1-S6) and [comparison-opencode.md](comparison-opencode.md) (secondary, O-A)). Phase 1 ships S1: a TS-native golden-task **live runner** that revives the golden suite as a working evaluator (the optimization loop's hard prerequisite, and a restoration of the live golden runs deleted by [ADR-0001](../../../adr/0001-python-backend-disposition.md)) -- four vscode-free `modules/coding/evaluation/` modules (a declarative `success_criteria` evaluator, a copy-into-temp + `git init` snapshot materializer, a dependency-free YAML-subset task loader, and a runner that materializes -> runs the agent via an injected driver -> evaluates -> emits a scored `GoldenTaskResult`) (SO001, closed 2026-06-29). This file is appended phase-by-phase; items move to `## 2. Resolved` when closed; the `## 3. Summary` is recomputed each pass.

**Audience**: v1.7.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-06-29 (Phase 1 -- S1 TS-native golden-task live runner, SO001)
**Sibling reviews**: [../v1.6.0/known-gaps.md](../v1.6.0/known-gaps.md) (the prior cycle's gap log) and [plans/adoption-self-optimizing-skills.md](plans/adoption-self-optimizing-skills.md) (the active plan).

**Cycle context**: This file is created in Phase 1 (rather than at the FINAL Phase 6 named in plan sub-task SO008) because the implement-phase post-phase sequence appends gaps every phase. Phase 1 introduces no bug, test failure, coverage shortfall, suppressed lint, or bypassed quality gate; the seeded entries below are forward-tier follow-ups (`candidate` / `future`), not defects.

**Wording convention**: every prose claim follows the evidence-and-support-tiers discipline ([../v1.4.0/development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md), A7): a gap describes its unbuilt capability at tier `future` or `candidate` (never `supported`); the "Suggested next step" states what cited evidence would raise the tier. "not_observed != absent" applies throughout.

Severity tags: **P0** release-blocker; **P1** should-fix; **P2** nice-to-have; **P3** out-of-scope for v1.7.0 / recorded for future planning.
Category tags: **NI** not implemented; **DF** deferred; **BG** bug; **MT** missing tests; **WN** warning; **QG** quality gate.

---

## 0. Adoption Ledger

Per-sub-task closure ledger for the self-optimizing-skills adoption plan. Rows land as each phase closes.

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| SO001 | S1 -- TS-native golden-task live runner | Resolved | Phase 1 (2026-06-29); four vscode-free `modules/coding/evaluation/` modules. [goldenCriteria.ts](../../../../modules/coding/evaluation/goldenCriteria.ts): TS port of `tests/golden/framework/evaluator.py` -- all 8 declarative criterion types (`file_contains`/`file_exists`/`file_deleted`/`output_contains`/`test_passes`/`lint_passes`/`no_errors`/`diff_matches`) with regex-or-literal matching and an injected `CommandRunner` (default shells out with a timeout; tests inject a fake for determinism + cross-platform). [goldenSnapshot.ts](../../../../modules/coding/evaluation/goldenSnapshot.ts): TS port of `snapshot.py` `prepare_worktree`+`init_git_repo` -- copies a snapshot into a throwaway temp dir (pruning `node_modules`/`.git`/`.worktrees`/`__pycache__`) and `git init`s a clean baseline via an injected, fault-tolerant `GitRunner`. [goldenTaskLoader.ts](../../../../modules/coding/evaluation/goldenTaskLoader.ts): dependency-free YAML-subset parser for the fixed `tests/golden/tasks/*.yaml` schema -> `GoldenTaskSpec` (block scalars, escaped double-quoted scalars, single-quoted scalars, flow lists, mapping sequences; fail-closed throws on unsupported constructs), validated against the full 28-task corpus. [GoldenTaskRunner.ts](../../../../modules/coding/evaluation/GoldenTaskRunner.ts): materialize -> (dry: skip / live: injected `AgentDriver`) -> `evaluateCriteria` -> scored `GoldenTaskResult`, with a per-task timeout (`AbortController`/`AbortSignal`) and workspace cleanup. The agent loop + concrete `OllamaClient` are vscode-coupled (`ConversationManager`, the logger) and live behind the `no-llm-outside-llm-folder` rule, so the runner depends on an injected `AgentDriver` seam (mirroring the `WorktreeManager.GitRunner` / `TraceDbReader` injection pattern) rather than importing them. Tests: [goldenCriteria.test.ts](../../../../tests/unit/evaluation/goldenCriteria.test.ts) (12), [goldenTaskLoader.test.ts](../../../../tests/unit/evaluation/goldenTaskLoader.test.ts) (13, incl. the full corpus + the escaped-scalar decode), [goldenSnapshot.test.ts](../../../../tests/unit/evaluation/goldenSnapshot.test.ts) (9), [GoldenTaskRunner.test.ts](../../../../tests/unit/evaluation/GoldenTaskRunner.test.ts) (8), [golden-runner-end-to-end.test.ts](../../../../tests/integration/golden/golden-runner-end-to-end.test.ts) (3: real-snapshot dry + mock-live), [golden-runner.live.test.ts](../../../../tests/integration/golden/golden-runner.live.test.ts) (env-gated `GOLDEN_LIVE_OLLAMA` real-Ollama smoke). Verification: `tsc -b` clean, lint 0 errors, check-architecture 0 errors / 10 pre-existing warnings, check:tampering 0 findings, security:check in sync, root suite 4354 passed / 6 skipped / 0 failed, new-module coverage 97.11% lines / 83.25% branches / 100% functions. |

---

## 1. Open Items

### Phase 1 follow-ups (forward-tier, not defects)

| ID | Sev | Cat | Description | Suggested next step |
|---|---|---|---|---|
| `SO001.P1.A` | P2 | DF | The runner drives the agent through an injected `AgentDriver` seam; this phase does **not** ship a production driver that wires the real full `AgentLoop` end-to-end. The Coding-pillar agent loop is constructible headlessly, but two of its dependencies (`ConversationManager` and the `logger`) import `vscode` and so cannot load in a plain-Node CLI -- the same coupling that forced the v1.6.0 A4 `TraceDbReader`. The dry path (no driver) and the mock-live path (test-injected driver) are fully exercised, and the env-gated live smoke proves the live path runs against a real Ollama backend via the vscode-free `OllamaClient`; only the full real-loop driver is deferred. Tier: runner + criteria + snapshot + dry/mock-live + live-backend smoke `supported`; full real-`AgentLoop` driver `future`. | When Phase 3's `SkillOptimizer` needs real rollouts (or sooner if the desktop sidecar's headless agent path is factored out), supply a vscode-free `AgentDriver` -- either by extracting a `ConversationLike` port + a headless logger, or by reusing the sidecar's existing Node agent-driving path behind the seam -- and add an integration test that runs one real task to completion. |
| `SO001.P1.B` | P3 | NI | No `nexus golden run` CLI subcommand was added this phase. The runner is fully consumable programmatically + from tests (the acceptance was unit + integration + live-smoke tests, not a CLI), and a CLI's value is gated on the production driver (`SO001.P1.A`). The A4 `nexus trace export` pattern (a thin `.mjs` that loads compiled `out/...` artifacts) is the template when it lands. Tier: programmatic runner `supported`; `nexus golden run` CLI `future`. | Once `SO001.P1.A` lands, add a `nexus golden run [--task <id>] [--mode dry|live]` subcommand to `bin/nexus.mjs` mirroring `runTraceExport`, loading the compiled `GoldenTaskRunner` + driver. |
| `SO001.P1.C` | P3 | MT | Command-based criteria (`output_contains`, `*_passes`, `diff_matches`) shell out via the default runner; the live corpus's shell targets use unix tools (`grep`, `node -e`) that are absent or differ on Windows, so on Windows those specific criteria fail rather than evaluating. This does not affect `file_contains`/`file_exists`/`file_deleted` (the bulk of the corpus) and the runner never throws on a missing binary (fail-closed to a recorded failure). Tier: file criteria + injected-runner command criteria cross-platform `supported`; native Windows shell-command criteria `candidate`. | If Windows-native live runs become a target, normalize the corpus's shell targets (or add a portable shim) so `grep`-style criteria resolve on cmd/PowerShell, or run live evaluation inside a bundled POSIX shell. |

---

## 2. Resolved

(Phase 1 SO001 is recorded in the Adoption Ledger above; resolved cross-phase items will move here as later phases close.)

---

## 3. Summary

- **Phases closed**: 1 of 6 (Phase 1 -- S1 TS-native golden-task live runner, SO001, 2026-06-29).
- **Open forward-tier follow-ups**: 3 (`SO001.P1.A` P2 deferred full-loop driver, `SO001.P1.B` P3 no CLI yet, `SO001.P1.C` P3 Windows-native shell criteria) -- all `candidate`/`future`, none defects, none release-blocking.
- **Defects / failing gates / suppressed checks**: 0. Phase 1 introduced no bug, test failure, coverage shortfall, suppressed lint, or bypassed quality gate (root suite 4354 passed / 6 skipped / 0 failed; new-module coverage 97.11% lines / 83.25% branches / 100% functions, above the 80/75/80 gate).
- **Demand-gated backlog (recorded by the plan, not this phase)**: S5 (background autonomous self-optimization routine, off by default) and opencode O-B/O-D/O-E -- see the plan's Out-of-Scope appendix; to be carried in the FINAL Phase 6 SO008 sweep.

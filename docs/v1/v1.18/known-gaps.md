# Known Gaps - v1.18.0 (Agent Harness Activation, Autonomy Governance, and Sandbox)

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-16

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.18.0-adoption-agent-harness-and-governance.md](plans/v1.18.0-adoption-agent-harness-and-governance.md)

Carry-forward source: [../v1.17/known-gaps.md](../v1.17/known-gaps.md) (reconcile in Phase 7, not this phase).

## v1.18.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 2 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Live llama-server round-trip is not proven here

- **Source phase**: Phase 1 - Skill-native adoptions + llama.cpp recipe (LG-A5)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 1.2)
- **Reason**: The recipe, example manifest, and `validateLocalAdapterManifest` tests are in-repo. A live `GET /v1/models` plus a Nexus chat against a user-started llama-server was not run on this host. Support tier for that path is `internal-compatible` (not_observed != absent). Same class as v1.16 LSO.P5.A (macOS MLX smoke).
- **Suggested next step**: On a machine with llama.cpp installed, start llama-server on `127.0.0.1`, register the example manifest, set `nexus.llm.backend` to `llamacpp`, and record the smoke. Do not bundle the runtime.

##### DF-2 - Hub catalog presence is not CI-gated

- **Source phase**: Phase 1 - Skill-native adoptions (OW-B1, OI-A4-web)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 1.1)
- **Reason**: CI does not ship `~/.nexus-ai/catalog/`. The Phase 1 test asserts the mapping note and that `modules/coding/skills/catalog/` has no duplicate `agent-presets` / `browser-testing-with-devtools` / `morning-briefing` entries. Live Hub files were confirmed on the operator machine during implementation, not in CI.
- **Suggested next step**: Keep the builtin-catalog negative check. An optional operator step is `nexus skills sync` then list those two skills under `~/.nexus-ai/catalog/skills/`. Do not vendor Hub skills into this repo.

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| (none yet) | | | |

v1.17 items stay in [../v1.17/known-gaps.md](../v1.17/known-gaps.md). This phase does not close motion, serving, or OCR carry-forwards.

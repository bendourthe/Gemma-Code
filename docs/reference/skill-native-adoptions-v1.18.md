# Skill-native adoptions (v1.18.0)

v1.18.0 Phase 1 (OW-B1, OI-A4-web): a written mapping, not a new Hub skill. Neither item needs a duplicate catalog entry in this repository. The scheduling mechanism for the morning brief landed in Phase 4 (OW-A2) as `AgentRunScheduler`; it still consumes this Hub preset for content. The native-app half of computer-use remains deferred ([OI-A4-native](../v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md#deferred-and-gated-items-tracked-not-built-this-cycle)).

This note exists so later phases do not rebuild what the Nexus-Hub catalog already provides. There is no new skill in the builtin catalog: do not add a second morning-brief or browser-QA skill. Verify each coverage against the synced Hub catalog (`nexus skills sync` into `~/.nexus-ai/catalog/`), not against a duplicate skill in `modules/coding/skills/catalog/`.

## OW-B1 -- morning-brief *content*

| | |
|---|---|
| **Source** | OpenWorker comparison, [Section 4a A2](../v1/v1.18/comparisons/v1.18.0-comparison-openworker.md) and [Section 7 Bucket 1](../v1/v1.18/comparisons/v1.18.0-comparison-openworker.md) |
| **Covered by** | Nexus-Hub skill `agent-presets`, preset `morning-briefing` |
| **What is covered** | Recurring start-of-day orientation *content*: resume last session, read the progress tracker, scan recent commits / session logs, emit a short brief with prioritized next actions. No code is written in this preset. |
| **What is not covered** | The *scheduling mechanism* that fires that content unattended. That is OW-A2, built in Phase 4 as [`AgentRunScheduler`](../../modules/coding/autonomy/AgentRunScheduler.ts) (off by default; no auto-approve). Do not vendor a second morning-brief skill. |
| **New skill / MCP / code this cycle** | None for content. Phase 4 added the scheduler mechanism only. |

Authored in v1.5.0 as a Hub catalog skill ([session history](../v1/v1.5/development/history/2026-06_phase-2-skill-native.md)); consumed here via `nexus skills sync`. Catalog id after namespacing: `nexus-hub/agent-presets`. Upstream: [Nexus-Hub](https://github.com/bendourthe/Nexus-Hub).

## OI-A4-web -- browser GUI QA

| | |
|---|---|
| **Source** | Open Interpreter comparison, [Section 4a A4](../v1/v1.18/comparisons/v1.18.1-comparison-openinterpreter.md) and [Section 7 Bucket 1](../v1/v1.18/comparisons/v1.18.1-comparison-openinterpreter.md) |
| **Covered by** | Nexus-Hub skill `browser-testing-with-devtools` |
| **What is covered** | The *browser* half of GUI QA: DevTools-driven network, console, DOM, performance, and accessibility checks as the QA driver. The agent already has browser tools; this skill is the method, not a new MCP. |
| **What is not covered** | The *native-app* half (OI-A4-native). That stays deferred: any future driver is an internal, opt-in, permission-tiered build. Bundling `trycua` is rejected (OI-N3). |
| **New skill / MCP / code this cycle** | None. Do not scaffold a second browser-QA skill. |

Catalog id after namespacing: `nexus-hub/browser-testing-with-devtools`. Upstream: [Nexus-Hub](https://github.com/bendourthe/Nexus-Hub).

## How to verify (no rebuild)

1. Confirm the Hub catalog lists `agent-presets` (with a `morning-briefing` preset) and `browser-testing-with-devtools`. After a sync, those files live under `~/.nexus-ai/catalog/skills/`.
2. Confirm this repository did **not** add matching entries under [`modules/coding/skills/catalog/`](../../modules/coding/skills/catalog/). Builtin skills stay the existing coding-engine set.
3. Invoke the coverage by naming the Hub skill or preset. Do not author a parallel skill.

The llama.cpp loopback adapter (LG-A5) is a documented recipe, not a skill: [llamacpp-loopback-adapter.md](./llamacpp-loopback-adapter.md).

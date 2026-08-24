# Known Gaps - v1.18.0 (Agent Harness Activation, Autonomy Governance, and Sandbox)

**Project**: Nexus AI Studio
**Status**: finalized
**Last updated**: 2026-08-20 (v2.1.0 follow-up; no retag)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.18.0-adoption-agent-harness-and-governance.md](plans/v1.18.0-adoption-agent-harness-and-governance.md)

Carry-forward source: [../v1.17/known-gaps.md](../v1.17/known-gaps.md) (reconciled in Phase 7; items stay in that file).

## v1.18.0

**Summary**: 10 open items after the v2.1.0 follow-up - 0 NI, 10 DF (DF-1,2,5,7,10..15), 0 MT - plus 8 resolved (EM.P1.A, EM.P5.A, OI-A3 shared transport, DF-9, and DF-3/4/6/8 in the follow-up). No suppressed warnings, no bypassed gates. Finalized at the v1.18.0 version bump; this file remains the canonical tracker.

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 10 | 8 |
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

##### DF-5 - Deeper scaffold knobs remain off `HarnessProfile` (EM.P1.C remainder)

- **Source phase**: Phase 2 - Named per-family harness profiles (OI-A2)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 2.2); v1.12 EM.P1.C
- **Reason**: Named family profiles (`concise-loop`, `plan-first`, `structured-edit`, `minimal`) now exist as data and drive the three existing `PromptContext` knobs. Tool-exposure verbosity and retry / step granularity are still described in `docs/reference/low-cost-model-optimization.md` and are not fields on `HarnessProfile` / `PromptContext`.
- **Suggested next step**: After a live weak-model A/B (EM.P1.B), extend `PromptContext` only if the A/B shows those knobs move quality. Do not add a fourth prompt style without a `PromptBuilder` change.

##### DF-7 - `gemma4:26b` MoE copy has no published active/total counts

- **Source phase**: Phase 3 - Catalog schema (LG-A3)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 3.1)
- **Reason**: The 26B entry describes MoE routing. No in-repo published active-parameter count was available, so `activeParams` / `totalParams` stay omitted (dense-schema default). MoE numbers are populated only on `deepseek-coder-v2:16b` (2.4B active / 16B total, already in that entry's copy).
- **Suggested next step**: When Google publishes a stable active-parameter figure for Gemma 4 26B, add both MoE fields together. Do not guess.

##### DF-10 - ACP is HTTP JSON-RPC on the shared listener, not a stdio subprocess

- **Source phase**: Phase 5 - ACP agent surface (OI-A3)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 5.1 / 5.2)
- **Reason**: The open ACP spec commonly uses stdio. This cycle mounts JSON-RPC 2.0 at `POST /acp` on the v1.16 serving `LoopbackHttpServer` so there is one loopback bind and one bearer token (`nexus.serving.token`). `session/update` notifications are returned on `session/prompt` as `updates[]`, and also flushed as SSE when the client sends `Accept: text/event-stream`.
- **Suggested next step**: If an editor requires stdio ACP, add a thin stdio bridge that forwards to `POST /acp` rather than a second agent engine. Do not vendor Open Interpreter.

##### DF-11 - Windows sandbox does not kernel-enforce filesystem or network

- **Source phase**: Phase 6 - OS process sandbox (OI-A1)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 6.4)
- **Reason**: Job objects plus a best-effort restricted token do confine process lifetime and resource caps. They do not implement a filesystem or network allow-list comparable to Seatbelt or Landlock. AppContainer was not applied (capability SIDs break typical coding CLIs). Mode on Windows is therefore `partial`, never `confined`. Writable-root and network-deny policy stay tool-layer (denylists, confirmation) on this OS. Matrix: `modules/coding/sandbox/windowsMatrix.ts`.
- **Suggested next step**: Revisit AppContainer or an equivalent FS/network restriction only if a coding-CLI-compatible capability set is proven. Do not report Windows as confined until filesystem and network are actually enforced.

##### DF-12 - Laguna-S-2.1 catalog entry stays gated (LG-A1)

- **Source phase**: Phase 7 - Known-gaps reconciliation (gated this cycle)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (Deferred and Gated Items)
- **Reason**: EM.P3 (`extremeLowBit.ts` fail-closed at `999.0.0`) and EM.P4 (`patientTier.ts` disabled) stay closed. Phase 3 prepared schema and UD-label recognition only. No Laguna catalog row, and no independent benchmark.
- **Suggested next step**: After those gates open and a benchmark exists, add the entry in a serving-oriented cycle. Do not guess quant or VRAM numbers.

##### DF-13 - 1M-context budget policy is not built (LG-A4)

- **Source phase**: Phase 7 - Known-gaps reconciliation (gated this cycle)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (Deferred and Gated Items)
- **Reason**: Depends on LG-A1. No context-window budget policy landed.
- **Suggested next step**: After LG-A1 ships, add a 1M-context budget policy in the same serving/catalog cycle. Do not add a dummy window size.

##### DF-14 - Native-app computer-use driver is not built (OI-A4-native)

- **Source phase**: Phase 7 - Known-gaps reconciliation (gated this cycle)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (Deferred and Gated Items)
- **Reason**: High effort, new local capability. Browser-half is skill-native (`browser-testing-with-devtools`). Native driver must be internal (no `trycua`), permission-tiered, and confirmation-gated.
- **Suggested next step**: A later cycle after the Hub browser-QA skill has proven the workflow. Do not vendor Open Interpreter or CUA runtimes.

##### DF-15 - Harness selector shipped default stays off (EM.P1.B)

- **Source phase**: Phase 2 - Live harness activation; recorded in Phase 7
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 2.1); v1.12 EM.P1.B
- **Reason**: `HARNESS_SELECTOR_SHIPPED_DEFAULT` remains `false`. No live weak-model A/B was run, so the no-degradation gate does not flip `nexus.coding.harnessSelector.enabled`.
- **Suggested next step**: Run `runHarnessAb` on a weak local model with the live driver; flip the default only on a measured net win.

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| EM.P1.A (v1.12) | Selector not wired into the live prompt path | Phase 2 | `buildPromptContext` spreads `overlayForModel` / session override when `settings.harnessSelectorEnabled` is on; off returns the base context by reference. `HARNESS_SELECTOR_SHIPPED_DEFAULT` stays false (EM.P1.B). Do not treat the v1.12 file as finalized. |
| EM.P5.A (v1.12) | No OS-level process sandbox for agent-run commands | Phase 6 | Abstraction + three backends shipped behind `nexus.coding.execSandbox` (off by default). **macOS**: `confined` when `/usr/bin/sandbox-exec` is present (Seatbelt FS+network). **Linux**: `confined` when Landlock is in the LSM list and python3 can apply the ctypes helper (FS+seccomp network deny). **Windows**: `partial` (job object + best-effort restricted token; filesystem and network NOT kernel-enforced). Off or missing backend is loud `unconfined`. Windows remainder is DF-11. EM.P3 / EM.P4 stay closed. |
| OI-A3 shared transport | Serving gateway and ACP share one loopback listener | Phase 5 | [`LoopbackHttpServer`](../../../desktop/sidecar/src/controlSurface/loopbackServer.ts) + [`contract.ts`](../../../desktop/sidecar/src/controlSurface/contract.ts). `ServingGateway` no longer owns `createServer`. HTTP JSON-RPC vs stdio remains DF-10. |
| DF-3 | Sidecar harness overlay | v2.1.0 follow-up | `HeadlessAgentSession` applies overlay only when `harnessSelectorEnabled` is true. Off remains the default prompt. |
| DF-4 | Coding badge reads selector off | v2.1.0 follow-up | Badge suffixes `(off)` while `harnessSelectorEnabled={false}`. |
| DF-6 | Installer `toolCallingVerified` chip | v2.1.0 follow-up | Chip renders only when the catalog flag is true. |
| DF-8 | `mcp.list` / `mcp.invoke` | v2.1.0 follow-up | List returns exposed registry tools. Invoke is fail-closed (no stdio harness). |
| DF-9 (OW-A1/OW-A2) | Unattended ACP confirmation fail-closes | Phase 4 | Ask inbox + scheduler landed. ACP parks when an inbox is configured; fail-closed remains the fallback when it is not. Approve replays `classifyAction` + `resolveTier`. Interactive 60s webview unchanged. |

### Phase 7 reconciliation

v1.17 motion items (DF-1, DF-3, DF-6, DF-8, DF-9, DF-10) stay in [../v1.17/known-gaps.md](../v1.17/known-gaps.md) (`asr-capture` closed there in the v2.1.0 follow-up). v1.16 serving/OCR items stay in [../v1.16/known-gaps.md](../v1.16/known-gaps.md).

Phase 4 (ask inbox + scheduler) landed on 2026-08-17 and closed DF-9. The v2.1.0 follow-up closed DF-3, DF-4, DF-6, and DF-8. Status remains **finalized** at the v1.18.0 version bump. Open DF items remaining: DF-1,2,5,7,10..15.

_Last updated: 2026-08-20 (v2.1.0 follow-up; no retag)._

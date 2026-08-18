# Known Gaps - v1.18.0 (Agent Harness Activation, Autonomy Governance, and Sandbox)

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-17

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.18.0-adoption-agent-harness-and-governance.md](plans/v1.18.0-adoption-agent-harness-and-governance.md)

Carry-forward source: [../v1.17/known-gaps.md](../v1.17/known-gaps.md) (reconciled in Phase 7; items stay in that file).

## v1.18.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 14 | 4 |
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

##### DF-3 - Desktop sidecar headless runner does not spread the harness overlay

- **Source phase**: Phase 2 - Live harness activation (OI-A5)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 2.1)
- **Reason**: EM.P1.A named the composition root as `ToolActivationContext.buildPromptContext` (VS Code / in-process coding engine). That path is wired and gated. The desktop sidecar uses `HeadlessAgentSession`, which builds a fixed system prompt and does not consume `PromptContext` / `HarnessSelector`. Support tier for sidecar overlay application is `not proven here`.
- **Suggested next step**: A later coding-sidecar phase can thread `applyHarnessOverlay` into `HeadlessAgentSession.buildSystemPrompt` behind the same setting, with a regression test that off remains byte-identical. Phase 3 did not take this (catalog/registry scope).

##### DF-4 - Desktop ModelSelector badge does not read `harnessSelectorEnabled`

- **Source phase**: Phase 2 - `/harness` inspect/switch surface
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 2.3)
- **Reason**: The coding page shows the auto-selected profile id as a small label. The desktop settings store has no `nexus.coding.harnessSelector.enabled` reader, so the badge is informational (catalog selection), not proof the overlay is applied. The VS Code `/harness` inspect line reports applied vs not-applied from the real setting.
- **Suggested next step**: When the sidecar grows a settings projection, hide the badge unless the selector is on, or suffix it with `off`.

##### DF-5 - Deeper scaffold knobs remain off `HarnessProfile` (EM.P1.C remainder)

- **Source phase**: Phase 2 - Named per-family harness profiles (OI-A2)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 2.2); v1.12 EM.P1.C
- **Reason**: Named family profiles (`concise-loop`, `plan-first`, `structured-edit`, `minimal`) now exist as data and drive the three existing `PromptContext` knobs. Tool-exposure verbosity and retry / step granularity are still described in `docs/reference/low-cost-model-optimization.md` and are not fields on `HarnessProfile` / `PromptContext`.
- **Suggested next step**: After a live weak-model A/B (EM.P1.B), extend `PromptContext` only if the A/B shows those knobs move quality. Do not add a fourth prompt style without a `PromptBuilder` change.

##### DF-6 - Installer catalog cards do not render `toolCallingVerified`

- **Source phase**: Phase 3 - Catalog + registry governance (OW-A4)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 3.2)
- **Reason**: The plan's consumption surface is `desktop/src/shared/chat/ModelSelector.tsx`. The PyQt installer `typed_catalog.py` still ignores the new optional JSON fields (valid extra keys). Support tier for installer badge: not implemented here.
- **Suggested next step**: If the installer picker should distinguish verified-for-tool-calling from merely-runs, add an Origin-style chip keyed to `toolCallingVerified` without requiring the field.

##### DF-7 - `gemma4:26b` MoE copy has no published active/total counts

- **Source phase**: Phase 3 - Catalog schema (LG-A3)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 3.1)
- **Reason**: The 26B entry describes MoE routing. No in-repo published active-parameter count was available, so `activeParams` / `totalParams` stay omitted (dense-schema default). MoE numbers are populated only on `deepseek-coder-v2:16b` (2.4B active / 16B total, already in that entry's copy).
- **Suggested next step**: When Google publishes a stable active-parameter figure for Gemma 4 26B, add both MoE fields together. Do not guess.

##### DF-8 - `mcp.list` / `mcp.invoke` remain unimplemented

- **Source phase**: Phase 3 - Per-tool MCP allow/deny (OW-A5)
- **Plan reference**: `docs/v1/v1.18/plans/v1.18.0-adoption-agent-harness-and-governance.md` (sub-task 3.4); v1.1.0 Phase 11 IPC
- **Reason**: Those methods are the VS Code extension MCP bridge (`core/coding/McpBridge.ts`). This phase added `mcp.registry.list` / `mcp.registry.setToolDenied` for Settings governance instead of hijacking the invoke catalog.
- **Suggested next step**: Phase 11 (or a later coding-IPC phase) can implement `mcp.list` / `mcp.invoke` over `McpManager` without loosening Hub policy. Filter listed tools through `resolveExposedMcpTools`.

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
| DF-9 (OW-A1/OW-A2) | Unattended ACP confirmation fail-closes | Phase 4 | Ask inbox + scheduler landed. ACP parks when an inbox is configured; fail-closed remains the fallback when it is not. Approve replays `classifyAction` + `resolveTier`. Interactive 60s webview unchanged. |

### Phase 7 reconciliation

v1.17 motion items (DF-1, DF-3, DF-5, DF-6, DF-8, DF-9, DF-10) stay in [../v1.17/known-gaps.md](../v1.17/known-gaps.md). v1.16 serving/OCR items stay in [../v1.16/known-gaps.md](../v1.16/known-gaps.md). This cycle does not close them.

Phase 4 (ask inbox + scheduler) landed on 2026-08-17 and closed DF-9. Status stays **in-progress** until `/update release` cuts the version. Open DF items remaining: DF-1..8, DF-10..15.

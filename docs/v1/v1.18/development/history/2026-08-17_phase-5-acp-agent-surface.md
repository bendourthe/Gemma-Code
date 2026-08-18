# Session History - v1.18.0 Phase 5: ACP Agent Surface

**Date**: 2026-08-17
**Version**: v1.18.0
**Plan**: [../../plans/v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
**Phase**: 5 of 7 - ACP Agent Surface (OI-A3)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 7 is terminal). Phase 4 remains incomplete.

## Goal

Expose the Nexus coding engine as an Agent Client Protocol agent over a loopback-only, locally-authenticated transport that is the same control-surface layer the v1.16 serving gateway uses. Native ACP. No Open Interpreter code. Every ACP tool call goes through `classifyAction` and the vscode-free permission-tier map.

## Pre-flight

`is_final_phase` = **false** (Phase 7 is Architecture Refactor, Known-Gaps Reconciliation, and CI/CD). Prior phases: Phase 1 complete, Phase 2 complete, Phase 3 complete (`12fe79f`). Phase 4 (ask inbox + scheduler) is **not** complete. Operator chose: implement Phase 5 now; unattended ACP confirmations fail-close until Phase 4; extract shared loopback/auth from the serving gateway.

Model routing: plan recommended Strong / high (claude-opus-4-8 high). Cursor is picker-only. This session stayed on Grok 4.6, which is same-or-stronger than Strong/high. Visible degrade: none. No silent downshift.

## 1. Starting State

- **Branch**: `develop`
- **Environment**: Windows 10, root Vitest suite + desktop shell tests
- **Plan reference**: [v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)

## 2. Chronological Steps

### 2.1 Shared loopback transport + local auth (5.1)

**Plan specification**: One control-surface layer for ACP now and the v1.16 gateway. Loopback-only, local bearer token, reuse contract documented in-module.

**What happened**: Extracted [`LoopbackHttpServer`](../../../../desktop/sidecar/src/controlSurface/loopbackServer.ts) from `ServingGateway`. [`contract.ts`](../../../../desktop/sidecar/src/controlSurface/contract.ts) locks mounts `serving` / `acp`, paths `/health` `/v1` `/acp`, loopback bind, bearer before protocol, health unauthenticated, listen if serving OR ACP, independent enable flags, token reuse `nexus.serving.token`. Serving handler returns false for non-`/v1` so ACP can mount.

**Verification**: `desktop/tests/controlSurface-contract.test.ts`; existing `serving-gateway.test.ts` still green.

### 2.2 Native ACP over the sidecar (5.2)

**Plan specification**: Implement ACP natively over the sidecar. Map onto the coding loop. Gating parity with the UI. Park unattended confirms in the Phase 4 inbox. No vendored agent binary.

**What happened**: [`AcpAgent`](../../../../desktop/sidecar/src/acp/AcpAgent.ts) JSON-RPC 2.0 at `POST /acp`. Methods: `initialize`, `authenticate` (empty after HTTP bearer), `session/new` (requires `cwd`), `session/prompt` (`HeadlessAgentSession` + `createHeadlessTools`), `session/cancel`. `# DEVIATION:` HTTP JSON-RPC on the shared listener, not stdio; `session/update` via `updates[]` and optional SSE. `# DEVIATION:` Phase 4 inbox missing, so [`AcpConfirmation.ts`](../../../../desktop/sidecar/src/acp/AcpConfirmation.ts) fail-closes rather than parking or waiting 60s on `ConfirmationGate`. BLOCKED actions never reach execute. Settings: `nexus.acp.enabled` / `NEXUS_ACP_ENABLED`. IPC `acp.status` / `acp.setEnabled`. Toggle lives on Settings > Local API server (no second token field).

**Verification**: `desktop/tests/acp-agent.test.ts`, `acp-gating.test.ts`, `servingRuntime.test.ts`, `sidecar-handlers.test.ts`, `ipcServingClient.test.ts`, `ServingSettings.test.tsx`.

### 2.3 Testing and stabilization (5.3)

**Plan specification**: Transport, protocol, gating, contract tests. `npm test` + lint. Update CI for new modules.

**What happened**: Full root suite with coverage. Desktop lint + typecheck + full shell coverage. CI not rewritten (`test-ts` unfiltered; `shell-build.yml` already watches `desktop/**`).

**Troubleshooting**:
- First root coverage run overlapped desktop coverage and failed two ENV tests (`HybridRetriever` p99 248ms vs 150ms; golden-runner 5s timeout). Isolated re-run and a second full root run passed. Same class as Phase 1 / 2 fixture/load flakes.
- `pretest` golden-task generator rewrites `tests/fixtures`; restored with `git checkout -- tests/fixtures`.
- Gating tests initially used JSON tool-call bodies; switched to Gemma `key:<|"|>value<|"|>` so `parseToolCalls` actually dispatches `write_file` / `run_terminal`.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm test -- --coverage` | PASS - 439 files / 4857 passed / 6 skipped / 0 failed |
| Line coverage | PASS - 87.81% lines / 84.2% branches / 91.27% functions (thresholds 80 / 75 / 80) |
| `npm run lint` | PASS - 0 errors (`eslint src modules`) |
| `npx tsc -b` | PASS |
| Desktop lint / typecheck | PASS |
| Desktop tests | PASS - 110 files / 956 passed / 0 failed; coverage 92.75% lines (ACP package 94.25%) |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Deviations

| Marker | What | Why |
|---|---|---|
| Phase 4 skip | Ask inbox + scheduler not built | Operator chose implement Phase 5 now with fail-closed unattended ACP |
| HTTP vs stdio | `POST /acp` JSON-RPC on `LoopbackHttpServer` | One bind + one token with the serving gateway; DF-10 |
| ConfirmationGate | Headless adapter, not the webview gate | Sidecar must stay vscode-free; same classifier + tier map |
| ACP Settings | Toggle added to Local API server, not a new tab | No existing ACP pane; token is already there |
| Cursor picker | Stayed on Grok 4.6 | Same-or-stronger than plan Strong/high; cannot script `/model` |

## 5. CI/CD

No workflow file edited. `ci.yml` already has concurrency cancel-in-progress, npm cache, and unfiltered `test-ts`. `shell-build.yml` already path-filters `desktop/**` and gates macOS/Windows to push-to-main. Proposed (not applied): add desktop Vitest to `ci.yml` so ACP tests run even when a change is outside the shell-build path filter.

## 6. Known gaps appended

- **DF-9**: unattended ACP fail-closes because Phase 4 inbox is not landed
- **DF-10**: ACP is HTTP JSON-RPC on the shared listener, not stdio

EM.P3 / EM.P4 stay closed.

## 7. Next steps

1. `/implement phase 6` (OS process sandbox; independent of Phase 4/5 per the plan).
2. `/implement phase 4` when ready to park unattended confirms instead of refusing them.
3. Optional stdio ACP bridge that forwards to `POST /acp` (DF-10) if an editor requires it.

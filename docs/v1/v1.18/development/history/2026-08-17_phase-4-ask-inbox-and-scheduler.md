# Session History - v1.18.0 Phase 4: Ask Inbox and Scheduler

**Date**: 2026-08-17
**Version**: v1.18.0
**Plan**: [../../plans/v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
**Phase**: 4 of 7 - Unattended Autonomy (OW-A1, OW-A2)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 7 is terminal and already landed). DF-9 closed.

## Goal

Make headless and recurring agent runs safe: park approval requests in a persistent inbox instead of dying on the 60s `ConfirmationGate` timeout, and enqueue scheduled runs that re-enter the full permission stack on every wake. No auto-approve. Interactive VS Code confirmation stays the 60s webview.

## Pre-flight

`is_final_phase` = **false**. Phases 1-3 and 5-7 already landed this cycle; Phase 4 was skipped by operator choice and is implemented now.

Model routing: plan recommended Mid-strong / high (claude-sonnet-5 high). Cursor is picker-only. This session stayed on Grok 4.6, which is same-or-stronger than Mid-strong/high. Visible degrade: none. No silent downshift.

## 1. Starting State

- **Branch**: `develop` (ahead of `origin/develop`; no push unless asked)
- **Environment**: Windows 10, root Vitest suite + desktop shell tests
- **Plan reference**: [v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)

## 2. Chronological Steps

### 2.1 Persistent approval queue + gate integration (4.1)

**Plan specification**: Headless/scheduled confirmation parks with classified action, tier, tool, args, and run identity. Approve replays gate + floor-clamp. Expiry and missing waiter fail safe. Interactive unchanged.

**What happened**: New vscode-free [`modules/coding/autonomy/`](../../../../modules/coding/autonomy/). [`AskInbox`](../../../../modules/coding/autonomy/AskInbox.ts) with memory or JSON store (`~/.nexus/ask-inbox.json`). `parkAndWait` registers the waiter **before** persist so an approve-before-waiter race fail-safes. [`replayAsk.ts`](../../../../modules/coding/autonomy/replayAsk.ts) re-runs `classifyAction` + `resolveTier`; BLOCKED at approval time fails safe; AUTO_APPROVE override on CONFIRM is clamped. [`ConfirmationGate`](../../../../src/tools/ConfirmationGate.ts) optional `ConfirmationParkContext`: unattended parks; interactive 60s webview unchanged. ACP [`AcpConfirmation.ts`](../../../../desktop/sidecar/src/acp/AcpConfirmation.ts) parks when an inbox is passed; no inbox still fail-closes (`ACP_FAIL_CLOSED_REASON`). [`AcpAgent.ts`](../../../../desktop/sidecar/src/acp/AcpAgent.ts) wraps confirm with `sessionId` / `runId` `acp:<sessionId>`. Production sidecar constructs a shared `AskInbox` file store.

**Verification**: `tests/unit/autonomy/AskInbox.test.ts`, `replayAsk.test.ts`, `tests/unit/tools/ConfirmationGate.test.ts` (unattended park uses real timers), `desktop/tests/acp-gating.test.ts` (fail-closed without inbox; park + deny; park + approve writes a file).

### 2.2 Desktop ask-inbox panel (4.2)

**Plan specification**: List parked asks with action, tier, run, age; approve/deny; history; pending-count chrome.

**What happened**: Route `/inbox` [`AskInboxPanel`](../../../../desktop/src/pages/inbox/AskInboxPanel.tsx). Sidebar Admin **Ask inbox** (`nav-admin-inbox`) with pending badge via `useAskInboxPendingCount`. Dashboard bell navigates to `/inbox` (`data-pending-count`). IPC: `ask.inbox.list|approve|deny|pendingCount`. Clients: `ipcAskInboxClient.ts`, `mockAskInboxClient.ts` (clones parked DTOs so deny-after-approve tests do not share one object). Missing inbox throws `Ask inbox is not configured` (not `NotImplementedError`). New methods added to the sidecar-handlers implemented-exclude list.

**Verification**: `desktop/tests/AskInboxPanel.test.tsx`, `ask-inbox-handlers.test.ts`, Sidebar/Dashboard tests.

### 2.3 Local agent-run scheduler (4.3)

**Plan specification**: Local cron-style; every wake re-enters PermissionTiers / ConfirmationGate; GitSafetyNet checkpoint; morning-brief content from Hub `agent-presets` / `morning-briefing`; no auto-approve.

**What happened**: [`AgentRunScheduler`](../../../../modules/coding/autonomy/AgentRunScheduler.ts) (`daily` or `interval`). Built-in morning-brief **off by default**. `createScheduledRun({ autoApprove: true })` throws `NO_AUTO_APPROVE`. Every fire: [`gitCheckpoint.ts`](../../../../modules/coding/autonomy/gitCheckpoint.ts) (vscode-free copy of `GitSafetyNet.createCheckpoint`), then parking confirm. Persist `~/.nexus/agent-schedules.json`. [`morningBrief.ts`](../../../../modules/coding/autonomy/morningBrief.ts) is a fallback prompt string; content stays Hub skill-native. Sidecar `scheduler.start()` and `stop()` on shutdown. IPC `ask.scheduler.list|setEnabled`. Panel can toggle the morning-brief schedule.

**Verification**: `tests/unit/autonomy/AgentRunScheduler.test.ts` (5 tests, including persist/reload enabled and interval `tick`), `noAutoApprove.test.ts`, `gitCheckpoint.test.ts`.

### 2.4 Testing and stabilization (4.4)

**Plan specification**: Park, replay, expiry, scheduler, no-auto-approve, panel. Lint + full suites. CI for queue/scheduler/panel paths.

**What happened**: Full root suite with coverage and full desktop suite. No new workflow file: `ci.yml` `test-ts` is unfiltered; `shell-build.yml` already watches `desktop/**` and `modules/**`. `pretest` rewrote `tests/fixtures` timings; restored with `git checkout -- tests/fixtures`. `.gitignore` already covers `coverage/` and `.nexus/` (inbox/schedule JSON live under `~/.nexus/`).

**Troubleshooting**:
- `parkAndWait` waiter-before-persist race (approve could land before the waiter existed).
- Expiry test raced `waitForDecision` vs `now` bump.
- `headlessGuards` spy needed the 4th `args` param.
- AskInboxPanel tests must clone parked DTOs (shared `PENDING` object caused deny-after-approve flake).
- `useAskInboxPendingCount` import path; captured `client` for TS18048.
- `index.ts` wrongly re-exported `createScheduledRun` from `noAutoApprove.js` (fixed).
- PowerShell: `&&` is invalid; use `; if ($LASTEXITCODE ...)`.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm test -- --coverage` | PASS - 459 files / 4926 passed / 11 skipped / 0 failed |
| Line coverage | PASS - 87.61% lines / 84.09% branches / 91.14% functions (thresholds 80 / 75 / 80) |
| `npm run lint` | PASS - 0 errors (`eslint src modules`) |
| `npx tsc -b` | PASS |
| Desktop lint / typecheck | PASS |
| Desktop tests | PASS - 112 files / 967 passed / 0 failed |
| Scheduler extra tests | PASS - 5/5 after persist/tick cases |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Deviations

| Marker | What | Why |
|---|---|---|
| Implemented after Phases 5-7 | Plan order was 4 then 5 | Operator skipped Phase 4 earlier; ACP fail-closed until this park path |
| vscode-free checkpoint | `gitCheckpoint.ts` copy, not `GitSafetyNet` import | `GitSafetyNet` pulls vscode logger; sidecar must stay vscode-free |
| Sidecar confirm | `AcpConfirmation` + `createParkingConfirm`, not `ConfirmationGate` webview | Same classifier + tier map; webview is VS Code only |
| Morning brief default | Schedule exists, **enabled: false** | Do not fire unattended work until the user opts in |
| Cursor picker | Stayed on Grok 4.6 | Same-or-stronger than plan Mid-strong/high; cannot script `/model` |

## 5. CI/CD

No workflow file edited. `ci.yml` already has concurrency cancel-in-progress, npm cache, and unfiltered `test-ts`. `shell-build.yml` already path-filters `desktop/**`. Root tests cover `modules/coding/autonomy/` on every PR.

## 6. Known gaps appended

- **DF-9**: **resolved**. Ask inbox + scheduler landed. Fail-closed remains the fallback when no inbox is configured (intentional, not a new DF).
- **DF-10**: unchanged (HTTP JSON-RPC vs stdio).

EM.P3 / EM.P4 stay closed.

## 7. Next steps

1. `/update release` (all 7 plan phases landed).
2. Optional stdio ACP bridge that forwards to `POST /acp` (DF-10) if an editor requires it.

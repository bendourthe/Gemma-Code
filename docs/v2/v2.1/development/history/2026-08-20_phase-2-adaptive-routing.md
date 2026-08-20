# Session History - v2.1.0 Phase 2: Adaptive Model Routing (Switchyard-derived)

**Date**: 2026-08-20
**Version**: v2.1.0
**Plan**: [../../plans/v2.1.0-adoption-open-local-ai-wave.md](../../plans/v2.1.0-adoption-open-local-ai-wave.md)
**Phase**: 2 of 7 - Adaptive Model Routing
**Outcome**: Complete. Cheap-first worker routing, GPU swap deferral, and a Traces routing lane. Ollama weight prefetch and VS Code AgentLoop remain deferred.

## Goal

Reverse-engineer NeMo Switchyard's tuning-free routing heuristics into a local router: per-turn worker-to-strong escalation from tool-activity signals, cheap-first session policy, session affinity, and hysteretic anti-thrash scheduling on a single GPU.

## Pre-flight

`is_final_phase` = **false**. Model routing: plan recommended frontier / high. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-7 with local commits after 1-6, then Phase 7 commit and push.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `d467e888` (Phase 1 catalog + harness + eval)
- **Package version**: 2.0.0 (bump waits for `/update release`)

## 2. Chronological Steps

### 2.1 Routing signals (2.1)

Pure functions over `RoutingTurnEvent[]`. Consecutive tool errors, identical tool+args (`hashToolCall` strips `id` / `_callId`), progress-free worker steps. Missing, stale, or other-session events are skipped (neutral). Does not import AgentLoop.

**Key files**: `modules/coding/orchestration/routing/RoutingSignals.ts`

### 2.2 Escalation policy (2.2)

Planner/critic pin to strong. Workers start on catalog `role: worker-candidate`. Thresholds: 3 tool errors, 2 identical repeats, 8 progress-free steps. Session pin after two turn-escalations. Cooldown wins vs escalate. Strong missing stays on worker with a notice. Malformed config loads compiled defaults. `decide()` does not commit; caller `acknowledge()` or `applySwapGate()` then `commit()`. Telemetry kind `routing.decision`.

**Key files**: `modules/coding/orchestration/routing/EscalationPolicy.ts`, `routeTurn.ts`, `DAGExecutor.ts`, `Orchestrator.ts`

### 2.3 GPU swap cost (2.3)

`evaluateModelSwap`: both fit keep worker; else honor and evict; diffusion occupying and insufficient free VRAM defers; null/non-finite VRAM defers. `GpuScheduler.evaluateRoutingSwap` batches same-session requests (50 ms). Telemetry kind `scheduler.swap`. No Ollama load/unload (DF-4).

**Key files**: `core/scheduler/modelSwap.ts`, `core/scheduler/GpuScheduler.ts`

### 2.4 Routing observability (2.4)

`RoutingLane` on the Traces dashboard. Empty when no decisions. Uninstalled models show the id plus a note. Placeholder traces gained a `routing.decision` payload so a replayed fixture renders a routing story. Live sidecar still has no TraceStore (v1.16 LSO.P2.A).

**Key files**: `desktop/src/modules/coding/panels/RoutingLane.tsx`, `TraceDashboardPanel.tsx`, `desktop/sidecar/src/coding/panelData.ts`

### 2.5 Tests and CI (2.5)

Signal units, policy matrix, soak swap-budget, DAG integration with induced errors, scheduler VRAM scenarios, RoutingLane component tests. No new CI job: `ci.yml` `test-ts` already runs root + desktop Vitest. Concurrency cancel-in-progress and npm cache already present. No CI rewrite.

## 3. Verification Gate

| Check | Result |
|---|---|
| Root routing + DAG + modelSwap | PASS 25 tests / 5 files |
| Desktop RoutingLane / TraceDashboard / panelData | PASS |
| `tsc -b` | PASS after `hashToolCall` record narrowing |
| ESLint on changed coding modules | PASS |

## 4. Deviations

- `routeTurn` without a scheduler honors the swap (`no-scheduler`). Passing Infinity VRAM would defer because `finiteGb` rejects non-finite values.
- Planner/critic pin uses Orchestrator `modelName`, not a separate `routeTurn` call.
- Swap cost is advisory; Ollama weights are not prefetched or unloaded (DF-4).
- AgentLoop is not on the routing path (DF-5).

## 5. Known gaps appended

DF-4, DF-5. DF-1 and DF-2 remain open from Phase 1.

## 6. Next

Phase 3 Image Studio provenance + persistent generation queue. Local commit only.

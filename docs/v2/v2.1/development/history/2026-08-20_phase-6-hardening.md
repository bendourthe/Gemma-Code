# Session History - v2.1.0 Phase 6: Hardening + Depth Backlog

**Date**: 2026-08-20
**Version**: v2.1.0
**Plan**: [../../plans/v2.1.0-adoption-open-local-ai-wave.md](../../plans/v2.1.0-adoption-open-local-ai-wave.md)
**Phase**: 6 of 7 - Hardening + Depth Backlog
**Outcome**: Complete. Signed local audit log, JSON CLI over `/nexus/*`, and diffusion VRAM knobs shipped. Live GPU streaming rescue, Video Lab knobs, and AgentLoop `tool.call` remain deferred.

## Goal

Governance and agent-surface hardening: append-only signed audit log with per-actor identity, headless JSON CLI over the sidecar bearer token, explicit diffusion VRAM/RAM budget knobs.

## Pre-flight

`is_final_phase` = **false**. Model routing: plan recommended strong / medium. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-7 with local commits after 1-6, then Phase 7 commit and push.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `1797afb` (Phase 5 local fine-tuning)
- **Package version**: 2.0.0 (bump waits for `/update release`)

## 2. Chronological Steps

### 2.1 Signed audit log (6.1)

[`core/audit/`](../../../../core/audit/) is vscode-free SQLite at `~/.nexus/audit/audit.db`. Events sign with per-actor Ed25519 (`app` / `planner` / `critic` / `worker`). Keys prefer the OS keychain via `VaultActorKeyStore`; vault write failures stay in process memory (never plaintext files). `redactSecrets` runs before persist. Burst writes increment `droppedCount` instead of blocking. Tampered rows list as `trusted: false`. Sidecar attaches the shared `InProcessTelemetryBus`. Viewer: Settings > Security.

### 2.2 JSON CLI (6.2)

Sibling mount `/nexus/*` on the existing loopback control surface (not `/v1`, which 404s unknown OpenAI paths). Commands: `nexus session new/send/list`, `models list`, `generate queue/status`. Token reuse: `--token` / `NEXUS_SERVING_TOKEN` / `nexus.serving.token`. Schema failures exit 2 with no network. Sidecar session lock serializes concurrent `sendMessage`. Docs: [`json-cli.md`](../json-cli.md).

### 2.3 Diffusion VRAM knobs (6.3)

[`core/config/diffusionBudget.ts`](../../../../core/config/diffusionBudget.ts) derives defaults from DiffusionTier. Validation rejects a VRAM cap below the model minimum unless layer streaming is on. Python `choose_offload(..., layer_streaming=True)` upgrades `insufficient_vram` to sequential CPU offload. Image Studio Advanced surfaces the knobs. Video Lab does not (DF-19).

### 2.4 Tests and CI (6.4)

Root `core/audit`, `core/cli`, `core/config/diffusionBudget` units green (scoped coverage 97% lines). Desktop audit IPC, JSON CLI routes, session lock, Security/Image/Serving settings green (72 tests). Python diffusion budget + streaming rescue 33 passed. `tsc -b` clean. Skill catalog count updated for `training-recipe` (18 built-in). No new CI workflow: existing `test-ts`, desktop vitest (Node 22), and `test-python-runtimes` already cover the paths. Path filters / concurrency / npm cache already present; no silent rewrite.

## 3. Verification Gate

| Check | Result |
|---|---|
| Root audit / jsonCli / diffusionBudget units | PASS (97% lines on new files) |
| Desktop Phase 6 vitest (8 files) | PASS 72 |
| Python diffusion budget + pipelines | PASS 33 |
| `tsc -b` | PASS |
| Root vitest (post skill-count fix) | 501 files pass; 1 prior skill-count failure fixed |
| Live GPU streaming OOM rescue | not_run (DF-21) |

## 4. Deviations

- JSON CLI requires Local API or ACP so the listener is up (DF-18).
- Video Lab UI omits VRAM knobs (DF-19).
- Vault unavailable keeps keys in memory (DF-20).
- Live GPU streaming not proven (DF-21).
- AgentLoop does not emit `tool.call` (DF-22). Generation and training audit as GpuScheduler `job.*`.

## 5. Known gaps appended

DF-18 through DF-22. DF-1, DF-2, DF-4 through DF-17 remain open. DF-3 remains resolved.

## 6. Next

Phase 7 architecture refactor, known-gaps reconciliation, CI/CD. Then commit and push.

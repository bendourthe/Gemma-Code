# Session History - v2.1.0 Phase 5: Local Fine-Tuning Pillar (Unsloth Core)

**Date**: 2026-08-20
**Version**: v2.1.0
**Plan**: [../../plans/v2.1.0-adoption-open-local-ai-wave.md](../../plans/v2.1.0-adoption-open-local-ai-wave.md)
**Phase**: 5 of 7 - Local Fine-Tuning Pillar (Unsloth Core)
**Outcome**: Complete. License gate proceeded (no required AGPL). Installer and Settings can provision Apache `unsloth` plus LGPL `unsloth-zoo`. Dataset builder redacts secrets. QLoRA jobs run through GpuScheduler with stub training in CI. Live GPU train, PDF extract, default installer chain, GoldenTaskRunner, and Ollama import remain deferred.

## Goal

License-gated local fine-tuning: Unsloth Core as a managed runtime, Nexus-owned dataset builder and QLoRA orchestration, eval quarantine, GGUF export.

## Pre-flight

`is_final_phase` = **false**. Model routing: plan recommended frontier / max. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-7 with local commits after 1-6, then Phase 7 commit and push.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `c831a543` (Phase 4 multimodal chat + SAM2)
- **Package version**: 2.0.0 (bump waits for `/update release`)

## 2. Chronological Steps

### 2.1 License gate (5.1)

PyPI `unsloth` 2026.8.18 is Apache-2.0. `unsloth-zoo` 2026.8.13 is LGPL-3.0-or-later (required import, not AGPL). `unsloth[studio]` and `unsloth_cli` are AGPL and excluded. STOP did not fire. Pins: [`core/tuning/unsloth-pins.json`](../../../../core/tuning/unsloth-pins.json). Record: [`unsloth-license-boundary.md`](../unsloth-license-boundary.md).

### 2.2 Installer + Settings provision (5.2)

[`UnslothVenvProvisioner`](../../../../scripts/installer/src/nexus_installer/engine/unsloth_venv_provisioner.py) is opt-in, not on `chain_for`. Hardware gate: NVIDIA any OS, AMD Linux, 16 GB min. [`TuningProvisioner`](../../../../core/tuning/provisioner.ts) is the Settings twin (`uv venv` then pinned `uv pip install`). AGPL extras refused.

### 2.3 Dataset builder (5.3)

[`buildDataset`](../../../../core/tuning/datasetBuilder.ts) reads JSONL/JSON/CSV/txt/md from local paths. Every record passes `redactSecrets`. Oversized and unreadable files skip. PDFs skip (DF-14). Output: `~/.nexus/tuning/datasets/<id>/train.jsonl`.

### 2.4 QLoRA orchestration (5.4)

[`TuningJobStore`](../../../../core/tuning/jobStore.ts) mirrors the generation queue (running -> interrupted -> queued, stable ids). [`runTuningJob`](../../../../core/tuning/orchestrator.ts) trains, scores via injected `EvalPort`, quarantines on regression, keeps artifacts on export failure. Sidecar IPC `tuning.*` enqueues `moduleId: "tuning"` on GpuScheduler. CI trainer is `stubTrainer` / `train.py --stub`.

### 2.5 Tests and CI (5.5)

Root `core/tuning` units, desktop Fine-tuning settings + IPC, installer provisioner pytest, Python `tests/python/tuning`. Live GPU job is `workflow_dispatch` only ([`.github/workflows/tuning-live.yml`](../../../../.github/workflows/tuning-live.yml)). Gates: [`ci-hardware-gates.md`](../../ci-hardware-gates.md).

## 3. Verification Gate

| Check | Result |
|---|---|
| Root `core/tuning` + GpuScheduler + modelSwap | PASS |
| Desktop FineTuningSettings + tuning IPC + sidecar-handlers | PASS |
| Python `tests/python/tuning` | PASS 2 |
| Installer `test_unsloth_venv_provisioner` | PASS |
| `tsc -b` | PASS |
| Live Unsloth train | not_run (DF-13) |

## 4. Deviations

- Required zoo is LGPL (DF-12).
- Live GPU train not run (DF-13).
- PDF skip (DF-14).
- Not on default installer chain (DF-15).
- EvalPort stub, not GoldenTaskRunner (DF-16).
- Ollama import not default (DF-17).

## 5. Known gaps appended

DF-12 through DF-17. DF-1, DF-2, DF-4 through DF-11 remain open.

## 6. Next

Phase 6 hardening (signed audit log, JSON CLI, diffusion VRAM knobs). Local commit only.

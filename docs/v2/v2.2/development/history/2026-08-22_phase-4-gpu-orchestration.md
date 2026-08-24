# Session History - Phase 4: Smart Single-GPU Model Orchestration

**Date**: 2026-08-22
**Plan**: [v2.2.0-runtime-repair-and-ux-overhaul.md](../../plans/v2.2.0-runtime-repair-and-ux-overhaul.md) - Phase 4 of 8
**Outcome**: All 4 sub-tasks implemented; all gates green. Integration is partial by scope (DF-9, DF-10, DF-11).

## Context

This phase answers the question the user raised directly: on a single GPU, what happens when you click Image Studio while an agentic task is running? The answer must not be "silently evict the model they were using", and it must not be "ask every single time" either.

## Sub-tasks

### 4.1 Policy engine

`core/scheduler/ModelSwitchPolicy.ts`, pure and dependency-free, mirroring the style of `modelSwap.ts` beside it. Verdicts: `resident`, `coreside`, `auto-switch`, `confirm`, `defer`, `not-installed`.

Decisions worth recording:

- **Co-residency needs 2 GB headroom** on top of both models. Fitting them to the byte leaves nothing for activations and KV cache, so a "successful" co-residency would OOM mid-generation.
- **`resident` is checked before everything else.** If the requested model is already loaded, a busy GPU is not a reason to interrupt: nothing is being evicted.
- **`rememberKey` includes the target model**, so consenting to "coding -> image with sana-1.6b-2k" does not silently consent to evicting something else later.
- **Confirm-time re-classification** (`reclassifyOnConfirm`): the job that triggered a dialog may finish while the dialog is open, so the answer is applied to a freshly-computed verdict rather than the stale one.
- **`assertNoLoadOnNavigation`** plus `tests/no-load-on-navigation.test.tsx` (render-mount plus a static source audit) pin the navigation invariant against a future "helpful" preload-on-mount.

### 4.2 Cross-model requests

`core/scheduler/CrossModelRequest.ts`: hold the agentic model, classify, run through the scheduler, release in a `finally`. The restore is unconditional because the failure that matters is ending a task with the wrong model resident, which silently degrades every later step. `ModelNotInstalledError` is thrown before any hold or queue entry.

### 4.3 Switch UX

`useModelResidency` (residency, in-flight switch, session-scoped remember set held in a ref so consent applies to the very next classification) plus `ModelSwitchDialog` and `ModelSwitchChip`. The remember set is deliberately NOT persisted: a choice made once should not silently govern every future launch. `ImageStudioPage.handleSubmit` is wired end to end, including resuming the original prompt after the user agrees.

## The design flaw the tests caught

The first version returned `confirm` whenever free VRAM was unknown. That broke 9 existing Image Studio tests, and the reason mattered: in the shipped app, with telemetry not yet feeding the studios, EVERY generation would have been gated behind a dialog. The confirm exists to protect an incumbent model; with nothing resident there is nothing to protect. The policy now takes the no-incumbent path directly, and the scheduler's own VRAM gate remains the backstop. Three regression tests pin it.

## Gates

| Gate | Result |
|---|---|
| Root vitest | 5373 passed / 12 skipped / 0 failed |
| Desktop vitest | 1191 passed / 0 failed (144 files) |
| Desktop coverage | 89.5% lines / 82.53% branches (gate: 80%) |
| tsc -b / eslint | clean (`core/**` is outside the repo's `eslint src modules` scope by existing convention) |
| Installer pytest | not re-run: no installer file was touched this phase |

New tests: 28 policy matrix cases, 9 cross-model cases, 16 residency/dialog cases, 5 navigation-invariant cases.

## What is NOT done

Recorded as DF-9, DF-10, DF-11:

- Only Image Studio's submit consults the policy; Video Lab, chat, and coding do not.
- Nothing supplies live residency, free VRAM, or the scheduler's active job, so in the running app the policy always sees "nothing loaded". The matrix is correct but not yet driven by real inputs.
- The cross-model orchestrator is not called by the agent's image/video tools.

The stability gate's manual scenarios therefore cannot be walked end to end yet. Closing DF-10 (a `scheduler.snapshot` IPC feeding `App.tsx`) is the single highest-value follow-up, and it also closes DF-5 from Phase 2.

## Next steps

Phase 5 - Local Chatbot Rebuild.

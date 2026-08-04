# Session History - v1.15.0 Phase 4: Real model registry (IPC + disk/Ollama reconciliation)

**Date**: 2026-07-31
**Plan**: [../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)
**Phase**: 4 of 8 - "Real Model Registry: IPC + disk/Ollama reconciliation (Issue 3)"
**Outcome**: Complete (full scope, including in-app streaming install, per the user's "Full Phase 4 in one pass" choice). Quality gate GO (desktop suite 566 pass / 0 fail; ruff + eslint clean; tsc clean; coverage 92.23% lines / 84.69% branch, above the 80/70 gate).

## Goal

Fix Issue 3 ("the app shows only 1 model, where are the others?"). The Settings > Models page was hard-wired to a mock client, `models.list` was a `NotImplementedError` stub, and the installer's on-disk weights + Ollama store were never enumerated. Make the page reflect and manage the REAL installed set, and produce the installed-models feed the Phase 5-6 studio selectors consume.

## What was done

### Reconciliation core (pure)
- `core/registry/installedProbe.ts`: `markInstalledFromProbe` flips a catalog-only entry to installed when a probe proves it is present in Ollama's store (matched by `ollamaTagForSpec`) or in the installer's `~/.nexus/models/weights/<id>/` tree. Pure; the I/O lives in the sidecar.

### Sidecar service + install manager
- `desktop/sidecar/src/models/modelsService.ts`: `ModelsService` composes `NexusModelRegistry.list()` with the two probes (`queryOllamaTags` via `/api/tags`, `scanWeightsIds`) so `list()` returns reconciled `ListedModelDto`s; `remove` + `diskUsage` are pass-throughs. `createModelsRuntime()` is the composition root (registry + Ollama pull client + catalog).
- `desktop/sidecar/src/models/installManager.ts`: `InstallManager` (start/drain/cancel) mirrors the diffusion job/drain pattern so a multi-minute download never blocks the IPC channel; `HttpOllamaPullClient` streams `/api/pull` NDJSON progress.

### Protocol + handlers
- `protocol.ts`: repointed `models.list` -> `ListedModelDto` (was the chat-picker `ModelDropdownEntry`) + `models.install` -> job-accepted; added `models.remove`, `models.diskUsage`, `models.install.drainEvents`, `models.install.cancel` with schemas.
- `handlers.ts`: implemented the six `models.*` handlers backed by a lazily-built (test-injectable) `ModelsRuntime` on `HandlerContext`.

### Frontend
- `desktop/src/pages/settings/ipcModelsClient.ts`: real `createIpcModelsClient` (list/remove/diskUsage + a polling install that maps drain events to `onProgress`/`done`/`cancel`).
- `App.tsx`: renders the real `modelsClient` (mock retired to tests/stories).
- `desktop/src/shared/models/installedFeed.ts`: `installedModelsForType` + `SETTINGS_MODELS_PATH` for the Phase 5-6 studio selectors.

## Test results

- Full desktop suite: 73 files / 566 tests, 0 failures. New: `installedProbe` (4), `modelsService` (6), `installManager` (3), `ipcModelsClient` (5), `installedFeed` (3), plus a `sidecar-handlers` models-routing test and the allowlist update.
- ruff + eslint clean; `tsc --noEmit` clean. Coverage 92.23% lines / 84.69% branch (gate 80/70). `installedFeed` 100%; `modelsService` 73.55% -- the uncovered lines are the `createModelsRuntime` composition root + the `statfs` branch (integration-only, tracked as IRSC.P4.A).

## CI/CD

- `shell-build.yml`: added `core/**` to the trigger paths, since the desktop suite now depends on `core/registry` (the reconciliation core) -- so a core-registry change re-runs the desktop build/test job.

## Deviations / known gaps

- IRSC.P4.A (MT): composition root integration-only.
- IRSC.P4.B (BG): in-app install works for Ollama models; an HTTP/diffusers model with an all-zero placeholder `sha256` fails verification in the core `Downloader` (the installer's HF puller tolerates placeholders; the core one does not). Rotate pins or relax the Downloader before relying on in-app HF install.
- IRSC.P4.C (DF): packaged-sidecar catalog resolution needs the packaging build to stage `catalog.json` (or set `NEXUS_CATALOG_PATH`); dev/tests resolve it fine.
- Resolves the long-tracked gap 5.P1.BB (sidecar `models.*` IPC) -- to be reconciled in the historical gap file during the final phase.

## Next steps

- Phase 5: Image Studio chat redesign (Issue 5) - consumes `installedModelsForType(models, "image")` + `SETTINGS_MODELS_PATH` from this phase.

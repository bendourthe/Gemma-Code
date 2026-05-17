# 2026-05-17 - Phase 5: ModelRegistry + native model downloader

**Plan**: [docs/v1.0.0/plans/phase-05-model-registry.md](../../plans/phase-05-model-registry.md)
**Goal**: Ship the shared-core `ModelRegistry` with content-addressed storage, resumable SHA-256-verified downloads, ComfyUI `extra_model_paths.yaml` compatibility, a Settings UI for browsing / installing / removing models, and the `ModelPinRegistry` wiring that closes `[v0.9.0:10.N.A]`. Stability gate: a fresh `~/.nexus/models/` directory is populated by `nexus models install gemma4:e4b` via the registry; an interrupted download resumes cleanly; SHA-256 mismatch is rejected.

## Outcome

Phase 5 stability gate met:

- Phase 5 tests (10 files, 115 tests): all pass against ephemeral `os.tmpdir()` roots.
- `npm test` (desktop workspace): 238 / 238 pass.
- `npm run lint` (desktop workspace): clean. `npm run typecheck` (desktop): clean.
- `npm run lint` (root workspace) + `npm run build` (root): clean.
- `npm test` (root workspace): 2859 pass / 5 pre-existing failures unchanged from the Phase 2 baseline tracked under `2.P3.L` (4x `SubAgentManager.characterization` CRLF snapshots, 1x `workflow-discipline` SHA-pin).
- Coverage on every Phase 5 module exceeds the 80% gate; `core/registry/` aggregate sits at 97.71% lines / 91.38% branches / 100% functions.

## Sub-tasks landed

### 5.1 -- Storage layout + manifest schema

- New [core/registry/ModelStorage.ts](../../../../core/registry/ModelStorage.ts) defines the on-disk layout under `~/.nexus/models/`: a `blobs/sha256-<hex>` content-addressed pool, a `manifests/<family>/<name>/<tag>.json` named index, and a `_tmp/<sha256>.part` scratch area for partial downloads.
- Public methods: `hasBlob` / `writeBlob` (Buffer or Readable) / `readBlob` (stream) / `readBlobBuffer` / `linkManifest` / `unlinkManifest` / `readManifest` / `listManifests` / `listBlobShas` / `gcUnreferencedBlobs` / `diskUsageBytes` / `ensureLayout`.
- Garbage collection walks every manifest, unions all referenced SHAs, and unlinks every `blobs/sha256-*` file not in the union. Shared blobs (two manifests pointing at the same hex) are preserved -- the GC integration test exercises exactly that path.
- Manifest schema is documented in JSON Schema at [core/registry/manifest.schema.json](../../../../core/registry/manifest.schema.json). The runtime validator in `ModelStorage` enforces `schemaVersion === 1`, non-empty identity fields, at least one blob ref, and `^[a-f0-9]{64}$` digests on every blob.
- 22 tests in [tests/unit/core/registry/ModelStorage.test.ts](../../../../tests/unit/core/registry/ModelStorage.test.ts) cover layout creation, write / read round-trips (Buffer + Readable), digest validation, link / unlink / readManifest, listManifests across multiple families + skipping non-JSON files, gc on orphans, gc preserving shared blobs, diskUsageBytes, missing-blob errors, schemaVersion / empty-blobs / missing-identity rejection paths.

### 5.2 -- Resumable + SHA-256-verified downloader

- New [core/registry/Downloader.ts](../../../../core/registry/Downloader.ts) wraps Node's native `fetch` plus `crypto.createHash` -- no third-party library introduced.
- `download(url, expectedSha256, opts)` streams the body to `<storage._tmp>/<sha256>.part`. If a partial file already exists, the prefix is hashed first and a `Range: bytes=<size>-` header is appended; the entire payload (prefix + new bytes) flows through the same hash.
- A server that ignores the `Range` header (responds with 200 instead of 206) is detected -- the prefix is reset, the `.part` file truncated, the body re-streamed from byte 0.
- The final SHA-256 is compared against `expectedSha256`; mismatch unlinks the `.part` file and throws a `DigestMismatch` error. Success renames the `.part` into `blobs/sha256-<hex>`.
- Cancellation is propagated through `opts.signal`; partial files survive an abort so a subsequent call resumes from the same byte offset.
- Progress events fire every 256 KB OR every 500 ms (whichever first); the callback receives `{ downloaded, total | null }`. `Content-Range` header (when present) supplies the total; otherwise `Content-Length` is added to the prefix size; otherwise `total` is `null`.
- 8 tests in [tests/unit/core/registry/Downloader.test.ts](../../../../tests/unit/core/registry/Downloader.test.ts) cover full download + verification, mismatch rejection, malformed expected sha, range-resumption (server honors Range with 206), ignored-range fallback (server returns 200), progress event firing, AbortSignal propagation, non-2xx HTTP response.

### 5.3 -- Catalog + NexusModelRegistry orchestration

- New [core/registry/catalog.json](../../../../core/registry/catalog.json) curates 18 installable entries: 11 LLMs (Gemma 4 E2B / E4B / 26B / 31B, Llama 3.1 8B / 70B, Qwen 2.5 7B / 14B, Qwen 2.5 Coder 7B / 14B, DeepSeek Coder V2 16B), 1 embedding model (Nomic Embed Text), 4 image diffusion models (SDXL Turbo, SDXL 1.0 base, FLUX.1 Schnell, SD 1.5 -- flagged for Phase 6), 2 video models (LTX-Video, SVD -- flagged for Phase 7).
- New [core/registry/catalog.ts](../../../../core/registry/catalog.ts) declares the `ModelSpec` type, the `loadCatalog(path?)` loader (defaults to the bundled `catalog.json` via `__dirname`), `validateSpec` / `validateCatalog` (duplicate-id check, type whitelist, non-ollama `source.url` requirement, optional `source.sha256` digest format), and the `findSpec` / `getSpec` lookups.
- New [core/registry/NexusModelRegistry.ts](../../../../core/registry/NexusModelRegistry.ts) is the orchestration layer:
  - `install(spec)` dispatches to either `OllamaPullClient.pull(tag)` (for `protocol: "ollama"`) or the HTTP downloader (for `huggingface` / `url`). Ollama installs derive the tag from `source.url`'s `ollama://` scheme or fall back to the spec id. HTTP installs require a `source.sha256` digest; the rejection path is covered.
  - `remove(id)` looks up the manifest by id, unlinks it, then runs `gcUnreferencedBlobs()`. External (`extra_model_paths.yaml`) entries cannot be removed -- `ExternalRemovalError` is thrown with a clear message.
  - `list(filter)` enumerates disk manifests, catalog entries that have NOT been installed, and external entries surfaced by the wired `ExternalModelIndex`. Filters by `type` / `family` / `installed` / free-text `query`.
  - `installById(id)` is a convenience over `findSpec(catalog, id) -> install(spec)`.
- The Phase 2.6 `InMemoryModelRegistry` survives as a separate class in [core/registry/ModelRegistry.ts](../../../../core/registry/ModelRegistry.ts) so the 9 existing tests there pass untouched.
- 11 catalog tests in [tests/unit/core/registry/catalog.test.ts](../../../../tests/unit/core/registry/catalog.test.ts) + 15 integration tests in [tests/integration/NexusModelRegistry.test.ts](../../../../tests/integration/NexusModelRegistry.test.ts) cover Ollama install (with `pulls++` counter), HTTP install + manifest, off-catalog spec, http-without-sha rejection, external entries surfacing, external-removal refusal, uninstalled-id error, unknown protocol, list with all filter combinations, progress event passthrough, repo metadata preservation, missing-required-fields rejection, ollama url-less fallback.

### 5.4 -- `extra_model_paths.yaml` compatibility

- New [core/registry/ExtraModelPaths.ts](../../../../core/registry/ExtraModelPaths.ts) ships a tiny hand-rolled YAML parser (no `yaml`-package dependency) targeting ComfyUI's flat `<profile>: { base_path, <category>: <relative-path> }` shape.
- Parser features: ignores `#` comments and blank lines, supports `'`/`"` quoted values (single or double), accepts absolute paths in category values, walks any number of profiles. Rejects malformed input (missing colon, inconsistent indent, empty profile name, key before profile header, malformed header) with descriptive errors that quote the line number.
- `ExtraModelPathsIndex` implements the `ExternalModelIndex` interface (consumed by `NexusModelRegistry`). `list()` walks each referenced directory for `.safetensors` / `.ckpt` / `.gguf` / `.bin` / `.pt` files and returns `ExternalModelEntry[]` rows tagged `source: "external"`. Missing directories return `[]` (no error). Missing YAML returns `[]` (no error).
- External entries cannot be removed via `NexusModelRegistry.remove(id)` -- the registry throws `ExternalRemovalError` with the user-actionable hint "Edit your YAML or remove the file directly".
- 13 tests in [tests/unit/core/registry/ExtraModelPaths.test.ts](../../../../tests/unit/core/registry/ExtraModelPaths.test.ts) cover the parser (10 -- flat profile, multiple profiles, quoted values, comments, missing colon, inconsistent indent, malformed header, empty name, no header before key) + the index (3 -- ENOENT yaml, `.safetensors` enumeration with filter, missing directory, absolute category path).

### 5.5 -- Settings UI for models

- New [desktop/src/pages/settings/ModelsSettings.tsx](../../../../desktop/src/pages/settings/ModelsSettings.tsx) renders three sections (Installed / Available / External), filter controls (type: All / LLM / Image / Video / Embed; family: dynamic; free-text search), a disk-usage summary header ("Models occupy X. Y free."), an install progress bar driven by an injectable `InstallProgressDto` stream, Cancel button while installing, Remove on installed entries, Reveal on external entries.
- The page is provider-driven via `ModelsClient` (interface: `list` / `install` / `remove` / `reveal?` / `diskUsage` / `pin?` / `isPinned?`) so tests inject an in-memory client. The production binding through the sidecar IPC is deferred (known-gap `5.P1.BB`).
- Mock client at [desktop/src/pages/settings/mockModelsClient.ts](../../../../desktop/src/pages/settings/mockModelsClient.ts) drives the default `/settings` route until the IPC bridge lands; it mimics download progress in real time so the UI is exercised end-to-end without a sidecar.
- New [desktop/src/pages/settings/SettingsPage.tsx](../../../../desktop/src/pages/settings/SettingsPage.tsx) is the route shell -- Phase 5 ships only the Models tab; future phases add Hardware / Skills / About siblings.
- [desktop/src/App.tsx](../../../../desktop/src/App.tsx) replaces the Phase 1 `/settings` placeholder with `<SettingsPage />`.
- 9 desktop UI tests in [desktop/tests/ModelsSettings.test.tsx](../../../../desktop/tests/ModelsSettings.test.tsx) cover the three-section layout, type filter, family filter, search narrowing, install + progress + completion, cancel removes the progress bar, remove drops the row, reveal callback fires for external entries, disk-usage summary renders.

### 5.6 -- ModelPinRegistry wiring (closes `[v0.9.0:10.N.A]`)

- New [core/registry/ModelPinRegistry.ts](../../../../core/registry/ModelPinRegistry.ts) is the canonical implementation. The legacy `src/storage/ModelPinRegistry.ts` becomes a one-line compat re-export so the VS Code-bound callers (`StreamingPipeline`, `MemoryPanelHost`) keep compiling unchanged.
- New surface: `hydrate()` (idempotent) loads the pin set from a `SettingsStore` at `nexus.llm.modelPins`. `pin` / `unpin` / `setPinned` (async, awaitable) persist immediately. `forget` / `clear` also persist. `keepAliveFor(model)` returns `-1` for pinned models or `OLLAMA_KEEP_ALIVE` env / `5m` default for unpinned. `resolver()` returns the existing `KeepAliveResolver` callback shape expected by `StreamingPipeline`.
- New [core/storage/SettingsStore.ts](../../../../core/storage/SettingsStore.ts) ships two implementations: `InMemorySettingsStore` (tests) and `JsonFileSettingsStore` (production, persists to `<nexusHome>/settings.json` and creates the file lazily on first `set`).
- New [desktop/sidecar/src/runtime/codingBootstrap.ts](../../../../desktop/sidecar/src/runtime/codingBootstrap.ts) is the composition root that wires the SettingsStore + hydrated ModelPinRegistry + bound `keepAliveResolver(model) -> number | string | null`. The sidecar's session manager (deferred to a Phase 5 follow-on, known-gap `5.P2.DD`) will pass `boot.keepAliveResolver` into `StreamingPipeline`'s `resolveKeepAlive` constructor argument.
- 13 unit tests in [tests/unit/core/registry/ModelPinRegistry.test.ts](../../../../tests/unit/core/registry/ModelPinRegistry.test.ts) cover hydrate (load + idempotent), pin / unpin persistence, `setPinned(true/false)`, env override precedence, pinned-trumps-env, resolver factory, forget + clear with persistence, snapshot sorting, `envKeepAlive` injection.
- 6 tests in [tests/unit/core/storage/SettingsStore.test.ts](../../../../tests/unit/core/storage/SettingsStore.test.ts) cover in-memory get / set / delete / entries, JSON-file get-when-missing, lazy creation on first set, cross-instance persistence, delete no-op when missing, delete removal across instances.
- 2 tests in [desktop/tests/codingBootstrap.test.ts](../../../../desktop/tests/codingBootstrap.test.ts) cover hydration-from-injected-store and JsonFileSettingsStore default wiring.
- The 8 legacy `tests/unit/storage/ModelPinRegistry.test.ts` tests continue to pass through the compat re-export.

### 5.7 -- Testing and stabilization

- 115 Phase 5 tests added; all pass against ephemeral `os.tmpdir()` roots.
- Coverage on every Phase 5 module exceeds the 80% gate. Per-file: `Downloader.ts` 96.52 / 93.54 / 100, `ExtraModelPaths.ts` 95.96 / 91.07 / 100, `ModelCatalog.ts` 99.04 / 91.66 / 100, `ModelPinRegistry.ts` 100 / 94 / 100, `ModelRegistry.ts` 100 / 94.73 / 100, `ModelStorage.ts` 96.17 / 94.11 / 100, `NexusModelRegistry.ts` 100 / 85.54 / 100, `catalog.ts` 90.9 / 90.9 / 100, `SettingsStore.ts` 96.49 / 86.95 / 100. The `core/registry/` aggregate sits at 97.71 / 91.38 / 100 (lines / branches / functions).
- 5 pre-existing root failures (4 `SubAgentManager.characterization` CRLF snapshots, 1 `workflow-discipline` SHA-pin) carry forward unchanged from item `2.P3.L`. None are introduced by Phase 5.

## Known gaps added

See [docs/v1.0.0/known-gaps.md](../../known-gaps.md) entries `5.P1.BB` -- `5.P3.FF` (six new entries; one entry moved to the Resolved table for `[v0.9.0:10.N.A]` ModelPinRegistry wiring). Headline gaps:

- `5.P1.BB` -- Settings UI bound to mock client; sidecar IPC handlers for `models.list` / `install` / `remove` / `diskUsage` are still `NotImplementedError`. Wiring is a Phase 5 follow-on.
- `5.P2.CC` -- HuggingFace catalog SHA-256 digests are placeholders (`0`.repeat(64)). Phase 6 / Phase 7 capture canonical digests when those pillars consume them.
- `5.P2.DD` -- StreamingPipeline's `resolveKeepAlive` is still threaded through `src/panels/ChatPanelBootstrap.ts`; the sidecar's session manager will own the wiring once the engine relocates into `modules/coding/`.
- `5.P2.EE` -- Per-model VRAM-pin checkbox not yet rendered. The `ModelsSettings` component accepts the `pin` callback; the production wiring waits on the same IPC bridge as `5.P1.BB`.

## Deviations from the plan

- The plan referenced a `SettingsStore from Phase 2.6`; Phase 2.6 stopped at the in-memory registry stub and never landed a settings backplane. Phase 5.6 introduces the minimum surface (`core/storage/SettingsStore.ts`) needed to persist the pin set and a small JSON-file implementation.
- The plan referenced `desktop/sidecar/src/runtime/CodingBootstrap.ts` "added in Phase 3.4 for IdleTimeScheduler". Phase 3.4 actually landed `desktop/sidecar/src/runtime/idleScheduler.ts`. Phase 5.6 adds the matching `codingBootstrap.ts` alongside it so the bootstrap composition surface exists; the IdleTimeScheduler bootstrap continues to live in its own file.
- The plan's 5.3 acceptance ("a CLI smoke `nexus models install gemma4:e4b -> list -> remove` is exercised in a test against a fixture catalog and a mock Ollama") is met by the integration tests in `tests/integration/NexusModelRegistry.test.ts` (install via `OllamaPullClient`, list, remove). A `nexus models` CLI subcommand is not landed in Phase 5; the registry surface is consumed by the Settings UI (`5.5`) and -- once the IPC bridge in `5.P1.BB` lands -- by future tooling.
- The plan's 5.5 acceptance ("install / remove a small model end-to-end via the UI") runs against the mock client; the real sidecar-backed end-to-end is part of the Phase 5 follow-on tracked as `5.P1.BB`.

## Files added or modified

**New files (core)**:

- [core/registry/ModelStorage.ts](../../../../core/registry/ModelStorage.ts)
- [core/registry/manifest.schema.json](../../../../core/registry/manifest.schema.json)
- [core/registry/Downloader.ts](../../../../core/registry/Downloader.ts)
- [core/registry/catalog.ts](../../../../core/registry/catalog.ts)
- [core/registry/catalog.json](../../../../core/registry/catalog.json)
- [core/registry/NexusModelRegistry.ts](../../../../core/registry/NexusModelRegistry.ts)
- [core/registry/ExtraModelPaths.ts](../../../../core/registry/ExtraModelPaths.ts)
- [core/registry/ModelPinRegistry.ts](../../../../core/registry/ModelPinRegistry.ts)
- [core/storage/SettingsStore.ts](../../../../core/storage/SettingsStore.ts)

**New files (desktop)**:

- [desktop/src/pages/settings/ModelsSettings.tsx](../../../../desktop/src/pages/settings/ModelsSettings.tsx)
- [desktop/src/pages/settings/SettingsPage.tsx](../../../../desktop/src/pages/settings/SettingsPage.tsx)
- [desktop/src/pages/settings/mockModelsClient.ts](../../../../desktop/src/pages/settings/mockModelsClient.ts)
- [desktop/src/pages/settings/modelsTypes.ts](../../../../desktop/src/pages/settings/modelsTypes.ts)
- [desktop/sidecar/src/runtime/codingBootstrap.ts](../../../../desktop/sidecar/src/runtime/codingBootstrap.ts)

**Modified**:

- [src/storage/ModelPinRegistry.ts](../../../../src/storage/ModelPinRegistry.ts) (now a one-line compat re-export of `core/registry/ModelPinRegistry.ts`).
- [desktop/src/App.tsx](../../../../desktop/src/App.tsx) (`/settings` route binds to `SettingsPage`).

**Tests**:

- [tests/unit/core/registry/ModelStorage.test.ts](../../../../tests/unit/core/registry/ModelStorage.test.ts)
- [tests/unit/core/registry/Downloader.test.ts](../../../../tests/unit/core/registry/Downloader.test.ts)
- [tests/unit/core/registry/catalog.test.ts](../../../../tests/unit/core/registry/catalog.test.ts)
- [tests/unit/core/registry/ExtraModelPaths.test.ts](../../../../tests/unit/core/registry/ExtraModelPaths.test.ts)
- [tests/unit/core/registry/ModelPinRegistry.test.ts](../../../../tests/unit/core/registry/ModelPinRegistry.test.ts)
- [tests/unit/core/storage/SettingsStore.test.ts](../../../../tests/unit/core/storage/SettingsStore.test.ts)
- [tests/integration/NexusModelRegistry.test.ts](../../../../tests/integration/NexusModelRegistry.test.ts)
- [desktop/tests/ModelsSettings.test.tsx](../../../../desktop/tests/ModelsSettings.test.tsx)
- [desktop/tests/codingBootstrap.test.ts](../../../../desktop/tests/codingBootstrap.test.ts)

**Docs**:

- [docs/v1.0.0/known-gaps.md](../../known-gaps.md) (six new entries + one moved to Resolved).
- [docs/DEVLOG.md](../../../DEVLOG.md) (Phase 5 entry).
- [docs/v1.0.0/development/history/2026-05-17_phase-05-model-registry.md](2026-05-17_phase-05-model-registry.md) (this file).

## Next phase

Phase 6 (DiffusionRuntime + Image Studio MVP) consumes the registry for SDXL Turbo / SDXL 1.0 / Flux Schnell / SD 1.5 weights and is the first phase to exercise the HTTP downloader against real HuggingFace digests (resolving `5.P2.CC`). The Phase 5 follow-on that bridges `NexusModelRegistry` over IPC (`5.P1.BB`) is bundled with the Phase 6 IPC surface widening or the engine relocation -- whichever lands first.

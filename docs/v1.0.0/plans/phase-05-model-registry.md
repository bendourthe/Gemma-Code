# Phase 5 - ModelRegistry + native model downloader

**Goal**: Shared-core `ModelRegistry` with content-addressed storage, resumable SHA-256-verified downloads, `extra_model_paths.yaml` compatibility, and a Settings UI for browsing / installing / removing models.
**Prerequisites**: Phase 2.
**Stability Gate**: A fresh `~/.nexus/models/` directory is populated by `nexus models install gemma4:e4b` via the registry; an interrupted download resumes cleanly; SHA-256 mismatch is rejected. Closes `[v0.9.0:10.N.A]` ModelPinRegistry wiring.

---

## Sub-tasks

### 5.1 - Storage layout + manifest format

**Objective**: Define `~/.nexus/models/` layout: content-addressed blobs under `blobs/<sha256>` + named manifests under `manifests/<family>/<name>/<tag>`.

**Prompt**:
> Define the model storage layout under `~/.nexus/models/`: a `blobs/` directory holding files keyed by their SHA-256 (`blobs/sha256-<hex>`); a `manifests/` directory holding per-model JSON manifests at `manifests/<family>/<name>/<tag>.json`. A manifest references blobs by SHA-256 + role (e.g. `{role: "weights", sha256: "abc..."}`, `{role: "config", sha256: "def..."}`). Manifest schema in `core/registry/manifest.schema.json`. Implement the storage layer at `core/registry/ModelStorage.ts` with methods: `hasBlob(sha256)`, `writeBlob(sha256, stream)`, `readBlob(sha256)`, `linkManifest(family, name, tag, manifest)`, `unlinkManifest(family, name, tag)`, `gcUnreferencedBlobs()`. Garbage collection: any blob not referenced by a manifest is deleted on `nexus models gc`. Acceptance: unit tests cover write / read / link / gc; integration test simulates two manifests sharing a blob and verifies GC preserves the shared blob.

---

### 5.2 - Resumable + SHA-256-verified downloader

**Objective**: Implement an HTTP downloader with `Range:` resumption, SHA-256 verification, and progress events.

**Prompt**:
> In `core/registry/Downloader.ts` implement a Node-based downloader: `download(url: string, expectedSha256: string, opts: {resumeFrom?: number, onProgress?: (bytes: number, total: number | null) => void, signal?: AbortSignal}): Promise<{path: string, sha256: string}>`. Resume: if a partial file exists at `~/.nexus/models/_tmp/<sha256>.part`, send a `Range: bytes=<size>-` header and append. Verify: stream the downloaded bytes through a SHA-256 hasher; if the final hash does not match `expectedSha256`, delete the file and throw `DigestMismatch`. Cancellation via `AbortSignal`. Progress events fire every 256 KB or 500 ms (whichever first). Use Node's native `fetch` + `ReadableStream` - no external library. Acceptance: integration test against a local HTTP server (vitest's built-in or `msw`) covers full download, interrupted-and-resumed download, mismatched-digest rejection, cancellation.

---

### 5.3 - Model catalog + registry orchestration

**Objective**: `core/registry/ModelRegistry.ts` becomes the orchestration layer: model catalog (curated list of installable models), install / remove / list, integration with the downloader + storage.

**Prompt**:
> In `core/registry/catalog.json` define the curated model catalog as a JSON array of `ModelSpec` entries: `{id: "gemma4:e4b", family: "gemma4", name: "gemma4", tag: "e4b", type: "llm", description, sizeGB, vramGB, license, source: {protocol: "ollama" | "huggingface" | "url", url, sha256}}`. The v1.0.0 catalog includes LLMs (Gemma 4 E2B/E4B/26B/31B, Llama 3.1 8B/70B, Qwen 2.5 7B/14B, Qwen 2.5 Coder 7B/14B, DeepSeek Coder V2), embedding models (`nomic-embed-text`), image diffusion models (SDXL Turbo, SDXL 1.0, Flux Schnell, SD 1.5 - flagged for Phase 6), and video models (LTX-Video, SVD - flagged for Phase 7). Implement `ModelRegistry.install(spec)` which (a) looks up the spec, (b) for Ollama-sourced models delegates to `ollama pull` and wraps the result in a manifest, (c) for HuggingFace / URL-sourced models uses the downloader from 5.2 + writes a manifest. Implement `ModelRegistry.remove(id)`. Implement `ModelRegistry.list(filter)` enumerating manifests + augmenting with `installed: boolean`. Acceptance: a CLI smoke (`nexus models install gemma4:e4b` -> `list` -> `remove`) is exercised in a test against a fixture catalog and a mock Ollama.

---

### 5.4 - `extra_model_paths.yaml` compatibility

**Objective**: Read ComfyUI-style `extra_model_paths.yaml` if present at `~/.nexus/extra_model_paths.yaml` and merge external directories into the registry's search path.

**Prompt**:
> Implement compatibility with ComfyUI's `extra_model_paths.yaml` format so users who already have a ComfyUI install can point Nexus at their existing model directories without duplicating disk space. Schema: a YAML map of `<profile-name>: {base_path: ..., checkpoints: ..., loras: ..., controlnet: ..., ...}`. Parse it at registry boot if `~/.nexus/extra_model_paths.yaml` exists; for each profile, scan the referenced directories for `.safetensors` / `.ckpt` / `.gguf` files and surface them in `ModelRegistry.list()` with `source: "external", path: <abs-path>` (no copy / no manifest - just an index entry). External-source models cannot be removed via `nexus models remove` (it would delete user data); the registry returns a clear error if `remove` is attempted. Acceptance: integration test creates a synthetic `extra_model_paths.yaml` pointing at a directory with two `.safetensors` files, runs `list`, asserts both surface as `external`; `remove` on an external entry errors clearly.

---

### 5.5 - Settings UI for model browsing / installing / removing

**Objective**: In the Settings page, add a "Models" tab listing every catalog entry with install / remove / progress UI.

**Prompt**:
> Build the Models settings page at `desktop/src/pages/settings/ModelsSettings.tsx`. Three sections: "Installed" (registry entries with `installed: true`), "Available" (catalog entries with `installed: false`), "External" (sourced from `extra_model_paths.yaml`). Each row shows the model's icon (LLM / image / video / embed), name, family + tag, size on disk, license, and an action button (Install / Remove / Reveal in finder for External). Install shows a progress bar driven by the downloader's progress event (subscribe via IPC). Cancel button. Filters at the top: type (All / LLM / Image / Video / Embed), family. Search by name. Disk-usage summary at the top: "Models occupying X GB. Y GB free." Acceptance: install / remove a small model end-to-end via the UI; UI test asserts progress events render correctly.

---

### 5.6 - `ModelPinRegistry` wiring (closes [v0.9.0:10.N.A])

**Objective**: Wire the existing `ModelPinRegistry` module into the new `ModelRegistry` so per-model keep-alive resolves through the registry; persist pins via the settings store.

**Prompt**:
> The `ModelPinRegistry` module at `src/runtime/ModelPinRegistry.ts` is instantiable but never wired (per `[v0.9.0:10.N.A]`). In Phase 5 the new `core/registry/ModelRegistry.ts` becomes the natural home for pin state. Refactor `ModelPinRegistry` -> `core/registry/ModelPinRegistry.ts`, persist pins through the new `SettingsStore` from Phase 2.6 (key: `nexus.llm.modelPins`), and inject the `keepAliveFor(modelId)` resolver into the streaming pipeline via the existing `KeepAliveResolver` callback in `StreamingPipeline`. Wire-up happens in `desktop/sidecar/src/runtime/CodingBootstrap.ts` (added in Phase 3.4 for IdleTimeScheduler) - same composition root. Add a Settings UI checkbox per installed LLM: "Keep loaded in VRAM" toggles the pin. Acceptance: pinning a model via the Settings UI persists across daemon restarts; the streaming pipeline observes the new keep-alive value; closes `[v0.9.0:10.N.A]`.

---

### 5.7 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 5. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 5. Include: unit tests for `ModelStorage` (write / read / link / gc); unit + integration tests for `Downloader` (full / resume / digest-mismatch / cancel); unit tests for the catalog schema validation; integration tests for `ModelRegistry.install/remove/list` against a mock Ollama and a mock HTTP server; integration test for `extra_model_paths.yaml` parsing; UI tests for `ModelsSettings`; regression test for `ModelPinRegistry` wiring; coverage gate at lines >= 80, functions >= 80 across `core/registry/`. Run the test suite, fix all failures, iterate. After all tests pass, run `/generate-session-history` to document Phase 5.

---

### Phase 5 Exit Checklist

- [ ] All sub-tasks completed
- [ ] Downloader resume + verify works
- [ ] Catalog covers v1.0.0 model set
- [ ] `extra_model_paths.yaml` compat verified
- [ ] Settings UI for models works end-to-end
- [ ] `[v0.9.0:10.N.A]` ModelPinRegistry wiring closed
- [ ] Coverage gate green
- [ ] Session history generated for Phase 5
- [ ] Ready to advance to Phase 6

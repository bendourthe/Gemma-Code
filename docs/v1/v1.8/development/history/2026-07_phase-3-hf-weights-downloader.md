# v1.8.0 Phase 3 -- Hugging Face weights downloader: image/video selection becomes real (T301-T304)

**Date**: 2026-07-03
**Branch**: `feat/v1.8.0-installer-phase-3` (stacked on `feat/v1.8.0-installer-phase-2`)
**Plan**: [../../plans/one-shot-installer.md](../../plans/one-shot-installer.md) (Phase 3 of 6, closes gap G2)
**Constraints honored**: GitHub Actions freeze ($0 until 2026-08-01) -- all proofs local. The dev sandbox additionally has **no Hugging Face egress** (the HF API returns a proxy 401), which shaped two deliberate deferrals: digest pins stay placeholders (`OSI003.P3.A`) and the real-download smoke is env-gated for the operator's GPU box (`OSI003.P3.C`).

## Why this phase exists (G2)

Before this phase, image/video entries in the typed catalog were selectable dead ends: `model_puller.py` only ran `ollama pull`, so an HF-protocol selection (SANA, SDXL, FLUX, LTX-Video, SVD) downloaded nothing. Phase 3 gives every `source.protocol: "huggingface"` entry a real, verified download path and routes the engine's model step by protocol.

## What shipped

### T301 -- per-model weights manifests + the model-path contract

- **Contract verification first** (the plan's precondition): the diffusion runtime's model-path contract turned out to be *undefined* -- the pipelines' real diffusers executors are still OA-09 stubs (`base.select_executor` falls back off-GPU), and no consumer anywhere resolved local weights paths. The contract was therefore **defined and documented** in catalog `_meta`: each file lands at `<models_root>/weights/<model-id>/{repo-relative path}` (`models_root` defaults to `~/.nexus/models`), giving the per-model directory diffusers `from_pretrained` loads with repo subpaths (`transformer/`, `vae/`, ...) preserved.
- [catalog.json](../../../../core/registry/catalog.json): `weights` manifests (`layoutVersion: 1`, `files[].path` + `files[].sha256`) added to all 16 HF entries via a line-based transform (untouched entries keep their exact formatting). Existing placeholder digests carried over -- consistent with the repo's `versions.lock.json` placeholder convention.
- [catalog.ts](../../../../core/registry/catalog.ts): `ModelWeightsFile` / `ModelWeightsManifest` types + `validateSpec` checks (non-empty files, traversal-safe paths, well-formed sha256).
- [scripts/installer/build/pin-hf-weights.py](../../../../scripts/installer/build/pin-hf-weights.py) (new, stdlib-only like `fetch-payload.py`): rotates pins from the HF tree API (`lfs.oid` sha256s) or from locally downloaded files (`--from-dir`), plus a `--check` gate that exits non-zero while placeholders remain. Its catalog rewrite is line-based and format-preserving. Verified locally: `--check` reports exactly the 16 expected placeholders.

### T302 -- `engine/hf_weights_puller.py` (new, 94% line coverage)

Follows the `desktop_provisioner.py` / `ollama_installer.py` download-verify structure, per file:

- **Manifest parsing** (`load_weights_manifest`): explicit `weights.files[]`, with a single-file fallback derived from `source.url` for older catalog snapshots; fail-closed `ManifestError` on missing repo, wrong protocol, empty file lists, malformed digests, and unsafe paths (`..` segments, absolute, backslash, drive-colon -- path-traversal defense per the security rules).
- **Resumable download**: per-file `.partial` + `Range` (206 appends, 200 restarts, 416 promotes); cancellation keeps partials for resume across wizard restarts.
- **Retry**: 3 attempts per file with linear backoff (injectable sleep for tests); network errors only -- a digest mismatch is never retried.
- **Verification**: real pin mismatch deletes the file and fails the model (fail closed); an all-zero placeholder pin warns, skips verification, and **logs the computed sha256** so the operator can rotate the pin -- the exact `fetch-payload.py` discipline, chosen over a stricter fail-closed default because every current pin is a placeholder and a hard fail would make the feature dead-on-arrival (recorded as `OSI003.P3.A`).
- **Disk pre-check**: `shutil.disk_usage` against the entry's `sizeGB` plus the existing 10 GB OS reserve (`state.disk_reserve_gb`); a failed probe warns and proceeds (mirroring `can_select_model`'s unknown-disk permissiveness).
- Already-present files short-circuit: digest match skips the download; a stale mismatch is deleted and re-fetched.

### T303 -- protocol routing (`engine/model_router.py`, new, 98% line coverage)

- `ModelStepRouter` replaces the engine's direct `ModelPuller` call (GUI step 4 **and** the `--headless` step in [main.py](../../../../scripts/installer/pyqt/src/nexus_installer/main.py)): each selected id resolves against catalog.json and routes `ollama` -> `ModelPuller.pull_model` (split out of `pull`; behavior unchanged) or `huggingface` -> `HFWeightsPuller.install_model`. Unknown ids keep the historical behavior (verbatim `ollama pull`). An unreadable catalog degrades to all-ollama with a warning.
- **Weighted mixed progress**: per-model weights proportional to catalog `sizeGB` (unknown = 1.0), so a 23 GB FLUX download does not distort a 1.4 GB SANA pull's band.
- **Per-model failure isolation**: one failed model logs, lands on the new `InstallerState.failed_models`, and the rest continue; the step reports failure when any model failed, and the complete page's warning callout now names each failed model (`• model download failed: <id>`).
- State threading: new `selected_model_ids` (multi-select surface; wins over the legacy single `selected_model` when non-empty -- the wizard UI producer arrives with Phase 4's catalog rework, `OSI003.P3.D`), `failed_models`, `models_root` (test/override hook for the `~/.nexus/models` default).
- Cancel wiring: `InstallEngine.cancel` -> router -> active puller; a user cancel stops routing without polluting `failed_models`.

### T304 -- tests (62 new across two files + suite updates)

- [test_hf_weights_puller.py](../../../../scripts/installer/pyqt/tests/test_hf_weights_puller.py) (39): manifest parsing (explicit, derived, 7 traversal/malformed-path cases, digest validation), models-root resolution, disk pre-check (insufficient / ample / probe-failure), install orchestration (placeholder digest logging incl. the pin-script pointer, real-pin verify, mismatch-deletes-fails-closed, skip-verified-existing, re-download-stale, multi-file monotonic progress, retry-then-succeed, retries-exhausted, cancel), resume semantics (promote, 206 append, 200 restart, 416, cancel-keeps-partial, network error).
- [test_model_router.py](../../../../scripts/installer/pyqt/tests/test_model_router.py) (19): catalog discovery/indexing, protocol resolution, selection precedence + dedupe, routing by protocol, unknown-id fallback, legacy single-model path, empty-selection skip, failure isolation (single + all), sizeGB-weighted progress (asserts the 2.7/4.1 boundary), unreadable-catalog fallback, cancel semantics (pre, forwarded, mid-run).
- Suite updates: engine tests patch `ModelStepRouter` (order, skip, cancel propagation incl. a new router-cancel case).
- **Integration smoke (env-gated, `NEXUS_HF_WEIGHTS_SMOKE=1`)**: downloads the smallest real entry (`NEXUS_HF_SMOKE_MODEL`, default `sana-1.6b-int4`, 1.4 GB) through the real puller into a tmp models root and asserts the on-disk layout. Deferred to the operator's GPU box (`OSI003.P3.C`) -- this sandbox has no HF egress.

## Quality gates

| Gate | Result |
|---|---|
| Installer pytest suite | **494 passed / 2 skipped / 0 failed** (+61 passed; the new skip is the env-gated HF smoke) |
| New-module coverage | `hf_weights_puller.py` 94% lines; `model_router.py` 98%; `model_puller.py` 92%; `installer_state.py` 100% |
| Ruff (changed files) | 0 new findings (one `zip(strict=)` finding introduced and fixed in-session) |
| `tsc -b` | clean |
| Root Vitest suite (`npm test`) | **4565 passed / 6 skipped / 0 failed** (unchanged; catalog.json + catalog.ts additive) |
| Pin script | `--check` exits 1 listing exactly the 16 known placeholders |

## Decisions

- **Placeholder pins warn-and-skip rather than fail closed**: matches the repo's established `fetch-payload.py` discipline and keeps the feature usable before the operator's pin rotation; the computed digest is logged on every placeholder download, which *is* the `--from-dir` rotation workflow. Real pins fail closed (delete + per-model failure).
- **The model-path contract is defined by this phase, not discovered**: no runtime consumer existed to match, so the simplest diffusers-loadable layout (`weights/<model-id>/{repo path}`) was chosen and documented in catalog `_meta`, catalog.ts, and the puller docstring. The runtime's OA-09 real-executor wiring should consume `model_weights_dir()`.
- **Single-file manifests this phase**: full diffusers repo file lists (text encoder, tokenizer, scheduler, VAE configs) could not be enumerated without HF egress; Phase 4's T403 GPU-box curation extends them per default entry (`OSI003.P3.B`).
- **Headless path routes too**: the smoke scripts exercise the same step surface as the GUI, so `--headless --model sana-1.6b-int4` now downloads weights instead of silently failing through `ollama pull`.

## Follow-ups recorded

`OSI003.P3.A` (pin rotation, operator), `OSI003.P3.B` (full multi-file manifests, Phase 4/T403), `OSI003.P3.C` (GPU-box smoke + runtime load, operator), `OSI003.P3.D` (wizard multi-select producer, Phase 4/T401) in [../../known-gaps.md](../../known-gaps.md).

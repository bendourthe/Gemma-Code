# Session History - v1.13.0 Phase 1: Model catalog correctness, Ollama pinning, download-engine hardening

**Date**: 2026-07-17
**Plan**: [../../plans/installer-reliability-and-ux.md](../../plans/installer-reliability-and-ux.md) - Phase 1
**Branch**: `feat/v1.13.0-installer-reliability`

## Goal

Make a fresh install land every default model: fix the two failures from the 2026-07-17 real install (the recommended Gemma 4 12B chat model, and the gated `sana-1.6b-int4` image opt-in), pin the Ollama version so the Gemma 4 default line can pull and load, and harden the download engine against gated repos and permanent errors.

## Subtasks

- **1.1 - Gemma 4 12B off the broken GGUF path.** `core/registry/catalog.json` `gemma-4-12b-it-gguf` re-pointed from `ollama://hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL` (which fails Ollama manifest registration, bug #15447) to the Ollama-registry `ollama://gemma4:12b` tag; identity fields updated to describe the registry model (name/tag/displayName/sizeGB 7.37->7.6/tags, dropped the GGUF wording). The id is kept (19 files reference it) so `recommended.json` and downstream code are untouched. `gemma4:12b` and Ollama's Gemma 4 support were web-verified against the Ollama registry.
- **1.2 - Ollama version floor.** `ollama_installer.py` gained `MIN_OLLAMA_VERSION = "0.22.0"` (Gemma 4 support landed in 0.20.0; 0.21.x Flash-Attention bug fixed in 0.22.0), `_version_tuple` / `_meets_min_version`, and a best-effort `_ollama_version` (API then CLI). `install()` now upgrades a pre-existing Ollama below the floor instead of skipping. `VERSIONS.md` reconciled from the stale `v0.3.6` / `install.sh` to the real `v0.32.0` / tar.zst pin and the new floor.
- **1.3 - Gated/broken remediation.** `sana-1.6b-int4` (live 401, wrong INT4 layout), `sd1.5`, `svd`, `stable-audio-open-1.0` flagged with additive `gated: true` + `gatedReason` (kept, not deleted - they are woven into desktop UI + diffusion tests). Real SHA pins deferred (needs downloads).
- **1.4 - Download-engine hardening.** `hf_weights_puller.py`: permanent (401/403/404) vs transient error classification (a `_DownloadOutcome` enum; permanent is never retried), optional `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` `Authorization: Bearer` header, and a fast gated-repo skip with the `gatedReason`. httpx exception classes bound at import so mocked-httpx tests stay valid.

## Tests

- Installer pytest: full suite green (incl. new `TestGatedModels`, `TestHfTokenFromEnv`, `TestPermanentErrorInstall`, permanent/transient/token cases in `TestDownloadResume`, `TestOllamaVersionGate`, and `TestCatalogIntegrity` asserting no default is gated + Gemma 4 routes to `gemma4:12b`).
- Root vitest: `catalog.test.ts` assertion updated to the new routing; `catalog-digests`, `Gemma4GgufQuants`, `NexusModelRegistry` green (61 tests). The additive `gated`/`gatedReason` fields are schema-safe.
- Gates: `ruff check` + `ruff format` clean on changed files; `tsc -b` clean.

## Deviations

- Kept the `gemma-4-12b-it-gguf` id (did not rename to `gemma4:12b`) to avoid churning 19 referencing files; only `source`/identity changed.
- `sana-1.6b-int4` marked gated rather than deleted (blast radius: desktop UI + diffusion + catalog tests).

## CI/CD

No new CI needed - the changes live within existing installer pytest files already in CI. The live pull+load preflight CI job is a Phase 2 concern, freeze-deferred (IR.P1.E).

## Next steps

Phase 2: the default-model preflight harness (pull + load verification + whole-catalog reachability probe), which is the live gate for IR.P1.A. Known gaps recorded in [../../known-gaps.md](../../known-gaps.md).

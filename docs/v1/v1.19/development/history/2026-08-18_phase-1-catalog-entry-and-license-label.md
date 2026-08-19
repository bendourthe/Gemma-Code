# Session History - v1.19.0 Phase 1: Catalog Entry + License Label

**Date**: 2026-08-18
**Version**: v1.19.0
**Plan**: [../../plans/v1.19.0-adoption-liquid-lfm-agentic.md](../../plans/v1.19.0-adoption-liquid-lfm-agentic.md)
**Phase**: 1 of 4 - Catalog Entry + License Label (A1 + A4, P0)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 4 is terminal).

## Goal

Land LFM2.5-2.6B as the low-VRAM Agentic catalog entry so CPU and sub-4 GB hosts get a dedicated tool-calling pick, with an accurate LFM Open License v1.0 use restriction (USD 10M revenue cap), not a download gate.

## Pre-flight

`is_final_phase` = **false** (Phase 4 is Architecture Refactor, Known-Gaps Reconciliation, and CI/CD). Prior phases: none. Model routing: plan recommended Mid / medium (claude-sonnet-5 medium). Re-score in this session: five mediums would map to strong / high. Cursor is picker-only; the session stayed on the current model (Grok 4.6), which is same-or-stronger. Visible degrade: map refresh was not re-run as a blocking gate. No silent downshift.

## 1. Starting State

- **Branch**: `develop` tracking `origin/develop`
- **Environment**: Windows 10, PowerShell, installer uv venv, root Vitest, desktop Vitest
- **Plan reference**: [v1.19.0-adoption-liquid-lfm-agentic.md](../../plans/v1.19.0-adoption-liquid-lfm-agentic.md)

## 2. Chronological Steps

### 2.1 Curate the LFM2.5-2.6B catalog entry

**Plan specification**: Add `lfm2.5:2.6b` with `task: "agentic"`, `agentic: true`, Q4_K_M 1.67 GB, ~3 GB VRAM class, CPU-capable copy, `license: "LFM Open License v1.0"` + `licenseUrl`, `requiresLicense: false`, real SHA-256 or Ollama digest delegation, no vendor benchmarks, context 32K pending Phase 2.

**What happened**: Entry lives in `core/registry/catalog.json` after `deepseek-coder-v2:16b`. Official GGUF is `LiquidAI/LFM2.5-2.6B-GGUF` / `LFM2.5-2.6B-Q4_K_M.gguf`, LFS SHA-256 `79fdf00351b46cf26f020aead28d01889886be87c55fa0eb907e6f9b00bfee14`. Official Ollama library does not carry the model. `# DEVIATION:` protocol is `ollama` via `ollama://hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M` (quant in the URL so installer `ollama_target_for` does not append `:2.6b`). `weights.files[]` still holds the pin. Schema gained optional `licenseUrl` / `licenseNote` / `requiresLicense` on `ModelSpec`. Coding `ModelCatalog` / `FRONTEND_MODELS` left untouched (DF-1).

**Verification**: `check-catalog.py` OK (41 models). `catalog.test.ts` asserts task, license, pin, no ToolSandbox/BFCLv4 copy.

### 2.2 Low-tier agentic default placement

**Plan specification**: Place LFM on cpu and 8 GB agentic lists without regressing 12/16/24 Gemma-preferred coder-fallback defaults.

**What happened**: `cpu` agentic is `["lfm2.5:2.6b", "gemma4:e2b", "qwen2.5-coder:7b"]` so CPU defaults chat e2b plus agentic LFM (two LLMs). `8` agentic is `["gemma4:e4b", "lfm2.5:2.6b", "qwen2.5-coder:7b"]` so 8 GB still prefers Gemma; a 4 GB card using the 8 matrix falls through to LFM. 12/16/24 unchanged.

**Verification**: `test_tier_defaults.py` cpu includes LFM; 4 GB GPU selects LFM and not the 7B coder; 8/12/16/24 do not default LFM; Gemma-covers-agentic still holds on those GPU tiers.

### 2.3 LFM Open License use-restriction label

**Plan specification**: Visible USD 10M cap as a use restriction, not a gated download. Reuse `licenseUrl`. Must not fire `requiresLicense` / gated-auth.

**What happened**: `# DEVIATION:` installer UI is the typed catalog card (`objectName="licenseNote"`), not `model_checkbox.py` (that file is only the painted checkbox). Desktop Settings row `models-row-<id>-license-note` plus ModelSelector `data-task` / `title`. IPC `ModelListedEntry` gained optional `task` / `licenseUrl` / `licenseNote`.

**Verification**: Qt card test, ModelsSettings test, gated-auth test that LFM does not prompt, invariants require "10M"/"10 million" and "use restriction".

### 2.4 Testing and stabilization

**Plan specification**: Invariants, tier defaults, picker surface; installer pytest, `npm test`, `npm run test:shell`, `npm run lint`; CI coverage for catalog/installer.

**What happened**: Extended installer invariants / tier / typed catalog / model router / gated auth / brand tokens; root catalog + NexusModelRegistry tests; desktop ModelSelector, ModelsSettings, installedProbe. CI `test-installer` already always runs pytest; `test-ts` is unfiltered. No workflow rewrite. Proposed (not applied): `setup-uv` cache on `test-installer`.

**Troubleshooting**:
- Adding a Qt card test with a `qwen2.5-coder:7b` not-in-selected assertion failed because that string appeared twice; the render test now uses unique `licenseNote` objectName lookup.
- `npm test` rewrote `tests/fixtures/**` ingest timings. Restored with `git checkout -- tests/fixtures`. ENV class, same as v1.16 / v1.18.

## 3. Verification Gate

| Check | Result |
|---|---|
| Installer `uv run pytest tests/` | PASS - full suite green (3 skipped) |
| `npm test` | PASS - 459 files / 4932 passed / 11 skipped / 0 failed |
| `npm run test:shell` | PASS - 112 files / 971 passed / 0 failed |
| `npm run lint` + `npm run lint:shell` | PASS - 0 errors |
| `npm run build` (`tsc -b`) | PASS |
| `check-catalog.py` | PASS - 41 models |
| Targeted coverage (changed installer modules) | PASS - 91% lines (`catalog_invariants` 89%, `typed_catalog` 91%, `constants` 95%) |
| Targeted coverage (catalog.ts + NexusModelRegistry) | PASS combined 90.65%; NexusModelRegistry 97.73%; catalog.ts 76.33% on this subset (pre-existing validateSpec branches; Phase 1 added no new executable branches) |
| Targeted coverage (desktop ModelsSettings / ModelSelector / modelsService) | ModelsSettings 94%, ModelSelector 100%, modelsService 75% (pre-existing diskUsage/resolveCatalog; toDto fields covered) |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Coding dropdown does not list LFM | P2 | Deferred (DF-1) to Phase 2 ModelCatalog / harness |
| Sourced via Ollama hf.co bridge, not HF weights puller | P2 | Deferred (DF-2); required so the LLM lands in Ollama |
| `origin` is USA not Liquid AI | P3 | Deferred (DF-3); schema is country |
| contextWindow 32K pending 128K probe | P2 | Deferred (DF-4) to Phase 2.1 |
| `toolCallingVerified` omitted | P2 | Deferred (DF-5) until Phase 2 A/B |

## 5. Plan Discrepancies

- Plan preferred HF `weights` puller if the official Ollama library did not carry the model. That path cannot serve Coding/Chat. Shipped Ollama hf.co bridge plus a real pin (DF-2).
- Plan said `origin` (Liquid AI, USA). Schema is country; Liquid AI is family/publisher (DF-3).
- Plan named `model_checkbox.py` for the license label. The card lives in `typed_catalog.py`.
- Plan said "desktop model pickers". Settings + shared ModelSelector yes; Coding FRONTEND_MODELS no until Phase 2 (DF-1).
- Did not add `toolCallingVerified` in Phase 1 (DF-5).

## 6. Assumptions Made

- Cursor model picker is manual. Session stayed on the current model (same-or-stronger than the plan's Mid / medium).
- Ollama `ollama pull hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M` is the supported official-GGUF path; `/api/tags` reports that same tag. Not proven live on this host (no network pull in unit tests).
- SHA-256 from Hugging Face LFS metadata for `LFM2.5-2.6B-Q4_K_M.gguf` remains `79fdf00351b46cf26f020aead28d01889886be87c55fa0eb907e6f9b00bfee14` as of curation.
- LFM Open License v1.0 USD 10M cap is a use restriction; weights stay ungated (`gated` must stay false).

## 7. Testing Summary

- Installer: full pytest green; new `TestLfmLowVramAgentic`, cpu/4 GB tier tests, license-note card, ungated LFM router + gated-auth, Liquid AI in provider legend.
- Root: catalog entry + recommended.json placement; NexusModelRegistry list/install pulls `hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M`.
- Desktop: ModelSelector `data-task="agentic"`, Settings license note + License text link, installedProbe matches the hf.co tag.
- No vendor benchmark strings in card copy (invariant-enforced).

## 8. TODO Tracker

| Item | Status |
|---|---|
| 1.1 Catalog entry | Done |
| 1.2 recommended.json low-tier placement | Done |
| 1.3 License use-restriction label | Done |
| 1.4 Tests + CI + session history | Done |
| Phase 2 LFM harness profile | Next |
| DF-1..5 | Recorded in known-gaps |

## 9. Summary and Next Steps

Phase 1 curated LFM2.5-2.6B as the CPU / sub-4 GB Agentic default with a visible LFM Open License v1.0 use restriction and a real GGUF pin, pulled through Ollama's official-repo hf.co bridge. Next: Phase 2 characterize the local tool-call format, add a HarnessSelector profile, and resolve the 32K vs 128K context claim.

# Session History - v1.19.2 Phase 1: Catalog, Model, and Tier Additions

**Date**: 2026-08-19
**Version**: v1.19.2
**Plan**: [../../plans/v1.19.2-adoption-catalog-and-model-expansion.md](../../plans/v1.19.2-adoption-catalog-and-model-expansion.md)
**Phase**: 1 of 1 - Catalog, model, and tier additions + patient-tier calibration
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is true. Version bump, changelog, tag, and GitHub Release are owned by `/update release`.

## Goal

Extend the registry and installer so later plan-family phases have the model plumbing they need: calibrated patient-tier copy, merged `modalities` + `audioConditioning` schema, official-only precision-variant weight delivery, Hermes 3 family with harness profiles, Inkling-Small as an opt-in patient-tier GGUF, RAM-budget presets, and a skip-if-absent determinism assertion.

## Pre-flight

`is_final_phase` = **true** (this plan has a single phase; it is the numerically last phase; prior-phase completion is vacuously true). Adjacent v1.19.0 / v1.19.1 plans are already cut and do not keep this phase non-final. Model routing: plan recommended mid / medium (claude-sonnet-5 medium). Re-score of the cross-cutting catalog+installer+harness work is higher than that mid-tier note. Cursor cannot script a switch; this session stayed on the current model (Grok 4.6), which is same-or-stronger. Visible degrade: none. No silent downshift. The user pre-authorized Phase 1, then commit, push, then `/update release`.

## 1. Starting State

- **Branch**: `develop`
- **Environment**: Windows 10, root Vitest suite, desktop Vitest, installer pytest via uv
- **Prior session**: [2026-08-19_phase-2-agent-loop-and-guardrail-hardening.md](2026-08-19_phase-2-agent-loop-and-guardrail-hardening.md) (v1.19.1 cut)
- **Plan reference**: [v1.19.2-adoption-catalog-and-model-expansion.md](../../plans/v1.19.2-adoption-catalog-and-model-expansion.md)
- **Package version**: still 1.19.1 until `/update release`

## 2. Chronological Steps

### 2.1 Patient-tier throughput honesty (1.1)

**Plan specification**: Warning floor honest against ~0.03 tok/s; expected s/token and peak RSS fields where measurements exist.

**What happened**: `PATIENT_TIER_LATENCY_WARNING` now names ~0.03 tokens/sec, ~32 s/token laptop, ~19-21 s/token server. Patient-tier catalog fields: `expectedSecondsPerToken`, `measuredPeakRssGB`. Data and copy only.

**Key files**: `core/registry/patientTier.ts`, `core/registry/catalog.json`, `package.json` (setting description)

### 2.2 Modalities + audioConditioning (1.2)

**Plan specification**: One schema wave; backfill existing entries.

**What happened**: Types in `catalog.ts`. Video entries carry `audioConditioning: { supported: false, modes: [] }`. DiffusionTier video defaults: `{ enabled: false, modes: [] }`. Gemma 12B `["text","image"]`; faster-whisper `["audio"]`; others text-only unless already documented.

**Key files**: `core/registry/catalog.ts`, `core/registry/catalog.json`, `core/config/DiffusionTier.ts`

### 2.3 Quantized-weights variants (1.3)

**Plan specification**: Official precision-variant file sets; sha256 unchanged; no community quants.

**What happened**: `ModelWeightsVariant` with `official: true`. Puller `select_weights_variant` / `resolve_weights_variant_override` (`InstallerState.weights_variant` or `NEXUS_WEIGHTS_VARIANT`) plus host VRAM default. Unofficial variants fail closed. `pin-hf-weights.py` walks variant files. `InstallerState.models_root` was briefly dropped while adding `weights_variant` and was restored (see troubleshooting).

**Key files**: `scripts/installer/src/nexus_installer/engine/hf_weights_puller.py`, `scripts/installer/src/nexus_installer/installer_state.py`, `scripts/installer/build/pin-hf-weights.py`

### 2.4 Hermes-family catalog (1.4)

**Plan specification**: Hermes/Nous entries through existing Ollama pipeline; license + provenance; not a recommended.json surprise.

**What happened**: `hermes3:8b` (4.7 GB, 8 GB VRAM, 128K) and `hermes3:70b` (40 GB, `advanced` tag). Ollama library URLs. Llama 3.1 Community License. `agentic: true`. Coding `ModelCatalog` + `models.json` family `hermes`. Sidecar Zod `ModelFamily` includes `hermes`. Installer publisher map: family `hermes` -> Nous Research. `hermes3:70b` is excluded from `recommended.json`.

**Key files**: `core/registry/catalog.json`, `core/registry/ModelCatalog.ts`, `core/registry/models.json`, `desktop/sidecar/src/protocol.ts`

### 2.5 Hermes harness profiles (1.5)

**Plan specification**: Profiles + golden A/B.

**What happened**: Profile id `hermes-agentic` (concise, thinking on, budget 10%, `toolCallFormat: "llama3-json"`, `compactionThreshold: 0.8`, `userMessageTail: 3`). Fixture A/B: panel arm wins when the overlay is llama3-json. Live Hermes generate was not run (DF-1). `AgentLoop` still parses Gemma XML (DF-3).

**Key files**: `modules/coding/orchestration/HarnessSelector.ts`, `tests/unit/orchestration/HarnessSelectorAb.test.ts`

### 2.6 Inkling-Small patient-tier entry (1.6)

**Plan specification**: Opt-in, never-default, honest modalities, official GGUF line.

**What happened**: id `inkling-small`, tags `patient-tier` + `opt-in`, 74.8 GB, Apache-2.0. HF repo `unsloth/Inkling-Small-GGUF`, revision `1a19ef82883cb7b9c581b93c30ea252dabbf658d` (an older `8f64b86...` pin was not current HEAD and was replaced). Three UD-IQ1_S shards with real LFS sha256. `modalities: ["text"]` with copy that native multimodal is unverified at this GGUF. Hidden unless `NEXUS_PATIENT_TIER=1`. Never in `recommended.json`.

**Key files**: `core/registry/catalog.json`, `scripts/installer/tests/test_patient_tier_gate.py`

### 2.7 RAM-budget presets + determinism (1.7)

**Plan specification**: laptop / workstation / max copy; skip-if-absent byte-identical assertion.

**What happened**: `PATIENT_TIER_RAM_PRESETS` plus setting `nexus.llm.patientTier.ramPreset`. `runDeterminismAcrossBudget` / `isPatientTierAdapterRegistered` (`NEXUS_PATIENT_TIER_ADAPTER`). Types live on `catalog.ts` so `patientTier.ts` imports catalog one-way (depcruise cycle removed).

**Key files**: `core/registry/patientTier.ts`, `core/registry/catalog.ts`, `modules/coding/config/settings.ts`, `modules/coding/evaluation/GoldenTaskRunner.ts`

### 2.8 Testing and CI (1.8)

**Plan specification**: schema + installer + harness + lint/typecheck; path filters.

**What happened**: Unit tests for schema, Hermes, Inkling, presets, unofficial-variant rejection, puller selection, patient-tier gate, fixture A/B, determinism skip/identical/mismatch. Installer-tests.yml path filters now include `patientTier.ts` and `core/config/**`. Coverage augmentation added rejection tests for weights/modality/audio/preset/MoE error paths (`catalog.ts` 97.04% lines on the targeted pass).

**Key files**: `tests/unit/core/registry/catalog.test.ts`, `.github/workflows/installer-tests.yml`

### 2.9 Troubleshooting

- **Problem**: Adding `weights_variant` deleted `InstallerState.models_root`, causing mass `TypeError: unexpected keyword argument 'models_root'`.
- **Resolution**: Keep both fields.
- **Problem**: Inkling `source.revision` `8f64b86...` was not current `main`.
- **Resolution**: Pin `1a19ef82883cb7b9c581b93c30ea252dabbf658d`.
- **Problem**: Inserting the Hermes harness test ate the LFM `it("maps an lfm2.5 id...")` header.
- **Resolution**: Restored the LFM test header.
- **Problem**: `catalog.ts` <-> `patientTier.ts` type import cycle (depcruise warning).
- **Resolution**: Move `PatientRamPreset` types into `catalog.ts`; re-export from `patientTier.ts`.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run lint` | Pass (0 errors) |
| `npx tsc -b` | Pass |
| `npm run check-architecture` | Pass (0 errors; catalog/patientTier cycle gone) |
| Root Vitest + coverage | 466 files passed / 3 skipped; 5072 tests passed / 11 skipped; lines 87.77 / branches 83.95 / functions 91.35 |
| Installer pytest | Pass (3 skipped) |
| Desktop lint + coding-models/protocol | 25 tests passed |
| Ruff on touched installer files | Pass after format |

## 4. Known Issues

Recorded in [known-gaps.md](../../known-gaps.md) under `## v1.19.2`: DF-1 live Hermes A/B, DF-2 Inkling GGUF text-only, DF-3 AgentLoop Gemma XML, DF-4 determinism skip-if-absent.

## 5. Plan Discrepancies

None that change scope. `# DEVIATION:` none. Fixture A/B instead of a live Hermes generate is DF-1, matching the LFM cycle's evidence rule (`not_observed != absent`).

## 6. Assumptions Made

- Unsloth UD-IQ1_S is an established GGUF line for this entry, not an unvetted community re-quant (`official: true`).
- Patient-tier RAM numbers are seeded from the kimi-k3-in-c K2 measurement and applied as expectation copy on Inkling until a local Inkling RSS sample exists.
- Cursor picker-only: staying on Grok 4.6 satisfies the no-degradation rule against a mid-tier plan recommendation.

## 7. Testing Summary

See Verification Gate. New tests cover unofficial variants, invalid modalities/audio/presets, Hermes profile selection, Inkling gate, puller variant selection, and determinism skip/identical/mismatch. Hermes A/B is fixture-only.

## 8. TODO Tracker

| Sub-task | Status |
|---|---|
| 1.1 Patient-tier throughput honesty | Done |
| 1.2 modalities + audioConditioning | Done |
| 1.3 Quantized-weights variants | Done |
| 1.4 Hermes catalog | Done |
| 1.5 Hermes harness | Done (fixture A/B) |
| 1.6 Inkling-Small | Done |
| 1.7 RAM presets + determinism | Done |
| 1.8 Tests + CI | Done |

## 9. Summary and Next Steps

Phase 1 of v1.19.2 is complete and is the final phase of this plan. Next: commit and push, then `/update release` (version 1.19.2, changelog, README What's new, tag, GitHub Release) behind confirmation gates. Do not add Inkling or hermes3:70b to `recommended.json`. Do not claim a live Hermes eval.

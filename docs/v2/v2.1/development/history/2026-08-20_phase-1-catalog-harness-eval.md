# Session History - v2.1.0 Phase 1: Model Catalog Expansion + Harness Profiles

**Date**: 2026-08-20
**Version**: v2.1.0
**Plan**: [../../plans/v2.1.0-adoption-open-local-ai-wave.md](../../plans/v2.1.0-adoption-open-local-ai-wave.md)
**Phase**: 1 of 7 - Model Catalog Expansion + Harness Profiles
**Outcome**: Complete. Muse Glimmer and Nemotron Lightning are catalogued with harness profiles, VRAM/Ollama gates, and `localEval.status: not_run`. `recommended.json` is unchanged.

## Goal

Ship Muse Glimmer 30B and Nemotron 3.5 Lightning 30B-A3B as tier-gated catalog models with harness profiles, add Unsloth Dynamic quant references and catalog capability flags, and re-verify vendor benchmarks with the local golden-task harness before any default-route promotion.

## Pre-flight

`is_final_phase` = **false** (Phase 7 is the last phase). Model routing: plan recommended strong / medium. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-7 with local commits after 1-6, then Phase 7 commit and push, a historical known-gaps sweep, and `/update release`.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `8559684` (docs: regenerate src module catalog after browser tools)
- **Environment**: Windows 10, root Vitest, desktop Vitest, installer pytest
- **Package version**: 2.0.0 (version bump waits for `/update release` after Phase 7)

## 2. Chronological Steps

### 2.1 Muse Glimmer catalog + quant tiers (1.1)

**Plan specification**: Apache-2.0, `meta-models/Muse-Glimmer-30B-GGUF`, Ollama >= 0.32.7. K-Quant-17GB at 24 GB, K-Quant-Dynamic at 32 GB, hidden below 16 GB. Vendor SWE-Bench Verified 76.0 flagged `vendorReported: true` and kept out of card copy.

**What happened**: `muse-glimmer:30b` and `muse-glimmer:30b-dynamic` in `catalog.json`, `models.json`, and `ModelCatalog.ts`. Installer `_sorted_section_models` skips `hideBelowVramGB`. Content invariants require the pair, Apache-2.0, 0.32.7, hide 16, and forbid SWE-Bench / 76.0 in card copy.

**Key files**: `core/registry/catalog.json`, `scripts/installer/src/nexus_installer/catalog_invariants.py`, `scripts/installer/src/nexus_installer/pages/typed_catalog.py`

### 2.2 Muse Glimmer harness profile (1.2)

**Plan specification**: reasoning-strength plumbing, function-calling template, long-horizon conventions.

**What happened**: Named profile `muse-glimmer` (strong, detailed, thinking on, 14% budget, llama3-json, compaction 0.85 / tail 5, `reasoningStrength: medium`). `toRuntimeOptions` / `applyReasoningStrength` drop the parameter when the served model rejects it and log the downgrade in HarnessSelector memory (not InferenceMetrics). Per-session isolation already exists via `HarnessSessionOverride`.

**Key files**: `modules/coding/orchestration/HarnessSelector.ts`

### 2.3 Lightning dual-tier + harness (1.3)

**Plan specification**: OpenMDW-1.1, ggml-org GGUF, Ollama >= 0.32.9, Q4_K_M at 24 GB, expert-offload at 16 GB, `role: worker-candidate`, Qwen3-Coder-style parser.

**What happened**: `nemotron-lightning:30b-a3b` and `:30b-a3b-offload`. Harness profile `lightning-worker` (weak, concise, thinking off, 8% budget, qwen-json). Reuses the existing qwen-json parser. No new parser.

**Key files**: `core/registry/catalog.json`, `core/registry/ModelCatalog.ts`, `HarnessSelector.ts`

### 2.4 Unsloth Dynamic audit + flags + watch item (1.4)

**Plan specification**: Swap artifacts where Dynamic is strictly better; add `diffusion` / `codingEligible`; record DiffusionGemma watch item.

**What happened**: No artifact swaps. Ollama-library LLMs cannot move onto Unsloth `hf.co` GGUF (v1.15.0 Gemma HTTP 400 invariant). Inkling-Small already ships UD-IQ1_S. Schema flags default via `normalizeSpec`. DF-1 DiffusionGemma watch item in `docs/v2/v2.1/known-gaps.md`. DF-3 records the audit as resolved. Training-recipe skill added for Phase 5.

**Key files**: `core/registry/catalog.ts`, `docs/v2/v2.1/known-gaps.md`, `modules/coding/skills/catalog/training-recipe/SKILL.md`

### 2.5 Local golden-task re-verification (1.5)

**Plan specification**: Run both models on a 24 GB host; persist `localEval`; propose default-route changes only from a recorded local result.

**What happened**: `runCatalogModelEval` refuses below-tier hosts, serializes GPU-bound runs, and marks timeout/OOM `incomplete`. This cycle had no proven 24 GB host with either model loaded. Persisted `not_run` document at `docs/v2/v2.1/benchmarks/local-eval-muse-glimmer-nemotron-lightning.json`. Default-route proposal: no-change. DF-2.

**Key files**: `modules/coding/evaluation/localCatalogEval.ts`

### 2.6 Tests and CI (1.6)

Root unit tests for catalog schema, visibility, ModelCatalog families, harness selection, local-eval stub, SkillLoader. Desktop family enum. Installer hide/show and invariants. No new CI job: `ci.yml` `test-ts` already runs root + desktop vitest; `installer-tests.yml` already path-filters `catalog.json` and `scripts/installer/**`. Concurrency cancel-in-progress and npm/uv caches already present. No CI rewrite.

## 3. Verification Gate

| Check | Result |
|---|---|
| Root Vitest (Phase 1 files) | PASS 145 tests / 8 files |
| Coverage on catalog.ts, catalogVisibility.ts, HarnessSelector.ts, localCatalogEval.ts | 96.1% lines / 89.0% branches / 100% functions |
| Desktop coding-models + coding-protocol | PASS 25 |
| Installer catalog pytest | PASS |
| `tsc -b` | PASS |
| ESLint on changed coding modules | PASS |
| ruff on changed installer files | PASS |
| Skill prompt check | PASS for training-recipe; 2 pre-existing oversized warnings on unrelated skills |

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| DiffusionGemma not catalogued | P2 | Deferred (DF-1) |
| Live 24 GB golden-task not run | P1 | Deferred (DF-2); `not_run` not a silent pass |
| Unsloth Dynamic no-swap | P3 | Resolved (DF-3) |
| Coding dropdown still lists all ModelCatalog ids | P3 | Installer hide is the Phase 1 acceptance; `catalogVisibility` is the runtime helper for later surfaces |

## 5. Plan Discrepancies

- Reasoning-strength downgrades live in HarnessSelector memory, not InferenceMetrics records (smaller blast radius; consumers can still read `reasoningStrengthDowngrades()`).
- Muse/Lightning GGUF rows have no `weights.files` SHA pins (LFM still does). Invariants require the HF path, not a pin.
- Muse `advanced` tag is load-bearing so 4B active params do not classify the harness as weak.

## 6. Assumptions

- Meta K-Quant-17GB / Dynamic labels and ggml-org Q4_K_M tags match the plan's published Ollama hf.co bridge names.
- Muse GGUF in this cycle is text-only (`modalities: ["text"]`). Vision projector check is Phase 4.
- Installer catalog page often runs before Ollama is installed, so unknown version must not hide.

## 7. Testing Summary

See Verification Gate. Golden-task smoke used a stubbed `AgentDriver`. Live Ollama pull/load of the 30B models was not observed.

## 8. TODO Tracker

Phase 1 sub-tasks 1.1-1.6 complete. Next: Phase 2 adaptive routing.

## 9. Summary and Next Steps

Phase 1 is ready to advance. Do not promote Muse or Lightning onto `recommended.json` until DF-2 records a passing local eval. Phase 2 consumes Lightning `role: worker-candidate` and the new harness profiles.

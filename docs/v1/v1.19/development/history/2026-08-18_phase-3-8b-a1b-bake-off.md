# Session History - v1.19.0 Phase 3: 8B-A1B Bake-off + Watchlist

**Date**: 2026-08-18
**Version**: v1.19.0
**Plan**: [../../plans/v1.19.0-adoption-liquid-lfm-agentic.md](../../plans/v1.19.0-adoption-liquid-lfm-agentic.md)
**Phase**: 3 of 4 - 8B-A1B Bake-off (A2, P2) + Watchlist
**Outcome**: Complete. Verdict **DECLINE** (no catalog row). `is_final_phase` is false.

## Goal

Close LFM2.5-8B-A1B with the pre-committed rule (catalog entry only on a quality-per-GB win vs `qwen2.5-coder:14b` and `deepseek-coder-v2:16b`) and record the P3 watchlist.

## Pre-flight

`is_final_phase` = **false**. Prior phases 1-2 committed (`58e2293`, `6a8e3f0`). Plan recommended Mid / medium. Cursor picker-only; stayed on current model. No silent downshift. N1: no hosted inference.

## 3.1 Bake-off

Rule fixed first. Official GGUF is `LiquidAI/LFM2.5-8B-A1B-GGUF` Q4_K_M (5.16 GB). This host had `qwen2.5-coder:14b` installed, not DeepSeek 16B, and did not pull the 8B-A1B GGUF. No golden-task pass_rate was measured for any of the three. `not_observed != absent`.

Record: [../../development/2026-08-18_lfm25-8b-a1b-bake-off.md](../../development/2026-08-18_lfm25-8b-a1b-bake-off.md).

## 3.2 Verdict + watchlist

**DECLINE**: no `catalog.json` / `recommended.json` / `ModelCatalog` row. Watchlist (notes only): LFM2.5-VL deferred (existing multimodal coverage); PII-extract Nano deferred (possible future `redactSecrets` aid, no build). DF-7 opened to re-run when all three GGUFs are local.

## 3.3 Tests

Absence guards: catalog.test.ts, ModelCatalog.test.ts, installer `test_phase3_decline_keeps_8b_a1b_out_of_the_repo_catalog`. No product-code change.

## Gates

- Absence guards: catalog.test.ts, ModelCatalog.test.ts, installer invariants (green)
- Root **4947 passed / 11 skipped / 0 failed**. Desktop **971 passed**. Lint + `tsc -b` clean. `check-catalog.py` 41 models.

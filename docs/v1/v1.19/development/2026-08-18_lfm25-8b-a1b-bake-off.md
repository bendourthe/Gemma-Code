# LFM2.5-8B-A1B bake-off (v1.19.0 Phase 3)

**Date**: 2026-08-18
**Plan**: [../plans/v1.19.0-adoption-liquid-lfm-agentic.md](../plans/v1.19.0-adoption-liquid-lfm-agentic.md)
**Host**: local Ollama only (N1). No Liquid-hosted inference.

## Pre-committed decision rule

LFM2.5-8B-A1B earns a `catalog.json` row **only if** it beats both incumbent 12-14 GB agentic entries on **agentic golden-task quality per GB of VRAM**:

- Incumbent A: `qwen2.5-coder:14b` (`vramGB` 12, `sizeGB` 8.2)
- Incumbent B: `deepseek-coder-v2:16b` (`vramGB` 14, `sizeGB` 8.9)

Score: `pass_rate / vramGB` on the same held-out golden split, same `HarnessSelectorAb` rollout seam, local GGUF / Ollama. A tie is not a win. Vendor blog numbers (tok/s, ToolSandbox, BFCL) are not evidence.

## Candidate (not catalogued)

| Field | Value | Evidence |
|---|---|---|
| Official GGUF | `LiquidAI/LFM2.5-8B-A1B-GGUF` `Q4_K_M` | Hugging Face card, fetched 2026-08-18 |
| On-disk | 5.16 GB | same card |
| Architecture | MoE, 8.3B total / 1.5B active | Liquid docs `lfm25-8b-a1b` |
| Claimed context | 128K | vendor docs; **not probed here** |
| License | LFM Open License v1.0 (same USD 10M cap as 2.6B) | not applied; no catalog row |

A fair VRAM denominator for the rule would be the catalog `vramGB` we would ship (likely 8 GB class). That number was never needed because no pass_rate was measured.

## Task set (intended)

Reuse the YAML corpus under `tests/golden/tasks/` via `goldenTaskLoader` / `HarnessSelectorAb`, plus the Phase 2 LFM profile (`lfm-agentic`) if the 8B-A1B emission matches `lfm-pythonic`. Do not invent a second harness.

## What actually ran on this host

| Model | Local Ollama | Golden-task pass_rate | Context probe |
|---|---|---|---|
| `qwen2.5-coder:14b` | installed (9.0 GB blob) | not scored this phase | not run |
| `deepseek-coder-v2:16b` | **not installed** | not scored | not run |
| `hf.co/LiquidAI/LFM2.5-8B-A1B-GGUF:Q4_K_M` | **not pulled** (~5.16 GB) | not scored | not run |

A three-model live bake-off would have meant another ~14 GB of weights (8B-A1B + DeepSeek 16B) plus a full golden split on each. That run did not happen here. Phase 2 already used the 2.6B GGUF for format characterization; that result does not transfer to 8B-A1B quality-per-GB.

`not_observed != absent`: this note does **not** claim 8B-A1B is worse than the incumbents. It claims a **win was not demonstrated**.

## Verdict

**DECLINE** for `catalog.json` / `recommended.json` / Coding `ModelCatalog` in v1.19.0.

No row, no pin, no license widget, no tier default. The 2.6B entry is unchanged. `HarnessSelector` already maps an `lfm2.5:*` id to `lfm-agentic` if someone runs the GGUF later; that is profile data, not a catalog recommendation.

Re-open only with a dated local table of pass_rate / vramGB for all three models on the same split.

## P3 watchlist (notes only, no build)

| Item | Why not this cycle | Possible later use |
|---|---|---|
| LFM2.5-VL (and other VL siblings) | Image Studio already has a multimodal path; a second VL family is catalog expansion, not the low-VRAM agentic gap | Revisit under a vision-catalog plan, not v1.19.0 |
| PII-extract Nano | Task-specific Nano; Nexus already has `redactSecrets` / env scrubbing | Possible future local aid to those scrubbers; do not bundle weights |

Neither item gets a catalog row, installer checkbox, or harness profile in this cycle.

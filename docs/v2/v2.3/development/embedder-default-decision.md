# Required embedder default (v2.3.1)

**Date**: 2026-08-29
**Plan**: [v2.3.1-installer-field-repair.md](../plans/v2.3.1-installer-field-repair.md) T016
**Decision**: **KEEP** `nomic-embed-text` as the required memory embedder

## Options

| Id | Policy |
|---|---|
| KEEP | Leave Nomic Embed Text required. EmbeddingGemma stays opt-in. No reindex. |
| SWITCH | Promote EmbeddingGemma to required, change `recommended.json` embed lists and `package.json` `nexus.memory.embeddingModel`, and ship a named reindex tool plus a one-time wizard warning. |

## Facts

- Operator asked about "GemmaEmbedding 300B". That name is wrong. Catalog id is `embeddinggemma`. Display name is **EmbeddingGemma 300M** (300 million parameters, Ollama tag `300m`, 0.62 GB, 2K context, Gemma Terms of Use).
- Nomic Embed Text is Apache-2.0, 8K context, 0.27 GB. `CatalogModel.is_required` is hardcoded to `nomic-embed-text`. Every `recommended.json` tier `embed` list is `["nomic-embed-text"]`. `package.json` `nexus.memory.embeddingModel` defaults to `nomic-embed-text`.
- Existing semantic memory indexes are Nomic-shaped. Switching the required embedder without a reindex would silently mismatch stored vectors.

## Chosen policy

1. **KEEP** Nomic as the only required embedder for v2.3.1.
2. EmbeddingGemma stays opt-in. Catalog copy must say **300M** and must not say **300B**.
3. Two required embedders are forbidden.
4. SWITCH is out of scope this cycle: this file does not name a reindex tool or a wizard warning, so T017 must not change `is_required`, embed defaults, or the settings default.

## Not in this decision

A dedicated "Newer opt-in" status chip is not added. The card ladder is Required / hardware / Recommended / Compatible. EmbeddingGemma already uses `whyRecommended` and differentiators for the opt-in story. Do not steal Compatible.

# Known Gaps - v1.19

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-18

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.19.0-adoption-liquid-lfm-agentic.md](plans/v1.19.0-adoption-liquid-lfm-agentic.md)

## v1.19.0

**Summary**: 4 open items after Phase 3 (8B-A1B bake-off declined) - 0 NI, 4 DF, 0 MT. No suppressed warnings, no bypassed gates.

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 4 | 3 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-2 - LFM is pulled through Ollama's hf.co bridge, not the Hugging Face weights puller

- **Source phase**: Phase 1 - Catalog entry (A1 sourcing)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 1.1)
- **Reason**: The official Ollama library does not carry LFM2.5-2.6B. The installer LLM path is Ollama; an HF-protocol GGUF would land under `~/.nexus/models/weights/<id>/` and would not run in Coding/Chat. Shipped `source.protocol` is `ollama` with `ollama://hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M`. `weights.files[]` still records the real SHA-256 so invariants can require a non-placeholder pin. Community Ollama tags were rejected.
- **Suggested next step**: Do not switch this entry to `protocol: "huggingface"` unless an Ollama import path exists. If Liquid publishes an official Ollama library tag, re-point `source.url` and keep the pin.

##### DF-3 - Catalog `origin` is the country `USA`, not the publisher name Liquid AI

- **Source phase**: Phase 1 - Catalog entry metadata
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 1.1)
- **Reason**: `origin` is a country (or "Community") chip. Publisher color comes from `family` `lfm2.5` -> `Liquid AI` in the installer constants map. Display name and description name Liquid AI.
- **Suggested next step**: Leave the schema as country. Do not overload `origin` with a vendor name.

##### DF-6 - Coding AgentLoop still parses Gemma XML, not LFM pythonic spans

- **Source phase**: Phase 2 - LFM harness profile (A3)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 2.2)
- **Reason**: [`ToolCallFormat.ts`](../../../modules/coding/llm/ToolCallFormat.ts) now has `lfm-pythonic`, and `HarnessSelector` pins it on the LFM overlay. [`AgentLoop`](../../../src/tools/AgentLoop.ts) and [`HeadlessAgentSession`](../../../modules/coding/runtime/HeadlessAgentSession.ts) still call `Gemma4ToolFormat.parseToolCalls`. That is pre-existing for Llama/Qwen/DeepSeek as well. Listing LFM in Coding `ModelCatalog` does not yet make the live agent execute LFM tool calls.
- **Suggested next step**: Dispatch `getToolCallFormat(entry.toolFormat).parse` from the composition root (or a model-aware `ToolCallParser`) without changing Gemma's path when `toolFormat` is `gemma4-xml`.

##### DF-7 - LFM2.5-8B-A1B catalog row declined this cycle (win not demonstrated)

- **Source phase**: Phase 3 - 8B-A1B bake-off (A2)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 3.1)
- **Reason**: Pre-committed rule requires a measured golden-task quality/GB win against `qwen2.5-coder:14b` and `deepseek-coder-v2:16b`. That three-model local run was not completed (8B-A1B GGUF not pulled; DeepSeek 16B not installed). `not_observed != absent`. No catalog row. Record: [development/2026-08-18_lfm25-8b-a1b-bake-off.md](development/2026-08-18_lfm25-8b-a1b-bake-off.md).
- **Suggested next step**: Re-open only with a dated pass_rate/vramGB table for all three local GGUFs on the same golden split. Do not add the row on vendor blog numbers.

### Resolved

##### DF-1 - Coding-engine ModelCatalog / FRONTEND_MODELS does not list LFM2.5-2.6B

- **Source phase**: Phase 1; closed Phase 2
- **Resolution**: `core/registry/ModelCatalog.ts` and `core/registry/models.json` gained `lfm2.5:2.6b` (`family: lfm2.5`, `promptFormat: lfm`, `toolFormat: lfm-pythonic`). Desktop `FRONTEND_MODELS` is derived from that list. Sidecar `ModelFamily` enum includes `lfm2.5`.

##### DF-4 - Context window is recorded conservatively at 32K

- **Source phase**: Phase 1; closed Phase 2
- **Resolution**: Local Ollama `api/show` reports `lfm2.context_length: 128000`. Generates with `num_ctx=40960` and `num_ctx=131072` succeeded on a short prompt (full-length fill not run). `catalog.json` `contextWindow` is 128000. Copy no longer says pending.

##### DF-5 - `toolCallingVerified` is omitted on the LFM row

- **Source phase**: Phase 1; closed Phase 2
- **Resolution**: Local GGUF emitted `<|tool_call_start|>[get_candidate_status(candidate_id='12345')]<|tool_call_end|>`. Fixture A/B: LFM profile net win vs default gemma4-xml. Flag set with suite `nexus-harness-ab-lfm-local` dated 2026-08-18. Not a hosted eval.

# Known Gaps - v1.19

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-19

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.19.0-adoption-liquid-lfm-agentic.md](plans/v1.19.0-adoption-liquid-lfm-agentic.md)

Carry-forward source: [../v1.18/known-gaps.md](../v1.18/known-gaps.md) (v1.18.0 cycle items stay in that file; this cycle does not close them). Sibling subplans [v1.19.1](plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md) and [v1.19.2](plans/v1.19.2-adoption-catalog-and-model-expansion.md) keep this file in-progress after the v1.19.0 plan's Phase 4 reconciliation.

## v1.19.0

**Summary**: 8 open items after Phase 4 close-out - 0 NI, 8 DF, 0 MT. No suppressed warnings, no bypassed gates. v1.19.0 cycle items reconciled; file stays in-progress for sibling subplans.

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 8 | 4 |
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
- **Reason**: [`ToolCallFormat.ts`](../../../modules/coding/llm/ToolCallFormat.ts) now has `lfm-pythonic`, and `HarnessSelector` pins it on the LFM overlay. [`AgentLoop`](../../../src/tools/AgentLoop.ts) and [`HeadlessAgentSession`](../../../modules/coding/runtime/HeadlessAgentSession.ts) still call `Gemma4ToolFormat.parseToolCalls`. That is pre-existing for Llama/Qwen/DeepSeek as well. Listing LFM in Coding `ModelCatalog` does not yet make the live agent execute LFM tool calls. v1.19.1 is loop-hardening (guards, denials), not format dispatch.
- **Suggested next step**: Dispatch `getToolCallFormat(entry.toolFormat).parse` from the composition root (or a model-aware `ToolCallParser`) without changing Gemma's path when `toolFormat` is `gemma4-xml`.

##### DF-7 - LFM2.5-8B-A1B catalog row declined this cycle (win not demonstrated)

- **Source phase**: Phase 3 - 8B-A1B bake-off (A2)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 3.1)
- **Reason**: Pre-committed rule requires a measured golden-task quality/GB win against `qwen2.5-coder:14b` and `deepseek-coder-v2:16b`. That three-model local run was not completed (8B-A1B GGUF not pulled; DeepSeek 16B not installed). `not_observed != absent`. No catalog row. Record: [development/2026-08-18_lfm25-8b-a1b-bake-off.md](development/2026-08-18_lfm25-8b-a1b-bake-off.md).
- **Suggested next step**: Re-open only with a dated pass_rate/vramGB table for all three local GGUFs on the same golden split. Do not add the row on vendor blog numbers.

##### DF-8 - LFM2.5-VL (and other VL siblings) stay off the catalog

- **Source phase**: Phase 3 - P3 watchlist
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 3.2)
- **Reason**: Image Studio already has a multimodal path. A second VL family is catalog expansion, not the low-VRAM agentic gap this cycle closed.
- **Suggested next step**: Revisit under a vision-catalog plan (v1.19.2 modality schema or a later Image Studio cycle). Do not add a VL row from this watchlist alone.

##### DF-9 - Liquid PII-extract Nano is not wired into redactSecrets

- **Source phase**: Phase 3 - P3 watchlist
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 3.2)
- **Reason**: Task-specific Nano. Nexus already has `redactSecrets` / env scrubbing. No weights bundled (N2).
- **Suggested next step**: If a later observability cycle wants a local PII model as an aid to those scrubbers, evaluate it as an optional local tool, not a default catalog row.

##### DF-10 - 128K context is GGUF metadata plus a short-prompt generate, not a full-length fill

- **Source phase**: Phase 2 - context probe; recorded Phase 4
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 2.1)
- **Reason**: Local `api/show` reports `lfm2.context_length: 128000`. Generates with `num_ctx=40960` and `num_ctx=131072` succeeded on a short prompt. A 128K-token fill was not run. Catalog `contextWindow` is 128000.
- **Suggested next step**: Optionally probe a long fill on a machine that can hold KV at 128K. Do not lower the catalog figure without a failed generate.

##### DF-11 - Vendor LFM benchmarks must not appear in catalog copy until corroborated

- **Source phase**: Phase 1 - card copy; standing rule, recorded Phase 4
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (Overview; Section 9)
- **Reason**: ToolSandbox / BFCLv4 / tok/s figures are vendor-reported. Installer invariants already reject those tokens in `whyRecommended`. No independent local score exists for 2.6B or 8B-A1B.
- **Suggested next step**: Cite a number in card copy only after a dated local or independently published reproduction. The 8B-A1B bake-off rule (DF-7) is the same bar.

### Resolved

##### DF-1 - Coding-engine ModelCatalog / FRONTEND_MODELS does not list LFM2.5-2.6B

- **Source phase**: Phase 1; closed Phase 2
- **Resolution**: `core/registry/ModelCatalog.ts` and `core/registry/models.json` gained `lfm2.5:2.6b` (`family: lfm2.5`, `promptFormat: lfm`, `toolFormat: lfm-pythonic`). Desktop `FRONTEND_MODELS` is derived from that list. Sidecar `ModelFamily` enum includes `lfm2.5`.

##### DF-4 - Context window is recorded conservatively at 32K

- **Source phase**: Phase 1; closed Phase 2
- **Resolution**: Local Ollama `api/show` reports `lfm2.context_length: 128000`. Generates with `num_ctx=40960` and `num_ctx=131072` succeeded on a short prompt (full-length fill not run; remainder is DF-10). `catalog.json` `contextWindow` is 128000. Copy no longer says pending.

##### DF-5 - `toolCallingVerified` is omitted on the LFM row

- **Source phase**: Phase 1; closed Phase 2
- **Resolution**: Local GGUF emitted `<|tool_call_start|>[get_candidate_status(candidate_id='12345')]<|tool_call_end|>`. Fixture A/B: LFM profile net win vs default gemma4-xml. Flag set with suite `nexus-harness-ab-lfm-local` dated 2026-08-18. Not a hosted eval.

##### DF-12 - Desktop picker tests did not run on develop CI

- **Source phase**: Phase 4 - CI/CD
- **Resolution**: `ci.yml` `test-ts` (Node 22) now runs `npm run test:shell`. `shell-build.yml` still covers main. Installer pytest moved to path-filtered `installer-tests.yml`.

### Phase 4 reconciliation

v1.18 items (DF-1..8, DF-10..15) stay in [../v1.18/known-gaps.md](../v1.18/known-gaps.md). This cycle does not close them. Closest relatives: v1.18 DF-3 (sidecar overlay) and DF-15 (selector default off) sit beside v1.19 DF-6 (AgentLoop Gemma XML).

No release-blockers. Remaining v1.19.0 work is later-cycle (parser dispatch, 8B-A1B re-run, VL/PII watchlist).

_Last updated: 2026-08-19 (v1.19.0 tagged; file in-progress for v1.19.1 / v1.19.2)._

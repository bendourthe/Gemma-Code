# Session History - v1.19.0 Phase 2: LFM Harness Profile

**Date**: 2026-08-18
**Version**: v1.19.0
**Plan**: [../../plans/v1.19.0-adoption-liquid-lfm-agentic.md](../../plans/v1.19.0-adoption-liquid-lfm-agentic.md)
**Phase**: 2 of 4 - LFM Harness Profile (A3, P1)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 4 is terminal).

## Goal

Select a correct, A/B-validated harness profile for LFM tool-call output, and correct the catalog context length to the empirically recorded figure.

## Pre-flight

`is_final_phase` = **false** (Phase 4 is Architecture Refactor, Known-Gaps Reconciliation, and CI/CD). Prior phase: Phase 1 complete (`58e2293`). Model routing: plan recommended Mid-strong / high. Cursor is picker-only; the session stayed on the current model (Grok 4.6), same-or-stronger. Visible degrade: map refresh was not re-run as a blocking gate. No silent downshift.

## 1. Starting State

- **Branch**: `develop` tracking `origin/develop`, 1 commit ahead after Phase 1
- **Environment**: Windows 10, PowerShell, Ollama 0.24.0 local
- **Plan reference**: [v1.19.0-adoption-liquid-lfm-agentic.md](../../plans/v1.19.0-adoption-liquid-lfm-agentic.md)

## 2. Chronological Steps

### 2.1 Characterize the LFM tool-call output format

**Plan specification**: Local Ollama/llama.cpp only (N1). Capture delimiters, JSON vs pythonic shape, failure modes. Probe beyond 32K.

**What happened**: Pulled `hf.co/LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M` (~1.67 GB) via the local Ollama API. Official docs (fetched 2026-08-18): `<|tool_call_start|>[fn(arg="value")]<|tool_call_end|>`, ChatML + `<|startoftext|>`. Live emission matched that grammar with two quirks vs the docs example: `<think>...</think>` before the span, and single-quoted kwargs (`candidate_id='12345'`). Captured fixture: `tests/unit/orchestration/fixtures/lfmToolCallFixtures.ts` (`LFM_LIVE_LOCAL`). `api/show` reports `lfm2.context_length: 128000`. Short-prompt generates succeeded at `num_ctx=40960` and `num_ctx=131072`. Full-length fill was not run. No hosted endpoint.

**Verification**: Live string parses under `lfm-pythonic`; gemma4-xml returns []. Catalog `contextWindow` set to 128000.

### 2.2 Implement the LFM profile in HarnessSelector

**Plan specification**: Additive family/id match. A/B vs default on fixtures and local runs. Keep profile on win/tie. Correct context if verified.

**What happened**: Named profile `lfm-agentic` (concise, thinking on, budget 12%, `toolCallFormat: lfm-pythonic`). `FAMILY_PROFILE_IDS["lfm2.5"]` plus id/tag fallback. Parser and ChatML `lfm` prompt format in `modules/coding/llm/`. Coding `ModelCatalog` / `models.json` / sidecar `ModelFamily` gained `lfm2.5:2.6b` (closes DF-1). Fixture A/B: selected overlay parses every well-formed golden; default gemma4-xml parses none. Profile retained. `HARNESS_SELECTOR_SHIPPED_DEFAULT` stays false (global selector gate is a live weak-model quality A/B, not this parse A/B). `toolCallingVerified` set with suite `nexus-harness-ab-lfm-local`.

`# DEVIATION:` AgentLoop / HeadlessAgentSession still call `Gemma4ToolFormat.parseToolCalls` (pre-existing for every non-Gemma family). Logged as DF-6 rather than rewriting the loop in this phase.

**Verification**: `defaultHarnessSelector.select("lfm2.5:2.6b")` reason `family`, profile `lfm-agentic`. qwen/deepseek/llama/gemma profiles unchanged. Unknown ids still default.

### 2.3 Testing and Stabilization

**Plan specification**: HarnessSelector + HarnessSelectorAb + fixture parse including malformed. `npm test` + lint. CI cover orchestration.

**What happened**: Tests in `HarnessSelector.test.ts`, `HarnessSelectorAb.test.ts`, `ToolCallFormat.test.ts`, `PromptFormat.test.ts`, `ModelCatalog.test.ts`, desktop protocol/models. CI `test-ts` already runs full `npm test` (no path-filter hole). No workflow rewrite.

**Verification**: See gates below.

## 3. Quality Gates

- Root Vitest: **4944 passed / 11 skipped / 0 failed** (459 files)
- Desktop: **971 passed** (112 files)
- Installer pytest (catalog invariants / typed catalog / tier defaults): green
- Lint (root + desktop): 0 errors
- `tsc -b`: clean
- `check-catalog.py`: 41 models OK
- Targeted coverage (harness + formats): 92.17% statements / 77.59% branches / 100% functions on that slice. Extra parser cases added after the first coverage pass. Full-repo coverage not re-cut this phase.
- No hosted inference (N1)

## 4. Known Gaps

Closed DF-1, DF-4, DF-5. Open: DF-2 (Ollama hf.co bridge), DF-3 (origin country), DF-6 (AgentLoop Gemma XML).

## 5. Ready for Phase 3

Yes. Bake-off of LFM2.5-8B-A1B against qwen2.5-coder:14b and deepseek-coder-v2:16b, local GGUF only.

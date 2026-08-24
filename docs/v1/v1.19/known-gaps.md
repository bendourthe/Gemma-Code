# Known Gaps - v1.19

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-20

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plans: [v1.19.0](plans/v1.19.0-adoption-liquid-lfm-agentic.md) (cut), [v1.19.1](plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md) (cut), [v1.19.2](plans/v1.19.2-adoption-catalog-and-model-expansion.md) (cut; open DF carry into v2.0.0).

Carry-forward source: [../v1.18/known-gaps.md](../v1.18/known-gaps.md) (v1.18.0 cycle items stay in that file; this cycle does not close them). Sibling subplans [v1.19.1](plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md) and [v1.19.2](plans/v1.19.2-adoption-catalog-and-model-expansion.md) keep this file in-progress after the v1.19.0 plan's Phase 4 reconciliation.

## v1.19.0

**Summary**: 7 open items after the v2.1.0 follow-up - 0 NI, 7 DF, 0 MT. Tool-format dispatch closed DF-6. File stays in-progress for sibling subplans.

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 7 | 5 |
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

##### DF-6 - Coding AgentLoop still parses Gemma XML, not LFM pythonic spans

- **Resolved**: 2026-08-20 (v2.1.0 follow-up). `parseAgentToolCalls` dispatches by catalog `toolFormat` in `AgentLoop` and `HeadlessAgentSession`. Gemma stays `gemma4-xml`. Also closes v1.19.2 DF-3 (Hermes `llama3-json`).

##### DF-12 - Desktop picker tests did not run on develop CI

- **Source phase**: Phase 4 - CI/CD
- **Resolution**: `ci.yml` `test-ts` (Node 22) now runs `npm run test:shell`. `shell-build.yml` still covers main. Installer pytest moved to path-filtered `installer-tests.yml`.

### Phase 4 reconciliation

v1.18 items (DF-1,2,5,7,10..15) stay in [../v1.18/known-gaps.md](../v1.18/known-gaps.md). v1.18 DF-3/4/6/8 closed in the v2.1.0 follow-up. Closest remaining relative: v1.18 DF-15 (selector default off).

No release-blockers. Remaining v1.19.0 work is later-cycle (8B-A1B re-run, VL/PII watchlist, 128K fill).

_Last updated: 2026-08-20 (v2.1.0 follow-up; no retag)._

## v1.19.1

**Summary**: 2 open items after the v2.1.0 follow-up - 0 NI, 2 DF, 0 MT. Persona UI, Headless LoopGuards, and DANGEROUS clamp closed. Hub skill merge remains later-cycle.

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 2 | 3 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-2 - Hub skill edits are authored but not yet merged or synced

- **Source phase**: Phase 1 - Skill-native wins (1.1-1.3)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md` (sub-tasks 1.1-1.3, 1.5)
- **Reason**: Grounded-citation, persona-card, avatar-prep, and transcript-reasoning prose landed on Nexus-Hub branch `feat/v1.19.1-skill-native-wins` (commit `451e508f`) and passed `validate_skills.py --quality`. They are not on Hub `develop` / `main` and are not yet in a `nexus skills sync` catalog. CI in this repository cannot see Hub skill bodies; it asserts the Nexus-AI mapping note and the no-duplicate builtin check.
- **Suggested next step**: Merge the Hub branch, then `nexus skills sync --apply` so `~/.nexus-ai/catalog/skills/` carries the new sections. Do not vendor copies under `modules/coding/skills/catalog/`.

##### DF-4 - Pass-state one-shot nudge means the no-action budget rarely trips in production

- **Source phase**: Phase 2 - Unified loop guards (2.2)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md` (sub-task 2.2)
- **Reason**: AgentLoop records a no-action on the pass-state gate continue path. `_gateNudgeIssued` still fires only once, so a live run typically gets one nudge and then proceeds rather than three consecutive no-action turns. Unit tests trip the guard by setting `noActionBudget: 1`. Production default remains 3.
- **Suggested next step**: If live auto-mode "thinking loops" still burn iterations, count every no-tool turn (not only the gated continue) toward the budget, or lower the default after a dated measurement.

### Resolved

##### DF-1 - Per-chat persona field is not in Chat settings

- **Resolved**: 2026-08-20 (v2.1.0 follow-up). Chat page `chat-persona` textarea prepends `[Persona]` onto the outbound message. In-memory only; no SQLite column.

##### DF-3 - HeadlessAgentSession does not construct LoopGuards

- **Resolved**: 2026-08-20 (v2.1.0 follow-up). Optional 4th ctor arg constructs `LoopGuards`. Default prompt stays `BASE_SYSTEM_PROMPT`.

##### DF-5 - getPermissionTier still maps DANGEROUS plus override 0 to CONFIRM

- **Resolved**: 2026-08-20 (v2.1.0 follow-up). Baseline DANGEROUS (including MCP) cannot drop below DANGEROUS. Override 0 on `run_terminal` clamps to 2.

### Phase 2 reconciliation

Hard denials, LoopGuards, self-recovery, compression tail, posture dial, provenance screening, DNS pin, watch/hash, and prompt assembler all shipped. Persona UI, Headless LoopGuards, and DANGEROUS clamp closed in the v2.1.0 follow-up. Remaining: Hub skill merge (DF-2) and the no-action nudge remainder (DF-4).

_Last updated: 2026-08-20 (v2.1.0 follow-up; no retag)._

## v1.19.2

**Summary**: 3 open items after the v2.1.0 follow-up - 0 NI, 3 DF, 0 MT. Tool-format dispatch closed DF-3 (same seam as v1.19.0 DF-6). Live Hermes generate and GGUF multimodal remain later-cycle.

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 3 | 1 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 1 |

### Open Items

#### Deferred

##### DF-1 - Hermes harness A/B is fixture-only; no live Hermes generate this cycle

- **Source phase**: Phase 1 - Hermes harness profiles (1.5)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.2-adoption-catalog-and-model-expansion.md` (sub-task 1.5)
- **Reason**: `HarnessSelectorAb` measures `hermes-agentic` as the panel arm on a golden split with a fixture rollout that scores `llama3-json` overlays as passes. A live `hermes3:8b` Ollama generate was not run on this host. Same posture as the LFM fixture A/B: `not_observed != absent`.
- **Suggested next step**: Re-run `runHarnessAb` against a pulled `hermes3:8b` on the same golden split and record pass_rate / duration. Do not claim a hosted eval.

##### DF-2 - Inkling-Small GGUF is catalogued text-only; native multimodal is unverified at this quant

- **Source phase**: Phase 1 - Inkling-Small patient-tier entry (1.6)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.2-adoption-catalog-and-model-expansion.md` (sub-task 1.6)
- **Reason**: The native Inkling-Small checkpoint is text+image+audio. The curated GGUF (`unsloth/Inkling-Small-GGUF`, UD-IQ1_S, three shards) has no verified llama.cpp multimodal projector at implementation time. The row ships `modalities: ["text"]` with copy that names the gap. Adding image/audio would over-claim.
- **Suggested next step**: If a later llama.cpp / GGUF line grows a working projector, add those modalities only after a dated local load of an image and an audio clip. Keep the row out of `recommended.json`.

##### DF-4 - Patient-tier determinism assertion skips when no offload adapter is registered

- **Source phase**: Phase 1 - RAM-budget presets + determinism (1.7)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.2-adoption-catalog-and-model-expansion.md` (sub-task 1.7)
- **Reason**: `runDeterminismAcrossBudget` is skip-if-absent (`NEXUS_PATIENT_TIER_ADAPTER` unset, or no injected `generate`). Nexus does not bundle the llama.cpp flash-MoE offload runtime; presets are copy only. CI therefore never proves byte-identical output on a real trillion-class MoE.
- **Suggested next step**: On a host with a registered adapter, run the two default budgets and keep the dated identical/mismatch record. Do not imply Nexus ships the offload runtime.

### Resolved

##### DF-3 - Coding AgentLoop still parses Gemma XML, not llama3-json, for Hermes

- **Resolved**: 2026-08-20 (v2.1.0 follow-up). Same dispatch as v1.19.0 DF-6. Live Hermes generate remains DF-1.

##### QG-1 - Linux CI/Release failed hash_file mkdir and installer uv.lock cache

- **Source phase**: Post-tag follow-up (v1.19.1 hash_file test; v1.19.0 installer-tests cache)
- **Reason**: `observe.test.ts` wrote under `MOCK_WORKSPACE_ROOT` (`/workspace` on POSIX). Ubuntu runners return EACCES on `mkdir /workspace/src`, so CI and Release `npm run test` failed while Windows local runs passed. Independently, `installer-tests.yml` set `enable-cache: true` with the default `**/uv.lock` glob; this repo gitignores `uv.lock`, so setup-uv failed closed before pytest.
- **Resolution**: Point the hash_file happy-path test at a real temp workspace (same pattern as `pathGuard.test.ts`). Key the uv cache on `scripts/installer/pyproject.toml` and set `ignore-nothing-to-cache: true`. The v1.19.2 GitHub Release remains published; this is a develop follow-up, not a retag.

### Phase 1 reconciliation

Modalities, audioConditioning, official-only precision variants, Hermes 3 catalog+harness, Inkling patient-tier GGUF, and calibrated patient-tier copy all shipped. Tag-time CI/Release red is QG-1 (closed on develop; no retag). Tool-format dispatch closed DF-3 in the v2.1.0 follow-up. Remaining: live Hermes generate (DF-1), Inkling multimodal (DF-2), patient-tier adapter (DF-4).

_Last updated: 2026-08-20 (v2.1.0 follow-up; no retag)._

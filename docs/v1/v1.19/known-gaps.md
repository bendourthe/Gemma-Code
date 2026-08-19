# Known Gaps - v1.19

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-18

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.19.0-adoption-liquid-lfm-agentic.md](plans/v1.19.0-adoption-liquid-lfm-agentic.md)

## v1.19.0

**Summary**: 5 open items after Phase 1 (catalog entry + license label) - 0 NI, 5 DF, 0 MT. No suppressed warnings, no bypassed gates.

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 5 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Coding-engine ModelCatalog / FRONTEND_MODELS does not list LFM2.5-2.6B

- **Source phase**: Phase 1 - Catalog entry + license label (A1)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 1.1)
- **Reason**: `core/registry/ModelCatalog.ts` and the VS Code `FRONTEND_MODELS` dropdown require `promptFormat` / `toolFormat` / `ModelFamily`. Those fields are the Phase 2 HarnessSelector work. Phase 1 surfaces the entry on the installer Agentic tab and desktop Settings > Models (catalog.json via NexusModelRegistry). The Coding chat dropdown will not offer LFM until Phase 2.
- **Suggested next step**: When Phase 2 adds the LFM harness profile, register the family in ModelCatalog / FRONTEND_MODELS so Coding can select `lfm2.5:2.6b`.

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

##### DF-4 - Context window is recorded conservatively at 32K

- **Source phase**: Phase 1 - Catalog entry metadata
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 1.1); Phase 2 sub-task 2.1
- **Reason**: Docs-library value is 32K; the release blog claims 128K. Phase 1 records `contextWindow: 32768` and says so in card copy. Phase 2 verifies empirically and corrects the catalog.
- **Suggested next step**: Probe beyond 32K on a local GGUF run in Phase 2.1 and update the entry to the verified figure.

##### DF-5 - `toolCallingVerified` is omitted on the LFM row

- **Source phase**: Phase 1 - Catalog entry (A1)
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.0-adoption-liquid-lfm-agentic.md` (sub-task 1.1); Phase 2 A/B
- **Reason**: `agentic: true` puts the row on the Agentic tab. `toolCallingVerified` requires a `toolCallingBenchmark` citation. Phase 2's harness A/B is the real verification; asserting verified in Phase 1 would overclaim.
- **Suggested next step**: Set `toolCallingVerified` only if Phase 2 golden-task A/B wins or ties, with a dated provenance note.

### Resolved

None yet.

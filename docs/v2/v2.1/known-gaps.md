# Known Gaps - v2.1

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-20

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.1.0-adoption-open-local-ai-wave.md](plans/v2.1.0-adoption-open-local-ai-wave.md)

## v2.1.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 2 | 1 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - DiffusionGemma is a watch item, not a catalog entry

- **Source phase**: Phase 1 - Unsloth Dynamic quant references + capability flags + watch item (1.4 / A4b)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 1.4)
- **Comparison**: `docs/v2/v2.1/comparisons/v2.1.0-comparison-open-local-ai-wave.md` Section 7 (DG1/DG4)
- **Reason**: Discrete-diffusion text generation at 26B-A4B needs llama.cpp PR #24423 mainlined into a shipped Ollama release, AND sub-16 GB quants published. Stock Ollama support is incomplete. Shipping it today would add a second installer-provisioned runtime for one experimental model.
- **Flip conditions** (both required):
  1. llama.cpp PR #24423 is mainlined into a shipped Ollama release.
  2. Sub-16 GB quants are published.
- **Suggested next step**: Re-open as a catalog entry only when both flip conditions hold. Gate `diffusion: true` and `codingEligible: false` so it never becomes a coding-harness default.

##### DF-2 - Live golden-task re-verification of Muse Glimmer and Nemotron Lightning was not run

- **Source phase**: Phase 1 - Local benchmark re-verification (1.5)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 1.5)
- **Reason**: This cycle had no proven 24 GB-tier host with either model loaded. Catalog `localEval.status` is `not_run`. Vendor-reported SWE-Bench Verified 76.0 stays in `vendorReported` only. `recommended.json` was not changed.
- **Suggested next step**: On a 24 GB-tier machine, run `runCatalogModelEval` against Muse Glimmer K-Quant-17GB and Lightning Q4_K_M, persist the blocks, and only then propose a default-route change.

### Resolved

##### DF-3 - Unsloth Dynamic 2.0 GGUF audit found no strict-better swap

- **Source phase**: Phase 1 - Unsloth Dynamic quant references (1.4 / A4)
- **Plan reference**: `docs/v2/v2.1/plans/v2.1.0-adoption-open-local-ai-wave.md` (sub-task 1.4)
- **Reason**: Ollama-library LLM entries cannot move onto Unsloth `hf.co` GGUF paths (v1.15.0 known-broken Gemma HTTP 400 invariant). Inkling-Small already ships the established Unsloth UD-IQ1_S GGUF. No other bundled GGUF LLM pick was strictly better at its tier without violating `official: true` or the broken-ref guard.
- **Resolved**: 2026-08-20 (audit recorded; catalog artifact references unchanged)

# Session history: v1.5.0 Phase 1 -- Local-only Foundations

**Date**: 2026-06-10
**Cycle**: v1.5.0 (Local Agent Maturity)
**Phase**: 1 (Local-only foundations -- Bucket 1: items 32, 2, 18)
**Plan reference**: [docs/versions/v1/v1.5.0/plans/adoption-ecosystem-2026-06.md](../../plans/adoption-ecosystem-2026-06.md)
**Source comparison**: [docs/versions/v1/v1.5.0/comparison-ecosystem-2026-06.md](../../comparison-ecosystem-2026-06.md)
**Branch**: `feat/v1.5.0-phase-1-local-only-foundations` (new, off the v1.4.0 line per the per-version-branch convention; v1.4.0 is not yet merged to `main`)
**Acceptance scope**: ship the three Bucket 1 `local-only` items with zero outbound calls and zero new heavy dependency. Stability gate: `npm run test`, `npm run lint`, `npm run check-architecture`, `npm run security:check` clean; the credential vault and energy estimator degrade gracefully where the OS primitive is unavailable.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T001 (item 32) | Gemma 4 12B-IT Unsloth GGUF quant ladder. Catalog entry `gemma-4-12b-it-gguf` in [core/registry/catalog.json](../../../../../core/registry/catalog.json) (256K context, `multimodal: true` for Phase 5, `ollama://hf.co/unsloth/gemma-4-12b-it-GGUF`). Quant ladder + hardware-aware picker in [modules/coding/config/Gemma4GgufQuants.ts](../../../../../modules/coding/config/Gemma4GgufQuants.ts) (IQ2_M/Q3_K -> Tier 1, Q4_K_XL/Q5_K/Q6_K -> Tier 2, BF16 -> Tier 3; `selectGemma4GgufQuant(vramMb)`; tier derived via the shared `classifyTier`). Installer rows (`GEMMA4_GGUF_QUANTS` + opt-in Q4_K_XL/Q6_K preset entries) in [recommended_models.py](../../../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py). | Closed |
| T002 (item 2) | Local OS-keychain credential vault. [core/security/KeychainBackend.ts](../../../../../core/security/KeychainBackend.ts) (macOS `security` / Linux `secret-tool` / Windows WinRT `PasswordVault`, plus `InMemoryKeychainBackend`; all via an injected `KeychainExec` so command-construction + parsing are unit-testable without a real keychain; no new npm dependency). [core/security/CredentialVault.ts](../../../../../core/security/CredentialVault.ts) (`KeychainCredentialVault`: per-integration get/set/delete/list; redacts secret-shaped backend errors via `redactSecrets`; throws `KeychainUnavailableError` -- never a plaintext fallback). Wired as the credential source for MCP `${vault}` / `${vault:NAME}` env refs in [McpManager.ts](../../../../../modules/coding/mcp/McpManager.ts) `_resolveEnv`, constructed at [ChatPanelBootstrap.ts](../../../../../src/panels/ChatPanelBootstrap.ts). | Closed |
| T003 (item 18) | Intelligence-per-watt energy telemetry. [core/telemetry/EnergyEstimator.ts](../../../../../core/telemetry/EnergyEstimator.ts) (`estimateEnergy` derives watts / tokens-per-watt / joules-per-request; `estimateEnergyForText` integrates `TokenCost.tokenize`; `samplePowerDraw` reads nvidia-smi `power.draw`; `raplWattsFromEnergyDelta` parse helper for a later Linux-RAPL wiring; reports `unavailable` on a missing sensor). Optional `powerQuery` + `powerDrawWatts`/`energyStatus` fields on [GpuTelemetrySource.ts](../../../../../core/telemetry/GpuTelemetrySource.ts) (additive; off when no sampler is wired). Surfaced on the desktop Local Model Status panel ([LocalModelStatus.tsx](../../../../../desktop/src/components/LocalModelStatus.tsx), `LocalModelStatus.types.ts`, `telemetryStream.ts`). | Closed |
| T004 | Testing + stabilization. New unit suites for the quant ladder, both keychain modules, and the energy estimator; an MCP credential-vault integration suite; extended catalog / GpuTelemetrySource / desktop telemetry suites; an installer pytest class. Full + desktop + installer suites green; all quality gates clean. | Closed |

## 2. Design decisions & deviations from the plan text

| # | Decision / deviation | Resolution |
|---|---|---|
| D1 | The plan prompt for T002 says "backed by the OS keychain ... via a keytar-class binding", but the Phase 1 goal mandates "zero new heavy dependency" and the project ethos is "originality over wrappers". | Resolved the tension by reverse-engineering keychain access through each platform's own CLI primitive (`security` / `secret-tool` / PowerShell `PasswordVault`) behind an injected `KeychainExec`, instead of adding a native node module. No npm dependency added; secrets pass on stdin (Linux/Windows) where possible to keep them off the argv vector. Matches AGENTS.md MCP-policy bucket 3 (reverse-engineer into a local internal). |
| D2 | The plan locates the quant ladder under "the ModelRegistry"; that registry lives in `core/registry/`. | The quant ladder's tier mapping needs `classifyTier` from `modules/coding/config/HardwareTier.ts`, and `core/**` must not import `modules/**` (dependency-cruiser `no-core-from-modules`). Split accordingly: the model metadata entry lives in `core/registry/catalog.json`; the quant-ladder + VRAM-aware picker live in `modules/coding/config/Gemma4GgufQuants.ts` (same layer as `HardwareTier`). |
| D3 | The plan says the energy estimator "feeds ... `core/observability/TokenCost.ts`". `TokenCost.ts` is deliberately minimal (its own header reserves extensions for a separate module). | Interpreted as integration rather than mutation: `EnergyEstimator` imports `tokenize` from `TokenCost` (`estimateEnergyForText`) so per-request energy uses the same token estimator; `TokenCost.ts` was left untouched to honor its stated design. |
| D4 | The plan's T003 acceptance says "the panel surfaces the metric when present"; no production `GpuTelemetrySource` is constructed anywhere (only tests reference it). | Added the optional `powerQuery` seam + the panel data-contract fields and a `createPowerSampler()` factory, verified by unit + desktop tests. The live sidecar construction wiring is recorded as `T003.P3.B` (no phantom wiring into a non-existent call site). |

## 3. Open items added to known-gaps

Created [docs/versions/v1/v1.5.0/known-gaps.md](../../known-gaps.md) this phase (the post-phase sequence appends to it every phase). Two forward-tier follow-ups recorded, both `candidate`/`future` (not defects):

- `T001.P3.A` (P3/DF) -- `selectGemma4GgufQuant` is exported + unit-tested but has no production UI caller yet; Phase 5 item 33 (multimodal input) is the planned first consumer.
- `T003.P3.B` (P3/DF) -- `samplePowerDraw` implements NVIDIA only; macOS `powermetrics` + Linux RAPL remain parse-helper-only, and the sidecar `GpuTelemetrySource` is not yet constructed with a `powerQuery`.

Also tracked: the four v1.4.0 carryforward deferrals (`T018.P3.A/B`, `T016.P3.A`, `T022.P3.A`) scheduled for Phases 4 and 6.

## 4. Verification evidence

- `npx tsc -b` -> clean (after fixing 3 execFile-callback `never`-typing errors by annotating the callback params `string | Buffer`, mirroring `GpuDetector`).
- `npm run lint` (`eslint src modules`) -> clean, exit 0.
- `npm run check-architecture` -> 0 errors, 10 pre-existing warnings (orphans/cycle); none in the new files (`Gemma4GgufQuants` imports `HardwareTier`, so it is not an orphan).
- `npm run security:check` -> "All safety surfaces in sync."
- `npm test` -> 344 files / 3962 tests passed, 5 skipped, 0 failed.
- `npm run test:shell` (desktop) -> 47 files / 422 passed.
- Installer `pytest tests/test_recommended_models.py` -> 29 passed.
- `npm run catalog:check` regenerated `docs/index.md` (the +18 lines in `ChatPanelBootstrap.ts` shifted the `panels` module LOC count); regenerated file staged for the CI catalog-sync gate.
- No outbound call introduced: the credential vault uses local OS-keychain CLIs; the energy estimator uses local `nvidia-smi`; the catalog entry is data pulled by Ollama at install time.

## 5. Next steps

- Advance to Phase 2 (Skill-native adoptions): author the DCI / hybrid-retrieval search-discipline skill (item 11, T005) and the agent-preset bundles (item 21, T006) for the Nexus-Hub catalog; validate via `nexus-check --rule skill-duplicate-name` + `check:prompts`; no `core/` or `modules/` source change.
- Phase 5 (item 33) will consume the T001 `multimodal` flag and is the planned first caller of `selectGemma4GgufQuant` (closes `T001.P3.A`).
- When the sidecar telemetry feed is wired, pass `createPowerSampler()` into `GpuTelemetrySource` and add the macOS/Linux power branches (closes `T003.P3.B`).

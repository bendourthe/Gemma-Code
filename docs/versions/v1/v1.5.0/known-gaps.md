# v1.5.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: in-progress (Phase 2 closed 2026-06-10). v1.5.0 is the "Local Agent Maturity" cycle ([plans/adoption-ecosystem-2026-06.md](plans/adoption-ecosystem-2026-06.md), derived from [comparison-ecosystem-2026-06.md](comparison-ecosystem-2026-06.md)). Phase 1 (2026-06-10) ships the three Bucket 1 `local-only` foundations: the Gemma 4 12B-IT GGUF quant ladder (item 32), the OS-keychain credential vault (item 2), and the intelligence-per-watt energy estimator (item 18). Later phases land the skill-native adoptions (Phase 2), the inbound injection classifier (Phase 3), swarm/DAG orchestration (Phase 4, closing v1.4.0 `T018.P3.A/B` + `T016.P3.A`), the desktop / model-layer re-partials (Phase 5), the Tree-sitter packaging closure (Phase 6, closing v1.4.0 `T022.P3.A`), and the final Nexus-Hub sync + acceptance gate (Phase 7). This file is appended phase-by-phase; items move to `## 2. Resolved` when closed; the `## 3. Summary` is recomputed each pass.

**Audience**: v1.5.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-06-10 (Phase 2 -- Skill-native adoptions)
**Sibling reviews**: [../v1.4.0/known-gaps.md](../v1.4.0/known-gaps.md) (the upstream gap log; its open P3 deferrals `T016.P3.A`, `T018.P3.A`, `T018.P3.B`, `T022.P3.A` are the carryforward this cycle resolves in Phases 4 and 6), and [plans/adoption-ecosystem-2026-06.md](plans/adoption-ecosystem-2026-06.md) (the active plan).

**Cycle context**: This file is created in Phase 1 (rather than at a later phase) because the implement-phase post-phase sequence appends gaps every phase. Phase 1 introduces no bug, test failure, coverage shortfall, suppressed lint, or bypassed quality gate; the two seeded entries below are forward-tier follow-ups (`candidate` / `future`), not defects.

**Wording convention**: every prose claim follows [../v1.4.0/development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md) (A7): a gap describes its unbuilt capability at tier `future` or `candidate` (never `supported`); the "Suggested next step" states what cited evidence would raise the tier. "not_observed != absent" applies throughout.

Severity tags: **P0** release-blocker; **P1** should-fix; **P2** nice-to-have; **P3** out-of-scope for v1.5.0 / recorded for future planning.
Category tags: **NI** not implemented; **DF** deferred; **BG** bug; **MT** missing tests; **WN** warning; **QG** quality gate.

---

## 0. Adoption Ledger

Per-sub-task closure ledger for the 2026-06 ecosystem adoption plan. Rows land as each phase closes.

### Local Agent Maturity (adoption-ecosystem-2026-06)

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| T001 | Item 32 -- Gemma 4 12B-IT Unsloth GGUF quant ladder (local-only) | Resolved | Phase 1 (2026-06-10); catalog entry `gemma-4-12b-it-gguf` in [../../../../core/registry/catalog.json](../../../../core/registry/catalog.json) (256K context, `multimodal: true`, `ollama://hf.co/unsloth/gemma-4-12b-it-GGUF`); quant ladder + hardware-aware picker in [../../../../modules/coding/config/Gemma4GgufQuants.ts](../../../../modules/coding/config/Gemma4GgufQuants.ts) (`selectGemma4GgufQuant`, tier mapping via `classifyTier`); installer rows in [../../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/recommended_models.py) (`GEMMA4_GGUF_QUANTS` + opt-in preset rows). Tests: [../../../../tests/unit/config/Gemma4GgufQuants.test.ts](../../../../tests/unit/config/Gemma4GgufQuants.test.ts), catalog assertion in [../../../../tests/unit/core/registry/catalog.test.ts](../../../../tests/unit/core/registry/catalog.test.ts), `test_recommended_models.py` |
| T002 | Item 2 -- local OS-keychain credential vault (local-only) | Resolved | Phase 1 (2026-06-10); [../../../../core/security/CredentialVault.ts](../../../../core/security/CredentialVault.ts) (`KeychainCredentialVault`, per-integration get/set/delete/list, redacts secret-shaped backend errors via `redactSecrets`, throws `KeychainUnavailableError` with no plaintext fallback) over [../../../../core/security/KeychainBackend.ts](../../../../core/security/KeychainBackend.ts) (macOS `security` / Linux `secret-tool` / Windows `PasswordVault` via injected exec; no new npm dependency). Wired as the `${vault}` env source in [../../../../modules/coding/mcp/McpManager.ts](../../../../modules/coding/mcp/McpManager.ts) `_resolveEnv`, constructed at [../../../../src/panels/ChatPanelBootstrap.ts](../../../../src/panels/ChatPanelBootstrap.ts). Tests: KeychainBackend + CredentialVault unit suites, [../../../../tests/integration/mcp/credential-vault-mcp.test.ts](../../../../tests/integration/mcp/credential-vault-mcp.test.ts) |
| T003 | Item 18 -- intelligence-per-watt energy telemetry (local-only) | Resolved | Phase 1 (2026-06-10); [../../../../core/telemetry/EnergyEstimator.ts](../../../../core/telemetry/EnergyEstimator.ts) (`estimateEnergy` -> watts / tokens-per-watt / joules-per-request; `estimateEnergyForText` integrates `TokenCost.tokenize`; `samplePowerDraw` via nvidia-smi `power.draw`; reports `unavailable` on a missing sensor). Optional `powerQuery` + `powerDrawWatts` / `energyStatus` on [../../../../core/telemetry/GpuTelemetrySource.ts](../../../../core/telemetry/GpuTelemetrySource.ts); surfaced through the desktop Local Model Status panel ([../../../../desktop/src/components/LocalModelStatus.tsx](../../../../desktop/src/components/LocalModelStatus.tsx), `telemetryStream.ts`). Tests: EnergyEstimator unit suite, extended GpuTelemetrySource + desktop telemetryStream / LocalModelStatus suites |
| T004 | Phase 1 testing + stabilization | Resolved | Phase 1 (2026-06-10); `npm test` 3962 passed / 5 skipped / 0 failed; `npm run test:shell` 422 passed; installer `test_recommended_models.py` 29 passed; `tsc -b`, `npm run lint`, `npm run check-architecture` (0 errors), `npm run security:check` all clean; no outbound call introduced (vault uses local OS keychain CLI, energy uses local nvidia-smi) |
| T005-T007 | Phase 2 -- skill-native adoptions (items 11, 21) | Resolved | Phase 2 (2026-06-10); authored in Nexus-Hub on branch `feat/dci-discipline-and-agent-presets` (commit `786651f`): `catalog/skills/developer-experience/direct-corpus-interaction/SKILL.md` (item 11 -- DCI discipline over `HybridRetriever` RRF + code-graph MCP) and `catalog/skills/workflow/agent-presets/SKILL.md` (item 21 -- morning-briefing / research / coding-assistant bundles). Both PASS `scripts/validate_skills.py` (0 errors) + `--quality`; `data/skills.json` + `data/SKILL_INDEX.md` regenerated. Nexus-AI: `nexus-check --rule skill-duplicate-name` 0 findings, `check:prompts` exit 0, no `core/`/`modules/` change. Merge/publish/`nexus skills sync` -> Phase 7 (T023), tracked as `T005.P3.A`. |
| T008-T009 | Phase 3 -- inbound prompt-injection classifier (item 3) | Pending | Phase 3 |
| T010-T014 | Phase 4 -- swarm/DAG orchestration (item 36) + v1.4.0 `T018.P3.A/B`, `T016.P3.A` | Pending | Phase 4 |
| T015-T020 | Phase 5 -- model-layer & desktop re-partials (items 33, 24, 25, 26, 38) | Pending | Phase 5 |
| T021-T022 | Phase 6 -- Tree-sitter `.wasm` packaging (v1.4.0 `T022.P3.A`) | Pending | Phase 6 |
| T023-T024 | Phase 7 -- Nexus-Hub sync + whole-plan acceptance gate | Pending | Phase 7 |

---

## 1. Open Items

### Phase 1 follow-ups (forward-tier, not defects)

| ID | Sev | Cat | Description | Suggested next step |
|---|---|---|---|---|
| `T001.P3.A` | P3 | DF | The Gemma 4 GGUF quant ladder + `selectGemma4GgufQuant` hardware-aware picker are exported and unit-tested but not yet consumed by a runtime UI call site; the catalog entry surfaces the model in the picker, and the installer presets surface the Q4_K_XL / Q6_K quants, but the VRAM-driven quant auto-selection helper has no production caller yet. Tier: `candidate` (built + unit-tested). | Phase 5 item 33 (multimodal input) gates on the T001 `multimodal` flag and is the planned first consumer; wire `selectGemma4GgufQuant` into the desktop/installer model picker there to raise the tier to `supported`. |
| `T003.P3.B` | P3 | DF | `samplePowerDraw` implements the NVIDIA path (nvidia-smi `power.draw`); macOS `powermetrics` and Linux RAPL exist only as pure parse helpers (`raplWattsFromEnergyDelta`), not wired into the sampler, and no production `GpuTelemetrySource` is yet constructed with a `powerQuery` (the sidecar telemetry feed has no live construction site). Tier: NVIDIA `supported` (estimator + sampler unit-tested); macOS/Linux RAPL `future`. | When the sidecar constructs `GpuTelemetrySource`, pass `createPowerSampler()`; add the `powermetrics` (macOS) and RAPL-sysfs (Linux) branches to `samplePowerDraw` with cited readings to raise those platforms' tier. |

### Phase 2 follow-ups (forward-tier, not defects)

| ID | Sev | Cat | Description | Suggested next step |
|---|---|---|---|---|
| `T005.P3.A` | P3 | DF | The two Phase 2 skills (`developer-experience/direct-corpus-interaction`, `workflow/agent-presets`) are authored, validated, and committed on the Nexus-Hub branch `feat/dci-discipline-and-agent-presets` (commit `786651f`), but not yet merged to the Hub `develop` / `main` line and not yet reflected by `nexus skills sync` on the Nexus-AI consumer side. Tier: `candidate` (authored + validated; not yet published). | Phase 7 (T023) merges / publishes the Hub branch with attribution (`python scripts/validate_skills.py`) and runs `nexus skills sync` so the consumed catalog reflects the two skills, raising the tier to `supported`. |

### Carryforward from v1.4.0 (resolved later in this cycle)

| ID | Sev | Cat | Description | Closing phase |
|---|---|---|---|---|
| `T018.P3.A` | P3 | DF | Live-wire `WorktreeManager` at session bootstrap (from [../v1.4.0/known-gaps.md](../v1.4.0/known-gaps.md)). | Phase 4 (T010) |
| `T018.P3.B` | P3 | DF | Planner/critic/worker orchestration layer + read-tool worktree rooting. | Phase 4 (T011, T012) |
| `T016.P3.A` | P3 | DF | Live-wire the PreCompact WIP hook on the production bus. | Phase 4 (T013) |
| `T022.P3.A` | P3 | DF | Bundle the Tree-sitter grammar `.wasm` into the packaged app. | Phase 6 (T021) |

---

## 2. Resolved

| ID | Resolution |
|---|---|
| T001 | Phase 1 -- Gemma 4 12B-IT GGUF quant ladder in the catalog + tier-mapped picker + installer rows (see Adoption Ledger). |
| T002 | Phase 1 -- local OS-keychain `CredentialVault` wired as the MCP `${vault}` credential source (see Adoption Ledger). |
| T003 | Phase 1 -- intelligence-per-watt `EnergyEstimator` + optional GPU power sampling surfaced on the Local Model Status panel (see Adoption Ledger). |
| T004 | Phase 1 -- full + desktop + installer suites green; lint / arch / security / type-check clean; no outbound call introduced. |
| T005 | Phase 2 -- `direct-corpus-interaction` DCI search-discipline skill authored in Nexus-Hub (item 11); passes `validate_skills.py` + `--quality`. |
| T006 | Phase 2 -- `agent-presets` skill (morning-briefing / research / coding-assistant bundles) authored in Nexus-Hub (item 21); passes `validate_skills.py` + `--quality`. |
| T007 | Phase 2 -- Hub `validate_skills.py` PASS on both; Nexus-AI `nexus-check --rule skill-duplicate-name` 0 findings + `check:prompts` exit 0; no `core/` / `modules/` source changed. |

---

## 3. Summary

- **Phase 1 (2026-06-10)**: 3 Bucket-1 `local-only` adoptions resolved (items 32, 2, 18) + stabilization (T001-T004). 2 forward-tier follow-ups recorded (`T001.P3.A` candidate, `T003.P3.B` NVIDIA-supported / RAPL-future). 0 defects, 0 coverage shortfalls, 0 suppressed warnings, 0 bypassed gates.
- **Phase 2 (2026-06-10)**: 2 Bucket-2 `skill-native` adoptions resolved (items 11, 21) + stabilization (T005-T007), authored in the Nexus-Hub catalog with no Nexus-AI `core/` / `modules/` source change. 1 forward-tier follow-up recorded (`T005.P3.A` candidate -- merge / publish / `nexus skills sync` to Phase 7). 0 defects, 0 coverage shortfalls, 0 suppressed warnings, 0 bypassed gates.
- **Carryforward tracked**: 4 v1.4.0 P3 deferrals (`T018.P3.A`, `T018.P3.B`, `T016.P3.A`, `T022.P3.A`) scheduled for Phases 4 and 6.
- **Remaining phases**: 3-7 pending.

# Session History - v1.18.0 Phase 3: Catalog + Registry Governance

**Date**: 2026-08-17
**Version**: v1.18.0
**Plan**: [../../plans/v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
**Phase**: 3 of 7 - Catalog + Registry Governance (OW-A4, LG-A2, LG-A3, OW-A5)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 7 is terminal).

## Goal

One additive catalog schema revision (`toolCallingVerified` + MoE `activeParams`/`totalParams`), UD-style labels in the extreme-low-bit gate without opening EM.P3/EM.P4, and per-tool MCP deny that only tightens Hub policy. Dense-model harness tiering must stay bit-identical when MoE fields are absent.

## Pre-flight

`is_final_phase` = **false** (Phase 7 is Architecture Refactor, Known-Gaps Reconciliation, and CI/CD). Prior phases: Phase 1 complete (`147cc39`), Phase 2 complete (`6666a74`). Model routing: plan recommended Mid / medium (claude-sonnet-5 medium). Cursor cannot script a switch; this session stayed on the current model (Grok 4.6), which is same-or-stronger than Mid/medium. Visible degrade: none. No silent downshift.

## 1. Starting State

- **Branch**: `develop` (2 commits ahead of `origin/develop` after Phase 1 + Phase 2)
- **Environment**: Windows 10, root Vitest suite + desktop shell tests
- **Plan reference**: [v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)

## 2. Chronological Steps

### 2.1 Catalog schema (OW-A4 + LG-A3)

**Plan specification**: Additive `toolCallingVerified` + `toolCallingBenchmark` provenance; optional `activeParams` / `totalParams`. Existing entries remain valid unmodified. Populate verified only for models Nexus has actually tagged agentic. Do not mass-flag. Dense rows omit MoE fields.

**What happened**: [`catalog.ts`](../../../../core/registry/catalog.ts) validates provenance when verified is true (suite / `YYYY-MM-DD` date / result), requires MoE fields as a pair, and requires `activeParams <= totalParams`. [`catalog.json`](../../../../core/registry/catalog.json) flags nine in-repo `agentic` rows (Gemma 4 e2b/e4b/12b/26b/31b, Qwen2.5-Coder 7b/14b, DeepSeek Coder V2 16b) with suite `nexus-catalog-agentic-flag`, date `2026-08-17`, result stating the in-repo `agentic=true` flag (not a live golden A/B). MoE numbers only on `deepseek-coder-v2:16b` (`activeParams: 2.4`, `totalParams: 16`). Python installer ignores extra JSON keys.

**Verification**: `tests/unit/core/registry/catalog.test.ts` (new-field validation + full catalog still valid).

### 2.2 Consume fields (badge + HarnessSelector + scheduler)

**Plan specification**: ModelSelector badge with provenance tooltip. HarnessSelector prefers `activeParams` for compute and `totalParams`/`vramGb` for residency when present; dense path exactly unchanged. GPU scheduler threads conservative residency.

**What happened**: Optional DTO fields on ModelSelector / QuickModelSwitcher / sidecar listed-model protocol. Badge text `tool-calling verified`. [`moeFootprint.ts`](../../../../core/registry/moeFootprint.ts) `conservativeResidentVramGb` prefers `vramGb`, else `totalParams * 0.6`, never `activeParams`. [`modelCapabilityTier`](../../../../modules/coding/orchestration/HarnessSelector.ts) keeps the previous tag-then-vram path when `activeParams` is absent; MoE path uses 20 / 4 billion active-param cutoffs after tags. `HarnessSelection.residentFootprint` is `"standard" | "moe"`. Re-exported from [`GpuScheduler.ts`](../../../../core/scheduler/GpuScheduler.ts).

**Verification**: desktop `sharedChat.test.tsx` badge; `HarnessSelector.test.ts` dense regression + MoE weak compute / moe footprint; `moeFootprint.test.ts`.

### 2.3 UD quant labels (LG-A2)

**Plan specification**: Recognize `UD-IQ1_S`, `UD-IQ1_M`, `UD-IQ2_*`, `UD-Q2_K_XL`, `MXFP4_MOE` style labels while remaining fail-closed. Do not change `EXTREME_LOW_BIT_MIN_OLLAMA_VERSION`.

**What happened**: [`extremeLowBit.ts`](../../../../core/registry/extremeLowBit.ts) added those labels plus prefixes `ud-iq1`, `ud-iq2`, `ud-q2`, `mxfp4`. Ordinary `Q4_K_M` / `Q5_K_M` stay false. Min Ollama version remains `"999.0.0"`.

**Verification**: `tests/unit/core/registry/extremeLowBit.test.ts`.

### 2.4 Per-tool MCP deny (OW-A5)

**Plan specification**: Per-project registry per-tool allow/deny layered on `HubRegistryPolicyFilter`. Tightens-only: no toggle enables what policy denies. Persist per project.

**What happened**: [`McpToolDeny.ts`](../../../../modules/coding/mcp/McpToolDeny.ts) resolver: policy `drop` exposes `[]`; user deny subtracts; `userRequestedEnable` cannot invent or undeny. Persist [`.nexus/mcp-tool-deny.json`](../../../../modules/coding/mcp/McpToolDenyStore.ts). [`McpManager`](../../../../modules/coding/mcp/McpManager.ts) skips register + filters metadata. There was no existing MCP settings tab, so Settings > MCP plus sidecar `mcp.registry.list` / `mcp.registry.setToolDenied`. `mcp.list` / `mcp.invoke` stay unimplemented (Phase 11 VS Code bridge).

**Verification**: dedicated `McpToolDeny.test.ts` tightens-only invariant; `McpRegistrySettings.test.ts`; `McpManager.test.ts`; desktop `McpRegistrySettings.test.tsx` + `sidecar-handlers.test.ts`.

### 2.5 Testing and stabilization

**Plan specification**: Schema + dense regression + MoE + UD labels + MCP invariant + badge. `npm test` + lint. Desktop shell tests.

**What happened**: Full root suite with coverage. Desktop lint + typecheck + full shell tests. CI not rewritten (`test-ts` unfiltered; `shell-build.yml` already watches `desktop/**`, `core/**`, `modules/**`).

**Troubleshooting**:
- **`tsc -b` failed** on `ToolActivationContext.ts`: Phase 2 `applyHarnessOverlay` generic was too strict for live `PromptContext` (`systemPromptBudgetPercent?`). Loosened to `T extends Partial<HarnessPromptOverlay>`. `# DEVIATION:` compile fix, in scope because Phase 3 consumes the overlay path.
- **Benchmark fixtures rewritten by pretest** (`tests/fixtures/**`). Restored with `git checkout -- tests/fixtures`. Same ENV class as Phase 1 / Phase 2.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm test -- --coverage` | PASS - 439 files / 4857 passed / 6 skipped / 0 failed |
| Line coverage | PASS - 87.81% lines / 84.22% branches / 91.27% functions (thresholds 80 / 75 / 80) |
| `npm run lint` | PASS - 0 errors (`eslint src modules`) |
| `npx tsc -b` | PASS (after overlay generic fix) |
| Desktop lint / typecheck | PASS |
| Desktop tests | PASS - 107 files / 925 passed / 0 failed |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Installer typed catalog does not render `toolCallingVerified` | P3 | Deferred (DF-6); plan consumption surface was ModelSelector |
| `gemma4:26b` MoE copy has no published active/total counts | P3 | Deferred (DF-7); schema unused on that row |
| `mcp.list` / `mcp.invoke` remain unimplemented | P3 | Deferred (DF-8); new `mcp.registry.*` instead of hijacking invoke |
| EM.P3 / EM.P4 remain closed | P2 | In scope; recognizing UD labels still blocks |
| Sidecar overlay still not applied | P2 | Existing DF-3; out of this phase |

## 5. Plan Discrepancies

- No existing MCP settings area. Added Settings > MCP + `mcp.registry.*` rather than implementing `mcp.list` / `mcp.invoke`. `# DEVIATION:` surface choice, still tightens-only.
- MoE numbers only on DeepSeek Coder V2 16B. Gemma 4 26B describes MoE routing but has no published active count (DF-7).
- `toolCallingVerified` follows existing `agentic: true` rows (nine), not a live golden A/B. Provenance text states that.
- `applyHarnessOverlay` generic loosened so `PromptContext` typechecks (Phase 2 compile hole found by this phase's `tsc -b`).

## 6. Assumptions Made

- Cursor model picker is manual. Session stayed on the current model (same-or-stronger than the plan's Mid / medium).
- User `mcp.json` servers are treated as policy-allow (already opted in). Hub drop still enforced for hub-sourced servers in the settings list.
- `.nexus/mcp-tool-deny.json` is user data (already covered by `.nexus/` in `.gitignore`); not a repo artifact.

## 7. Testing Summary

- Root: 4857 passed, 6 skipped, 0 failed, 439 files.
- New: `moeFootprint.test.ts`, `McpToolDeny.test.ts`, `McpRegistrySettings.test.ts`, desktop `McpRegistrySettings.test.tsx`.
- Extended: catalog, extremeLowBit, HarnessSelector, McpManager, sharedChat, sidecar-handlers.
- Coverage notes: `McpToolDeny.ts` ~95% lines; `moeFootprint.ts` 95%; `extremeLowBit.ts` 100%. `McpManager.ts` ~77% lines (pre-existing holes plus new deny paths mostly covered). Overall suite remains above 80%; no MT opened.

## 8. TODO Tracker

| Item | Status |
|---|---|
| 3.1 Catalog schema | Done |
| 3.2 Consume fields | Done |
| 3.3 UD quant labels | Done |
| 3.4 Per-tool MCP deny | Done |
| 3.5 Tests + gates | Done |
| Open EM.P3 / EM.P4 | Not done (closed by design) |
| Phase 4 ask inbox + scheduler | Next |

## 9. Summary and Next Steps

Phase 3 added catalog provenance and MoE schema, taught the selector and scheduler to reason about resident-vs-active cost without changing dense behavior, recognized UD labels so the extreme-low-bit gate can still block them, and shipped tightens-only per-tool MCP deny. Next: Phase 4 unattended autonomy (ask inbox + scheduler).

# Session History - v1.18.0 Phase 2: Live Harness Activation

**Date**: 2026-08-17
**Version**: v1.18.0
**Plan**: [../../plans/v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
**Phase**: 2 of 7 - Live Harness Activation (OI-A5 flagship, OI-A2)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 7 is terminal).

## Goal

Turn the built-but-dormant per-model harness selector on (closes EM.P1.A), feed it named per-family profiles (fleshes EM.P1.C), and add `/harness` inspect/switch plus a ModelSelector badge. Setting off must stay byte-identical. Do not flip `HARNESS_SELECTOR_SHIPPED_DEFAULT`.

## Pre-flight

`is_final_phase` = **false** (Phase 7 is Architecture Refactor, Known-Gaps Reconciliation, and CI/CD). Prior phases: Phase 1 complete (commit `147cc39`, session history present). Model routing: plan recommended mid-strong / high (claude-sonnet-5 high). Re-score: several mediums plus live-path risk -> strong / high. Delta is an upshift. Cursor cannot script a switch; this session stayed on the current model (Grok 4.6), which is same-or-stronger. Visible degrade: none. No silent downshift.

## 1. Starting State

- **Branch**: `develop` (1 commit ahead of `origin/develop` after Phase 1)
- **Environment**: Windows 10, root Vitest suite + desktop shell tests
- **Plan reference**: [v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)

## 2. Chronological Steps

### 2.1 Wire the overlay into the live prompt path (OI-A5)

**Plan specification**: Spread `overlayForModel()` into `PromptContext` inside `buildPromptContext`, gated on `settings.harnessSelectorEnabled`. Safe fallback intact. Off = byte-identical. Do not change `HARNESS_SELECTOR_SHIPPED_DEFAULT`.

**What happened**: [`ToolActivationContext.buildPromptContext`](../../../../src/panels/ToolActivationContext.ts) builds the existing context object, returns it by reference when the setting is off, and otherwise spreads `selector.select(modelName, sessionOverride).overlay` via `applyHarnessOverlay`. Bootstrap shares one `HarnessSessionOverride` with slash-command handlers.

**Verification**: `tests/unit/panels/ToolActivationContext.test.ts` (off knobs unchanged; qwen overlay detailed/thinking-on when on; unknown model does not throw; override ignored when off). `liveHarnessKnobs` in `HarnessSelectorAb.test.ts`.

### 2.2 Named per-family profiles (OI-A2)

**Plan specification**: Reverse-engineer behavioral shape into internal `HarnessProfile` data. Generic names (`concise-loop`, `plan-first`, `structured-edit`, `minimal`). Key via catalog family/tier. Update `docs/reference/low-cost-model-optimization.md`. No external attribution.

**What happened**: Data tables `FAMILY_PROFILE_IDS` / `FAMILY_TIER_PROFILE_IDS` / `NAMED_PROFILES`. qwen -> `plan-first`, deepseek -> `structured-edit`, kimi id/tag -> `concise-loop`, llama+weak -> `minimal`, else tier scaffold. Profile ids/labels/rationales tested against an external-name regex.

**Verification**: `tests/unit/orchestration/HarnessSelector.test.ts` family/tier cases plus unknown-family fallback.

### 2.3 `/harness` inspect/switch + ModelSelector badge

**Plan specification**: Inspect (profile, why, overlay) and session switch (revert on model change or new session). Wire through `src/panels/`. Badge on `desktop/src/shared/chat/ModelSelector.tsx`. Override never bypasses the master setting.

**What happened**: Builtin `/harness` in `CommandRouter` + `ChatCommandHandlers`. Desktop slash catalog gained `harness`. Optional `harnessLabel` on ModelSelector / QuickModelSwitcher; Coding page shows `defaultHarnessSelector.profileForModel(modelId).id`.

**Verification**: ChatCommandHandlers inspect/switch/clear/list tests; desktop ModelSelector + CodingPage + slashCommands tests.

### 2.4 Testing and stabilization

**Plan specification**: Wiring + profiles + override + golden A/B against the live path. `npm test` + `npm run lint`. Desktop `npm run test:shell` + `npm run lint:shell`. Record go/no-go for flipping the shipped default.

**What happened**: Full root suite with coverage. Desktop lint + typecheck + targeted (then full) shell tests. CI not rewritten (`test-ts` unfiltered; `shell-build.yml` already watches `desktop/**` and `modules/**`).

**Go/no-go for `HARNESS_SELECTOR_SHIPPED_DEFAULT`**: **NO-GO**. `decideHarnessDefault` still has no live weak-model A/B (EM.P1.B). The golden harness still ships opt-in / off.

**Troubleshooting**:
- **Benchmark fixtures rewritten by pretest** (`tests/fixtures/**`). Restored with `git checkout -- tests/fixtures`. Same ENV class as Phase 1 / v1.16 Phase 5.
- Isolated `vitest` without `--config configs/vitest.config.ts` failed to load `vscode` (setup mock missing). Full `npm test` uses the config.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm test -- --coverage` | PASS - 436 files / 4839 passed / 6 skipped / 0 failed |
| Line coverage | PASS - 87.92% lines / 84.25% branches / 91.31% functions (thresholds 80 / 75 / 80) |
| `npm run lint` | PASS - 0 errors (`eslint src modules`) |
| `npx tsc -b` | PASS |
| Desktop lint / typecheck | PASS |
| Desktop tests | PASS - 106 files / 920 passed / 0 failed |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Sidecar `HeadlessAgentSession` does not apply the overlay | P2 | Deferred (DF-3); VS Code composition root was the plan's EM.P1.A target |
| Desktop badge does not read the master setting | P3 | Deferred (DF-4); informational label |
| Deeper knobs (tool-exposure, retry granularity) | P3 | Deferred (DF-5 / EM.P1.C remainder) |
| Live weak-model A/B not run | P2 | Existing EM.P1.B; shipped default stays false |

## 5. Plan Discrepancies

- Plan examples included a kimi-class concise loop; `ModelCatalog` has no `kimi` family. Selection uses id/tag heuristics plus a `kimi` family key for when a row lands. `# DEVIATION:` data-only, documented in tests.
- Plan listed `structured-edit` and a terse-diff shape separately; both collapse to one named profile `structured-edit` (same three knobs). In scope.
- Desktop sidecar overlay not wired (DF-3). Plan named `ToolActivationContext` as the live path.

## 6. Assumptions Made

- `PromptContext` still only consumes the three overlay knobs; family profiles do not need new PromptBuilder sections.
- Cursor model picker is manual. Session stayed on the current model (same-or-stronger than the plan's mid-strong / high).
- Byte-identical when off means the same object reference for the context (and equal settings knobs), not a serialized prompt string dump.

## 7. Testing Summary

- Root: 4839 passed, 6 skipped, 0 failed, 436 files.
- New/extended: `HarnessSelector.test.ts`, `HarnessSelectorAb.test.ts`, `ToolActivationContext.test.ts`, `ChatCommandHandlers.test.ts`, `CommandRouter.test.ts`, desktop ModelSelector / QuickModelSwitcher / CodingPage / slashCommands.
- `HarnessSelector.ts`: 100% lines / 92.7% branches / 100% functions.

## 8. TODO Tracker

| Item | Status |
|---|---|
| 2.1 Live overlay | Done |
| 2.2 Named profiles | Done |
| 2.3 `/harness` + badge | Done |
| 2.4 Tests + gates | Done |
| Flip shipped default | Not done (NO-GO) |
| Phase 3 catalog/registry | Next |

## 9. Summary and Next Steps

Phase 2 closed EM.P1.A without turning the selector on by default. Next: Phase 3 catalog + registry governance (OW-A4, LG-A2, LG-A3, OW-A5). Optional follow-up: sidecar overlay (DF-3) once that composition root grows a settings projection.

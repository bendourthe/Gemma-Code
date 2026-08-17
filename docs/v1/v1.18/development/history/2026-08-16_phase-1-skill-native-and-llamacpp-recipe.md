# Session History - v1.18.0 Phase 1: Skill-Native Adoptions + llama.cpp Recipe

**Date**: 2026-08-16
**Version**: v1.18.0
**Plan**: [../../plans/v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)
**Phase**: 1 of 7 - Skill-Native Adoptions + llama.cpp Recipe (OW-B1, OI-A4-web, LG-A5)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 7 is terminal).

## Goal

Ship every zero-code win first: confirm two Hub skills already cover OpenWorker morning-brief *content* and Open Interpreter browser GUI QA, and document llama.cpp as a user-registered loopback adapter. No runtime change.

## Pre-flight

`is_final_phase` = **false** (Phase 7 is Architecture Refactor, Known-Gaps Reconciliation, and CI/CD). Prior phases: none. Model routing: plan recommended mid / low (claude-sonnet-5 medium). Re-score: scope medium, complexity low, context medium, risk low, reasoning medium (three mediums -> strong / high). Delta is an upshift. Cursor cannot script a switch; this session stayed on the current model (Grok 4.6), which is same-or-stronger. Visible degrade: none. No silent downshift.

## 1. Starting State

- **Branch**: `develop` (working tree)
- **Environment**: Windows 10, root Vitest suite
- **Plan reference**: [v1.18.0-adoption-agent-harness-and-governance.md](../../plans/v1.18.0-adoption-agent-harness-and-governance.md)

## 2. Chronological Steps

### 2.1 Confirm the two skill-native coverages (OW-B1, OI-A4-web)

**Plan specification**: A short reference note mapping OpenWorker's morning-brief *content* to Hub `agent-presets` `morning-briefing` (scheduler is Phase 4) and Open Interpreter's browser-half GUI QA to Hub `browser-testing-with-devtools` (native-app half deferred). Cite comparison sections. No new skill, MCP, or code.

**What happened**: Wrote [docs/reference/skill-native-adoptions-v1.18.md](../../../reference/skill-native-adoptions-v1.18.md). Operator Hub skills on this machine match those names. Builtin catalog under `modules/coding/skills/catalog/` has no duplicate.

**Verification**: content + no-duplicate assertions in `tests/unit/docs/v1.18-phase-1-reference.test.ts`.

### 2.2 llama.cpp loopback adapter recipe (LG-A5)

**Plan specification**: Example manifest (`protocol` openai, loopback host) plus `docs/reference/llamacpp-loopback-adapter.md` covering llama-server startup flags for large-MoE offload, where the manifest lives, and user-side registration. Cross-reference `patientTier.ts`. Do not open EM.P4. Never bundle the runtime.

**What happened**: Canonical JSON at [docs/reference/examples/llamacpp-loopback-adapter.json](../../../reference/examples/llamacpp-loopback-adapter.json). Guide documents `--host 127.0.0.1`, `--n-cpu-moe` / `--cpu-moe`, `--load-mode mmap`, no trailing `/v1`, and the hard non-loopback reject. Patient tier remains off.

**Verification**: example parses via `validateLocalAdapterManifest`; LAN / remote / `0.0.0.0` mutations rejected with an MCP Registry Policy citation.

### 2.3 Testing and stabilization

**Plan specification**: Unit test for the example (loopback accepted, non-loopback mutation rejected) plus docs-consistency that internal links resolve. `npm test` + `npm run lint`. Update CI path filters if a docs job exists.

**What happened**: Combined tests in `tests/unit/docs/v1.18-phase-1-reference.test.ts`. No dedicated docs job exists; `ci.yml` `test-ts` is unfiltered and already picks up `tests/unit/docs/**`. No workflow rewrite.

**Troubleshooting**:
- **Benchmark fixtures rewritten by pretest / an unrelated suite** (`tests/fixtures/**` ingestMs / compactMs). Restored with `git checkout -- tests/fixtures`. Same ENV class as v1.16 Phase 5. Not a product bug.

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm test -- --coverage` | PASS - 435 files / 4818 passed / 6 skipped / 0 failed |
| Line coverage | PASS - 87.87% lines / 84.25% branches / 91.4% functions (thresholds 80 / 75 / 80) |
| New tests | PASS - 5/5 in `v1.18-phase-1-reference.test.ts` |
| `npm run lint` | PASS - 0 errors (`eslint src modules`) |
| `npx tsc -b` | PASS |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Live llama-server chat not run on this host | P3 | Deferred (DF-1); recipe is `internal-compatible` |
| Hub catalog not present in CI | P3 | Deferred (DF-2); builtin-catalog negative check is the CI gate |

## 5. Plan Discrepancies

- Plan said "update CI path filters to cover `docs/reference/` link checks if a docs job exists." No docs job exists. Link checks live in the unit test that `test-ts` already runs. Not a `# DEVIATION:` in code.
- Standalone example JSON at `docs/reference/examples/` in addition to in-guide fences, so the mutation test has a canonical file. Additive, in scope.

## 6. Assumptions Made

- Hub skill names `agent-presets` / `morning-briefing` and `browser-testing-with-devtools` remain the catalog ids after `nexus skills sync`.
- llama.cpp `--n-cpu-moe` / `--cpu-moe` / `--load-mode mmap` are the current offload knobs (confirmed against the llama.cpp server README as of 2026-08-16). A future rename is operator-side; the guide says to consult that README.
- Cursor model picker is manual. Session stayed on the current model (same-or-stronger than the plan's mid tier).

## 7. Testing Summary

### Automated Tests
- Root Vitest: 4818 passed, 6 skipped, 0 failed (435 files)
- Coverage: 87.87% lines (threshold 80%)

### Manual Testing Performed
- Read Hub `agent-presets` and `browser-testing-with-devtools` SKILL.md on the operator machine.
- Did not start llama-server (DF-1).

### Manual Testing Still Needed
- [ ] Start llama-server on `127.0.0.1:8080`, register the example manifest, set `nexus.llm.backend` to `llamacpp`, send a short prompt (DF-1).
- [ ] After `nexus skills sync`, confirm the two Hub skills exist under `~/.nexus-ai/catalog/skills/` (DF-2).

## 8. TODO Tracker

### Completed This Session
- [x] 1.1 Skill-native coverage note
- [x] 1.2 llama.cpp loopback recipe + example manifest
- [x] 1.3 Tests, lint, typecheck, coverage, CI check

### Remaining (Not Started)
- [ ] Phase 2: Live harness activation (OI-A5, OI-A2, `/harness`)

### Out of Scope (Deferred)
- [ ] Live llama-server smoke (DF-1)
- [ ] CI assertion against a synced Hub catalog (DF-2)
- [ ] OI-A4-native native-app driver (gated item)
- [ ] Opening EM.P4 / adding a Laguna catalog entry (LG-A1)

## 9. Summary and Next Steps

Phase 1 is documentation and validation only. Two Hub skills cover the skill-native comparison items. llama.cpp is a first-class loopback recipe that does not bundle a runtime and does not open the patient-tier gate.

**Next session should**:
1. Implement Phase 2 (wire `HarnessSelector.overlayForModel()` into `buildPromptContext`, gated on `settings.harnessSelectorEnabled`).
2. Keep the setting-off path byte-identical.
3. Do not flip `HARNESS_SELECTOR_SHIPPED_DEFAULT` in 2.1.

# Session History - v1.19.1 Phase 1: Skill-Native Wins

**Date**: 2026-08-19
**Version**: v1.19.1
**Plan**: [../../plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md](../../plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md)
**Phase**: 1 of 2 - Skill-Native Wins (Hermes A3, Airi persona-card, LongCat A5, Inkling transcript-reasoning, QM/Atomic verify-only)
**Outcome**: Complete. All quality gates passed without bypass. `is_final_phase` is false (Phase 2 is terminal).

## Goal

Land every zero-code adoption first: extend three Nexus-Hub skills, record four verify-only coverage lines, and keep Nexus-AI engine code untouched.

## Pre-flight

`is_final_phase` = **false** (Phase 2 is Agent-loop + guardrail hardening; it is the numerically last phase). Prior phases: none on this plan. Model routing: plan recommended mid / low-medium (claude-sonnet-5 medium). Re-score: scope medium, complexity low, context medium, risk low, reasoning medium (three mediums -> strong / high). Delta is an upshift. Cursor cannot script a switch; this session stayed on the current model (Grok 4.6), which is same-or-stronger. Visible degrade: none. No silent downshift. The user pre-authorized the sequence (Phase 1, commit only, Phase 2, commit, push, `/update release`).

## 1. Starting State

- **Branch (Nexus-AI)**: `develop` (working tree)
- **Branch (Nexus-Hub)**: `feat/v1.19.1-skill-native-wins` off `develop`
- **Environment**: Windows 10, root Vitest suite
- **Plan reference**: [v1.19.1-adoption-agent-loop-and-guardrail-hardening.md](../../plans/v1.19.1-adoption-agent-loop-and-guardrail-hardening.md)
- **Hub commit**: `451e508f` (`docs(skills): add grounded citations, persona cards, and avatar-prep guidance`)

## 2. Chronological Steps

### 2.1 Grounded-citation verification (Hermes A3)

**Plan specification**: Extend Hub `deep-research-compilation` with quote-verification against fetched text and a fact-check pass. Failure: flag, do not fabricate. Skill prose only.

**What happened**: Added a Grounded-citation verification section (excerpt store, `[UNVERIFIED QUOTE]`, `[UNSUPPORTED]`, stop-and-report after one retry). Folded the pass into Step 8. Tightened Critical Rules, Common Rationalizations, and Verification (kept at 6 checklist items).

**Verification**: Hub `python scripts/validate_skills.py --path catalog/skills/specialized-domains/deep-research-compilation --quality` -> PASS (0 errors, 0 warnings).

### 2.2 Persona-card prompting (Airi skill-native)

**Plan specification**: Add identity / voice / boundaries card patterns to `prompt-engineering` / `creative-generation`. Map onto Chat system-prompt if it exists; else record the field as a stretch.

**What happened**: Card template and Nexus mapping table in `prompt-engineering`. Companion-voice pointer in `creative-generation`. Chat `Chat` type has no system-prompt field (title, modelId, folderId, contextScopeId only). Workaround: first user message kept in the thread. Recorded as known-gaps DF-1.

**Verification**: Hub quality PASS on both skills.

### 2.3 Avatar-prep + transcript-reasoning (LongCat A5, Inkling)

**Plan specification**: Self-contained guidance blocks naming v2.0.0 avatar mode (Phase 3) and audio bridge (Phase 1) as "when available".

**What happened**: Added talking-head prep (script pacing, TTS handoff, reference-photo framing, audio hygiene) and transcript-reasoning (heard vs inferred, no silent ASR correction) to `creative-generation`.

**Verification**: Hub quality PASS.

### 2.4 Verify-only dedups

**Plan specification**: Four evidence lines; zero code.

**What happened** (recorded in [docs/reference/skill-native-adoptions-v1.19.1.md](../../../reference/skill-native-adoptions-v1.19.1.md) and this file):

| Item | Evidence |
|---|---|
| (a) QM scope-owned skills + git import | `nexus skills sync` via `NexusHubSyncer.ts` + `SkillInstaller.ts` + Settings Sync now; user/project roots via `SkillCatalog` (`builtin` > `user` > `nexus-hub`). |
| (b) QM crons/watches | OpenWorker A2 scheduler **has shipped**: `modules/coding/autonomy/AgentRunScheduler.ts` in v1.18.0 (morning brief off by default; no auto-approve). Not rebuilt. |
| (c) Atomic lessons/procedures capture | Hub `continuous-learning` (observations.jsonl -> instincts YAML -> draft skills). C5 memory-kind storage stays v2.0.0 stretch. |
| (d) Atomic 17 starter playbooks | Hub catalog 271 skills / 21 categories (`agent-presets`, `runbook-writer`, `oncall-runbook`, `implementation-plan`). No import. |

### 2.5 Testing and stabilization

**Plan specification**: Hub skill lint on the three edited skills; session history for Phase 1.

**What happened**: Hub quality PASS x3. Nexus-AI: mapping note + `tests/unit/docs/v1.19.1-phase-1-reference.test.ts`. `nexus-check --rule skill-duplicate-name` 0 findings. `check:prompts` 0 errors (pre-existing oversized warnings on `review-pr` / `council`). No `core/` or `modules/` source changed.

**Troubleshooting**:
- **Benchmark fixtures rewritten by an unrelated suite** (`tests/fixtures/**`). Restored with `git checkout -- tests/fixtures`. Same ENV class as v1.18 Phase 1. Not a product bug.

## 3. Verification Gate

| Check | Result |
|---|---|
| Hub `validate_skills.py --quality` (3 skills) | PASS - 0 errors, 0 warnings |
| `npx vitest run --coverage` | PASS - 460 files / 3 skipped; 4950 passed / 11 skipped / 0 failed |
| Line coverage | PASS - 87.8% lines / 83.9% branches / 91.5% functions (thresholds 80 / 75 / 80) |
| New tests | PASS - 3/3 in `v1.19.1-phase-1-reference.test.ts` |
| `npm run lint` | PASS - 0 errors (`eslint src modules`) |
| `npx tsc -b` | PASS |
| `npm run check:prompts` | PASS - 0 errors (2 pre-existing oversized warnings) |
| Quality gate bypass | None |

**Verdict: GO.**

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Chat has no per-chat system-prompt field | P2 | Deferred (v1.19.1 DF-1); first-message card works today |
| Hub edits not merged / not synced | P3 | Deferred (v1.19.1 DF-2); authored at `451e508f` |

## 5. Plan Discrepancies

- Plan said "run `/generate-session-history` for Phase 1." This file is that artifact (implement-phase 8.8).
- Plan said "wire CI" after tests. No dedicated docs job exists; `ci.yml` `test-ts` already picks up `tests/unit/docs/**`. No workflow rewrite (same as v1.18 Phase 1).
- Patient-tier honesty calibration is not in this phase (moved to v1.19.2 task 1.1 per the plan header).

## 6. Assumptions Made

- Hub skill ids `deep-research-compilation`, `prompt-engineering`, `creative-generation`, and `continuous-learning` remain the catalog ids after `nexus skills sync`.
- Chat pillar will keep the current `Chat` record shape through v1.19.1 Phase 2; the persona field is out of scope for this plan.
- Cursor model picker is manual. Session stayed on the current model (same-or-stronger than the plan's mid tier).

## 7. Testing Summary

### Automated Tests
- Root Vitest: 4950 passed, 11 skipped, 0 failed (460 files passed, 3 skipped)
- Coverage: 87.8% lines (threshold 80%)
- Hub skill lint: 3/3 PASS with `--quality`

### Manual Testing Performed
- Read Chat `types.ts` and `ChatPage.tsx`; confirmed no system-prompt setting.
- Confirmed `AgentRunScheduler.ts` exists and is the v1.18.0 OW-A2 scheduler.
- Confirmed Hub `SKILL_INDEX.md` total 271 skills across 21 categories.

### Manual Testing Still Needed
- [ ] Merge Hub `feat/v1.19.1-skill-native-wins` and run `nexus skills sync --apply` (DF-2).
- [ ] After sync, open `deep-research-compilation` under `~/.nexus-ai/catalog/skills/` and confirm the Grounded-citation section is present.

## 8. TODO Tracker

### Completed This Session
- [x] 1.1 Grounded-citation discipline
- [x] 1.2 Persona-card prompting
- [x] 1.3 Avatar-prep + transcript-reasoning
- [x] 1.4 Four verify-only evidence lines
- [x] 1.5 Hub lint, Nexus-AI tests, session history

### Remaining (Not Started)
- [ ] Phase 2: Agent-loop + guardrail hardening (2.1-2.10)

### Out of Scope (Deferred)
- [ ] Per-chat persona field in Chat settings (DF-1; v2.0.0 Chat phases)
- [ ] Hub merge + `nexus skills sync` (DF-2)
- [ ] Atomic C5 lesson/procedure memory kinds (v2.0.0 stretch)
- [ ] Video Lab avatar mode and audio bridge (v2.0.0)

## 9. Summary and Next Steps

Phase 1 is skill prose and documentation only. Three Hub skills carry the zero-code adoptions. Four verify-only items are covered by existing Nexus / Hub surfaces. No `core/` or `modules/` source changed.

**Next session should**:
1. Implement Phase 2 (hard denials first, then loop guards, recovery, compression, posture dial, provenance, DNS pin, watch/hash, introspected prompts, integration tests).
2. Keep the PermissionTiers floor clamp authoritative in every posture.
3. Do not ship a literal QM "Dangerous" no-floor mode.

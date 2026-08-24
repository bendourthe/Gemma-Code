# Development Log: Phase 5 Motion Coordination + Polish (A4-completion)

**Date**: 2026-08-16
**Operator**: Nexus contributor
**Assisted by**: Cursor Grok 4.6
**Objective**: Wire recede-when-active across every adopting surface, enforce one primary motion per element from a single precedence table, and document the accessibility plus battery/perf audit.
**Outcome**: Complete. All four quality gates passed without bypass. `is_final_phase` is false (Phase 6 is terminal).

---

## 1. Starting State

- **Branch**: `develop`
- **Starting tag/commit**: `210b7a6` (Phase 4 hero-action metal)
- **Environment**: Windows 10, Node workspace `@nexus/desktop`, Vitest + jsdom
- **Prior session reference**: [2026-08_phase-4-hero-action-metal.md](2026-08_phase-4-hero-action-metal.md)
- **Plan reference**: [docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md](../../plans/v1.17.0-adoption-ui-motion-identity.md)

Context: Phases 2-4 landed orbs, beams, and metal. Recede was per-effect. Composer focus could breathe a beam while the submit control ran metal. The retained generation canvas stacked aurora, orb, and a frame beam. Phase 5 makes those rules global.

---

## 2. Chronological Steps

### 2.1 Recede-when-active everywhere + one-motion-per-element

**Plan specification**: Every orb / beam / metal surface participates in recede. One primary motion per element. Precedence lives in one place, not per component.

**What happened**: `desktop/src/motion/precedence.ts` is the SSOT: `orb > metal > beam > aurora`. `MotionSurface` groups nested effects, registers recede once when the winner is non-null, and exposes `useAllowsMotion` so losers pause. Nested `useActiveMotionSurface` skips inside a group. Helpers: `composerMotionCandidates` (streaming -> beam, focus -> metal, idle -> none), `dockMotionCandidates` (loading/working -> orb, idle -> beam), `GENERATION_CANVAS_CANDIDATES` (orb always wins).

Surfaces wrapped: `CodingInput`, `MediaComposer`, `LocalModelStatus` (loading and active), `GenerationCanvas` (`data-motion-winner`). `AccentBeam` / `MetalAccent` / `AgentStateOrb` honor `useAllowsMotion`. Aurora CSS halts when the winner is not `aurora`. Ungrouped message orbs still self-register recede.

Composer focus no longer plays the breathing beam (metal owns focus). Traveling beam owns streaming. Idle composers are quiet (no recede from the composer).

**Key files changed**: `precedence.ts`, `MotionActivity.tsx`, `index.ts`, `CodingInput.tsx`, `MediaComposer.tsx`, `LocalModelStatus.tsx`, `GenerationCanvas.tsx`, `AccentBeam.tsx`, `MetalAccent.tsx`, `AgentStateOrb.tsx`, `globals.css`

**Troubleshooting**:
- **Problem**: An earlier `useMemo` for dock candidates sat after `LocalModelStatus` early returns. Coverage failed 9 tests with `Rendered more hooks than during the previous render`.
- **Root cause**: Rules of Hooks. Loading path had fewer hooks than the sample path.
- **Resolution**: Drop the memo. `dockMotionCandidates` is cheap and called during render after the sample exists.

**Verification**: `tests/motionPrecedence.test.ts`, `MotionActivity.test.tsx` grouped recede restore, composer/canvas/dock tests.

---

### 2.2 Accessibility + battery/perf audit

**Plan specification**: Confirm reduced-motion fallbacks for orb, beam, metal, and ambient. Confirm offscreen pause, instance cap, and no runaway frame cost on a realistic multi-effect screen.

**What happened**: Combined reduced-motion test mounts orb + beam + metal together and asserts halt (static orb, static beam border, metal fallback). Metal also pauses when `document.hidden` is true. Offscreen pause and cap 3 remain unit-proven from Phases 2-4. One-motion gating is unit-proven (focus does not play beam; canvas beam `data-beam-playing="false"` with winner `orb`).

Live Tauri fps / battery with a streaming composer, idle dock, and visible hero control is **not proven here** (jsdom has no GPU; this session did not capture an on-device trace). Recorded as DF-8.

**Key files changed**: `useReducedMotion.test.tsx`, `MetalAccent.tsx` (visibility listener), `known-gaps.md` (DF-8)

**Troubleshooting**: None beyond the hooks fix in 2.1.

**Verification**: combined reduced-motion test; existing IntersectionObserver and cap tests still pass.

---

### 2.3 Testing and stabilization

**Plan specification**: Precedence yields one winner; recede flag toggles; reduced-motion covers all three effects. Lint, typecheck, tests. Update CI if needed.

**What happened**: New `motionPrecedence.test.ts`. Recede restore when grouped candidates go empty. Composer tests assert focus does not play the beam. GenerationCanvas asserts winner orb and paused beam. CI already watches `desktop/**` with concurrency, npm cache, and PR ubuntu-only; no workflow rewrite.

**Verification**: see section 3.

---

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run test:coverage --workspace @nexus/desktop` | PASS - 106 files / 916 passed / 0 failed |
| Line coverage | PASS - 92.92% lines / 86.2% branches / 85.08% functions |
| `src/motion` | PASS - 96.96% lines (`MotionActivity.tsx` 97.14%, `precedence.ts` 91.66%) |
| `AccentBeam.tsx` | PASS - 100% lines |
| `GenerationCanvas.tsx` | PASS - 100% lines |
| `MetalAccent.tsx` | PASS - 99.23% lines |
| `npm run lint --workspace @nexus/desktop` | PASS |
| `npm run typecheck --workspace @nexus/desktop` | PASS |
| Quality gate bypass | None |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| On-device multi-effect GPU/battery cost not measured | P3 | DF-8; unit-proven pause/cap/gating; operator pass in Phase 6 or release QA |
| Tailwind `@theme` still source-level | P3 | DF-1 unchanged |
| Installer motion still separate | P3 | DF-3 unchanged |
| ASR / web-search activities unused | P3 | DF-5 unchanged |
| Chat pending is a batch wait | P3 | DF-6 unchanged |

---

## 5. Plan Discrepancies

- Phase 3 placed a breathing beam on composer focus. Phase 5 changes that: focus is metal-only so the composer does not run two primary motions. Streaming still uses the traveling beam.
- Sub-task 5.2 asked for a realistic on-device multi-effect screen. jsdom cannot measure GPU frame time; the gap is DF-8 rather than a silent pass.
- "Update CI for the coordination layer" was a no-op: `shell-build.yml` already path-filters `desktop/**`.
- A dock `useMemo` was tried and removed (Rules of Hooks after early returns). No `# DEVIATION:` markers in code.

---

## 6. Assumptions Made

- Grouping recede on `MotionSurface` (one id per composer/dock/canvas) is enough; nested effects should not double-count.
- Composer `playing={streaming || focused}` on `AccentBeam` is safe because `useAllowsMotion("beam")` gates the effective play flag.
- Cursor model picker is manual: plan recommended mid / medium; session stayed on the current model. Visible degrade, no downshift.

---

## 7. Testing Summary

### Automated Tests
- Desktop Vitest: 916 passed, 0 failed (106 files)
- Coverage: 92.92% lines / 86.2% branches / 85.08% functions (thresholds 80 / 70 / 80)

### Manual Testing Still Needed
- [ ] Confirm one-motion-per-surface in the live Tauri shell (focus metal, streaming beam, idle dock beam, working dock orb)
- [ ] Confirm reduced-motion halts orb, beam, metal, and aurora together
- [ ] On-device: fps / battery with streaming composer + idle dock + visible hero control (DF-8)

---

## 8. TODO Tracker

### Completed This Session
- [x] 5.1 Precedence SSOT + MotionSurface recede on composers, dock, canvas
- [x] 5.2 A11y + perf audit documented; DF-8 for unproven GPU cost
- [x] 5.3 Tests, lint, typecheck, coverage

### Remaining
- [ ] Phase 6: Architecture refactor, known-gaps reconciliation, and CI/CD (final)

---

## 9. Summary and Next Steps

Phase 5 is the coordination layer. One winner per grouped surface. Ambient glow recedes while any winner is active and restores when candidates go empty. Reduced-motion still halts every kind. Live GPU cost is not proven here.

**Next session should**:
1. Implement Phase 6 (refactor + known-gaps finalize + CI/CD optimize).
2. Operator visual pass for DF-8 if a GPU is available.
3. Do not start `/update release` until Phase 6 completes.

# Development Log: Phase 1 Motion Foundation (A4-foundation)

**Date**: 2026-08-16
**Operator**: Nexus contributor
**Assisted by**: Cursor Grok 4.6
**Objective**: Land shared motion tokens, a centralized `prefers-reduced-motion` mechanism, and a recede-when-active primitive so later orb / beam / metal effects cannot ship uncoordinated or inaccessible.
**Outcome**: Complete. All four quality gates passed without bypass. `is_final_phase` is false (Phase 6 is terminal).

---

## 1. Starting State

- **Branch**: `develop`
- **Starting tag/commit**: `1afcb6e` (catalog + prod-audit recovery on top of v1.16.0)
- **Environment**: Windows 10, Node workspace `@nexus/desktop`, Vitest + jsdom
- **Prior session reference**: first v1.17 session
- **Plan reference**: [docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md](../../plans/v1.17.0-adoption-ui-motion-identity.md)

Context: v1.16.0 (serving gateway + OCR) is tagged. v1.17 is a shell-only motion-identity cycle. Phase 1 unblocks Phases 2-4.

---

## 2. Chronological Steps

### 2.1 Shared motion tokens

**Branch**: `develop` | **PR**: none yet | **Merged to**: n/a

**Plan specification**: Additive motion-token group in `tokens.css` (durations, easings, state-accent aliases mapped to locked accents/gradient), resolving via Tailwind v4 `@theme inline`.

**What happened**: Added `--motion-duration-*`, `--motion-ease-*`, `--motion-accent-*` aliases, and recede opacities to `:root`. Added an `@theme inline` bridge for a future Tailwind pipeline. Nothing in the existing token set changed.

**Key files changed**: `desktop/src/styles/tokens.css`, `docs/v1/v1.17/design-tokens.md`

**Troubleshooting**: None for this sub-task.

**Verification**: `tests/brandTokens.test.ts` asserts token presence, alias targets, and the `@theme inline` mapping.

---

### 2.2 Centralized reduced-motion

**Plan specification**: `useReducedMotion` hook + a single CSS media block; refactor constellation, GenerationCanvas, and FloatingLogo onto it without changing the halt-not-slow outcome.

**What happened**: New `desktop/src/motion/` module (`reducedMotion.ts`, `useReducedMotion.ts`). `constellation.ts` re-exports `prefersReducedMotion` from the shared helper. The two `globals.css` media blocks were merged into one. JS surfaces mark `data-reduced-motion`; CSS still kills keyframes under the media query.

**Key files changed**: `desktop/src/motion/reducedMotion.ts`, `desktop/src/motion/useReducedMotion.ts`, `desktop/src/styles/globals.css`, `desktop/src/components/constellation.ts`, `ConstellationBackground.tsx`, `FloatingLogo.tsx`, `GenerationCanvas.tsx`

**Troubleshooting**:
- **Problem**: `useReducedMotion` change-event test failed with `expected 'false' to be 'true'` and an `act(...)` warning.
- **Attempted**: Assert immediately after calling the stubbed `matchMedia` listener.
- **Root cause**: React 19 did not flush the `setReduced` update outside `act`.
- **Resolution**: Wrapped the listener dispatch in `act()` from `@testing-library/react`.

**Verification**: Hook tests plus constellation "static frame, never loops" test still pass through the shared mechanism.

---

### 2.3 Recede-when-active primitive

**Plan specification**: Shared context plus a CSS affordance; one reference integration; no production-surface wiring (Phase 5).

**What happened**: `MotionActivityProvider` tracks active surface ids. `useActiveMotionSurface(id, active)` is the declarative registration. App backdrop and constellation read `isAmbientReceded` and drop opacity via `--motion-recede-*` with a duration/ease transition (instant under reduced-motion). Styleguide hosts the reference toggle.

**Key files changed**: `desktop/src/motion/MotionActivity.tsx`, `desktop/src/App.tsx`, `desktop/src/pages/Styleguide.tsx`, `desktop/src/styles/globals.css`

**Troubleshooting**: None for this sub-task.

**Verification**: `MotionActivity.test.tsx` and the App styleguide recede test toggle `data-ambient-receded` on activate/deactivate with no layout shift.

---

### 2.4 Testing and stabilization

**Plan specification**: Hook, reduced-motion halt, token presence, recede toggle. `npm run test:shell` + desktop lint. Update CI path filters if needed.

**What happened**: Added unit tests for the helper, hook, and recede primitive; extended existing brand/constellation/logo/canvas/App tests. CI was already covering `desktop/**` (`shell-build.yml` path filters, concurrency cancel-in-progress, npm cache). No workflow rewrite.

**Key files changed**: `desktop/tests/reducedMotion.test.ts`, `useReducedMotion.test.tsx`, `MotionActivity.test.tsx`, plus the extended existing tests.

**Troubleshooting**: See 2.2 (`act` wrap). No further failures.

**Verification**: See section 3.

---

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run test --workspace @nexus/desktop` (coverage) | PASS - 98 files / 849 passed / 0 failed |
| Line coverage | PASS - 92.57% lines / 85.77% branches / 84.62% functions |
| New motion files coverage | PASS - `reducedMotion.ts` 100%, `useReducedMotion.ts` 100%, `MotionActivity.tsx` 100% lines |
| `npm run lint --workspace @nexus/desktop` | PASS - 0 errors, `--max-warnings=0` |
| `npm run typecheck --workspace @nexus/desktop` | PASS |
| Quality gate bypass | None |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Tailwind `@theme inline` is not compiled by Vite | P2 | Deferred (DF-1); tokens resolve as CSS vars |
| Production surfaces do not yet register recede | P2 | Deferred to Phase 5 (DF-2) |
| Installer motion not on the desktop hook | Cosmetic | Deferred (DF-3); shell-only cycle |

---

## 5. Plan Discrepancies

- Motion tokens "resolve via Tailwind v4 `@theme inline`" in source, but the shell's actual consumption path is CSS custom properties (Tailwind is not in the Vite pipeline). Documented as DF-1 rather than adding a Tailwind dependency.
- No other deviations. `# DEVIATION:` markers were not required in code.

---

## 6. Assumptions Made

- **Styleguide is an acceptable reference surface**: the plan asked for one proof integration and forbade wiring every production surface. The `/_styleguide` toggle is not a user-facing feature of the four pillars.
- **Opacity-only recede**: "no per-frame work beyond an opacity transition" was taken as a hard constraint; no spatial mask around the active surface.
- **Cursor model picker is manual**: the plan recommended mid-tier/medium; this session stayed on the current Cursor model (no scriptable switch). Visible degrade, no downshift.

---

## 7. Testing Summary

### Automated Tests
- Desktop Vitest: 849 passed, 0 failed (98 files)
- Coverage: 92.57% lines (threshold 80%)

### Manual Testing Performed
- None in this session (jsdom cannot show the recede transition visually).

### Manual Testing Still Needed
- [ ] Open `/_styleguide` in `npm run dev:web` / `tauri dev`, toggle "Active effect on", confirm the constellation and radial glow dim smoothly and restore without layout shift.
- [ ] Toggle OS reduced-motion and confirm constellation is static, logo does not bob, and recede has no transition.

---

## 8. TODO Tracker

### Completed This Session
- [x] 1.1 Shared motion tokens
- [x] 1.2 Centralized reduced-motion
- [x] 1.3 Recede-when-active primitive + Styleguide reference
- [x] 1.4 Tests, lint, typecheck, coverage

### Remaining (Not Started or Partially Done)
- [ ] Phase 2: Agent-state orbs (A1)

### Out of Scope (Deferred)
- [ ] Phase 5 recede wiring on every orb/beam/metal surface (DF-2)
- [ ] Tailwind v4 Vite pipeline (DF-1)
- [ ] Installer reduced-motion unification (DF-3)

---

## 9. Summary and Next Steps

Phase 1 is the motion foundation: tokens, one reduced-motion source of truth, and a cheap recede primitive proven on the Styleguide. Existing constellation / aurora / float behavior is unchanged when motion is allowed and still fully halted when reduced.

**Next session should**:
1. Implement Phase 2 (agent-state orbs, flagship) on this foundation.
2. Have each adopting surface call `useActiveMotionSurface` so the ambient glow steps back.
3. Keep reduced-motion on the Phase 1 hook; do not add per-component `matchMedia` checks.

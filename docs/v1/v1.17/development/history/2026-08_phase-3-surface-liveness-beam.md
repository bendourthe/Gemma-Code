# Development Log: Phase 3 Surface-Liveness Beam (A2)

**Date**: 2026-08-16
**Operator**: Nexus contributor
**Assisted by**: Cursor Grok 4.6
**Objective**: Reverse-engineer a traveling / breathing border beam (no `border-beam` package) onto the input composers, idle model dock, and generation-canvas frame.
**Outcome**: Complete. All four quality gates passed without bypass. `is_final_phase` is false (Phase 6 is terminal).

---

## 1. Starting State

- **Branch**: `develop`
- **Starting tag/commit**: `6f69324` (Phase 1+2 motion primitives and agent-state orbs)
- **Environment**: Windows 10, Node workspace `@nexus/desktop`, Vitest + jsdom
- **Prior session reference**: [2026-08_phase-2-agent-state-orbs.md](2026-08_phase-2-agent-state-orbs.md)
- **Plan reference**: [docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md](../../plans/v1.17.0-adoption-ui-motion-identity.md)

---

## 2. Chronological Steps

### 2.1 Internal beam component

**Plan specification**: CSS `@property` traveling beam + breathing pulse; Nexus accents; strength; play/pause fade; auto radius from `--radius-*`; reduced-motion static border; recede-when-active.

**What happened**: `desktop/src/components/AccentBeam.tsx` wraps children. `globals.css` declares `--nexus-beam-angle`, conic `::before` mask, travel and breathe keyframes, and a static border fallback. Play/pause is opacity so the wrapper never unmounts (no layout shift).

**Key files changed**: `AccentBeam.tsx`, `desktop/src/styles/globals.css`

**Troubleshooting**: None.

**Verification**: `tests/AccentBeam.test.tsx` covers mode, pause, strength, reduced-motion, recede.

---

### 2.2 Surface placement

**Plan specification**: Breathing on composer focus; traveling while streaming; subtle beam on loaded-and-ready model dock; beam framing GenerationCanvas. Do not stack with the Phase 2 orb on the same element.

**What happened**: `CodingInput` and `MediaComposer` take `streaming` and track focus. Chat / image / video pass streaming from pending / `isGenerating`. Coding passes `busy`. `LocalModelStatus` plays a breathing beam only while idle (loaded, ready). Loading and inference keep the orb and pause the beam. `GenerationCanvas` gets a traveling frame beam outside the overflow-hidden aurora box.

**Key files changed**: `CodingInput.tsx`, `CodingPage.tsx`, `MediaComposer.tsx`, `ChatPage.tsx`, `ImageStudioPage.tsx`, `VideoLabPage.tsx`, `LocalModelStatus.tsx`, `GenerationCanvas.tsx`

**Troubleshooting**: None.

**Verification**: Per-surface tests for focus/streaming/idle-ready/rendering.

---

### 2.3 Testing and stabilization

**Plan specification**: Beam unit tests + one test per surface. Lint. CI path filters if needed.

**What happened**: Extended existing composer / dock / canvas / page tests. CI already covers `desktop/**`. No workflow rewrite.

---

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run test:coverage --workspace @nexus/desktop` | PASS - 102 files / 886 passed / 0 failed |
| Line coverage | PASS - 92.77% lines / 85.85% branches / 84.92% functions |
| `AccentBeam.tsx` | PASS - 100% lines / 100% branches |
| `npm run lint --workspace @nexus/desktop` | PASS |
| `npm run typecheck --workspace @nexus/desktop` | PASS |
| Quality gate bypass | None |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| GenerationCanvas aurora + orb + frame beam | P2 | DF-4 updated; canvas unmounted in production chat |
| Recede incomplete for metal | P2 | DF-2 |
| Chat pending is a batch wait | P3 | DF-6; traveling beam uses the same flag |

---

## 5. Plan Discrepancies

- Chat uses `MediaComposer`, not `ChatInput`. Beam landed on `MediaComposer` + `CodingInput`.
- Model dock beam plays only when idle (ready). Inference keeps the orb and pauses the beam so one motion owns the widget.
- Beam wrapper stays mounted when paused (fade), rather than unmounting.
- No `# DEVIATION:` markers in code.

---

## 6. Assumptions Made

- Frame beam vs interior orb on `GenerationCanvas` is "not the same element" for Phase 3; full precedence is Phase 5 (DF-4).
- Cursor model picker is manual: plan recommended mid / medium; session stayed on the current model. Visible degrade, no downshift.

---

## 7. Testing Summary

### Automated Tests
- Desktop Vitest: 886 passed, 0 failed (102 files)
- Coverage: 92.77% lines (threshold 80%)

### Manual Testing Still Needed
- [ ] Focus a composer and confirm a breathing accent beam, then send and confirm it travels until the reply lands.
- [ ] Confirm the model dock breathes while idle and yields to the orb while inferring.
- [ ] Toggle OS reduced-motion and confirm a static accent border, no chase.

---

## 8. TODO Tracker

### Completed This Session
- [x] 3.1 AccentBeam
- [x] 3.2 Surface placement
- [x] 3.3 Tests, lint, typecheck, coverage

### Remaining
- [ ] Phase 4: Hero-action metal (A3)

---

## 9. Summary and Next Steps

Phase 3 is the surface-liveness beam. Composers breathe on focus and travel while streaming. The model dock breathes when ready. The retained generation canvas has a traveling frame. No new npm dependency.

**Next session should**:
1. Implement Phase 4 (hero-action metal) on send / Generate / New session only.
2. Keep reduced-motion on the Phase 1 hook.
3. Do not blanket-apply metal to every button (N2).

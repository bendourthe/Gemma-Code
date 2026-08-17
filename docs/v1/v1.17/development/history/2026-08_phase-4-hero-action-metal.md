# Development Log: Phase 4 Hero-Action Metal (A3)

**Date**: 2026-08-16
**Operator**: Nexus contributor
**Assisted by**: Cursor Grok 4.6
**Objective**: Reverse-engineer a bounded WebGL liquid-metal ring (no `metal-fx` package) onto send / Generate / New session only.
**Outcome**: Complete. All four quality gates passed without bypass. `is_final_phase` is false (Phase 6 is terminal).

---

## 1. Starting State

- **Branch**: `develop`
- **Starting tag/commit**: `05d27f3` (Phase 3 surface-liveness beam)
- **Environment**: Windows 10, Node workspace `@nexus/desktop`, Vitest + jsdom
- **Prior session reference**: [2026-08_phase-3-surface-liveness-beam.md](2026-08_phase-3-surface-liveness-beam.md)
- **Plan reference**: [docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md](../../plans/v1.17.0-adoption-ui-motion-identity.md)

---

## 2. Chronological Steps

### 2.1 Internal metal component

**Plan specification**: WebGL liquid-metal ring; Nexus accents; strength; paused; offscreen pause; instance cap; reduced-motion and missing-WebGL static fallback; recede while animating.

**What happened**: `MetalAccent` overlays a pointer-events-none canvas on a hero control. `metalGl.ts` compiles a tiny rounded-rect SDF + moving specular, tinted from locked accent linear-RGB. `metalRegistry.ts` caps simultaneous GPU loops at 3. Feature-detect `getContext('webgl2'|'webgl')` inside try/catch; compile/link failure releases the slot and falls back. Missing IntersectionObserver is treated as visible.

**Key files changed**: `MetalAccent.tsx`, `metalGl.ts`, `metalRegistry.ts`, `desktop/src/styles/globals.css`

**Troubleshooting**: jsdom logs "Not implemented: HTMLCanvasElement's getContext()" on the default fallback path (same as orbs). Tests that need the animating path stub `getContext`.

**Verification**: `tests/MetalAccent.test.tsx`, `metalRegistry.test.ts`, `metalGl.test.ts`.

---

### 2.2 Hero-control placement

**Plan specification**: Metal on chat/coding send, primary Generate, New-session CTA. Not on secondary buttons, chips, list items, or icons.

**What happened**: Wrapped `coding-input-submit`, `media-composer-submit`, and `chat-input-submit`. Image Studio / Video Lab pass `submitLabel="Generate"` (Generate is the same hero submit after the chat redesign). Desktop CodingPage had no New-session control; added a labeled **New session** button beside Cancel (Cancel stays secondary). Clicking it cancels the sidecar session if any, then clears `sessionId` / `turns`. Folder-tree new-chat, slash suggestions, and media add stay unadorned.

**Key files changed**: `CodingInput.tsx`, `MediaComposer.tsx`, `ChatInput.tsx`, `CodingPage.tsx`, `ImageStudioPage.tsx`, `VideoLabPage.tsx`

**Troubleshooting**: None.

**Verification**: Placement assertions in CodingInput, MediaComposer, ChatInput, and CodingPage tests.

---

### 2.3 Testing and stabilization

**Plan specification**: Mount, fallback, cap, placement. Lint. CI path filters if needed. Perf/battery note.

**What happened**: Extended existing composer / page tests. CI already covers `desktop/**`. No workflow rewrite.

**Perf/battery note**: Offscreen pause is proven via a fake IntersectionObserver (animating -> fallback when `isIntersecting` is false). The instance cap is proven (fourth stubbed-GL host stays on the static fallback and does not open a fourth context). Frame cost and battery drain with all hero controls visible is **not proven here**: jsdom has no GPU, and this session did not capture an on-device trace. Phase 5.2 is the documented place for that on-device pass.

---

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run test:coverage --workspace @nexus/desktop` | PASS - 105 files / 909 passed / 0 failed |
| Line coverage | PASS - 92.91% lines / 86.08% branches / 85.19% functions |
| `MetalAccent.tsx` | PASS - 99.17% lines / 85% branches / 100% functions |
| `metalGl.ts` / `metalRegistry.ts` | PASS - 100% lines |
| `npm run lint --workspace @nexus/desktop` | PASS |
| `npm run typecheck --workspace @nexus/desktop` | PASS |
| Quality gate bypass | None |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Composer beam + submit metal can play together | P2 | DF-7; adjacent nodes, Phase 5 precedence |
| Recede not yet a global one-motion rule | P2 | DF-2 updated; metal now registers while animating |
| GPU frame cost not measured on device | P3 | Recorded as not proven here; Phase 5.2 |

---

## 5. Plan Discrepancies

- Chat uses `MediaComposer`, not `ChatInput`. Metal landed on both (shared send contract + live chat composer).
- Image/Video have no separate Generate button; Generate is `media-composer-submit` with `submitLabel="Generate"`.
- Desktop CodingPage had no New-session CTA; one was added rather than metal-ing an icon.
- Metal is on the button; beam stays on the composer wrapper (not the same DOM node).
- No `# DEVIATION:` markers in code.

---

## 6. Assumptions Made

- Wrapping the button in an inline-flex host is enough for the ring to size to the control.
- Cursor model picker is manual: plan recommended mid-strong / high; session stayed on the current model. Visible degrade, no downshift.

---

## 7. Testing Summary

### Automated Tests
- Desktop Vitest: 909 passed, 0 failed (105 files)
- Coverage: 92.91% lines / 86.08% branches / 85.19% functions (thresholds 80 / 70 / 80)

### Manual Testing Still Needed
- [ ] Confirm the metal ring reads as an on-brand specular on send / Generate / New session in the live Tauri shell
- [ ] Confirm reduced-motion shows a static accent edge and no WebGL loop
- [ ] On-device: frame cost with coding send + media Generate + New session visible; confirm offscreen tab pause (Phase 5.2)

---

## 8. TODO Tracker

### Completed This Session
- [x] 4.1 MetalAccent + registry + fallback
- [x] 4.2 Hero placement (send / Generate / New session)
- [x] 4.3 Tests, lint, typecheck, coverage, perf note

### Remaining
- [ ] Phase 5: Motion coordination + polish (A4-completion)

---

## 9. Summary and Next Steps

Phase 4 is the hero-action metal ring. Three (plus the shared ChatInput send) hero controls carry it. Secondary controls do not. GPU work is capped and paused offscreen. jsdom proves fallback, cap, and pause; live GPU cost is not proven here.

**Next session should**:
1. Implement Phase 5 (recede everywhere, one-motion-per-element, a11y + battery/perf audit).
2. Resolve DF-7 (composer beam vs submit metal) in the precedence table.
3. Do not start Phase 6 until Phase 5 is stable.

# Development Log: Phase 2 Agent-State Orbs (A1)

**Date**: 2026-08-16
**Operator**: Nexus contributor
**Assisted by**: Cursor Grok 4.6
**Objective**: Land an internal on-brand agent-state orb (Canvas 2D, no `thinking-orbs` package), a typed activity-to-state mapping, and adopt it on coding, chat, media, and model-status loaders.
**Outcome**: Complete. All four quality gates passed without bypass. `is_final_phase` is false (Phase 6 is terminal).

---

## 1. Starting State

- **Branch**: `develop`
- **Starting tag/commit**: Phase 1 motion foundation is uncommitted on the same tree
- **Environment**: Windows 10, Node workspace `@nexus/desktop`, Vitest + jsdom
- **Prior session reference**: [2026-08_phase-1-motion-foundation.md](2026-08_phase-1-motion-foundation.md)
- **Plan reference**: [docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md](../../plans/v1.17.0-adoption-ui-motion-identity.md)

Context: Phase 1 shipped tokens, `useReducedMotion`, and recede-when-active. Phase 2 is the flagship orb.

---

## 2. Chronological Steps

### 2.1 Typed activity mapping

**Plan specification**: Adapt thinking-orbs's six states to Nexus activities without importing that library. Data-driven: surface passes activity, module returns state + locked accent.

**What happened**: Added `desktop/src/components/agentState/mapping.ts` with idle plus eleven activities. Each row documents rationale. Hex fallbacks match `tokens.css` because Canvas cannot rely on jsdom `getComputedStyle`. Extended the vocabulary with `document-parse` (OCR) and `model-loading` / `model-inference` (dock).

**Key files changed**: `desktop/src/components/agentState/mapping.ts`

**Troubleshooting**: None for this sub-task.

**Verification**: `tests/agentStateMapping.test.ts` asserts every activity, accent token, and fallback.

---

### 2.2 Internal Canvas orb

**Plan specification**: HTML5 Canvas 2D dotted thought-orb; hero 64px and inline 20px; DPR cap 2; reduced-motion static frame; IntersectionObserver offscreen pause; Nexus accents only.

**What happened**: Pure engine in `orbEngine.ts` (step/draw, testable without a 2d context). `AgentStateOrb.tsx` wires canvas + rAF, `useReducedMotion`, IntersectionObserver (missing IO treated as visible), and `useActiveMotionSurface` when activity is not idle.

**Key files changed**: `desktop/src/components/agentState/orbEngine.ts`, `AgentStateOrb.tsx`, `index.ts`

**Troubleshooting**: None. jsdom logs `HTMLCanvasElement.getContext` as unimplemented; the component already no-ops on a null context (same pattern as constellation).

**Verification**: Component tests cover both sizes, `data-agent-state`, reduced-motion pause, missing-IO visibility, and offscreen pause via a mocked observer.

---

### 2.3 Surface adoption

**Plan specification**: Replace ad-hoc loaders on coding, chat streaming, one media-generation surface, and model-status. Mark recede-when-active. Remove superseded spinner markup.

**What happened**: There was no CSS spinner. Pending UI was the string "Generating...". Replaced that with the inline orb. Coding injects a pending assistant row while `busy`. Chat appends a pending composing bubble then patches it. Image Studio / Video Lab pending messages carry `image-generation` / `video-generation`. `GenerationCanvas` (retained, unmounted) gets a centered hero orb. `LocalModelStatus` shows an inline orb while loading or actively inferring, not when muted or idle.

**Key files changed**: `MessageBubble.tsx`, `types.ts`, `CodingPage.tsx`, `ChatPage.tsx`, `ImageStudioPage.tsx`, `VideoLabPage.tsx`, `GenerationCanvas.tsx`, `LocalModelStatus.tsx`

**Troubleshooting**: None. Chat "unavailable" path still patches the pending bubble with the error text, so the existing notice test still passes.

**Verification**: Per-surface tests (CodingPage hang, ChatPage hang, ImageStudio pending, VideoLab pending, LocalModelStatus loading/active/idle, GenerationCanvas hero orb). MessageBubble no longer contains "Generating...".

---

### 2.4 Testing and stabilization

**Plan specification**: Mapping + component + surface tests. `npm run test:shell` + lint. Update CI if needed.

**What happened**: Added mapping, engine, and orb tests; extended existing surface tests. CI already covers `desktop/**` (`shell-build.yml` path filters, concurrency cancel-in-progress, npm cache, PR ubuntu-only matrix). No workflow rewrite.

**Key files changed**: tests listed in section 7.

---

## 3. Verification Gate

| Check | Result |
|---|---|
| `npm run test:coverage --workspace @nexus/desktop` | PASS - 101 files / 878 passed / 0 failed |
| Line coverage | PASS - 92.73% lines / 85.74% branches / 84.8% functions |
| New agent-state files | PASS - mapping 100% lines, orbEngine 100% lines, AgentStateOrb 92.3% lines |
| `npm run lint --workspace @nexus/desktop` | PASS - 0 errors, `--max-warnings=0` |
| `npm run typecheck --workspace @nexus/desktop` | PASS |
| Quality gate bypass | None |

---

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Tailwind `@theme inline` is not compiled by Vite | P2 | Deferred (DF-1) |
| Beam/metal recede + one-motion precedence still Phase 5 | P2 | DF-2 updated; orbs now register |
| Installer motion not on the desktop hook | Cosmetic | Deferred (DF-3) |
| GenerationCanvas aurora + hero orb | P2 | Deferred (DF-4); canvas is unmounted in production chat |
| ASR / web-search activities unused | P3 | Deferred (DF-5) |
| Chat pending is a batch wait | P3 | Deferred (DF-6) |

---

## 5. Plan Discrepancies

- Added `document-parse`, `model-loading`, and `model-inference` activities so OCR and the model dock have typed rows (plan listed the six thought-orb states plus idle; it did not name these keys).
- Chat has no live `isStreaming` flag; `pending` + `chat-streaming` is the signal.
- `GenerationCanvas` keeps aurora and adds the hero orb (plan named the file; Image/Video already used the bubble pending state). Recorded as DF-4 rather than deleting aurora in this phase.
- No `# DEVIATION:` markers in code.

---

## 6. Assumptions Made

- Replacing "Generating..." with the orb (keeping `<progress>` when present) is the ad-hoc-loader swap the plan asked for.
- IntersectionObserver missing in jsdom means "visible", matching constellation's getContext-null no-op posture.
- Cursor model picker is manual: the plan recommended mid-strong / high; this session stayed on the current Cursor model. Visible degrade, no downshift.

---

## 7. Testing Summary

### Automated Tests
- Desktop Vitest: 878 passed, 0 failed (101 files)
- Coverage: 92.73% lines (threshold 80%)

### Manual Testing Performed
- None in this session (jsdom cannot show the dotted motion).

### Manual Testing Still Needed
- [ ] Send a coding turn and confirm the inline working orb in the transcript, then its disappearance when the reply lands.
- [ ] Send a chat turn and confirm the composing orb, then the patched reply.
- [ ] Generate an image / clip and confirm the shaping orb (no "Generating..." text).
- [ ] Toggle OS reduced-motion and confirm the orb is a static ring.

---

## 8. TODO Tracker

### Completed This Session
- [x] 2.1 Typed agent-state activity mapping
- [x] 2.2 Canvas AgentStateOrb
- [x] 2.3 Adopt on coding, chat, media, model-status
- [x] 2.4 Tests, lint, typecheck, coverage

### Remaining (Not Started or Partially Done)
- [ ] Phase 3: Surface-liveness beam (A2)

### Out of Scope (Deferred)
- [ ] Phase 5 one-motion-per-element on GenerationCanvas (DF-4)
- [ ] Live token streaming into the chat bubble (DF-6)
- [ ] ASR / web-search surface wiring (DF-5)

---

## 9. Summary and Next Steps

Phase 2 is the agent-state orb: one Canvas component, a typed mapping onto locked Nexus accents, and the primary loaders now share that vocabulary. Reduced-motion still halts. Offscreen orbs pause. No new npm dependency.

**Next session should**:
1. Implement Phase 3 (surface-liveness beam) on the composer, model dock, and generation-canvas frame.
2. Avoid stacking the beam on the same element as an active orb (full precedence is Phase 5).
3. Keep reduced-motion on the Phase 1 hook.

# Known Gaps - v1.17.0 (Agent-State Motion Identity)

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-16

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.17.0-adoption-ui-motion-identity.md](plans/v1.17.0-adoption-ui-motion-identity.md)

Carry-forward source: [../v1.16/known-gaps.md](../v1.16/known-gaps.md) (reconcile in Phase 6, not this phase).

## v1.17.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 5 | 3 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Tailwind v4 `@theme inline` is source-level, not compiled

- **Source phase**: Phase 1 - Motion Foundation (A4-foundation)
- **Plan reference**: `docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md` (sub-task 1.1)
- **Reason**: Motion tokens live in `:root` and are aliased in an `@theme inline` block in `desktop/src/styles/tokens.css`, matching the plan's Tailwind mapping. The desktop Vite pipeline still does not run Tailwind (pre-existing v1.0 gap: tokens are consumed as `var(--token)`). Browsers ignore the unknown `@theme` at-rule. The tokens therefore resolve in the shell as CSS custom properties, which is how every other token already works.
- **Suggested next step**: When a later cycle wires Tailwind v4 into `desktop/`, the existing `@theme inline` motion aliases should emit utilities with no second palette. Do not add `tailwindcss` in this plan (no new frontend dependency).

##### DF-3 - Installer motion is not on the shared desktop hook

- **Source phase**: Phase 1 - Motion Foundation (A4-foundation)
- **Plan reference**: `docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md` (Overview: shell-only cycle)
- **Reason**: This cycle is desktop-shell-only. The PyQt installer constellation and floating logo still use their own reduced-motion checks. Desktop centralization does not change installer behavior.
- **Suggested next step**: If a later installer pass wants one reduced-motion story across app and installer, port the same halt-not-slow contract; do not share the React hook.

##### DF-5 - ASR listening and web-search activities are typed but unused

- **Source phase**: Phase 2 - Agent-state orbs (A1)
- **Plan reference**: `docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md` (sub-task 2.1)
- **Reason**: The mapping is exhaustive over Nexus activities, including `asr-capture` (listening) and `web-search` (searching). No desktop surface currently exposes live ASR capture or a web-search turn, so those activities have unit coverage in the mapping tests only.
- **Suggested next step**: When an ASR or web-search surface ships, pass the typed activity into `AgentStateOrb` / `ChatMessage.activity`. Do not invent a placeholder loader in this cycle.

##### DF-6 - Chat pending is a batch wait, not live token streaming

- **Source phase**: Phase 2 - Agent-state orbs (A1)
- **Plan reference**: `docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md` (sub-task 2.3: "where `isStreaming` is signalled")
- **Reason**: `ChatPage` still waits for the full `sendMessage` event batch, then patches the assistant bubble. There is no per-token `isStreaming` flag. Phase 2 treats `pending: true` + `activity: "chat-streaming"` as the streaming signal so the composing orb appears for the whole wait. Phase 3 drives the composer traveling beam from the same `pending` flag.
- **Suggested next step**: If a later cycle streams tokens into the bubble, keep the same activity until the `done` event and then clear `pending` (the traveling beam follows).

##### DF-8 - On-device multi-effect GPU/battery cost is not proven here

- **Source phase**: Phase 5 - Motion coordination + polish (A4-completion)
- **Plan reference**: `docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md` (sub-task 5.2)
- **Reason**: jsdom cannot create a WebGL context or measure GPU frame time. Unit tests prove offscreen pause, the instance cap of 3, `document.hidden` pause on metal, and one-motion gating. Live Tauri frame cost with a streaming composer, idle dock, and visible hero control is not proven here.
- **Suggested next step**: Operator visual pass in the Tauri shell (Phase 6 or release QA). Record fps / battery if a regression is visible; do not treat absence of a local GPU trace as a pass.

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| DF-2 | Recede-when-active incomplete across motion kinds | Phase 5 | Grouped surfaces recede once via `MotionSurface`; ungrouped orbs/metal still self-register |
| DF-4 | GenerationCanvas stacked aurora + orb + beam | Phase 5 | Orb wins; beam paused; aurora halted to a static wash |
| DF-7 | Composer beam and submit metal could play together | Phase 5 | Streaming -> beam; focus -> metal; idle -> neither |

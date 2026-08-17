# Known Gaps - v1.17.0 (Agent-State Motion Identity)

**Project**: Nexus AI Studio
**Status**: finalized
**Last updated**: 2026-08-16

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.17.0-adoption-ui-motion-identity.md](plans/v1.17.0-adoption-ui-motion-identity.md)

Carry-forward source: [../v1.16/known-gaps.md](../v1.16/known-gaps.md) (reconciled in Phase 6).

## v1.17.0

**Summary**: 7 open items after Phase 6 - 0 NI, 7 DF, 0 MT - plus 3 resolved in Phase 5 (DF-2, DF-4, DF-7). No suppressed warnings, no bypassed gates. Phase 6 is verification-only (stale ChatPage/ChatInput comments, RETAINED-NOT-DEAD header on ChatInput, no behaviour change). Gates: desktop 106 files / 916 passed / 0 failed. Coverage 92.92% lines / 86.2% branches / 85.08% functions. Lint and `tsc --noEmit` clean. Finalized at the v1.17.0 version bump.

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
- **Reason**: jsdom cannot create a WebGL context or measure GPU frame time. Unit tests prove offscreen pause, the instance cap of 3, `document.hidden` pause on metal, and one-motion gating. Live Tauri frame cost with a streaming composer, idle dock, and visible hero control is not proven here. Phase 6 did not capture an on-device trace either.
- **Suggested next step**: Operator visual pass in the Tauri shell during release QA. Record fps / battery if a regression is visible; do not treat absence of a local GPU trace as a pass.

##### DF-9 - gigatoken remains a watch item (N5)

- **Source phase**: Phase 6 - Architecture refactor, known-gaps, CI/CD
- **Plan reference**: `docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md` (sub-task 6.2; comparison N5)
- **Reason**: gigatoken is Python-only against Nexus's JS `tiktoken` per-request path, targets a bulk corpus workload Nexus does not have, and has incomplete Windows testing against a Windows-first product with an OS-parity principle. N4 (tiktoken replacement) stays rejected. N5 is the hypothetical Python-side bulk-tokenization need; no such workload exists in the diffusion/ASR/TTS Python runtimes today.
- **Suggested next step**: Revisit only if a genuine Python-side bulk-tokenization need emerges AND gigatoken's Windows/ARM support matures. Do not add a Python tokenizer dependency on speculation.

##### DF-10 - Shared text-only ChatInput is not mounted by ChatPage

- **Source phase**: Phase 6 - Architecture refactor, known-gaps, CI/CD
- **Plan reference**: `docs/v1/v1.17/plans/v1.17.0-adoption-ui-motion-identity.md` (sub-task 6.1)
- **Reason**: ChatPage uses `MediaComposer` (attachments + streaming beam + metal Generate/Send). `ChatInput` still carries the Phase 4 metal ring and is unit-tested (`sharedChat.test.tsx`). It is the text-only twin, not a dead loader. Header now says RETAINED, NOT DEAD.
- **Suggested next step**: Delete only if the text-only send contract is retired. Do not metal a second composer on ChatPage.

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| DF-2 | Recede-when-active incomplete across motion kinds | Phase 5 | Grouped surfaces recede once via `MotionSurface`; ungrouped orbs/metal still self-register |
| DF-4 | GenerationCanvas stacked aurora + orb + beam | Phase 5 | Orb wins; beam paused; aurora halted to a static wash |
| DF-7 | Composer beam and submit metal could play together | Phase 5 | Streaming -> beam; focus -> metal; idle -> neither |

### Carried forward from v1.16.0 (still open)

v1.16 items stay in [../v1.16/known-gaps.md](../v1.16/known-gaps.md). This shell-only cycle does not close serving, OCR, or composition-root wiring.

| ID | Class | Item | Status this cycle |
|---|---|---|---|
| LSO.P1.B / P1.C / P1.D / P1.E | DF / MT | Dual vscode/headless clients; live gateway smoke; host/port editors; main.ts serving glue tests | Unchanged. Out of motion-identity theme. |
| LSO.P2.* | DF / MT | Trace placeholder list, unwired telemetry publisher, prompt-token estimates, non-Ollama memory | Unchanged. |
| LSO.P3.A / IRSC.P4.B | DF / BG | HF `sha256` pins are all-zero placeholders | Unchanged. |
| LSO.P3.B / P3.C / P3.D / P3.F | DF / MT | OCR wheel staging, on-device OCR, cancel-mid-page, ChildProcessOcrRuntime tests | Unchanged. |
| LSO.P4.A / P4.B / P4.C / P4.D | DF / MT | Headless tier confirm; parse_document + memory ingest unwired | Unchanged. |
| LSO.P5.A | DF | macOS MLX smoke checklist not run on hardware | Unchanged. |

### Open Items (Phase 6)

_No new product behaviour._ Close-out added a RETAINED-NOT-DEAD header on `ChatInput` and recorded DF-9 / DF-10.

| ID | Class | Source phase | Item | Reason | Suggested next step |
|---|---|---|---|---|---|
| DF-9 | DF | Phase 6 | gigatoken N5 watch | See above | See above |
| DF-10 | DF | Phase 6 | ChatInput retained, not mounted | See above | See above |

### Phase 6 reconciliation (terminal gate)

- **Architecture**: clean. No empty directories in v1.17-touched trees (`desktop/src/motion`, `desktop/src/components/agentState`). `check:docs-layout` and `check:naming` clean. No `thinking-orbs` / `border-beam` / `metal-fx` packages. `GenerationCanvas` stays RETAINED (IRSC.P5.A / richer in-bubble progress). `ChatInput` stays RETAINED (text-only metal twin; ChatPage uses MediaComposer). `useMotionSurface` is a public grouped-surface API with no extra caller beyond `MotionSurface` itself; keep it. No file moves. Propose-then-apply had nothing to apply besides comment accuracy.
- **Known gaps**: 7 open DF (DF-1,3,5,6,8,9,10), 3 resolved in Phase 5. v1.16 carry-forward unchanged (serving/OCR/composition-root). No release-blockers. Remaining work is on-device visual/GPU QA (DF-8) and later-cycle product work (Tailwind compile, installer motion, ASR/web-search, token streaming, gigatoken only if a Python bulk workload appears).
- **CI/CD**: no rewrite. `shell-build.yml` already watches `desktop/**` (motion foundation, orb/beam/metal, coordination, tests) with concurrency cancel-in-progress, npm + cargo cache, and PR-only ubuntu. Narrowing the filter to `desktop/src` (plan 6.3 suggestion) would skip `desktop/tests` and `desktop/sidecar` and is rejected. The GitHub Actions budget freeze ended 2026-08-01 and does not apply. `ci.yml` stays unfiltered. Cross-installer parity: no new installer surface this cycle. platform-contract-verification and model-prompting-research self-gate to no-ops (not a Nexus-Hub catalog repo).
- **Tests**: desktop 106 files / **916 passed** / 0 failed. Coverage 92.92% lines / 86.2% branches / 85.08% functions (unchanged; comment-only headers). `npm run lint --workspace @nexus/desktop` and `npm run typecheck --workspace @nexus/desktop` clean.
- **Release**: cut as git tag `v1.17.0` via `/update release` (2026-08-16). Not auto-pushed.

_Last updated: 2026-08-16 (finalized for the v1.17.0 release)._

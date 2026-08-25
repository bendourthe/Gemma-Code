# Known Gaps - v2.2

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-24 (v2.2.8 Phase 1)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.2.0-runtime-repair-and-ux-overhaul.md](plans/v2.2.0-runtime-repair-and-ux-overhaul.md), [plans/v2.2.1-field-repair-and-chrome-completion.md](plans/v2.2.1-field-repair-and-chrome-completion.md), [plans/v2.2.2-ready-shell-and-studio-chrome.md](plans/v2.2.2-ready-shell-and-studio-chrome.md), [plans/v2.2.3-glass-orbs-and-pillar-runtime.md](plans/v2.2.3-glass-orbs-and-pillar-runtime.md), [plans/v2.2.4-chatbot-first-and-runtime-honesty.md](plans/v2.2.4-chatbot-first-and-runtime-honesty.md), [plans/v2.2.5-first-successful-generation.md](plans/v2.2.5-first-successful-generation.md), [plans/v2.2.6-session-memory-and-studio-history.md](plans/v2.2.6-session-memory-and-studio-history.md), [plans/v2.2.7-context-meter-and-transcript-chrome.md](plans/v2.2.7-context-meter-and-transcript-chrome.md), [plans/v2.2.8-working-local-studio.md](plans/v2.2.8-working-local-studio.md)

## v2.2.8

**Last updated**: 2026-08-24 (Phase 1 - local inference that finishes)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 1 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

`rpc_timeout_for("chat.send")` and the real `chat.session.sendMessage` / coding send / diffusion generate methods are 600s with typed copy. `ping` stays 15s. A slow ChatPage fixture and a thrown `sidecar response timeout` never render that string. Ollama tag `gemma4:12b` marks catalog `gemma-4-12b-it-gguf` Downloaded. Packaged Chatbot `Hi` remains not_observed (DF-32). DF-2 close waits for Phase 6 evidence. DF-4 stays open.

### Open this cycle

##### DF-32 - Packaged Chatbot Hi and Agents turn remain unproven

- **Source phase**: v2.2.8 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.8-working-local-studio.md` (Phase 1 Stability Gate)
- **Reason**: Unit tests prove the timeout table, slow-stream copy, and Gemma alias probe. A packaged Explorer `Hi` against local Ollama was not recorded this phase. not_observed != absent.
- **Suggested next step**: On a packaged Windows build, send Chatbot `Hi` and one Agents turn. Expect a local reply or a typed Ollama/weights error, never `sidecar response timeout`. Confirm Settings shows Gemma 4 12B as Downloaded when `ollama list` has `gemma4:12b`.

### Resolved this phase

None. Timeout and probe work is new this cycle, not a prior BG close.

## v2.2.7

**Last updated**: 2026-08-24 (Phase 5 - architecture, known-gaps, and CI)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 4 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 1 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

Settings and installer Context chips are unit-proven as `<val>k` with no trailing `in`. Chat/coding fixture streams persist Ollama `prompt_eval_count` / `eval_count` (plus thinking estimates). Missing usage stores null. All four composers host the Context pill (or hide it when no window or visual budget exists) with the model picker under the typing area. Transcripts show one date heading per local day, a discrete clock on each bubble, and tokens by role (user `N in`; assistant think+out or an em dash). Phase 5 deleted unused `Breadcrumb.tsx` and rebuilt an unsigned Windows installer for the operator field checklist. Packaged Settings/installer chips remain not_observed (DF-28). Live Ollama thinking-in-message is not_observed (DF-29). Packaged four-tab meter and 80% CTA remain not_observed (DF-30). Packaged transcript chrome remains not_observed (DF-31). Chip copy is implemented twice (WN-7). DF-2 and DF-4 stay open from earlier cycles.

### Open this cycle

##### DF-28 - Packaged Settings and installer Context chips are unproven

- **Source phase**: v2.2.7 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md` (Phase 1)
- **Reason**: ModelsSettings and installer `_ModelCard` tests show `Context: 128k` for LFM and omit the chip on null diffusion rows. A packaged Explorer Settings tab and a running installer wizard were not screenshotted this phase. not_observed != absent.
- **Suggested next step**: Open Settings > Models on a packaged build and the installer Models tab; confirm Gemma / Qwen / LFM chips match catalog.json and SANA has no fake 128k.

##### DF-29 - Live Ollama usage and thinking fields are unproven

- **Source phase**: v2.2.7 Phase 2
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md` (Phase 2)
- **Reason**: Unit fixtures persist `prompt_eval_count` / `eval_count` / `message.thinking` onto the chat done event and round-trip chat/studio/coding stores. A live Gemma 4 Ollama final chunk was not captured this phase. Coding agent turns estimate when the runner does not attach counters. not_observed != absent.
- **Suggested next step**: Send one Chatbot turn against a local Ollama Gemma 4 model and confirm the persisted assistant row matches the final chunk; if thinking is in `message.thinking`, confirm it counts toward used tokens.

##### DF-30 - Packaged four-tab Context meter and 80% CTA are unproven

- **Source phase**: v2.2.7 Phase 3
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md` (Phase 3)
- **Reason**: Component tests cover 79% without CTA, 80% CTA creating a new Chatbot session without deleting the old tree row, hidden bar when no window or visual budget, and pickers under `composer-context-row` on Chat/Agents/Images/Videos. A packaged Explorer was not clicked through this phase. not_observed != absent.
- **Suggested next step**: On a packaged build, send Chatbot turns until the pill reaches 80%, accept Start a new session, confirm the old chat remains; peek Images/Videos and confirm the picker sits under the composer and peeking does not load weights.

##### DF-31 - Packaged transcript date, time, and token chrome is unproven

- **Source phase**: v2.2.7 Phase 4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md` (Phase 4)
- **Reason**: MessageList tests cover one heading per local day, discrete en-US clock text, skipped epoch timestamps, user `N in`, assistant `think + out`, and an em dash when unknown. Chat/Agents/Images/Videos smokes assert time and token testids after a turn. A packaged Explorer was not screenshotted this phase. not_observed != absent.
- **Suggested next step**: Open all four modes on a packaged build; confirm one date heading per day, a clock on each bubble, user input tokens, and assistant reasoning+output or an em dash.

##### WN-7 - Context chip formatters are duplicated across TypeScript and Python

- **Source phase**: v2.2.7 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md` (T002)
- **Reason**: The desktop renderer cannot import the installer Python module. Matching tests lock `128k` and `32k / 8k` on both sides. Drift remains possible if one formatter is edited alone.
- **Suggested next step**: Keep the two test files in the same PR as any copy change, or generate Python copy from the TypeScript fixture in a later cleanup.

### Resolved this phase

None. Usage persist is new work, not a prior BG.

## v2.2.6

**Last updated**: 2026-08-24 (Phase 6 - architecture, gaps, and CI)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 5 | 0 |
| Bugs / regressions (BG) | 0 | 4 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

DF-2 (packaged Explorer) and DF-4 (live GPU generate) stay open. BG-51 through BG-54 are closed at unit/integration evidence. Packaged quit/reopen persist remains not_observed (DF-25). Video remount cannot restore `continueFrom` (DF-26). Agents tool-call cards are not persisted (DF-27).

### Open this cycle

##### DF-2 - Packaged Explorer launch is unproven

- **Source phase**: carried from v2.2.5
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.6-session-memory-and-studio-history.md` (Phase 6.2)
- **Reason**: not_observed != absent. No packaged soak this phase.
- **Suggested next step**: Launch a packaged Windows build and record Explorer start.

##### DF-4 - Live GPU image/video generate is unproven

- **Source phase**: carried from v2.2.5
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.6-session-memory-and-studio-history.md` (operator field checklist)
- **Reason**: Fail-closed envelopes and last-output follow-up are unit-proven. An operator GPU generate that paints a SANA image or a video clip was not recorded this session.
- **Suggested next step**: Run one Image Studio generate and one Video Lab generate on a host with weights and GPU, or confirm the typed runtime-not-ready string in the UI when GPU is absent.

##### DF-25 - Packaged session persist (quit/reopen) is unproven

- **Source phase**: v2.2.6 Phases 1-5
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.6-session-memory-and-studio-history.md` (Phase 6.2)
- **Reason**: Image/Video SQLite, Agents `sessions.json`, and Chatbot explorer DB round-trips are unit-proven. A packaged Explorer quit/reopen soak was not run. not_observed != absent.
- **Suggested next step**: Install the unsigned Windows build, take one turn in each pillar, quit, reopen, and record whether the same session hydrates.

##### DF-26 - Video remount cannot restore `continueFrom`

- **Source phase**: v2.2.6 Phase 3
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.6-session-memory-and-studio-history.md` (Phase 3)
- **Reason**: `continueFrom` needs `priorJobId`. The studio session schema stores `lastOutputRef` (mp4 path), not the job id. After remount, a follow-up is a new text2video. `lastFramePath` is that mp4 path; there is no frame extractor.
- **Suggested next step**: Persist `priorJobId` (or a generations-index job key) on the session row, or extract a last-frame PNG and document the quality limit.

##### DF-27 - Agents resume does not restore tool-call cards

- **Source phase**: v2.2.6 Phase 4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.6-session-memory-and-studio-history.md` (Phase 4)
- **Reason**: Sidecar persist stores user prompt plus concatenated assistant token text. `toolCallHeader` / arg deltas / complete events are not written. Resume shows the transcript, not the tool cards from the live stream.
- **Suggested next step**: Persist a compact tool-card snapshot per turn, or accept text-only resume for this cycle.

### Resolved this phase

##### BG-51 - Image Studio had no named history or last-PNG memory

- **Source phase**: v2.2.6 Phases 1-2
- **Resolution**: Shared `StudioSessionStore` plus `studio.session.*` IPC. Image Studio creates a named session, appends turns (paths, never blobs), and empty-attachment follow-ups img2img `lastOutputRef`. Remount hydrates MessageList. Missing files render `output missing on disk`. Sidecar down does not claim saved.
- **Evidence**: `desktop/tests/ImageStudioPage.test.tsx`, `desktop/tests/studioSessionMemory.test.ts`, `tests/unit/core/generations/StudioSessionStore.test.ts`. Packaged persist remains DF-25.

##### BG-52 - Video Lab had no named history or last-clip memory

- **Source phase**: v2.2.6 Phases 1 and 3
- **Resolution**: Same store and history pane. In-session follow-up sets existing `continueFrom` from the live job. Remount hydrates transcript and last clip path. Unreadable `lastOutputRef` fail-closes with typed copy instead of silent text2video.
- **Evidence**: `desktop/tests/VideoLabPage.test.tsx`, `desktop/tests/studioSessionMemory.test.ts`. Remount `continueFrom` remains DF-26. Packaged persist remains DF-25.

##### BG-53 - Agents resume set sessionId only, so the transcript stayed empty

- **Source phase**: v2.2.6 Phase 4
- **Resolution**: `sendMessage` persists assistant token text. `coding.session.resume` returns `{ session, messages, turns }`. CodingPage hydrates MessageList. Unknown ids clear the list and show `Could not resume session`. Sessions list gained rename and delete (`coding.session.rename` / `coding.session.delete`).
- **Evidence**: `desktop/tests/CodingPage.test.tsx`, `desktop/tests/coding-session-resume.test.ts`, `desktop/tests/coding-sessionManager.test.ts`, `desktop/tests/panels.test.tsx`, `desktop/tests/sidecar-handlers.test.ts`. Tool cards remain DF-27. Packaged persist remains DF-25.

##### BG-54 - Chatbot remount hydration and failed-append honesty were unproven

- **Source phase**: v2.2.6 Phase 5
- **Resolution**: ChatPage already persisted via `chat.explorer.appendMessage` / `listMessages`, including attachment strings, and already folded model ids. Tests now prove append-then-remount (user + assistant), attachment `src` restore, and a visible bubble plus `Message is visible but was not saved` when append throws. No production ChatPage patch.
- **Evidence**: `desktop/tests/ChatPage.persistence.test.tsx`. Packaged persist remains DF-25.

## v2.2.5

**Last updated**: 2026-08-23 (Phase 6 - architecture, gaps, and CI)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 2 | 0 |
| Bugs / regressions (BG) | 0 | 8 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

DF-2 (packaged Explorer) and DF-4 (live GPU generate) stay open. BG-43 through BG-50 are closed at unit/integration evidence. Packaged Hi, GPU generate, Settings scroll, Qwen 4B pull, and Hub Update apply remain not_observed in a packaged soak. Live Hub apply stays DF-23.

### Open this cycle

##### DF-2 - Packaged Explorer launch is unproven

- **Source phase**: carried from v2.2.4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.5-first-successful-generation.md` (Phase 6.2)
- **Reason**: not_observed != absent. No packaged soak this phase.
- **Suggested next step**: Launch a packaged Windows build and record Explorer start.

##### DF-4 - Live GPU image/video generate is unproven

- **Source phase**: v2.2.5 Phase 2
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.5-first-successful-generation.md` (Phase 2 field gate)
- **Reason**: Fail-closed envelopes are unit-proven. An operator GPU generate that paints a SANA image was not recorded this session.
- **Suggested next step**: Run one Image Studio generate on a host with weights and GPU, or confirm the typed runtime-not-ready string in the UI when GPU is absent.

### Resolved this phase

##### BG-43 - Chatbot used two model-id namespaces

- **Source phase**: v2.2.5 Phase 1
- **Resolution**: Canonical alias table folds catalog id, Ollama tag, and coding LLM id. `requireModel` and the installed probe accept any alias. Chat and Agents send the folded runtime id. Unknown ids never fall back to `gemma4:e4b`.
- **Evidence**: `tests/unit/core/registry/modelAliases.test.ts`, `desktop/tests/coding-models.test.ts`, `desktop/tests/ChatPage.test.tsx`. Live Ollama `gemma4:12b` answered Hi this cycle. Packaged Explorer click remains DF-2.

##### BG-44 - Settings Models list could not scroll

- **Source phase**: v2.2.5 Phase 3
- **Resolution**: Settings shell and Models list are flex children with `minHeight: 0` and `overflowY: auto`. Search is no longer a growing flex:1 sibling that ate the list.
- **Evidence**: `desktop/tests/ModelsSettings.test.tsx` (scroll style assertion). Packaged window screenshot not recorded this phase (not_observed != absent).

##### BG-45 - Qwen 3.5 4B showed Download after a selected install

- **Source phase**: v2.2.5 Phase 3
- **Resolution**: `ModelsService.list` expands installer snapshot ids through aliases. Snapshot membership without an Ollama tag is `selectedAtInstall` plus Retry copy, not Downloaded. Snapshot writer keeps a ticked `qwen3.5:4b` even when 9B is also selected.
- **Evidence**: `desktop/tests/modelsService.test.ts`, `desktop/tests/ModelsSettings.test.tsx`, `scripts/installer/tests/test_runtime_provisioner.py`. Live Ollama 4B pull not recorded this phase.

##### BG-46 - Over-budget cards displayed Compatible

- **Source phase**: v2.2.5 Phase 3
- **Resolution**: `cardBadgeLabel` never returns Compatible when VRAM does not fit. Missing VRAM numbers leave the badge blank instead of inventing Compatible. Sort order is Required, Recommended that fits, Compatible that fits, then over-budget, then `releaseDate` desc.
- **Evidence**: `desktop/tests/catalogTabs.test.ts`, SANA 4K vs 16 GB host case in `desktop/tests/ModelsSettings.test.tsx`.

##### BG-47 - Settings cards omitted installer origin / date / guardrail chips

- **Source phase**: v2.2.5 Phase 3
- **Resolution**: `ListedModelDto` marshals `origin`, `releaseDate`, and `uncensored` from `catalog.json`. Missing origin omits the chip. `uncensored: false` shows Censored.
- **Evidence**: `desktop/tests/ModelsSettings.test.tsx`.

##### BG-48 - Chat rows hid rename/delete behind right-click and had no chats-pane pill

- **Source phase**: v2.2.5 Phase 4
- **Resolution**: Each chat row has pencil and trash buttons (`stopPropagation`, delete still confirms). Left-click on the already-selected chat starts inline rename. ChatPage chats aside uses the rail collapse pill, collapses to 24px, and persists `nexus.chat.chatsPaneCollapsed`. Right-click context menu remains.
- **Evidence**: `desktop/tests/FolderTree.test.tsx`, `desktop/tests/ChatPage.test.tsx`.

##### BG-49 - Empty diffusion complete looked like a successful generate

- **Source phase**: v2.2.5 Phase 2
- **Resolution**: Node result guard rejects empty/1x1/`ok: false` before `complete`. Python production path fail-closes instead of returning a 1x1 stub. SANA catalog ids call `sana.txt2img` / `sana_int4.txt2img` / `sana_sprint.txt2img`.
- **Evidence**: `desktop/tests/diffusion-resultGuard.test.ts`, `desktop/tests/diffusion-dispatcher.test.ts`, `desktop/tests/diffusion-route.test.ts`, `tests/python/diffusion/test_real_execute.py`.

##### BG-50 - Hub snapshot was frozen at 3.12.0 and Update was scanner-blocked

- **Source phase**: v2.2.5 Phase 5
- **Resolution**: Pack-time snapshot requires the catalog tag to match GitHub `/releases/latest` (tests inject `NEXUS_HUB_LATEST_TAG`). A stale 3.12.0 catalog is refused. Networked install already calls `--sync-hub-catalog` without a pin. `HUB_SKILL_SCAN_ALLOWLIST` was re-reviewed against Hub v3.19.2; `PromptInjectionScanner` stays on. A planted jailbreak in a non-allowlisted skill still blocks.
- **Evidence**: `scripts/installer/tests/test_hub_catalog_provisioner.py`, `tests/unit/core/skills/PromptInjectionScanner.test.ts`, `tests/unit/core/skills/NexusHubSyncer.test.ts`. Packaged live Hub apply remains DF-23.

## v2.2.4

**Last updated**: 2026-08-23 (Phase 7 - architecture, gaps, and CI)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 12 | 1 |
| Bugs / regressions (BG) | 0 | 10 |
| Warnings (WN) | 2 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

Open deferred items remain those carried from v2.2.3 (DF-1, DF-2, DF-4, DF-14, DF-16, DF-18 through DF-22) plus DF-23 (packaged Hub update) and DF-24 (Unix installer snapshot write). DF-17 is resolved in Phase 2. Screenshot failures 1-9 are closed in Phases 1-6 at the unit/integration evidence bar. Packaged Explorer launch and live GPU soaks stay unproven (DF-2, DF-4).

### Open this cycle

##### DF-23 - Packaged Hub Update against a live git clone is not executed

- **Source phase**: v2.2.4 Phase 6 / 7
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.4-chatbot-first-and-runtime-honesty.md` (Phase 6 residual, Phase 7.2)
- **Reason**: Vitest and Rust prove `skills.sync` waits up to 10 minutes and Hub timeout copy. A packaged Windows build pulling a real Nexus-Hub clone over the network was not run. not_observed != absent; packaged Hub update is unproven here.
- **Suggested next step**: Run Update now from a packaged shell with network, confirm the clone finishes, and capture log evidence.

##### DF-24 - Unix installer complete-path snapshot write is not proven

- **Source phase**: v2.2.4 Phase 7
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.4-chatbot-first-and-runtime-honesty.md` (Phase 7.4)
- **Reason**: `write_selection_snapshot` lives on the shared Python `RuntimeProvisioner` used by the Windows-first installer. This repo has no separate macOS/Linux complete-path writer. Unix hosts that never run that engine do not get `~/.nexus/selected-models.json` from install. Do not claim cross-OS installer parity.
- **Suggested next step**: If a Unix GUI/script install path is added, call the same writer from that complete step and add a fixture test.

### Resolved this phase


##### BG-42 - Hub Update now failed at the 15s sidecar RPC timeout

- **Source phase**: v2.2.4 Phase 6
- **Resolution**: `skills.sync` uses a 10-minute per-method timeout. Other RPCs stay at 15s. A Hub timeout reports Hub fetch copy, not sidecar response timeout. Auto-update to latest Nexus-Hub release defaults ON when the setting key is missing; explicit false stays off.
- **Evidence**: `desktop/src-tauri/src/sidecar.rs` (`rpc_timeout_for`), `desktop/tests/SkillsSettings.test.tsx`, `desktop/tests/codingBootstrap.test.ts`.

##### BG-41 - Settings > Models used Type/Family/Status filters instead of installer tabs

- **Source phase**: v2.2.4 Phase 5
- **Resolution**: Settings > Models uses Chat / Agentic / Image / Video / Audio / Document tabs (Other for unknown tasks). Cards reuse catalog description, Best for, license, size, and Recommended/Required/Compatible. Download vs Downloaded, hardware disable via modelFitsHost, one Favorite star per tab writing Phase 2 keys.
- **Evidence**: `desktop/tests/ModelsSettings.test.tsx`, `desktop/tests/catalogTabs.test.ts`.


##### BG-39 - Generated media used a 48rem min-height slab

- **Source phase**: v2.2.4 Phase 4
- **Resolution**: Inline media is max-height 40vh with no min-height slab. Click opens a lightbox with fullscreen, download, and copy image. In-chat actions are download and copy image; recall lives in the dialog.
- **Evidence**: `desktop/tests/mediaMessageBubble.test.tsx`, `desktop/tests/ImageStudioPage.test.tsx`, `desktop/tests/VideoLabPage.test.tsx`.

##### BG-40 - Empty studio completes painted a grey rectangle

- **Source phase**: v2.2.4 Phase 4
- **Resolution**: `isUsableImageBase64` / `isUsableVideoPath` reject empty, whitespace, invalid base64, and 1x1 PNG before media is patched. The assistant row is error text.
- **Evidence**: `desktop/tests/usablePayload.test.ts`, `desktop/tests/ImageStudioPage.test.tsx`.

##### BG-36 - Hi produced a not-installed banner with no user bubble

- **Source phase**: v2.2.4 Phase 3
- **Resolution**: Chat and Agents append the human turn before a not-installed or defer return. Send uses the visible installed model id after Phase 2 picker sync.
- **Evidence**: `desktop/tests/ChatPage.test.tsx` (Hi + LFM 2.5 send id; Hi retained when missing), `desktop/tests/CodingPage.test.tsx`.

##### BG-37 - Agents showed a pink coding title and harness badges

- **Source phase**: v2.2.4 Phase 3
- **Resolution**: The Agentic AI Coding h1 is gone. Chatbot and Agents no longer pass harness or tool-calling badges into the compact switcher.
- **Evidence**: `desktop/tests/CodingPage.test.tsx`.

##### BG-38 - Chat exposed an Enable tools checkbox defaulted off

- **Source phase**: v2.2.4 Phase 3
- **Resolution**: Tools stay on. ConfirmationGate and sandbox still gate execution. The checkbox is absent.
- **Evidence**: `desktop/tests/ChatPage.test.tsx`, `desktop/tests/sharedChat.test.tsx`.


##### DF-17 - Settings tabs are not URL-addressable

- **Source phase**: Carried from v2.2.3; closed in v2.2.4 Phase 2
- **Resolution**: `SettingsPage` honors `?tab=` on mount and when the query changes while Settings stays mounted. `+ Get more models` already navigates to `/settings?tab=models`.
- **Evidence**: `desktop/tests/SettingsPage.test.tsx`.

##### BG-33 - Cold start restored the last module instead of Chatbot

- **Source phase**: v2.2.4 Phase 1
- **Resolution**: `normalizeActiveRoute` now maps every stored path except `/chatbot` and `/chatbot/...` onto `/chatbot`. In-session navigation to Agents/Images/Videos is unchanged.
- **Evidence**: `desktop/tests/persistence.test.ts` (17 tests) plus App redirect coverage.

##### BG-34 - Rail labels still used the old product names

- **Source phase**: v2.2.4 Phase 1
- **Resolution**: `MODULES` labels are Chatbot, Agents, Images, Videos. Routes stay `/chatbot`, `/coding`, `/images`, `/videos`.
- **Evidence**: `desktop/tests/shell-phase6.test.tsx`, `desktop/tests/ModuleCard.test.tsx`.

##### BG-35 - Collapse control occupied a flex row above the first tab

- **Source phase**: v2.2.4 Phase 1
- **Resolution**: Collapse is an absolutely positioned edge pill (chevron left/right). The first aside element is the module nav.
- **Evidence**: `desktop/tests/Sidebar.test.tsx` document-flow assertions.

## v2.2.3

**Last updated**: 2026-08-23 (Phase 8 - architecture, gaps, and CI reconciliation)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 11 | 1 |
| Bugs / regressions (BG) | 0 | 18 |
| Warnings (WN) | 2 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Node SEA / externalBin bundling remains deferred

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Out of scope)
- **Reason**: The sidecar still uses the verified Node resolution chain rather than a Tauri `externalBin` or Node SEA artifact.
- **Suggested next step**: Revisit only in a packaging-focused cycle with clean-install validation for the replacement artifact.

##### DF-2 - Packaged clean-VM and Explorer-launch acceptance not executed

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Residual risks)
- **Reason**: Vitest proves the async adapter and route behavior, the debug Tauri build validates the scoped asset-protocol configuration, and the Phase 8 platform contract names the Windows artifact and acceptance gap. This cycle has not launched a packaged shell from Explorer, run a clean-VM install, or played a generated MP4 through a packaged asset URL. Packaged Chatbot first paint and packaged video playback are not proven here.
- **Suggested next step**: Launch the packaged application from Explorer on a clean Windows VM, confirm `/chatbot` renders without a console or blank pane, and play a generated MP4 from the scoped outputs directory.

##### DF-4 - Live-GPU image and video generation soaks not executed

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Residual risks, DF-4)
- **Reason**: Automated tests now prove that queue failures, empty image completes, empty video completes, and decode failures become written errors with no false media actions. Real SANA and LTX generation were not executed on a supported GPU, so successful bytes, runtime duration, and asset playback under live load remain unproven.
- **Suggested next step**: Run the existing image and video generation smoke on a supported GPU and capture successful output plus packaged playback evidence.

##### DF-14 - CodingInput retains a separate composer implementation

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.1)
- **Reason**: Phase 8 extracts the byte-identical composer surface, right-control, icon-cluster, document-chip, and remove-button styles into `composerSurfaceStyles.ts`. CodingInput still owns separate markup and behavior for slash-command discovery, audio state, and coding-only controls, so replacing both components with one renderer would broaden behavior rather than remove exact duplication.
- **Suggested next step**: Revisit a shared markup primitive only when the two composers' interaction contracts converge; keep the shared structural styles as the current deduplication boundary.

##### DF-16 - Native file dialogs remain unavailable

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 6.1, Phase 8.2)
- **Reason**: The repository has no Tauri dialog plugin. Phase 6 ships a validated workspace text field persisted under `nexus.coding.workspacePath`, while Settings data transfer also remains path-text based.
- **Suggested next step**: Add and capability-scope the dialog plugin in a dedicated cross-platform file-dialog task.

##### DF-17 - Settings tabs are not URL-addressable

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.2)
- **Reason**: Resolved in v2.2.4 Phase 2. `SettingsPage` now reads `?tab=` via `useSearchParams` so `/settings?tab=models` opens Models even when Settings is already mounted.
- **Suggested next step**: Nested Settings routes remain optional; query-param tabs satisfy the deep-link contract.

##### DF-18 - Packaged macOS and Linux sidecar native-addon paths are not proven

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.2)
- **Reason**: The Phase 8 parity contract and packaging tests show that macOS and Linux build scripts do not stage the desktop sidecar payload that Windows embeds. No macOS `.app` or Linux AppImage was executed in this session, so native-addon resolution on those targets is not proven here.
- **Suggested next step**: Stage the desktop sidecar payload in both Unix installer builds, then run packaged `--healthcheck` acceptance on each operating system and record the resolved addon path.

##### DF-19 - CREATE_NO_WINDOW parity is N/A on macOS and Linux

- **Source phase**: Carried into v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.4)
- **Reason**: The Phase 8 parity contract records the Windows creation flag as supported and macOS/Linux as not applicable. The Windows flag has no direct Unix counterpart; absence of an observed terminal window on other platforms is still not proven here.
- **Suggested next step**: Record platform-specific packaged-launch evidence and keep the Windows-only flag classified as N/A elsewhere.

##### DF-20 - Folder color changes are not persisted through the IPC adapter

- **Source phase**: v2.2.3 Phase 1
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (verification addendum item 33)
- **Reason**: The explorer protocol exposes no `updateFolder` method. The existing UI can reflect a local color touch for the in-memory client, but a production IPC client cannot persist it.
- **Suggested next step**: Add an explicit explorer `updateFolder` protocol method and a persistence regression test in a later chat-organization phase.

##### DF-21 - Local Chatbot reply transport remains batched

- **Source phase**: v2.2.3 Phase 4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 4)
- **Reason**: The sidecar chat protocol is request/response only and exposes no incremental token event channel. Phase 4 keeps the visible Composing orb until the complete reply arrives rather than simulating streaming.
- **Suggested next step**: Add a typed incremental chat event protocol and cancellation contract in a transport-focused cycle, then replace the single terminal response without changing transcript persistence.

##### DF-22 - Workspace Hub hook scripts are not executed by the desktop sidecar

- **Source phase**: v2.2.3 Phase 8 reconciliation of Phase 6
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 6.3, Phase 8.2)
- **Reason**: Phase 6 wires a vscode-free HookBus lifecycle inside the sidecar, but it does not discover or execute arbitrary workspace Hub hook scripts whose existing host integration depends on VS Code. Treating those scripts as active would be a false capability claim.
- **Suggested next step**: Define a vscode-free hook discovery, permission, timeout, and result contract before enabling workspace hook scripts in desktop or scheduled sessions.

#### Warnings

##### WN-1 - Pre-existing SIM117 in installer Complete test

- **Source phase**: v2.2.3 Phase 7 verification
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (7.4)
- **Reason**: Ruff reports a nested `with patch(...)` at `scripts/installer/tests/test_complete.py:13`. The line predates v2.2.3 and is outside the Phase 7 hunks; changing it would be unrelated cleanup. All Phase 7 source and newly changed test paths pass ruff, and every touched file passes `ruff format --check`.
- **Suggested next step**: Combine the two patch contexts during a dedicated installer test-cleanup task.

##### WN-2 - Desktop DOM suites emit known renderer-environment warnings

- **Source phase**: v2.2.3 Phase 8 verification
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.3-glass-orbs-and-pillar-runtime.md` (Phase 8.5)
- **Reason**: The solo desktop suite passes all 1369 tests but emits existing React `act(...)` warnings and jsdom notices for unimplemented Canvas and media methods. These warnings do not indicate failed assertions and the affected harness code is outside the Phase 8 refactor.
- **Suggested next step**: Add targeted Canvas/media stubs and close remaining async React updates inside a dedicated desktop test-harness cleanup.

### Resolved Items

#### Deferred items closed within this cycle

##### DF-9 (resolved) - Four-pillar occupancy final acceptance

- **Source phase**: v2.2.3 Phase 5, reconciled in Phase 8
- **What changed**: App supplies free VRAM, the Studio scheduler snapshot, the resolved diffusion tier, and one renderer-session consent set. Chat, Coding, Image, and Video consult the same policy only when the user submits work; navigation never loads or unloads a model.
- **Evidence**: The final occupancy acceptance passed 91 tests across the four pillar pages, model-residency policy, wiring, and no-load-on-navigation files. The solo desktop suite then passed 1369 tests across 157 files.

#### Bugs found and fixed within this cycle

##### BG-15 (resolved) - Async explorer client crashed Local Chatbot on first paint

- **Source phase**: Phase 1
- **What happened**: ChatPage cast the promise-returning IPC client to the synchronous in-memory contract. `FolderTree.listTree()` threw immediately, and `ancestors()` would throw again after opening a chat.
- **Fix**: A promise-safe adapter now supplies the complete explorer contract, caches tree reads, invalidates after mutations, and lets FolderTree and breadcrumbs resolve async results without crashing. `ModuleErrorBoundary` contains future route failures.
- **Evidence**: Solo desktop Vitest run: 154 files and 1325 tests passed, including the new async adapter and breadcrumb regressions.

##### BG-16 (resolved) - Fresh launch opened the hidden Dashboard route

- **Source phase**: Phase 1
- **What happened**: `/` rendered Dashboard and missing or invalid persisted routes were not normalized to a visible module.
- **Fix**: `/` redirects to `/chatbot`; missing, `/`, `/dashboard`, and invalid stored routes normalize to `/chatbot`, while real module routes continue to restore.
- **Evidence**: App and persistence regression tests passed in the 1325-test solo desktop run.

##### BG-17 (resolved) - Module rail used four unrelated accent colors

- **Source phase**: Phase 2
- **What happened**: Each module NavLink painted its icon, active fill, and 3px left bar from a per-pillar accent token.
- **Fix**: Every module row now shares `.nexus-nav-link`: muted inactive text and a frosted selected fill with one hairline and inset highlight. Lucide icons inherit `currentColor`; the rail no longer consumes `accentVar`.
- **Evidence**: Sidebar and brand-token tests assert the glass class and absence of per-pillar icon color.

##### BG-18 (resolved) - Composer beam illuminated only a partial wedge

- **Source phase**: Phase 2
- **What happened**: The breathing beam moved only from 0 to 48 degrees, wrapped the outer attachment box, and competed with inner focused borders in pillar colors.
- **Fix**: The beam wraps the inner typing surface, breathes as a full masked ring, travels 360 degrees, uses brand cyan on every pillar, and is the only focus ring. Drag and send controls also use neutral brand tokens.
- **Evidence**: MediaComposer, CodingInput, and brand-token tests assert inner-surface nesting, `--accent-chatbot`, and the absence of `48deg`.

##### BG-19 (resolved) - Studio recall actions rendered as native text buttons

- **Source phase**: Phase 2
- **What happened**: Download, workflow, prompt, seed, remix, and use-as-source actions used native Windows button chrome and visible captions.
- **Fix**: The actions now share `.nx-icon-btn`, use lucide icons, retain every existing test ID, and expose their names through `aria-label` plus `title`. Coding New session also uses neutral glass instead of the retired per-pillar MetalAccent ring.
- **Evidence**: Image Studio and Coding page tests assert icon-accessible controls and the new glass New session contract.

##### BG-20 (resolved) - Installer Document section had no recommended OCR model

- **Source phase**: Phase 7
- **What happened**: `document` was absent from `SECTION_ORDER` and every tier in `recommended.json`, so the Document tab never pre-selected a model.
- **Fix**: Document is a multi-pick section. CPU and 8 GB tiers default RapidOCR PP-OCRv4; 12, 16, and 24 GB tiers default Unlimited-OCR 3B.
- **Evidence**: Tier-default tests cover all five tiers and assert Document is not a single-pick section.

##### BG-21 (resolved) - Installer taskbar tile used an opaque navy background

- **Source phase**: Phase 7
- **What happened**: The Win32 taskbar renderer filled an opaque navy canvas and preferred `icon.png` over the transparent no-background brand asset.
- **Fix**: The renderer prefers `nexus-ai-primary_no-background.png`, falls back to `icon.png`, and paints onto an alpha-zero ARGB canvas.
- **Evidence**: Win-titlebar tests assert preference order, transparent corners and center pixels, and fallback rendering.

##### BG-22 (resolved) - Successful install required an extra Next into an oversized Complete page

- **Source phase**: Phase 7
- **What happened**: `_on_install_finished` only refreshed navigation. Complete remained a manual next step, service names clipped, default row margins wasted space, and Copy inherited the global 38px secondary-button height.
- **Fix**: Success defers an automatic jump to Complete, failure stays on Installing, the progress indicator unpins, rows and cards are compacted, the service-name column is wider, and Copy receives a local-only height override.
- **Evidence**: Installer navigation and Complete-page tests cover success, failure, stepper state, spacing, margins, label width, and local button styling.

##### BG-23 (resolved) - Pending studio work used a small uncaptained orb inside competing bubble chrome

- **Source phase**: Phase 3
- **What happened**: Pending image and video generations reused the compact inline orb, exposed no visible state caption, and sat inside the normal message-bubble surface. Activity colors also varied by state instead of using the locked brand cyan.
- **Fix**: Media pending states use the existing hero orb in a centered transparent surface, all active activities use brand cyan, and inline or hero captions describe the current activity. Reduced-motion behavior remains owned by the existing orb primitive.
- **Evidence**: Agent-state and media-bubble tests cover cyan mapping, caption layout, hero sizing, transparent pending media chrome, and unchanged plain-chat width.

##### BG-24 (resolved) - Generation failures and empty completes could hang or expose empty actions

- **Source phase**: Phase 3
- **What happened**: Queue exceptions only marked SQLite rows failed, image completes without bytes produced no event, video completes were double-gated on workflow metadata, and renderer decode failures could leave empty output entries or recall actions behind.
- **Fix**: Queue and dispatcher failures now emit typed `kind: "error"` completions. Empty image or video completes become written failures, output caches never receive empty strings, decode failures clear media and workflow state, and actions render only for displayable assets.
- **Evidence**: Sidecar handler, queue-pump, Image Studio, Video Lab, and media-error tests cover every failure route. Full desktop Vitest passed 1334 tests; full root Vitest passed 5436 tests with 12 skips.

##### BG-25 (resolved) - Successful video files were not converted into playable Tauri asset URLs

- **Source phase**: Phase 3
- **What happened**: `resolveMp4Url` defaulted to the identity function, App never supplied a resolver, and the Tauri shell had no asset-protocol feature or scope. A valid filesystem path therefore reached the webview as an unplayable URL.
- **Fix**: App resolves MP4 paths with `convertFileSrc`; Tauri enables `protocol-asset` with a scope limited to `~/.nexus/outputs/videos/`; the CSP admits only the local asset schemes; and video completion no longer depends on optional workflow metadata.
- **Evidence**: The debug Tauri build passed with the asset-protocol configuration, sidecar and web builds passed, and Video Lab tests cover resolved URLs plus visible playback failures. Packaged playback remains part of DF-2 acceptance.

##### BG-26 (resolved) - Local Chatbot transcripts existed only in renderer memory

- **Source phase**: Phase 4
- **What happened**: ChatPage appended messages only to React state. Opening another chat or remounting the page discarded visible turns even though the explorer database already exposed message APIs.
- **Fix**: ChatPage now hydrates the opened chat through `listMessages`, persists completed user and assistant rows through `appendMessage`, keeps pending rows transient, and reports hydration or write failures without discarding the in-memory conversation.
- **Evidence**: Persistence tests cover remount hydration, chat isolation, user and assistant writes, pending-row exclusion, and nonblocking failure behavior. The solo desktop suite passed 1344 tests across 155 files.

##### BG-27 (resolved) - Restored transcripts did not restore model context

- **Source phase**: Phase 4
- **What happened**: `sessionIdsRef` was per ChatPage instance and the sidecar session map was process-local. A remount or sidecar restart could show old messages while sending the model an empty conversation context.
- **Fix**: `chat.session.start` accepts bounded persisted user and assistant history. ChatPage replays the opened transcript when starting a session and retries once with the same history when a sidecar restart reports an unknown session id.
- **Evidence**: Page and session-manager tests prove history replay, sidecar-restart recovery, and omission of the transient retrieval prefix from stored session history.

##### BG-28 (resolved) - Production Local Chatbot used process-local episodic memory

- **Source phase**: Phase 4
- **What happened**: App constructed `InMemoryMemoryHub`, so chat memory vanished with the renderer and was never retrieved into later turns.
- **Fix**: Production App now records through sidecar episodic-memory IPC backed by the existing SQLite `EpisodicMemory` store. ChatSessionManager retrieves scoped, redacted references before generation and treats retrieval failure as nonfatal.
- **Evidence**: Handler, runtime, and session tests prove durable reopen, scope isolation, redaction, retrieval injection, and failure-safe generation. The full root suite passed 5438 tests with 12 skips across 516 passing files and 3 skipped files.

##### BG-29 (resolved) - Agentic Coding silently used the sidecar directory as its workspace

- **Source phase**: Phase 6
- **What happened**: CodingPage started sessions with only a model id, so headless tools fell through to `NEXUS_WORKSPACE` or the packaged sidecar process directory instead of the user's project.
- **Fix**: The Coding header now displays and persists an explicit workspace path, refuses an empty selection before IPC, sends `workspacePath` on session start, and the runner rejects missing, relative, or parent-traversing roots instead of falling back to `process.cwd()`.
- **Evidence**: Renderer and runner tests prove empty-path refusal, persistence, protocol transport, per-session scoping, and relative-root rejection. The final solo desktop suite passed 1368 tests across 157 files.

##### BG-30 (resolved) - Hub commands, workspace rules, and lifecycle hooks were absent from headless turns

- **Source phase**: Phase 6
- **What happened**: The composer listed Hub commands, but `createHeadlessAgentRunner` passed no command body, workspace `AGENTS.md`, `.nexus` rules, or lifecycle bus into `HeadlessAgentSession`. The cron scheduler used a separate unenriched composition.
- **Fix**: A shared sidecar enrichment builder resolves only the invoked non-built-in Hub command, prompt-injection scans its body, loads workspace instructions and rules, and emits start, prompt, skill-entry, end, stop, and reflection events. Interactive and scheduled runs use the same builder and telemetry-backed HookBus.
- **Evidence**: Fixture tests prove invoked-command-only injection, built-in precedence, scanner-blocked fallback, AGENTS/rule prompt composition, scheduled parity, hook failure isolation, reflection transcript, and explicit written-file capture.

##### BG-31 (resolved) - Headless tools bypassed workspace permissions.deny

- **Source phase**: Phase 6
- **What happened**: The pure deny parser was enforced by the VS Code ToolRegistry only. Sidecar Coding, scheduled, and ACP-style headless tools could execute a call that the workspace policy denied.
- **Fix**: The shared sidecar tool factory now reads the active workdir's `.nexus/permissions.deny` for every invocation, rejects the first matching rule, and fails closed when the policy is malformed or unreadable.
- **Evidence**: Sidecar tool tests prove a matching `write_file` call is rejected before mutation and a malformed policy rejects the attempted tool. Desktop lint, typecheck, web build, sidecar build, and the full desktop suite pass.

##### BG-32 (resolved) - Rust and sidecar shell gates did not run on develop pushes

- **Source phase**: Phase 8
- **What happened**: `shell-build.yml` ran for main pushes and pull requests to main, so a sidecar or `src-tauri` regression could remain invisible on the integration branch until the release pull request.
- **Fix**: Develop pushes now run the Ubuntu shell job, while main pushes and manual dispatch retain the full Windows, macOS, and Ubuntu matrix. Existing concurrency cancellation remains active.
- **Evidence**: Workflow-discipline tests assert both push branches, the main pull-request target, and the matrix-cost condition. All 8 workflow-discipline tests and the full 5441-test root suite pass.

## v2.2.2

**Last updated**: 2026-08-22 (ready-shell-and-studio-chrome)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 8 | 0 |
| Bugs / regressions (BG) | 0 | 6 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

v2.2.2 does not re-run v2.2.0 or v2.2.1. It closes what the 2026-08-22 post-healthcheck GUI session still proved broken, and finishes composer / bubble / Data / Advanced chrome.

### Open Items

#### Deferred (carried from v2.2.0 / v2.2.1)

##### DF-1 - Node SEA / externalBin bundling not implemented (resolution chain shipped instead)

Unchanged. Spawn now also sets `CREATE_NO_WINDOW` on Windows. The Node binary is still resolved from the installer chain, not a Tauri `externalBin`.

##### DF-2 - Packaged-build acceptance legs not executed (clean-VM smoke)

A 2026-08-22 Complete-page healthcheck on this Windows host printed sidecar ok. That is not a clean-VM proof, and this coding session did not launch `nexus-shell.exe` from Explorer to confirm zero Node consoles after the flag change. Unit tests cover the flag helper.

##### DF-4 - Live-GPU generation smoke written but not executed

Unchanged. Out of scope for v2.2.2.

##### DF-14 - CodingInput still has its own composer implementation

Unchanged as a shared primitive. v2.2.2 restyled CodingInput to the same in-field + / icon-send contract as MediaComposer (slash autocomplete stays). The duplicated surface style objects were not extracted.

##### DF-16 remaining - no native file dialog for data transfer

Unchanged. Settings > Data still takes a path string. Page padding now matches Models.

##### DF-17 - Settings tabs are not URL-addressable

Unchanged. Out of scope.

##### DF-18 - Sidecar cwd + native addon on macOS .app and Linux AppImage

Unchanged. This session did not execute a macOS `.app` or Linux AppImage install (`not_observed != absent`).

##### DF-19 - CREATE_NO_WINDOW / hidden Node console not applicable on macOS or Linux

- **Source phase**: v2.2.2 Phase 1 / Phase 6.4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.2-ready-shell-and-studio-chrome.md` (1.1, 6.4)
- **Reason**: `creation_flags(CREATE_NO_WINDOW)` is `cfg(windows)` only. macOS and Linux do not allocate a console for a GUI-parented Node child the way Windows console-subsystem `node.exe` does. Those platforms are N/A for this flag, not proven hidden.
- **Suggested next step**: Record a packaged macOS/Linux launch screenshot showing no extra terminal; do not copy the Windows flag there.

### Resolved Items

#### Bugs found and fixed within this cycle

##### BG-9 (resolved) - Visible node.exe console then sidecar-exited:-1073741510

- **Source phase**: Phase 1
- **What happened**: After a passing installer healthcheck, the GUI spawned console-subsystem `node.exe` with no creation flags. Closing that CMD sent `STATUS_CONTROL_C_EXIT` (0xC000013A / -1073741510) and killed the sidecar.
- **Fix**: Shared `sidecar_command` sets `CREATE_NO_WINDOW` (`0x08000000`) on Windows. No `DETACHED_PROCESS`. In-app `ReadyOverlay` waits for sidecar running plus `models.list` (empty catalog ok), then dismisses. Failure shows `SidecarDownBanner` plus Restart, not a hung splash.

##### BG-10 (resolved) - Image generate 400d on sampler flow-dpm-solver

- **Source phase**: Phase 2
- **What happened**: UI default and Fast Preview sent `flow-dpm-solver`. Python already allowed it. Sidecar Zod `DiffusionSampler` was the six-value enum without that member.
- **Fix**: Enum includes `flow-dpm-solver`. Protocol tests parse the 2026-08-22 field payload.

##### BG-11 (resolved) - Settings > Data had no page padding

- **Source phase**: Phase 4
- **What happened**: Data controls sat on the pane edge. Models uses `padding: var(--space-6, 24px)`.
- **Fix**: The same token on the `settings-data` root.

##### BG-12 (resolved) - Generate/Send was a labeled MetalAccent box; Coding was a three-box row

- **Source phase**: Phase 3
- **What happened**: MediaComposer wrapped a captioned submit in MetalAccent (`.nexus-metal-fallback` ring). CodingInput kept + / textarea / Send as separate boxes.
- **Fix**: + and icon send grouped inside the field (right cluster). Submit is `aria-label` only. AccentBeam stays on the surface.

##### BG-13 (resolved) - Transcripts were full-width rectangles labeled You/Assistant

- **Source phase**: Phase 5
- **What happened**: MessageBubble was full-width with a role header. Image/Video used custom `<ul>` lists.
- **Fix**: User rows `flex-end`, assistant `flex-start`. Bubble `fit-content`, `max-width: 80%`. No You/Assistant on normal turns. Image/Video use MessageList.

##### BG-14 (resolved) - Chat and Coding looked empty when the sidecar was down

- **Source phase**: Phase 5
- **What happened**: Neither page mounted `SidecarDownBanner`. Empty copy read as a blank constellation.
- **Fix**: Banner on Chat and Coding when `useSidecarStatus` reports down. Composer stays visible.

## v2.2.1

**Last updated**: 2026-08-22 (field-repair-and-chrome-completion)

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 6 | 0 |
| Bugs / regressions (BG) | 0 | 6 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

v2.2.1 does not re-run the v2.2.0 cycle. It closes what the 2026-08-22 field install still proved broken, and finishes chrome that v2.2.0 claimed done. Carry-forwards from v2.2.0 that this patch did not close are listed below (same IDs).

### Open Items

#### Deferred (carried from v2.2.0)

##### DF-1 - Node SEA / externalBin bundling not implemented (resolution chain shipped instead)

Unchanged. Spawn now sets cwd to the script directory and waits for liveness; the Node binary is still resolved from the installer chain, not a Tauri `externalBin`.

##### DF-2 - Packaged-build acceptance legs not executed (clean-VM smoke)

A 2026-08-22 rebuild of `nexus-shell.exe --healthcheck` on this Windows host printed `"sidecar":"ok"` with `catalogRows: 38` after two packaging fixes: copy `unsloth-pins.json` next to the bundle (import-time ENOENT), and fetch `better-sqlite3` for installer Node 22.11.0 (ABI 127) instead of the developer Node 24 (ABI 137). The Complete-page install of a freshly built `dist/NexusSetup.exe` is still the remaining live-install proof.

##### DF-4 - Live-GPU generation smoke written but not executed

Unchanged. Out of scope for v2.2.1.

##### DF-16 remaining - no native file dialog for data transfer

Unchanged. Settings > Data still takes a path string. Preview-and-stage import is not a full restore into final destinations.

##### DF-17 - Settings tabs are not URL-addressable

Unchanged. Out of scope.

##### DF-18 - Sidecar cwd + native addon on macOS .app and Linux AppImage

- **Source phase**: v2.2.1 Phase 1 / Phase 5.4
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.1-field-repair-and-chrome-completion.md` (5.4)
- **Reason**: Spawn cwd is `script.parent()` and Tauri maps the whole `sidecar/dist` tree, which is OS-agnostic in source. This session did not execute a macOS `.app` or Linux AppImage install, so those resource layouts are not proven here (`not_observed != absent`).
- **Suggested next step**: Run `--healthcheck` on a packaged macOS and Linux build and confirm `better_sqlite3.node` resolves from the script directory.

### Resolved Items

#### Bugs found and fixed within this cycle

##### BG-3 (resolved) - Complete page printed os error 232 and `[ / / Nodejs v22.11.0]`

- **Source phase**: Phase 1
- **What happened**: Node 22.11.0 started, then the child died (native addon lookup with the wrong cwd). The next JSON-RPC write hit a closed pipe. Healthcheck joined the last three stderr fragments with `" / "`.
- **Fix**: `spawn_with` sets cwd to `script.parent()`, waits for `[nexus-sidecar] ready` or 500 ms of liveness, maps a dead child to `sidecar-exited:<code>`, and the installer prints `exitCode`, paths, and non-empty stderr lines.

##### BG-4 (resolved) - Approvals popover could not be dismissed

- **Source phase**: Phase 3
- **What happened**: Open toggled only from the bell. No X, Escape, or outside click. The card followed the user across tabs.
- **Fix**: Close control, Escape, pointerdown outside the dialog and the bell. Portal to the right of the rail so it cannot cover the toggle. Sidecar-down error is closable and does not auto-open.

##### BG-5 (resolved) - Settings leftover native search/text/action chrome

- **Source phase**: Phase 4
- **What happened**: Models Search, Skill Optimizer, and every other Settings tab still used unstyled native inputs and buttons after the v2.2.0 select pass.
- **Fix**: Shared `Button` and `TextField` primitives; sweep of every Settings tab body; coding-panel leftover `<select>`s wrapped. Vitest grep guards the settings pages.

##### BG-6 (resolved) - User Profile sidebar row and expanded-by-default rail

- **Source phase**: Phase 2
- **What happened**: `ADMIN_ENTRIES` still had User Profile -> `/profile`. Compact was `storedCompact ?? narrow`, so a wide window started expanded.
- **Fix**: Profile row removed. Compact default is true. Silent `/profile` redirect remains.

##### BG-7 (resolved) - Image/Video mapped sidecar-down to a fake installed SANA

- **Source phase**: Phase 5 leftover
- **What happened**: Catch on `models.list` set `noneInstalled` and showed `FALLBACK_MODEL` marked installed.
- **Fix**: Sidecar-down sets an empty list and `noneInstalled=false`. A genuine empty catalog is empty, not a fake installed row.

##### BG-8 (resolved) - Chat composer hidden until a chat existed

- **Source phase**: Phase 5 leftover
- **What happened**: `MediaComposer` rendered only when `activeChat` was set. Empty copy told the user to pick a folder first.
- **Fix**: Composer is always visible. First send creates a folder-less "New chat" and titles it from the first prompt when the generator is available.

## v2.2.0


### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 17 | 7 |
| Bugs / regressions (BG) | 0 | 2 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 3 | 1 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Node SEA / externalBin bundling not implemented (resolution chain shipped instead)

- **Source phase**: Phase 1 - Sidecar Packaging and Runtime Wiring Repair (1.2)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 1.2)
- **Reason**: The plan prefers a Node SEA or Tauri `externalBin` next to the resources so the app is fully self-contained. This phase shipped the resolution chain (`NEXUS_NODE_PATH` -> `~/.nexus/runtime.json` `nodePath` -> per-OS provisioned path -> PATH `node`) plus a guaranteed installer runtime step (payload copy or pinned nodejs.org download, sha256-verified), which covers every installer-driven path. A machine whose app is installed WITHOUT the Nexus installer (raw NSIS bundle) and with no system Node still has no runtime.
- **Suggested next step**: Evaluate Tauri `externalBin` with the Node 22 binary at desktop build time in a later phase; if adopted, it becomes resolution source 2 and the download leg becomes repair-only.

##### DF-2 - Packaged-build acceptance legs not executed (clean-VM smoke)

- **Source phase**: Phase 1 (1.1 / 1.2 / 1.4 acceptance criteria)
- **Plan reference**: sub-tasks 1.1, 1.2, 1.4
- **Reason**: The 1.1/1.2/1.4 acceptance criteria include running a packaged NSIS build on a clean VM (resource-dir resolution, no-system-Node spawn, installer health-check verdict). This session validated the contracts statically (packaging assertion tests, Rust resolution-chain tests, stubbed healthcheck pytest) but did not produce and execute a full installer build.
- **Suggested next step**: On the next installer build (`build-windows.ps1` -> nexus-installer exe), run the install on a clean Windows VM/sandbox and confirm the Complete page reports `sidecar ok; catalogRows>0`. Phase 2's stability gate re-checks this on the reference machine.

##### DF-3 - provisioner_dispatch chain remains dead code in the GUI flow

- **Source phase**: Phase 1 (discovered during 1.3)
- **Plan reference**: sub-task 1.3
- **Reason**: The live `InstallEngine.run` never consumed `provisioner_dispatch.chain_for` ("node", "ffmpeg", python-venv provisioners) - that is WHY no Node was ever provisioned in shipped installs. Phase 1 added a dedicated always-on runtime step rather than rewiring the whole dispatch chain (diffusion venv wheels provisioning is still not wired into the GUI flow; runtime.json records the venv only if present).
- **Suggested next step**: Either wire the dispatch chain into `InstallEngine.run` (diffusion venv + ffmpeg steps) or delete the dead chain in the final refactor phase; the diffusion venv step matters for Phase 2's generation smoke on hosts that never had v1.x installs.

##### DF-4 - Live-GPU generation smoke written but not executed

- **Source phase**: Phase 2 - Model Availability End to End (2.5)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 2.5)
- **Reason**: `scripts/smoke/live-gpu-generation.mjs` renders one real image (sana-1.6b-2k) and one short clip (ltx-video) through the built sidecar and the installed weights, gated behind `NEXUS_LIVE_GPU=1`. It was verified to skip cleanly (exit 2) without the gate, but the actual GPU run was NOT performed in this session - no live render has been proven end to end. The mocked integration test covers routing and the typed `runtime-unavailable` path only.
- **Suggested next step**: Run `NEXUS_LIVE_GPU=1 node scripts/smoke/live-gpu-generation.mjs` on the RTX 3080 host after the next install, and record the outcome here. This is the leg that closes Phase 2's stability gate for real.

##### DF-5 - GPU telemetry reports no queue depth or active model

- **Source phase**: Phase 2 (2.4)
- **Plan reference**: sub-task 2.4
- **Reason**: `gpuRuntime.ts` builds `GpuTelemetrySource` with the default `activeJobProvider`, so `activeModelId` is null and `queuedJobs` is 0 in every sample. Real GPU/VRAM/device numbers are live, but the widget's "Idle vs model name" line and queue count are not yet fed by the scheduler. Wiring them means giving the sidecar handler access to the GpuScheduler snapshot, which is exactly what Phase 4's `ModelResidencyContext` introduces.
- **Suggested next step**: Feed the scheduler snapshot into `gpuTelemetrySource()` during Phase 4 (4.3), then assert a non-null `activeModelId` while a job runs.

##### DF-6 - Ollama upgrade path reaches through to a private helper

- **Source phase**: Phase 2 (2.3)
- **Plan reference**: sub-task 2.3
- **Reason**: `ensure_ollama_supports()` calls `OllamaInstaller._ollama_version()` (a private method, flagged with `noqa: SLF001`) because there is no public version accessor. Correct behavior, slightly leaky boundary.
- **Suggested next step**: Promote `_ollama_version` to a public `installed_version()` during the Phase 8 refactor and drop the noqa.

##### DF-7 [RESOLVED 2026-08-22, Phase 8] - Bundled hub snapshot is not produced by the release build yet

- **Source phase**: Phase 3 - Nexus-Hub Harness Provisioning (3.1)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 3.1)
- **Reason**: `scripts/installer/build/build-hub-snapshot.py` produces a checksummed `catalog.tar.gz` + `manifest.json`, the PyInstaller spec stages them when present (refusing a placeholder digest), and the provisioner extracts them. But no snapshot has been built and no build script calls the builder, so today's installer still falls back to the network sync. The OFFLINE-install guarantee is therefore implemented but not yet delivered.
- **Suggested next step**: Call `build-hub-snapshot.py` from `build-windows.ps1` (and the macOS/Linux build scripts) after a sync, so the release installer always carries a snapshot; then verify an offline install lands a populated catalog.

##### DF-8 - Hub tar extraction uses a minimal in-house reader

- **Source phase**: Phase 3 (3.1)
- **Plan reference**: sub-task 3.1
- **Reason**: `extractHubSnapshot` implements a small ustar reader (with a tar-slip guard) rather than adding a tar dependency to the sidecar bundle. It handles the regular-file and directory entries a catalog snapshot contains, but not symlinks, long-name (GNU/PAX) headers, or sparse entries. A snapshot built by `build-hub-snapshot.py` never contains those; a hand-rolled archive could.
- **Suggested next step**: Either keep it and assert the constraint in the builder (reject symlinks/long names at pack time), or vendor a small tar implementation, during the Phase 8 refactor.

##### DF-9 [RESOLVED 2026-08-22, Phase 8] - The switch policy is wired to one submit surface, not four

- **Source phase**: Phase 4 - Smart Single-GPU Model Orchestration (4.3)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 4.3)
- **Reason**: sub-task 4.3 calls for integrating the policy into "the studios' and chat/coding submit paths". Only `ImageStudioPage.handleSubmit` is wired (classify, dialog, chip, resume-after-confirm). Video Lab, Local Chatbot, and the Agentic composer still submit without consulting the policy, so a submit from those surfaces cannot raise the confirm dialog.
- **Suggested next step**: Apply the same four-line gate to `VideoLabPage`, the chat composer, and the coding composer. The hook and dialog are surface-agnostic; the remaining work is per-surface wiring plus one test each.

##### DF-10 [RESOLVED 2026-08-22, Phase 8] - The policy is not fed live residency or scheduler state

- **Source phase**: Phase 4 (4.1 / 4.3)
- **Plan reference**: sub-tasks 4.1, 4.3
- **Reason**: `ImageStudioPage` accepts `hostVramFreeGB` and `activeSchedulerJob` props, but `App.tsx` does not yet supply them, and `useModelResidency` starts with an empty resident list that nothing updates from the scheduler. In the shipped app the policy therefore sees "nothing loaded, VRAM unknown" and takes the no-incumbent path on every submit. The decision matrix is correct and fully tested; it is simply not being given real inputs yet. This is the same missing feed as DF-5 (telemetry carries no active model or queue depth).
- **Suggested next step**: Expose a `scheduler.snapshot` IPC (active job + queued) alongside the existing `gpu.sample`, feed `resident`/`freeVramGB`/`activeJob` from it in `App.tsx`, and assert an end-to-end confirm in a page test. Closing this also closes DF-5.

##### DF-11 [RESOLVED 2026-08-22, Phase 8] - Cross-model orchestration is not wired to the real agent tools

- **Source phase**: Phase 4 (4.2)
- **Plan reference**: sub-task 4.2
- **Reason**: `runCrossModelRequest` implements hold -> classify -> run -> restore with the three failure modes, and is covered by tests against a mock runtime (which is what the sub-task's acceptance asks for). It is not yet called by the coding agent's image/video tools, so an actual agentic session cannot exercise it, and the Trace-panel progress lines it emits are not rendered anywhere.
- **Suggested next step**: Call it from the agent's image/video tool handlers, passing the session's current model as `agenticModelId`, and render `CrossModelProgress` in the coding Trace panel.

##### DF-12 [RESOLVED 2026-08-22, Phase 8] - The chat rail is not yet the chat-first session history (5.2)

- **Source phase**: Phase 5 - Local Chatbot Rebuild (5.2)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 5.2)
- **Reason**: 5.2 asks for a rebuilt rail: composer-first empty state, a "New chat" primary action, recent chats at root, an optional Projects section, drag between root/projects/folders, and a collapsible rail. This phase delivered the storage, titling, persona, and composer work; `FolderTree` still renders its original "Create your first folder" empty state and the page still requires selecting a chat before the composer is usable. The user's specific complaint ("it only starts a chat when we create a folder") is therefore NOT yet fixed in the UI, even though the store has supported root-level chats all along.
- **Suggested next step**: Rework `FolderTree` into the session rail and make `ChatPage` render the composer with no active chat, creating a root chat on first send. The storage calls it needs (`createChat` with `folderId: null`, `listMessages`) are already wired and tested.

##### DF-13 [RESOLVED 2026-08-22, Phase 8] - Auto-titling is implemented end to end but not called on first send

- **Source phase**: Phase 5 (5.3)
- **Plan reference**: sub-task 5.3
- **Reason**: `chat.generateTitle` (sidecar), `fallbackTitle`/`sanitizeTitle`, the `userRenamed` pin, and the `renameChat({byUser})` split are all implemented and tested. The client-side trigger - set the fallback title on first send, request the generated one in the background, apply unless the user renamed - is not yet in `ChatPage.handleSubmit`, so chats created today still carry the title `FolderTree` gives them.
- **Suggested next step**: In `handleSubmit`, when the chat has no messages yet, set the fallback title immediately, then call `generateTitle` and apply the result via `renameChat(id, title)` (machine path, so it never sets `userRenamed`).

##### DF-14 - CodingInput still has its own composer implementation

- **Source phase**: Phase 5 (5.4)
- **Plan reference**: sub-task 5.4 ("Update CodingInput to reuse the same base composer")
- **Reason**: `MediaComposer` was rebuilt as the single in-field surface used by Chat, Image Studio, and Video Lab. `CodingInput` keeps its own layout and its own duplicated `addBtnStyle`/`docChipStyle`/`removeBtnStyle` objects, because it carries the slash-command dropdown that the shared composer has no concept of.
- **Suggested next step**: Extract the surface (field + in-field controls) into a shared primitive that accepts an overlay slot, then have `CodingInput` supply its dropdown through that slot. Phase 6's ui-primitives work is the natural place.

##### DF-15 - Token aliases added rather than call sites migrated

- **Source phase**: Phase 6 - Shell UI Modernization (6.4)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 6.4)
- **Reason**: `--border-1`, `--accent-primary`, `--accent-danger`, and `--accent-warning` were referenced in 71 places but never defined, so each usage fell through to whatever inline literal its author happened to write. They are now DEFINED as aliases of the canonical tokens, which fixes the rendering immediately. The plan also asked to migrate the 71 call sites and delete the aliases; that rename was deliberately not done inside a UI phase, where it would have been a large mechanical diff competing with real behaviour changes.
- **Suggested next step**: Sweep the call sites to the canonical names and delete the alias block during the Phase 8 refactor, with the existing token test as the guard.

##### DF-16 [PARTIALLY RESOLVED 2026-08-22, Phase 8] - Data transfer has no IPC surface or file dialogs yet

- **Source phase**: Phase 7 - Settings modernization and data transfer (7.4)
- **Plan reference**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md` (sub-task 7.4)
- **Reason**: `transferRuntime.ts` implements export and import end to end (manifest, per-category checksums, credentials excluded by default, atomic write, path-escape refusal, dry run, pre-import backup) and is covered by 15 tests. Settings > Data renders the category picker and calls a `DataSettingsClient`, but no `data.export` / `data.import` IPC methods exist and no save/open dialog is wired, so the page reports "the Nexus backend is not reachable" in the running app. The import apply path also stages files under `~/.nexus/import-staging` rather than moving them into place.
- **Resolution (Phase 8)**: `data.categories`, `data.export`, and `data.import` are declared, handled, and covered; Settings > Data now reaches the real runtime, exports to an editable path defaulting to a timestamped name, and offers Preview before Import.
- **Remaining**: no native file dialog. Adding one means a Tauri plugin plus a capability change, which is not a change to slip into a release build; the path fields cover the same ground without it. The import apply path still stages under `~/.nexus/import-staging` rather than merging into final destinations, so an import is a preview-and-stage, not yet a full restore.

##### DF-17 - Settings tabs are still not URL-addressable

- **Source phase**: Phase 7 (7.2)
- **Plan reference**: sub-task 7.2
- **Reason**: 7.2 asks for a declarative tab registry with `/settings/:tab` routing, redirects, and lazy mounting. This phase added the Data tab to the existing hand-written button list and ternary chain instead. Deep links to a specific settings tab therefore still do not work, and `/profile` redirects to `/settings` rather than `/settings/profile`.
- **Suggested next step**: Convert the tab list to a registry with routing during the Phase 8 refactor; the tab bodies are already independent components.

#### Missing tests / coverage

##### MT-3 - Studio backend-down banner not covered by a page-level test

- **Source phase**: Phase 2 (2.2)
- **Plan reference**: sub-task 2.2
- **Reason**: The classifier, the hook, and the settings pages are covered, but no test renders `ImageStudioPage` / `VideoLabPage` with a stubbed `sidecar_status` reporting `running: false` to assert the banner replaces the "No image models installed" button. The pages read the status through a Tauri command that is absent under Vitest (`ipc-unavailable` -> unknown -> not down), so this needs an injectable seam.
- **Suggested next step**: Add a `sidecarStatus` prop (or a context provider) to the studio pages in Phase 6's shell work and assert both branches.

##### MT-1 - Sidecar boot wiring (main.ts) covered only indirectly

- **Source phase**: Phase 1 (1.3)
- **Plan reference**: sub-task 1.3
- **Reason**: `applyRuntimeConfigEnv` is unit-tested, but the `main.ts` call site (applied before runtime construction, stderr log line) has no direct test - `main.ts` is the process entry and has no test harness today.
- **Suggested next step**: Cover via the Phase 2 sidecar-level integration test (spawn the built sidecar with a fixture `NEXUS_AI_HOME`/home and assert the boot log line).

##### MT-2 - Complete-page health detail line untested

- **Source phase**: Phase 1 (1.4)
- **Plan reference**: sub-task 1.4
- **Reason**: The Complete page now renders `state.desktop_health_detail`; existing complete-page tests pass but none assert the new detail string.
- **Suggested next step**: Add a QLabel-text assertion to the complete-page pytest when Phase 7 reworks settings/pages tests, or fold into the installer UI test pass.

### Resolved Items

#### Bugs found and fixed within this cycle

##### BG-1 (resolved) - the hub CLI reported a scanner-blocked sync as success

- **Source phase**: Phase 3 (3.1), found while restoring a catalog damaged by BG-2.
- **What happened**: `NexusHubSyncer.sync({apply: true})` returns `applied: false` when the prompt-injection scanner blocks the fetched bundle. The CLI reported that outcome as `{kind: "done", ok: true}`, so the installer would have recorded a successful harness install while the catalog on disk was untouched.
- **Fix**: a sync that did not apply and is not `alreadyUpToDate` now returns a `scan-quarantine` error and exit 1. Covered by `hub-catalog-phase3.test.ts` ("reports a fetched-but-not-applied sync as a failure").

##### BG-2 (resolved) - the hub CLI could only ever target the real `~/.nexus-ai/catalog`

- **Source phase**: Phase 3 (3.4).
- **What happened**: the CLI had no way to point at a different catalog directory, so a round-trip test that invoked the real `--extract-hub-snapshot` bundle overwrote the developer's installed catalog with a one-skill test fixture. The catalog was rebuilt from the intact top-level `~/.nexus-ai/` trees and its original tag (`3.12.0`) restored; no other data was affected.
- **Fix**: `--catalog-dir` (and `NEXUS_HUB_CATALOG_DIR`) are honoured by every CLI mode, the round-trip test passes an explicit target and asserts nothing was written outside it, and a regression test pins the override. The destructive extract path can no longer default onto a real home in a test.


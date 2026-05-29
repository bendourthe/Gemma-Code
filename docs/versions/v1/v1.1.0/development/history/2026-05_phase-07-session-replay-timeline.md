# v1.1.0 Phase 7 -- Session replay timeline (`<TimelineScrubber>` + side-list + compare mode)

**Date**: 2026-05-20
**Branch**: `main`
**Plan**: [docs/versions/v1/v1.1.0/plans/phase-07-session-replay-timeline.md](../../plans/phase-07-session-replay-timeline.md)
**Phase outcome**: Phase 7 of the v1.1.0 cycle ([v1.1.0-cycle](../../plans/v1.1.0-cycle.md)) landed -- agentmemory A6 (session replay) is closed via a new `<TimelineScrubber>` component, a session-list side-rail bolted onto the existing `TraceDashboardPanel`, and a side-by-side `<SessionCompareView>` that diffs two sessions at a linked playhead.

---

## 1. Goal and scope

Surface a scrubbable replay of any recorded coding session inside the TraceDashboard so the developer can step through tool calls, model deltas, skill loads, and lifecycle hookKind events at variable speed; plus a side-by-side compare mode that diffs event streams across two sessions at the same playhead position. The stability gate from the plan: TraceDashboard side-panel lists sessions; clicking opens a `<TimelineScrubber>` with play/pause/speed (0.5x / 1x / 2x / 4x); the playhead advances through trace events in order; a "Compare two sessions" mode renders side-by-side trace deltas; coverage on `TimelineScrubber.tsx` >= 80% lines.

## 2. Pre-implementation review

Read the plan ([phase-07-session-replay-timeline.md](../../plans/phase-07-session-replay-timeline.md)) end-to-end, then mapped the four sub-tasks against the existing codebase:

- **Existing surfaces** that already enable Phase 7 without protocol changes:
    - [desktop/sidecar/src/protocol.ts](../../../../desktop/sidecar/src/protocol.ts) declares `CodingSessionSummaryT` ({sessionId, modelId, family, title, createdAt, messageCount}), `TraceEventT` ({id, timestamp, kind, summary, payload?, hookKind?}), and the `coding.sessions.list` + `coding.trace.subscribe({sessionId?})` IPC channels. The Phase 7 plan was authored against this exact contract -- no protocol-side work was needed.
    - [desktop/src/modules/coding/panels/TraceDashboardPanel.tsx](../../../../desktop/src/modules/coding/panels/TraceDashboardPanel.tsx) already renders an event list with a Phase 4.5 `hookKind` dropdown filter. The sub-task 7.1 wording ("Modify TraceDashboardPanel.tsx to render a left-side session list") implied an in-place extension rather than a new component.
    - [desktop/src/modules/coding/CodingPage.tsx](../../../../desktop/src/modules/coding/CodingPage.tsx) already fetches `sessions` for the dedicated "sessions" tab; the Phase 7 wiring just needed to (a) also fetch sessions when the "trace" tab activates and (b) thread two new pieces of replay/compare state through to the panel.
- **Missing surfaces**: no `TimelineScrubber` component, no `SessionCompareView` component, no concept of "play state" or "playhead position" anywhere in the desktop frontend. All three were greenfield.
- **Test seam considerations**: a unit test on `requestAnimationFrame`-driven playback against `jsdom` would normally need an `rAF` polyfill plus a fake clock to be deterministic. Vitest's `vi.useFakeTimers({toFake: ['requestAnimationFrame', 'performance']})` is fiddly across versions. Decision: thread three optional props (`now`, `raf`, `caf`) through `TimelineScrubber` so tests inject a manual scheduler whose `flush(dtMs)` advances the clock and dispatches the queued frame callback in lock-step. Production still uses `window.{requestAnimationFrame, cancelAnimationFrame, performance.now}` because the defaults inside the component use those globals. Same pattern threaded through `SessionCompareView`.

## 3. Implementation

### 3.1 `TraceDashboardPanel` left-rail session list (sub-task 7.1)

`TraceDashboardPanelProps` gained four optional fields:
- `sessions?: readonly CodingSessionSummaryT[]` (the recorded sessions to list),
- `activeSessionId?: string | null` (drives the highlight in the side rail and feeds the `<TimelineScrubber>`),
- `onSelectSession?: (id: string) => void` (bubbled when the user clicks a row),
- plus the compare-mode trio (`compareSession`, `compareEvents`, `onPickCompareSession`, `onCloseCompare`).

The panel branches on `sessions` presence so the existing call sites (tests, the v1.0.0 "trace" tab on a pre-Phase-7 sidecar) keep working unchanged. When `sessions` is supplied, a `<aside data-testid="trace-session-list">` renders one `<button data-testid="trace-session-{id}">` per row showing `sessionId.slice(0, 8)`, the session `title`, and a `{modelId} - {messageCount} ev - {createdAt}` line under it. Active row gets `background: var(--bg-1)`.

### 3.2 `<TimelineScrubber>` (sub-task 7.2)

[desktop/src/modules/coding/panels/TimelineScrubber.tsx](../../../../desktop/src/modules/coding/panels/TimelineScrubber.tsx) is a standalone component (`TimelineScrubberProps`) with:

- `events: readonly TraceEventT[]` -- the events to replay,
- optional controlled-mode `playing` / `speed` props + `onPlayingChange` / `onSpeedChange` callbacks (used by 7.3's `SessionCompareView` to link two scrubbers),
- `onPlayheadCross?: (crossed: readonly TraceEventT[]) => void` -- fires once per event when the playhead crosses its offset,
- the three test seams (`now`, `raf`, `caf`),
- `testIdPrefix` -- so two scrubbers in compare mode don't collide on `data-testid` selectors.

Implementation notes:
- `parseEvents(events)` sorts by `Date.parse(timestamp)` and returns `{parsed: {event, offsetMs}[], durationMs}`. The first event sits at `offsetMs = 0`; `durationMs` is the offset of the last event.
- Playhead state lives in `playheadMs` (re-rendered on each tick) + a `playheadRef` so the rAF closure can read the latest value without re-registering.
- The rAF loop is mounted in a `useEffect` keyed on `playing` (not on `playheadMs`) so a frame doesn't re-register the loop. The loop:
    1. reads `t = now()`,
    2. computes `dt = t - lastFrame` (or 0 on first tick),
    3. advances `playheadMs` by `dt * speed`, clamped to `durationMs`,
    4. emits any events whose `offsetMs <= playheadMs` and haven't yet fired (the `nextEventIdxRef` cursor lets this run in amortized O(events) per session),
    5. if `playheadMs >= durationMs`, calls `setPlaying(false)` and returns (the cleanup function cancels the pending frame),
    6. otherwise schedules the next `raf(tick)`.
- `seekTo(ms)` is the single mutator for both the slider's `onChange` and the Go-to-start / Go-to-end buttons. It clamps the value, updates the playhead, and resets the firing cursor: anything with `offsetMs < clamped` is considered "already crossed" (strict less-than, so an event at exactly the playhead position still fires when playback resumes from there -- this is why seeking back to 0 re-replays event #0).
- Tick marks: a thin overlay `<div>` with one `<span>` per event positioned via `left: ${(offsetMs / durationMs) * 100}%`.
- The crossed-event list rendered below the slider is computed from the parsed events via `offsetMs <= playheadMs`, so the visible list updates in lock-step with the playhead even when the user scrubs backwards or forwards.

### 3.3 `<SessionCompareView>` (sub-task 7.3)

[desktop/src/modules/coding/panels/SessionCompareView.tsx](../../../../desktop/src/modules/coding/panels/SessionCompareView.tsx) renders two `<TimelineScrubber>` instances in a CSS-grid two-column layout, both in controlled mode against a shared `playing` / `speed` state that lives in the compare view. The shared "Play both" button toggles both scrubbers; the "Shared speed" dropdown propagates to both. The component tracks the events crossed in each session locally and feeds them into a `diffEvents(a, b)` helper that builds a row-per-index `DiffRow[]`; rows where `a.kind !== b.kind` or `a.summary !== b.summary` (or where one side has no event at that index) get `data-differs="true"` and a faint red tint. An optional `onCloseCompare` callback (forwarded from the dashboard's "Close compare" button) lets the user exit compare mode back to single-session replay.

### 3.4 Dashboard mode switch + picker dialog (sub-task 7.3, panel side)

The dashboard renders one of three sub-views inside its right pane:
1. **Single-session replay** (when `sessions` + `activeSession` are present but no `compareSession`): "Replaying: <title>" header + "Compare to..." button + `<TimelineScrubber>` + the legacy filtered event list.
2. **Compare picker open** (transient): a `<div role="dialog">` listing every session except the active one. Clicking a row calls `onPickCompareSession(id)`; the parent fetches that session's events and the picker auto-closes once `compareSession` is set (via a `useEffect`).
3. **Compare mode** (when both `compareSession` + `compareEvents` are populated): renders `<SessionCompareView>`.

### 3.5 CodingPage wiring (sub-task 7.4)

[desktop/src/modules/coding/CodingPage.tsx](../../../../desktop/src/modules/coding/CodingPage.tsx) added three pieces of state (`replaySessionId`, `compareSessionId`, `compareEvents`), three callbacks (`handleReplaySelect`, `handleCompareSelect`, `handleCloseCompare`), and a second `useEffect` that loads the session list whenever the "trace" tab activates (the existing one only loaded for the "sessions" tab). The callbacks call `coding.trace.subscribe({sessionId})` to swap the active or compare event stream; the dashboard receives both via props.

### 3.6 Tests

- [desktop/tests/TimelineScrubber.test.tsx](../../../../desktop/tests/TimelineScrubber.test.tsx): 9 cases. The signature case ("plays a synthetic 10-event session at 2x in ~50% of wall-clock time") drives the manual scheduler in 16 ms steps and asserts both the wall-clock budget (between 40% and 60% of 900 ms) and that the `onPlayheadCross` callback received exactly the 10 events in order. The seek-mid-playback case verifies that after slider-seeking to 2.5 s only events strictly after that time fire on resume.
- [desktop/tests/SessionCompareView.test.tsx](../../../../desktop/tests/SessionCompareView.test.tsx): 4 cases including the linked-playhead diff incrementally populating as the shared toggle plays both scrubbers.
- [desktop/tests/panels.test.tsx](../../../../desktop/tests/panels.test.tsx): 3 new TraceDashboard cases covering the session list, the picker dialog (excludes the active session), and the compare-mode switch when `compareSession` + `compareEvents` are supplied.

### 3.7 Phase 7 gate (sub-task 7.4)

- `npm run lint`: clean (eslint over `src`).
- `npm run lint:shell`: clean (eslint over `desktop/{src,sidecar/src,tests}` with `--max-warnings=0`).
- `npm run build`: clean (`tsc` at the root).
- `npm run test:shell`: 384 / 384 passing (45 test files).
- Coverage (desktop, via `npm run test:shell:coverage`):
    - `TimelineScrubber.tsx`: 97.79% lines / 86.56% branches / 100% functions.
    - `SessionCompareView.tsx`: 100% lines / 84% branches / 100% functions.
    - `TraceDashboardPanel.tsx`: 99.59% lines / 96.61% branches / 88.88% functions.
    - The plan's >= 80% lines target on `TimelineScrubber.tsx` is met with 17.79 points of margin.

## 4. CI carryover fix

The Phase 6 push (commit `c8d9e0b`) shipped the Phase 5 `@xenova/transformers ^2.17.2` `optionalDependencies` entry in `package.json` without running `npm install`, so `package-lock.json` was missing 44 transitive entries (`@xenova/transformers`, `@huggingface/jinja`, `onnxruntime-{node,web,common}`, `sharp`, `protobufjs` + its 9 `@protobufjs/*` packages, `tar-fs`, `tar-stream`, the `bare-*` family, `streamx`, `text-decoder`, etc.). Every CI step that started with `npm ci --prefer-offline --no-audit` failed with `EUSAGE: package.json and package-lock.json or npm-shrinkwrap.json are in sync`, which cascaded into exit-1 for `Lint TypeScript`, `Build TypeScript`, `Test TypeScript`, `Coverage gate`, `check-prompts`, `check-architecture`, `docs_index.md sync check`, `Package skills for sibling harnesses`, `Installer unit tests`, `npm audit`, `init.sh`, `init.ps1`, and `fast-bench (rendering)` -- 15 jobs total.

Resolution: `npm install --no-audit --no-fund` at the repo root regenerated the lockfile with the missing entries; `git diff --stat package-lock.json` reports +44 packages added. The Phase 6 implementation itself was not broken -- only the lockfile was stale -- so this is a pure carryover hygiene fix that ships alongside Phase 7. The catalog file [docs/index.md](../../../index.md) was also regenerated to drop the now-stale `src/utils/` section that lingered from the Phase 3 codemod move (commit `f3429c4`); the `catalog:check` CI step would have started failing on this once `npm ci` was unblocked.

## 5. Outcome

### New files

- [desktop/src/modules/coding/panels/TimelineScrubber.tsx](../../../../desktop/src/modules/coding/panels/TimelineScrubber.tsx)
- [desktop/src/modules/coding/panels/SessionCompareView.tsx](../../../../desktop/src/modules/coding/panels/SessionCompareView.tsx)
- [desktop/tests/TimelineScrubber.test.tsx](../../../../desktop/tests/TimelineScrubber.test.tsx)
- [desktop/tests/SessionCompareView.test.tsx](../../../../desktop/tests/SessionCompareView.test.tsx)
- This document.

### Updated source files

- [desktop/src/modules/coding/panels/TraceDashboardPanel.tsx](../../../../desktop/src/modules/coding/panels/TraceDashboardPanel.tsx) (left-rail session list + compare picker + compare-mode switch; legacy event-list branch preserved).
- [desktop/src/modules/coding/CodingPage.tsx](../../../../desktop/src/modules/coding/CodingPage.tsx) (session-replay + compare state and IPC fan-out).
- [desktop/tests/panels.test.tsx](../../../../desktop/tests/panels.test.tsx) (3 new TraceDashboardPanel cases).
- [package-lock.json](../../../../package-lock.json) (lockfile sync for `@xenova/transformers` and 43 transitive deps -- carryover hygiene from Phase 5).
- [docs/index.md](../../../index.md) (catalog regen -- drops the stale `src/utils/` section).

### Updated documents

- [docs/versions/v1/v1.1.0/known-gaps.md](../../known-gaps.md): Phase 7 closure recorded under `## 2. Resolved`; cycle context + last-updated line bumped to 2026-05-20; `## 3. Summary` recomputed (16 open / 29 resolved / 45 total).
- [docs/DEVLOG.md](../../../DEVLOG.md): new top-level "Phase 7 -- Session replay timeline" entry.

### Test status

- 13 new tests (9 `TimelineScrubber` + 4 `SessionCompareView`) plus 3 new `TraceDashboardPanel` cases.
- Full desktop suite: 384 / 384 passing.
- Top-level suite: passing (exit code 0).
- Coverage on the three Phase 7 files: 97.79% / 100% / 99.59% lines -- comfortably above the 80% gate.

## 6. Known gaps after Phase 7

After Phase 7 the v1.1.0 known-gaps file has 16 open items + 29 resolved (was 16 + 28 after Phase 6). Phase 7 closes agentmemory A6 and introduces no new deferred items -- the IPC `coding.trace.subscribe({sessionId?})` contract was already in place from Phase 2 and the new components are pure consumers of that surface. The 16 open items are unchanged from Phase 6's end-state: 6 Phase-1 layout migrations + 3 Phase-4 producer/sidecar wirings + 3 Phase-5 retriever migrations + 4 Phase-6 `MemoryStore` adapter deferrals. All four Phase-6 deferrals remain clustered around the same upcoming `MemoryStore` adapter work (Phase 8 or 9).

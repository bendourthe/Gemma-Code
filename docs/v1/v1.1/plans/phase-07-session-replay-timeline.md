# Phase 7 -- Session replay timeline

**Goal**: Add a timeline scrubber to TraceDashboard so the user can replay a previous session step-by-step.
**Prerequisites**: Phase 4 (provenance), Phase 2 (live Memory / Trace data).
**Stability Gate**: TraceDashboard side-panel lists sessions; clicking opens a `<TimelineScrubber>` with play/pause/speed (0.5x / 1x / 2x / 4x); the playhead advances through trace events in order; a "Compare two sessions" mode renders side-by-side trace deltas; coverage on `TimelineScrubber.tsx` >= 80% lines.

**Adopts**: agentmemory A6 (see [comparison-agentmemory.md](../comparison-agentmemory.md)).

---

## Sub-tasks

### 7.1 -- Session list panel

**Objective**: Add a left-side session list in the TraceDashboard.

**Prompt**:
> Modify [desktop/src/modules/coding/panels/TraceDashboardPanel.tsx](../../../../desktop/src/modules/coding/panels/TraceDashboardPanel.tsx) to render a left-side session list (sourced from `coding.sessions.list` IPC -- already wired in Phase 2.7). Each row: session id (short hash), start time, duration, model used, event count. Selecting a session loads its events into a new `<TimelineScrubber>` view. Acceptance: a unit test with a fixture session list renders the rows correctly.

---

### 7.2 -- `<TimelineScrubber>` component

**Objective**: A scrubbable timeline with play/pause and variable speed.

**Prompt**:
> Add [desktop/src/modules/coding/panels/TimelineScrubber.tsx](../../../../desktop/src/modules/coding/panels/TimelineScrubber.tsx). UI: a horizontal slider spanning the session's wall-clock duration, with tick marks at each event's timestamp. Controls: Play/Pause toggle, Speed dropdown (0.5x / 1x / 2x / 4x), "Go to start" / "Go to end" buttons. Playback uses `requestAnimationFrame`: at each frame, advance the playhead by `(now - lastFrame) * speed`; emit the events the playhead just crossed into a `replayBus` (an in-component event emitter). The rest of the TraceDashboard (event detail pane, message list) subscribes to `replayBus` to render the current event. Acceptance: a unit test plays a synthetic 10-event session at 2x and asserts the playback completes in ~50% of wall-clock time; play/pause works.

---

### 7.3 -- "Compare two sessions" mode

**Objective**: Side-by-side timeline render of two selected sessions.

**Prompt**:
> Add a "Compare to..." button that opens a session-picker dialog. Selecting a second session splits the TraceDashboard into two columns, each with its own `<TimelineScrubber>`. The scrubbers are linked (one play/pause affects both); the speed control is shared. Below the timelines, a "Diff" pane shows event-by-event deltas at the current playhead position (e.g., session A fired `tool.pre web_search` at t=4.2s; session B fired `tool.pre fetch_page` at t=4.3s -- highlighted). Acceptance: a unit test renders two synthetic sessions and verifies the diff pane updates correctly when the playhead advances.

---

### 7.4 -- Phase 7 lint, build, test gate

**Objective**: Verify timeline replay is CI-green.

**Prompt**:
> Re-run the four-step gate. Verify the new component's coverage is >= 80% lines. Acceptance: 0 failures; coverage gate passes.

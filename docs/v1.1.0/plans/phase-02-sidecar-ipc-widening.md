# Phase 2 -- Sidecar IPC widening + `tauri::Channel` notifications

**Goal**: Replace every "in-memory client" placeholder with a sidecar-backed implementation. Add `tauri::Channel` notifications so Coding / Image / Video pillars subscribe to streaming events instead of polling.
**Prerequisites**: Phase 1 (shared core).
**Stability Gate**: Coding sessions stream tokens via channel (no polling); Image / Video diffusion jobs stream progress via channel; chat folders persist across restarts; Memory / Trace / Sessions panels surface live data; `models.list/install/remove/diskUsage/pin` round-trip end-to-end against the live registry; the in-memory diffusion runtime is decommissioned in favour of the child-process Python sidecar (closes 6.P1.HH / 7.P1.OO when the installer adds the venv in Phase 14); telemetry feeds a `tauri::Channel`.

---

## Sub-tasks

### 2.1 -- `tauri::Channel` Rust-side wiring

**Objective**: Add a `tauri::Channel<TauriIpcEvent>` to [desktop/src-tauri/src/sidecar.rs](../../../desktop/src-tauri/src/sidecar.rs) so the Node sidecar can emit server-initiated notifications.

**Prompt**:
> Replace the single-`ipc_call` (request/response) command with a pair: `ipc_call` (unchanged) and `ipc_subscribe(channel: tauri::Channel<TauriIpcEvent>)`. The sidecar accepts a subscribe call with a unique subscription id, then each subsequent event line from Node's stdout is forwarded into `channel.send(...)`. Define `TauriIpcEvent { subscriptionId: String, kind: String, payload: serde_json::Value }`. On the Node side, add `ipc.emitEvent(subscriptionId, kind, payload)` to the sidecar runtime API. Run a smoke test: from the desktop frontend, call `ipc.subscribe("test")`, have the sidecar emit 100 events, assert the channel listener receives all 100 in order. Acceptance: the round-trip test passes; `cargo clippy` is clean.

---

### 2.2 -- Streaming events for `coding.session.*`

**Objective**: Swap the response-envelope event batching in [desktop/sidecar/src/coding/sessionManager.ts](../../../desktop/sidecar/src/coding/sessionManager.ts) for channel-based streaming.

**Prompt**:
> Add `coding.session.subscribe({sessionId})` IPC method that returns a `subscriptionId`. The session manager forwards every `token` / `toolCallHeader` / `toolCallArgDelta` / `toolCallComplete` / `done` event through `ipc.emitEvent(subscriptionId, "coding.session.event", payload)`. The desktop frontend's [desktop/src/modules/coding/CodingPage.tsx](../../../desktop/src/modules/coding/CodingPage.tsx) replaces the event-array reducer with a `channel.onmessage` listener that feeds the existing `toolCallCard.applyEvents`. Drop the `events: []` field from the `sendMessage` response shape (the response now returns only `{sessionId}`). Update [tests/integration/coding-session-streaming.test.ts](../../../tests/integration/) to exercise the streaming path. Acceptance: a multi-tool-call session streams events in real time; no polling loops remain in the Coding pillar.

---

### 2.3 -- Streaming events for `diffusion.job.*` (image + video)

**Objective**: Same pattern for diffusion progress events.

**Prompt**:
> Add `diffusion.job.subscribe({jobId})` IPC method. The diffusion runtime client forwards every `progress` / `latent_preview` / `done` / `failed` event from the Python sidecar to the channel. The desktop pages [desktop/src/modules/image/ImageStudioPage.tsx](../../../desktop/src/modules/image/ImageStudioPage.tsx) and [desktop/src/modules/video/VideoLabPage.tsx](../../../desktop/src/modules/video/VideoLabPage.tsx) replace their 100 ms `drainEvents` polling loops with channel listeners. Acceptance: a Generate run streams progress in real time; no polling loops remain in the Image / Video pillars; the InMemoryDiffusionRuntime test path still works (it just runs through the same channel API in test mode).

---

### 2.4 -- `models.*` IPC handlers wired to NexusModelRegistry

**Objective**: Replace `mockModelsClient` with a real sidecar-backed client.

**Prompt**:
> In [desktop/sidecar/src/handlers.ts](../../../desktop/sidecar/src/handlers.ts), implement `models.list`, `models.install`, `models.remove`, `models.diskUsage`, `models.pin`, `models.isPinned` against the `NexusModelRegistry` instance constructed by `bootstrapCoding` ([desktop/sidecar/src/runtime/codingBootstrap.ts](../../../desktop/sidecar/src/runtime/codingBootstrap.ts)). Add the matching schema entries to [desktop/sidecar/src/protocol.ts](../../../desktop/sidecar/src/protocol.ts). Add a `sidecarModelsClient` adapter under [desktop/src/pages/settings/](../../../desktop/src/pages/settings/) that satisfies the existing `ModelsClient` interface; install progress flows through the new `diffusion.job.subscribe` channel pattern (re-shaped as `models.install.subscribe`). Wire [desktop/src/pages/settings/ModelsSettings.tsx](../../../desktop/src/pages/settings/ModelsSettings.tsx) to use the sidecar client by default; keep `createMockModelsClient` as the test-only fallback. Acceptance: from a clean dashboard launch, the Models page lists models from the live registry, an install action triggers a download with a progress bar, a remove deletes the on-disk artifact, the per-model "Keep loaded in VRAM" checkbox toggles the pin.

---

### 2.5 -- ChatExplorerStore sidecar adapter

**Objective**: Replace the `InMemoryChatExplorerClient` with a sidecar-backed client.

**Prompt**:
> Add `chat.explorer.listTree`, `chat.explorer.createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`, `createChat`, `renameChat`, `moveChat`, `deleteChat`, `search`, `ancestors` IPC methods to [desktop/sidecar/src/protocol.ts](../../../desktop/sidecar/src/protocol.ts) + a handler in `desktop/sidecar/src/chat/explorerManager.ts` that delegates to the root [modules/chat/storage/ChatExplorerStore.ts](../../../modules/chat/storage/ChatExplorerStore.ts) (better-sqlite3 backed). Add `desktop/src/modules/chat/sidecarChatExplorerClient.ts` that satisfies the existing client interface and wire it in place of the in-memory client across [desktop/src/modules/chat/ChatPage.tsx](../../../desktop/src/modules/chat/ChatPage.tsx), [desktop/src/modules/chat/FolderTree.tsx](../../../desktop/src/modules/chat/FolderTree.tsx), and the TopBar search. Acceptance: chats created in the desktop UI persist across an app restart; folder operations round-trip; the search bar finds folders + chats from disk.

---

### 2.6 -- ChatPage messages over `coding.session.*`

**Objective**: Replace the in-memory message echo with a real assistant response via the sidecar.

**Prompt**:
> Update `ChatPage.handleSubmit` ([desktop/src/modules/chat/ChatPage.tsx](../../../desktop/src/modules/chat/ChatPage.tsx)) to call `ipc.call("coding.session.sendMessage", { sessionId, message })` and subscribe to the streaming events via Phase 2.2's channel. The shared chat surface does not change; only `handleSubmit` swaps the local echo for an IPC dispatch. The four-layer memory layer is reached via the same path. Acceptance: a chat message in the Chat pillar produces a real assistant response from the chosen local model; memory writes appear in the Memory panel.

---

### 2.7 -- Memory / Trace / Sessions panels surface live data

**Objective**: Replace deterministic placeholder data with live `MemoryHub` / `TelemetryBus` reads.

**Prompt**:
> In [desktop/sidecar/src/coding/panelData.ts](../../../desktop/sidecar/src/coding/panelData.ts), replace the placeholder `memorySnapshot()` / `traceSubscribe()` / `sessionsList()` bodies with adapter calls into `MemoryHub` (Phase 4 will extend the schema; for now read the existing layers), `TelemetryBus` (subscribe and forward to the new IPC channel), and `SessionStore`. Reuse the existing `redactSecrets()` utility unchanged. The desktop panels under [desktop/src/modules/coding/panels/](../../../desktop/src/modules/coding/panels/) do not change. Acceptance: opening the Memory panel shows the user's actual stored entries; the Trace dashboard streams events from the running session; the Sessions list shows the actual session history.

---

### 2.8 -- TopBar memory search wired

**Objective**: Default Dashboard passes a real `MemorySearchAdapter` so the Memories group in the TopBar search activates.

**Prompt**:
> Add `desktop/src/lib/memorySearch.ts` that calls `ipc.call("memory.retrieve", { query, limit: 10, scopeId: null })`. The sidecar's `memory.retrieve` handler delegates to `MemoryHub.retrieve(query, {scopeId, limit})`. Wire `<Dashboard memoryAdapter={memorySearch}>` in [desktop/src/App.tsx](../../../desktop/src/App.tsx). The TopBar component is unchanged. Acceptance: typing a query in the TopBar search returns memory hits alongside folders + chats; the result-set ordering matches the existing tests.

---

### 2.9 -- Tauri Channel for telemetry

**Objective**: Replace the polling mock telemetry stream with a sidecar-backed channel.

**Prompt**:
> Add `telemetry.subscribe` IPC method. The sidecar wraps `core/telemetry/GpuTelemetrySource.ts` with a `ChildProcessGpuQuery` -- on Win/Linux uses the long-lived `nvidia-smi -lms 500` stream, on macOS uses one-shot `system_profiler` polling. The desktop frontend's [desktop/src/lib/telemetryStream.ts](../../../desktop/src/lib/telemetryStream.ts) swaps the deterministic mock for the channel listener. Keep the mock as a test-only path. Acceptance: the always-on Local Model Status widget shows live GPU %, free VRAM, active model; the live values update at 2 Hz; the test path still works.

---

### 2.10 -- Tauri allow-list for video outputs + MP4 playback

**Objective**: Whitelist `~/.nexus/outputs/videos/` in [desktop/src-tauri/tauri.conf.json](../../../desktop/src-tauri/tauri.conf.json) and wire `convertFileSrc()` in the Video Lab.

**Prompt**:
> Add `~/.nexus/outputs/videos/` (resolved per-OS) to the `tauri.security.fs.allow` list. Update the default `resolveMp4Url` in [desktop/src/modules/video/VideoLabPage.tsx](../../../desktop/src/modules/video/VideoLabPage.tsx) to wrap the path with `convertFileSrc()` from `@tauri-apps/api/core`. Acceptance: in a packaged Tauri build, the `<video>` element plays the generated MP4 directly.

---

### 2.11 -- Video Lab "Save As..." + "Use Last Frame" actions

**Objective**: Wire the Tauri `dialog` plugin for `Save As...` and add a `video.export.lastFrame` IPC.

**Prompt**:
> Add `dialog.save()` Tauri API binding for "Save As..." in [desktop/src/modules/video/VideoLabPage.tsx](../../../desktop/src/modules/video/VideoLabPage.tsx); add `video.save` IPC in the sidecar that copies the local MP4 to the user-chosen target. Add `video.export.lastFrame` IPC that calls the Python sidecar's existing pipeline output reader to harvest the final frame as a PNG; the desktop UI shows a "Send to Image Studio" button on completed clips. Acceptance: both actions work end-to-end on a real generated clip.

---

### 2.12 -- Dashboard notification bell wired to a real stream

**Objective**: Drive the always-on red-dot badge from a real notification source instead of always-on hard-coded.

**Prompt**:
> Add a `notificationStream` prop on the Dashboard ([desktop/src/pages/Dashboard.tsx](../../../desktop/src/pages/Dashboard.tsx)). The default stream subscribes to `lifecycle.notification` events on the Phase 4 HookBus (cross-phase dependency -- for now, the bell consumes `scheduler.job.failed` and `telemetry.budget.exceeded` events as the initial signal sources). Acceptance: the badge appears when a real failure event fires; it clears when the panel is opened.

---

### 2.13 -- Slash-command parity integration test

**Objective**: Now that the live runtime is reachable from the sidecar, run the canonical 12 slash commands in both the desktop module and the VS Code reference and assert identical outputs.

**Prompt**:
> Add `tests/integration/slashCommandParity.test.ts` that drives both code paths against a fixed model mock and asserts equality on the rendered `RenderedTurn` from `toolCallCard.applyEvents`. The 12 commands: `/plan`, `/clear`, `/commit`, `/review-pr`, `/curate`, `/trace`, `/thinking-mode`, `/skill-metrics`, `/memory`, `/verify`, `/research`, `/help`. Acceptance: all 12 parity tests pass.

---

### 2.14 -- @dnd-kit/core swap for FolderTree (bundled with Image Studio dnd surfaces -- soft dep)

**Objective**: When a future phase adds another drag-drop surface, swap the FolderTree from native HTML5 to `@dnd-kit/core` in the same commit. v1.1.0 carries this as a soft dep -- if Image Studio's canvas (Phase 12) adds a new dnd surface, do the swap; otherwise defer to v1.2.0.

**Prompt**:
> Evaluate after Phase 12. If the Image Studio canvas adds dnd, install `@dnd-kit/core` + `@dnd-kit/sortable`, replace the four `handleDragStart` / `handleDragOver` / `handleDrop` / `dragSourceRef` paths in [desktop/src/modules/chat/FolderTree.tsx](../../../desktop/src/modules/chat/FolderTree.tsx), and re-run the existing dnd unit tests. If Phase 12 does not add dnd, log this sub-task as deferred in [docs/v1.1.0/known-gaps.md](../known-gaps.md). Acceptance: same drag-drop behaviour as today, but powered by `@dnd-kit/core`.

---

### 2.15 -- Phase 2 lint, build, test gate

**Objective**: Verify the IPC + channel changes are CI-green across all three OS legs.

**Prompt**:
> Re-run the four-step gate. Acceptance: 0 failures; the polling loops in production paths are gone (audit by `grep -rn "drainEvents\|setInterval" desktop/src/modules/`); the channel listeners are the only event consumers.

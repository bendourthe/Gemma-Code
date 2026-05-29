# Phase 11 -- Nexus VS Code extension (multi-model agentic add-on)

**Goal**: Extend the Phase 10 thin adapter into a **full agentic surface inside VS Code** -- the spiritual successor to Gemma Code, but **selectable across all installed local models** (not just Gemma 4), with the same surfaces as the desktop Coding module: plan mode, auto mode, memory, skills, sub-agent handling, sessions, slash commands, MCP tools.
**Prerequisites**: Phase 2 (sidecar IPC), Phase 10 (thin-adapter rename).
**Stability Gate**: From a fresh VS Code window connected to the running Nexus daemon: (a) the user picks any installed model from the model dropdown (Gemma 4 / Llama 3.1 / Qwen 2.5 Coder / Phi-3.5 / ...) and starts a chat; (b) `/plan` produces a Plan-Mode artifact identical to what the desktop Coding module produces; (c) auto mode runs an end-to-end tool-using session; (d) the four-layer memory panel is reachable via a VS Code webview; (e) skills loaded into the daemon (DevAI-Hub baseline + user) are listed in slash-command autocomplete; (f) sub-agent invocations stream their progress; (g) sessions persist across the VS Code <-> daemon disconnect; (h) MCP tools resolve via the daemon's MCP harness; (i) settings sync from the desktop app's settings store -- one source of truth.

---

## Sub-tasks

### 11.1 -- Multi-model picker in the extension's chat panel

**Objective**: The chat panel renders a model dropdown that lists every installed local model (text models with chat capability), not just Gemma 4.

**Prompt**:
> Update the rebranded `NexusCodingPanel` webview ([modules/coding/panels/NexusCodingPanel.ts](../../../../../src/panels/) post-Phase-1.4 layout): the chat header includes a `<select>` populated from `ipc.call("models.list", { type: "text", capability: "chat" })`. Selection persists to `SettingsStore` key `nexus.coding.activeModel`. The Phase 10 thin adapter forwards messages with the chosen `modelId`; the desktop daemon routes to the right Ollama backend. Acceptance: with three installed text models (Gemma 4 E4B, Llama 3.1 8B, Qwen 2.5 Coder 7B), the dropdown shows all three; switching mid-session preserves history and re-routes new messages to the chosen model.

---

### 11.2 -- Plan mode parity

**Objective**: `/plan` in the extension produces the same artifact as the desktop module.

**Prompt**:
> The `/plan` slash command is already dispatched via the SlashCommandRouter; in proxy mode, the extension forwards the user message through `coding.session.sendMessage`. The daemon-side router runs Plan Mode and streams the resulting Plan-Mode artifact back; the extension renders it in the same webview (Plan Mode UI lives in `desktop/src/modules/coding/panels/PlanPanel.tsx` -- the extension's webview reuses a shared bundle). Add `desktop/src/modules/coding/panels/PlanPanel.bundle.ts` that builds a webview-compatible bundle of the Plan UI; the extension's `extension.ts` resolves the bundle path and serves it from the webview. Acceptance: `/plan add a feature flag for X` produces a Plan-Mode artifact identical to the desktop module's output (byte-equal trace events; visually-equal rendered panel).

---

### 11.3 -- Auto mode parity

**Objective**: Auto mode runs end-to-end inside the extension.

**Prompt**:
> Auto mode (the existing tool-using session flow under `AgentLoop._runAutoMode`) is daemon-resident; the extension proxies the user's initial message and subscribes to the streaming events via Phase 2.2's channel. The extension's webview renders the tool-call cards via the shared `toolCallCard` reducer. Acceptance: an integration test launches the extension against a mocked daemon, sends "fix the failing test in tests/unit/<file>.test.ts", and asserts the full event stream (token / toolCallHeader / toolCallArgDelta / toolCallComplete / done) flows through and renders correctly.

---

### 11.4 -- Memory panel webview

**Objective**: The extension exposes the four-layer Memory panel via a VS Code webview backed by daemon IPC.

**Prompt**:
> Reuse the `<MemoryPanel>` React component from [desktop/src/modules/coding/panels/MemoryPanel.tsx](../../../../../desktop/src/modules/coding/panels/MemoryPanel.tsx); compile it into a webview bundle (`MemoryPanel.bundle.ts`). The extension's `extension.ts` registers a view container `nexus.coding.memoryPanel` that opens the webview; the webview makes IPC calls into the daemon through the thin adapter's IPC bridge. The memory panel shows working / episodic / semantic / graph layers + the provenance chips from Phase 4.5. Acceptance: opening the Memory panel in the extension shows the same content as the desktop app's Memory panel; rows are interactive (Forget button works).

---

### 11.5 -- Skills + slash-command autocomplete parity

**Objective**: The extension's chat input shows all skills loaded in the daemon (DevAI-Hub baseline + user skills).

**Prompt**:
> The autocomplete is daemon-resident (see Phase 8.4); the extension's chat input forwards `tab` keystrokes for completion via `coding.chat.autocomplete` IPC and renders the resulting suggestions. `preferUpstream` setting respected. Acceptance: typing `/` in the extension's chat shows the same skill list as the desktop module; selecting a skill dispatches it correctly.

---

### 11.6 -- Sub-agent handling + sessions

**Objective**: Sub-agent invocations stream progress into the extension; sessions persist across the VS Code <-> daemon disconnect.

**Prompt**:
> Sub-agent spawns are daemon-resident events; the extension subscribes via Phase 4.2's HookBus events (`lifecycle.subagent.start` / `.stop`) plus the existing `coding.session.event` channel. Sessions are stored in the daemon's `SessionStore`; reconnecting the extension to a running daemon resumes the active session id from `SettingsStore.get("nexus.coding.activeSessionId")`. Acceptance: an integration test runs a session with a sub-agent invocation, closes the VS Code window, reopens it, and asserts the session list shows the prior session with full event history.

---

### 11.7 -- MCP tools resolved via the daemon

**Objective**: MCP tools registered with the daemon's MCP harness are usable from the extension.

**Prompt**:
> Add an `mcp.list` / `mcp.invoke` IPC pair to the daemon's protocol. The extension's tool-call rendering already treats MCP tools transparently (they look like any other tool call). Acceptance: a synthetic test registers an MCP tool with the daemon and confirms the extension can invoke it via a slash-command-driven tool call.

---

### 11.8 -- Settings sync (one source of truth)

**Objective**: Settings configured in the extension write back to the daemon's `SettingsStore`; the desktop app and the extension share one store.

**Prompt**:
> Add `settings.get(key)` / `settings.set(key, value)` IPC. The extension's Settings webview is a thin proxy. The desktop app's `SettingsPage` writes go through the same IPC (it already does, since the desktop is just a Tauri frontend over the same daemon). VS Code's own settings (those under `nexus.coding.*` in the VS Code Settings UI) are *secondary* mirrors: a `settings.sync` worker reconciles them on extension activation, surfacing differences as a one-time dialog. Acceptance: changing a setting in the desktop app (e.g. `nexus.diffusion.tierOverride = "diffusion-high"`) is visible in the extension's webview-rendered Settings; both write to the same SQLite-backed store.

---

### 11.9 -- Plan mode + auto mode UI parity tests

**Objective**: Snapshot tests assert byte-equal rendering between desktop and extension.

**Prompt**:
> Add `tests/integration/extension-desktop-parity.test.ts` that drives both surfaces against a recorded session and asserts byte-equal DOM snapshots for Plan Mode artifacts and Auto Mode tool-call cards. Acceptance: the test passes; any divergence between desktop and extension rendering is caught here.

---

### 11.10 -- Phase 11 lint, build, test, smoke gate

**Objective**: Verify the full Nexus VS Code extension surface is CI-green and smokes against a real running daemon.

**Prompt**:
> Re-run the four-step gate. Manual smoke: install the extension in a clean VS Code, launch the desktop app, verify (a)-(i) from the stability gate. Acceptance: 0 failures; the manual smoke checklist passes.

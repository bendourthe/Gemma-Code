# Phase 3 - Agentic AI Coding module + multi-LLM + thin VS Code adapter

**Goal**: The engine runs as the desktop Coding module via shell IPC; Llama 3 / Qwen 2.5 / Gemma 4 selectable as backends; the VS Code extension becomes a ~200-line adapter that proxies to the desktop daemon. IdleTimeScheduler wired.
**Prerequisites**: Phase 2.
**Stability Gate**: From the dashboard, "Open Code Assistant" launches the Coding module; an end-to-end "fix the failing test in `tests/unit/<file>.test.ts`" task succeeds against each of the three model backends; the legacy `nexus-coding` VS Code extension still works against the new daemon.

---

## Sub-tasks

### 3.1 - Wire the Coding module behind the shell IPC

**Objective**: Expose the existing AgentLoop + ToolRegistry + ChatController via the sidecar IPC protocol so the Tauri shell can drive coding sessions.

**Prompt**:
> Extend the IPC contract from Phase 1.5 with the full Coding-module surface. Add methods: `coding.session.start(opts)` returns a `sessionId`; `coding.session.sendMessage(sessionId, msg)` streams agent output as `coding.session.event` notifications (token / toolCallHeader / toolCallArgDelta / toolCallComplete / done); `coding.session.cancel(sessionId)`; `coding.session.list()`; `coding.session.resume(sessionId)`. In the sidecar at `desktop/sidecar/src/handlers/coding.ts`, instantiate `NexusCodingRuntime` (renamed in 2.7) once per process and route IPC calls into it. The streaming protocol matches the existing webview protocol union from `src/panels/webview/render/protocol.ts` - reuse the types via a shared package or copy. In the frontend at `desktop/src/modules/coding/CodingPage.tsx`, build the chat UI: message list, input box, model selector dropdown (Gemma 4 / Llama 3 / Qwen 2.5 - populated from `ModelRegistry.list({type: 'llm'})`), tool-call cards rendering the new header / arg-stream / result protocol (closes `[v0.9.0:10.N.B]`). Acceptance: from the dashboard, clicking "Open Code Assistant" lands on `/coding`, the user can send a message, see streaming tokens + tool-call cards, and cancel a running task.

---

### 3.2 - Multi-LLM backend support (Llama 3 + Qwen 2.5)

**Objective**: Extend the existing `LLMClient` port with Llama 3 and Qwen 2.5 adapters using Ollama as the runtime; expose backend selection in the model dropdown.

**Prompt**:
> Today the engine supports Gemma 4 (via `OllamaClient`) and an LM Studio backend (v0.8.0). Extend the Ollama adapter to handle Llama 3.1, Llama 3.2, Llama 3.3, Qwen 2.5, Qwen 2.5 Coder, and DeepSeek Coder model families. For each family: (a) verify the chat template + tool-call format that Ollama exposes (use the model's modelfile template); (b) add the model to `core/registry/models.json` with default sampling parameters (temperature, top-p, top-k, context length); (c) extend `PromptBuilder` to emit the correct prompt format per model family (Gemma 4's `<|tool_call>` tokens differ from Llama 3's ChatML and Qwen's `<|im_start|>`). Add a `ModelFamily` enum and a `PromptFormat` strategy per family. The existing tool-call protocol is wrapped so each family's native tool format is parsed back into the engine's internal `ToolCall` representation. Acceptance: a golden-task run against each of `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b` produces the same `read_file` -> `apply_edit` trajectory on the canonical "fix the failing test" task.

---

### 3.3 - VS Code extension thin adapter

**Objective**: Reduce the VS Code extension to a thin adapter that proxies to the desktop daemon; keep the marketplace listing live as a fallback surface.

**Prompt**:
> Reduce the VS Code extension surface to a thin client. Move the bulk of the engine code to the desktop daemon (already done in Phase 2's `core/` + `modules/coding/` split). The extension at `src/extension.ts` becomes a ~200-line adapter that: (a) on activation, checks if the Nexus desktop daemon is running by connecting to a localhost UNIX socket / named pipe; (b) if absent, prompts the user to install / launch Nexus Desktop with a link to the installer; (c) if present, opens an IPC connection and proxies all chat / panel / tool calls into the daemon, displaying responses in the existing webview shells (`NexusCodingPanel`, `MemoryPanel`, `TraceDashboardPanel`). The webview HTML stays in the extension package; the data plane goes through the daemon. Local fallback: if the daemon is not running and the user opts into "extension-only mode", the engine runs in-process exactly as it did in v0.22.x. Acceptance: the VS Code extension still works in extension-only mode (regression check); when Nexus Desktop is running, the extension connects to the daemon and a coding session can be driven from VS Code while the dashboard shows the same session in the desktop app.

---

### 3.4 - IdleTimeScheduler wiring (closes [v0.9.0:10.N.Q])

**Objective**: Instantiate `IdleTimeScheduler` in the desktop daemon's bootstrap and wire the curator + reflect workers; remove the legacy edit-trigger fallback in `AgentLoop`.

**Prompt**:
> The `IdleTimeScheduler` module ships in `src/agents/IdleTimeScheduler.ts` with full unit-test coverage but was never wired into a composition root (per `[v0.9.0:10.N.Q]`). In the desktop sidecar at `desktop/sidecar/src/runtime/CodingBootstrap.ts`, instantiate the scheduler with an `activitySource` that subscribes to coding-session events (message start, message end, tool call), register the curator worker (idle 5 min / cadence 12 h) and the reflect worker (idle 10 min / cadence 24 h), and call `start()` after the daemon boots. Once the scheduler is wired and integration-tested, delete the legacy curator-cadence fallback in `modules/coding/tools/AgentLoop.ts._runOneIteration` (the post-N-edits dispatch). Add a Settings UI toggle at `nexus.curator.enabled` (default `true`). Acceptance: a 30-minute simulated idle session triggers the curator worker exactly once at the 5-minute mark; the legacy fallback is removed; integration test asserts the scheduler-driven path is the only curator entry point.

---

### 3.5 - Module-internal panels (Memory, Trace, Sessions)

**Objective**: Port the existing Memory / TraceDashboard / SessionList panels from the VS Code webview shells into the desktop Coding module routes.

**Prompt**:
> Port the four existing engine panels into the desktop Coding module. In `desktop/src/modules/coding/panels/`: `MemoryPanel.tsx` (renders the four memory layers + the new `anticipated` + `proposedSkills` sections from `[v0.9.0:10.N.C]`); `TraceDashboardPanel.tsx` (live trace events, secret-path redaction preserved); `SessionListPanel.tsx` (browse + resume past coding sessions). Each panel consumes data via the IPC protocol (new methods: `coding.memory.snapshot`, `coding.trace.subscribe`, `coding.sessions.list`). The Coding module's left rail lets the user switch between Chat / Memory / Trace / Sessions tabs. Reuse the existing `MemoryPanel` host-side handlers from `modules/coding/panels/MemoryPanel.ts` - only the frontend HTML rewrites. Closes `[v0.9.0:10.N.C]` (anticipated + proposedSkills fields rendered). Acceptance: from the desktop Coding module, all four tabs render real data from a running session; secret-path redaction confirmed by a Trace test that injects a fake AWS key and asserts the redacted form is shown.

---

### 3.6 - Slash command parity in desktop

**Objective**: Carry the v0.5.0 - v0.9.0 slash commands (`/plan`, `/commit`, `/review-pr`, `/curate`, `/trace`, `/thinking-mode`, `/skill-metrics`, `/memory ...`, etc.) into the desktop Coding chat input.

**Prompt**:
> The existing slash-command parser lives in `modules/coding/chat/SlashCommandRouter.ts`. Wire it into the desktop chat input at `desktop/src/modules/coding/CodingInput.tsx` so that typing `/` opens an autocomplete dropdown listing every command + skill from the `SkillCatalog`. Selecting a command pre-fills the chat input. Execution path: command -> IPC `coding.session.sendMessage` -> router parses + dispatches exactly as it does today in the VS Code webview. Verify each existing slash command in the catalog produces the same behavior in the desktop as in the VS Code extension. Acceptance: an integration test runs each of the 12 most-used slash commands (`/plan`, `/clear`, `/commit`, `/review-pr`, `/curate --dry-run`, `/trace status`, `/thinking-mode think`, `/skill-metrics`, `/memory status`, `/verify`, `/research`, `/help`) and asserts identical outputs against the VS Code reference.

---

### 3.7 - Testing and Stabilization

**Objective**: Generate and run all tests for Phase 3. Iterate until stable.

**Prompt**:
> Generate comprehensive tests for everything built in Phase 3. Include: unit tests for the new IPC protocol handlers in `desktop/sidecar/src/handlers/coding.ts`; unit tests for the Llama 3 / Qwen 2.5 prompt formatters and tool-call parsers; integration tests against a mocked Ollama returning canned model responses for each family; an E2E golden-task run against three live models (operator-driven, deferred to a tagged operator action in `docs/versions/v1/v1.0.0/operator-actions.md`); unit tests for the VS Code thin adapter's daemon-discovery + fallback paths; integration test for the IdleTimeScheduler wiring (synthetic 30-min idle); coverage gate at lines >= 80, functions >= 80 across `modules/coding/`. Run the test suite, fix all failures, iterate until every test passes. After all tests pass, run `/generate-session-history` to document Phase 3.

---

### Phase 3 Exit Checklist

- [ ] All sub-tasks completed
- [ ] Three model backends work end-to-end (Gemma 4 / Llama 3.1 / Qwen 2.5 Coder)
- [ ] VS Code thin adapter connects to the daemon
- [ ] IdleTimeScheduler wired; legacy fallback removed
- [ ] Memory / Trace / Sessions panels render in the desktop module
- [ ] Slash-command parity verified
- [ ] Coverage gate green
- [ ] Session history generated for Phase 3
- [ ] Ready to advance to Phase 4

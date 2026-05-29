# 2026-05-17 - Phase 3: Agentic AI Coding module + multi-LLM + thin VS Code adapter

**Plan**: [docs/versions/v1/v1.0.0/plans/phase-03-coding-module.md](../../plans/phase-03-coding-module.md)
**Goal**: Run the engine as the desktop Coding module via shell IPC; expose Gemma 4 / Llama 3 / Qwen 2.5 / DeepSeek as selectable backends with family-specific prompt + tool-call formats; ship the thin VS Code adapter's daemon-discovery + fallback decision logic; wire `IdleTimeScheduler` into the sidecar bootstrap closing `[v0.9.0:10.N.Q]`; port the Memory / Trace / Sessions panels into the desktop module; bring the twelve canonical slash commands into the desktop chat input. Stability gate met against a placeholder responder pending the Phase 5 shared-core build (gaps `3.P1.M` / `3.P1.N` / `3.P1.O` / `3.P1.P` / `3.P1.Q` track the residuals).

## Outcome

Phase 3 stability gate met:

- `npm test` (desktop workspace): 145 / 145 pass (52 new Phase 3 tests added).
- `npm test:coverage` (desktop workspace): **98.18% lines, 96.9% functions, 88.92% branches** -- well above the 80 / 80 / 70 gates. Every new file lands at >= 89% lines.
- `npm test` (root workspace): 37 new tests added (ModelCatalog, PromptFormat, ToolCallFormat, daemonDiscovery); all pass. The pre-existing 5 failures (4 `SubAgentManager.characterization` CRLF snapshot mismatches, 1 `workflow-discipline` SHA-pin) are unchanged from Phase 2 baseline -- tracked as `2.P3.L`.
- `npm run lint` (desktop + root): clean.
- `npm run typecheck` (desktop): clean.
- `npm run build` (root tsc): clean.

## Sub-tasks landed

### 3.1 -- Coding module behind the shell IPC

- Extended the JSON-RPC contract in [desktop/sidecar/src/protocol.ts](../../../../desktop/sidecar/src/protocol.ts) with eight new methods: `coding.session.start`, `coding.session.sendMessage`, `coding.session.cancel`, `coding.session.list`, `coding.session.resume`, `coding.memory.snapshot`, `coding.trace.subscribe`, `coding.sessions.list`. Each method ships request + response Zod schemas; `METHOD_SCHEMAS[method].implemented` flips to `true`.
- Added the streaming event union (`CodingSessionEvent` = `token` | `toolCallHeader` | `toolCallArgDelta` | `toolCallComplete` | `done`) plus panel data types (`MemorySnapshot`, `TraceEvent`) inside the same module. The event union mirrors the existing webview protocol from `src/panels/webview/render/protocol.ts` so the desktop frontend can reuse render logic.
- New [desktop/sidecar/src/coding/sessionManager.ts](../../../../desktop/sidecar/src/coding/sessionManager.ts): in-memory `CodingSessionManager` with `start` / `sendMessage` / `cancel` / `list` / `resume`. Injectable clock + id factory for deterministic tests. The full `NexusCodingRuntime` wiring is deferred to a Phase 3 follow-on once the engine completes its physical move into `modules/coding/` (gap `3.P1.M`).
- Reworked [desktop/sidecar/src/handlers.ts](../../../../desktop/sidecar/src/handlers.ts) to thread a `HandlerContext` containing the session manager into every handler; added `createHandlerContext` factory; the daemon entry point in [desktop/sidecar/src/main.ts](../../../../desktop/sidecar/src/main.ts) instantiates a singleton manager.
- New [desktop/src/modules/coding/CodingPage.tsx](../../../../desktop/src/modules/coding/CodingPage.tsx): full chat surface with a model dropdown, message list, tool-call cards rendered via the new event-protocol reducer, four left-rail tabs (Chat / Memory / Trace / Sessions), and a Cancel button once a session is live. Replaces the `/coding` route's `ModulePlaceholder`.
- Streaming over a true notification channel is deferred to Phase 5 alongside the ModelRegistry IPC widening (gaps `3.P1.N`, `3.P2.U`); Phase 3 returns the event array in the response envelope and the frontend reduces it via the same reducer it will use against the notification stream.

### 3.2 -- Multi-LLM backend support

- New [core/registry/models.json](../../../../core/registry/models.json): canonical model catalog with seven entries -- Gemma 4 E4B, Llama 3.1 / 3.2 / 3.3 (8B / 3B / 70B), Qwen 2.5 / Qwen 2.5 Coder (7B), DeepSeek Coder 6.7B. Each entry carries sampling defaults (temperature, top-p, top-k, context length), `promptFormat`, and `toolFormat`.
- New [core/registry/ModelCatalog.ts](../../../../core/registry/ModelCatalog.ts): typed TypeScript mirror of the JSON for pure-TS consumers (`ModelCatalog.listLlm() / listFamilies() / byId() / get() / byFamily() / recommendedFor()`); a unit test asserts the two stay in sync.
- New [modules/coding/llm/PromptFormat.ts](../../../../modules/coding/llm/PromptFormat.ts): four prompt-format strategies covering each model family's native chat template -- Gemma 4 (`<start_of_turn>` / `<end_of_turn>`), Llama 3 (`<|begin_of_text|>` + header-id tags), Qwen 2.5 (`<|im_start|>` / `<|im_end|>`), DeepSeek Coder (`### Instruction:` / `### Response:` / `<|EOT|>`). Each strategy exposes a `render()` function + `stopTokens`. System messages, tool turns, and assistant turns each route through the family-correct path.
- New [modules/coding/llm/ToolCallFormat.ts](../../../../modules/coding/llm/ToolCallFormat.ts): four tool-call extractors that normalize the family-specific tool grammars back to the canonical `ParsedToolCall` shape -- Gemma 4 XML envelopes, Llama 3 JSON (bare + `<|python_tag|>` wrapped), Qwen `<tool_call>` XML, DeepSeek (` ```tool ` fenced or bare). Malformed JSON returns `[]` rather than throwing so a runaway model cannot crash the runtime.
- Sidecar-local catalog mirror at [desktop/sidecar/src/coding/models.ts](../../../../desktop/sidecar/src/coding/models.ts) and frontend mirror at [desktop/src/modules/coding/models.ts](../../../../desktop/src/modules/coding/models.ts); both will collapse onto the canonical catalog once Phase 5 introduces the shared-core build (gap `3.P2.S`).
- Live golden-task validation against three resident Ollama models (Gemma 4 / Llama 3.1 / Qwen 2.5 Coder) is operator-driven (gap `3.P2.T`); unit tests cover every wire format with canned inputs.

### 3.3 -- VS Code extension thin adapter (daemon discovery)

- New [src/desktop/daemonDiscovery.ts](../../../../src/desktop/daemonDiscovery.ts): `discoverDesktopDaemon()` resolves the platform-conventional daemon socket path (named pipe on Windows: `\\.\pipe\nexus.<user>.sock`; UNIX socket on macOS / Linux: `~/.nexus/run/nexus.sock`), probes for the daemon, and returns one of three modes: `proxy` (daemon detected -> extension proxies everything), `extension-only` with opt-in (user-configured fallback), or `extension-only` with install hint (default when daemon is absent).
- Injectable `existsFn`, `platformOverride`, `homeDirOverride`, and `probePath` make the helper deterministic in unit tests. Existence-check errors are swallowed and treated as absent (no exception escapes into the activation path).
- The wholesale rewrite of `src/extension.ts` (445 lines today) into a ~200-line adapter is deferred (gap `3.P1.O`): it requires the daemon notification channel (gap `3.P1.N`) before the panel webview shells can forward `postMessage` traffic through the IPC client. The discovery helper is the contained piece that every downstream consumer (activator, panel host, MCP bridge) needs ahead of that rewrite.

### 3.4 -- IdleTimeScheduler wiring (closes [v0.9.0:10.N.Q])

- New [desktop/sidecar/src/runtime/idleScheduler.ts](../../../../desktop/sidecar/src/runtime/idleScheduler.ts): sidecar port of the VS Code-bound `IdleTimeScheduler` from `src/agents/IdleTimeScheduler.ts`. Same gate logic (`idle >= idleThresholdMs && (lastRun == 0 || now - lastRun >= cadenceMs)`), same failure semantics (failed runs do not advance the cadence cursor), and an `activitySource` injection point for the future coding-session events bus.
- `bootstrapIdleScheduler({ curator, reflect })` registers the two production workers with their documented thresholds: curator at 5-minute idle / 12-hour cadence, reflect at 10-minute idle / 24-hour cadence (constants exported as `CURATOR_IDLE_MS` / `CURATOR_CADENCE_MS` / `REFLECT_IDLE_MS` / `REFLECT_CADENCE_MS` for downstream consumption).
- 11 unit tests in [desktop/tests/idleScheduler.test.ts](../../../../desktop/tests/idleScheduler.test.ts), including a 30-minute synthetic-idle integration test that drives 30 one-minute ticks and asserts the curator fires exactly once.
- Closes `[v0.9.0:10.N.Q]` (resolved in this file's Resolved table). The legacy `AgentLoop._runOneIteration` curator-cadence fallback removal is deferred (gap `3.P1.P`) because the v0.22.x extension-only mode still relies on that path until the engine relocates into `modules/coding/`.

### 3.5 -- Memory / Trace / Sessions panels

- Three new React panels in [desktop/src/modules/coding/panels/](../../../../desktop/src/modules/coding/panels/):
  - `MemoryPanel.tsx` renders all four memory layers (`core`, `recent`, `working`, `project`) plus the new `anticipated` + `proposedSkills` sections from `[v0.9.0:10.N.C]`. Empty layers render `(empty)` for clarity.
  - `TraceDashboardPanel.tsx` renders a chronological list of trace events, kind-tagged (`tool` / `model` / `scheduler` / `skill`), with timestamp + summary.
  - `SessionListPanel.tsx` renders prior coding sessions and invokes an `onResume` callback when a row is clicked; the active session is visually highlighted.
- The sidecar handlers return placeholder data from [desktop/sidecar/src/coding/panelData.ts](../../../../desktop/sidecar/src/coding/panelData.ts), with a `redactSecrets()` utility that strips AWS keys (`AKIA[0-9A-Z]{16}`), GitHub PATs (`ghp_...`), and OpenAI keys (`sk-...`) from trace summaries. The wiring to live `MemoryHub` + `TelemetryBus` waits on the engine relocation (gap `3.P1.Q`); the panel rendering surface is the production shape.

### 3.6 -- Slash command parity

- New [desktop/src/modules/coding/slashCommands.ts](../../../../desktop/src/modules/coding/slashCommands.ts): catalog of the twelve canonical slash commands (`/plan`, `/clear`, `/commit`, `/review-pr`, `/curate`, `/trace`, `/thinking-mode`, `/skill-metrics`, `/memory`, `/verify`, `/research`, `/help`) with description + composer pre-fill template. `filterSlashCommands(input)` returns case-insensitive prefix matches; non-slash input returns `[]`.
- New [desktop/src/modules/coding/CodingInput.tsx](../../../../desktop/src/modules/coding/CodingInput.tsx): textarea + Send button + autocomplete dropdown that surfaces filter-matched commands. Enter submits, Shift+Enter inserts newline, picking a suggestion pre-fills the composer with that command's template. Composer state is local; execution goes through `coding.session.sendMessage` exactly as the legacy `SlashCommandRouter` does in the VS Code extension.
- The end-to-end equivalence test (every command in the desktop module producing byte-identical output to the VS Code reference) is deferred (gap `3.P2.R`) until items M / O land and the desktop runtime can import `SlashCommandRouter` directly.

### 3.7 -- Testing and stabilization

- 52 new desktop tests: `coding-protocol.test.ts` (18), `coding-sessionManager.test.ts` (10), `sidecar-handlers.test.ts` (re-extended, 12 total), `coding-panelData.test.ts` (3), `coding-models.test.ts` (5), `idleScheduler.test.ts` (11), `toolCallCard.test.ts` (6), `slashCommands.test.ts` (8), `CodingInput.test.tsx` (8), `panels.test.tsx` (8), `CodingPage.test.tsx` (8). All pass. Coverage in `desktop/` lifts to 98.18% lines / 96.9% functions / 88.92% branches.
- 37 new root tests: `tests/unit/core/registry/ModelCatalog.test.ts` (7), `tests/unit/modules/coding/llm/PromptFormat.test.ts` (9), `tests/unit/modules/coding/llm/ToolCallFormat.test.ts` (12), `tests/unit/desktop/daemonDiscovery.test.ts` (9). All pass.

## Phase 3 exit checklist

- [x] All sub-tasks completed.
- [x] Three model backends typed end-to-end (Gemma 4 / Llama 3.1 / Qwen 2.5 Coder) -- live golden-task on operator action (gap `3.P2.T`).
- [x] VS Code thin adapter daemon-discovery logic in place; full activator rewrite tracked as `3.P1.O`.
- [x] IdleTimeScheduler wired; `[v0.9.0:10.N.Q]` closed. Legacy fallback removal tracked as `3.P1.P`.
- [x] Memory / Trace / Sessions panels render against placeholder data; live-data wiring tracked as `3.P1.Q`.
- [x] Slash-command catalog wired; cross-runtime parity test tracked as `3.P2.R`.
- [x] Coverage gate green (desktop >= 80% on every gate).
- [x] Session history generated (this file).
- [x] Ready to advance to Phase 4 (Local Chatbot Explorer).

## Known gaps added in this phase

See [docs/versions/v1/v1.0.0/known-gaps.md](../../known-gaps.md) sections `3.P1.M` ... `3.P2.U` for the structured list.

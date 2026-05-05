# ADR-0008: Panel decomposition (ChatController + ChatWebviewHost + handlers)

- **Status**: Accepted (2026-05-04)
- **Deciders**: Benjamin Dourthe (project owner) — codifies the v0.6.0 Phase 6 split of `GemmaCodePanel.ts`

## Context

By the end of v0.5.0 [src/panels/GemmaCodePanel.ts](../../src/panels/GemmaCodePanel.ts) had grown to 1,724 lines holding the agent-loop wiring, the slash-command dispatch (a 600-line `switch`), the webview lifecycle (sidebar `WebviewView` + optional editor-area `WebviewPanel`), the postMessage routing, the plan-mode handling, the orchestrator path, the sub-agent verification trigger, and the memory injection. The companion file [src/panels/webview/index.ts](../../src/panels/webview/index.ts) was 1,573 lines of HTML + CSS + inline runtime IIFE in a single `getWebviewHtml` template literal.

The codebase-review pass surfaced this as findings #2 and #3 (single-file dragon hoard; webview template hard to navigate). Phase 4 (module-boundary ratchet) deferred its panel-storage cleanup explicitly to Phase 6 so the messaging port could be designed once during the split rather than retrofitted twice. Three forces drove the work:

1. **Test surface.** The panel had no unit tests; it was tested only through integration. Every change in slash-command behaviour required spinning up the full panel mock graph.
2. **Reasoning load.** New contributors had to read the entire 1,724-line file to find one feature. The line target in the plan (< 400 lines) reflected the cognitive ceiling, not a hard rule.
3. **Coupling drift.** The panel grew because every cross-cutting feature (memory, MCP, orchestrator) found it convenient to add another private method. Without explicit module boundaries the next addition would be more of the same.

## Decision

Decompose the panel into four modules with explicit responsibilities:

- **[src/panels/GemmaCodePanel.ts](../../src/panels/GemmaCodePanel.ts)** — composition root. Owns the deeply-coupled construction graph (memory subsystem -> streaming pipeline -> agent loop -> orchestrator -> sub-agent manager, all sharing a single OllamaClient), the VS Code lifecycle hooks (`resolveWebviewView`, `attachToWebviewPanel`), and the dependency wiring. Delegates flow to `ChatController` and surface to `ChatWebviewHost`.
- **[src/panels/ChatController.ts](../../src/panels/ChatController.ts)** — chat flow. Owns `submitUserMessage`, `cancelInFlight`, `approveStep`, plan detection, memory injection. Composes a `ChatCommandHandlers` instance internally. Receives dependencies through a `ChatControllerContext` getter bag.
- **[src/panels/ChatCommandHandlers.ts](../../src/panels/ChatCommandHandlers.ts)** — slash-command dispatch. Twelve commands (`help`, `clear`, `history`, `plan`, `compact`, `model`, `memory`, `mcp`, `verify`, `research`, `cache`, `operation-log`). Each dispatch path is a function over a `ChatCommandContext` interface.
- **[src/panels/ChatWebviewHost.ts](../../src/panels/ChatWebviewHost.ts)** — webview surface lifecycle. Owns the sidebar `WebviewView` and the optional editor-area `WebviewPanel`, the streaming-vs-broadcast routing rule (route to focused if focused, else broadcast for non-streaming events), HTML scaffolding via `getWebviewHtml`, and the rehydrate-on-show callback.

Decompose the webview template at the source level into [scaffold.ts](../../src/panels/webview/scaffold.ts) (HTML composer + `formatModelName`), [styles.ts](../../src/panels/webview/styles.ts) (CSS), [bodyMarkup.ts](../../src/panels/webview/bodyMarkup.ts) (HTML body), [runtime.ts](../../src/panels/webview/runtime.ts) (inline IIFE). [src/panels/webview/index.ts](../../src/panels/webview/index.ts) becomes a 12-line back-compat re-export shim so external callers (none in-tree, but kept for safety) continue to import `getWebviewHtml` from the same path.

The chat-controller takes a *flow-only* split, not a *full ownership* split. The plan called for the controller to own agent-loop / pipeline / orchestrator instantiation; we kept construction in the panel and route invocations through the controller via getter callbacks. The panel owns the **wiring**, the controller owns the **flow**. Hoisting wiring inward would have required a second large refactor of the constructor itself; that is logged as a v0.7.0 follow-up.

## Consequences

**Positive**

- `GemmaCodePanel.ts` shrank from 1,724 to 935 lines (-46%). The remaining bulk is constructor wiring + init factories that does not naturally fit any of the three extracted modules.
- 59 new unit tests landed across [tests/unit/panels/ChatController.test.ts](../../tests/unit/panels/ChatController.test.ts), [tests/unit/panels/ChatCommandHandlers.test.ts](../../tests/unit/panels/ChatCommandHandlers.test.ts), [tests/unit/panels/ChatWebviewHost.test.ts](../../tests/unit/panels/ChatWebviewHost.test.ts). The handlers module reaches 86% statements / 70% branches; the host reaches 99% / 100%.
- The webview source split makes individual surface changes (a CSS tweak, a new postMessage branch) localised. The runtime IIFE is no longer interleaved with the HTML body.
- Each new module declares its dependency surface explicitly via the `ChatCommandContext` / `ChatControllerContext` interfaces. New cross-cutting features have to declare what they consume; they cannot quietly import another panel field.

**Negative**

- The < 400-line target from the plan is a partial deviation. The remaining 935 lines of `GemmaCodePanel.ts` are wiring that resists further extraction without re-architecting the `OllamaClient` sharing model. v0.7.0 will revisit.
- The controller-as-flow / panel-as-wiring split adds a small indirection: a feature that adds a new flow has to thread it through both modules. Compared to the prior monolith this is a rounding error, but it is a small mental tax.
- Sub-task 6.5 (filesystem.ts split) was deferred per the plan's "lower-priority" note. Filesystem tools remain in a single file; tracked as v0.7.0 follow-up.

**Neutral**

- The 12-line `index.ts` shim is intentional. Removing it would force a follow-up commit to update any out-of-tree caller; the marginal cost of the shim is < 100 bytes.

## Alternatives considered

- **Keep `GemmaCodePanel.ts` and add per-feature mixins.** Rejected: TypeScript mixins fight the strict-mode contract; the resulting type intersections are harder to read than the monolith they replace.
- **Build a router-style command dispatcher with auto-registered handlers.** Rejected: 12 slash commands do not justify a registry pattern. A `dispatch(name, args)` switch is two extra lines per new command and stays grep-friendly.
- **Split the webview at the build-time level (separate `.ts` -> bundler -> single IIFE).** Rejected: VS Code webviews load a single resource via `<script src="...">`; introducing a bundler step for one inline IIFE is more infrastructure than the problem warrants. The source-level split achieves the same readability win.
- **Hoist agent-loop / pipeline / orchestrator construction into `ChatController` (full ownership split).** Deferred to v0.7.0: the construction graph shares a single `OllamaClient` across five layers. Hoisting it requires re-architecting the `OllamaClient` injection pattern and is a larger commit than Phase 6 had budget for.

## Links

- Implementation: [src/panels/GemmaCodePanel.ts](../../src/panels/GemmaCodePanel.ts), [src/panels/ChatController.ts](../../src/panels/ChatController.ts), [src/panels/ChatCommandHandlers.ts](../../src/panels/ChatCommandHandlers.ts), [src/panels/ChatWebviewHost.ts](../../src/panels/ChatWebviewHost.ts)
- Webview split: [src/panels/webview/scaffold.ts](../../src/panels/webview/scaffold.ts), [src/panels/webview/styles.ts](../../src/panels/webview/styles.ts), [src/panels/webview/bodyMarkup.ts](../../src/panels/webview/bodyMarkup.ts), [src/panels/webview/runtime.ts](../../src/panels/webview/runtime.ts), [src/panels/webview/index.ts](../../src/panels/webview/index.ts)
- Tests: [tests/unit/panels/ChatController.test.ts](../../tests/unit/panels/ChatController.test.ts), [tests/unit/panels/ChatCommandHandlers.test.ts](../../tests/unit/panels/ChatCommandHandlers.test.ts), [tests/unit/panels/ChatWebviewHost.test.ts](../../tests/unit/panels/ChatWebviewHost.test.ts)
- Phase 6 history: [docs/v0.6.0/development/history/2026-05_phase-6-panel-decomposition.md](../v0.6.0/development/history/2026-05_phase-6-panel-decomposition.md)
- v0.6.0 Phase 6 plan: [docs/v0.6.0/plans/v0.6.0-cycle.md](../v0.6.0/plans/v0.6.0-cycle.md) sub-tasks 6.1-6.6
- Codebase-review findings closed: #2, #3, #16, #23

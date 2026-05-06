# ADR-0011: OllamaClient injection via GemmaRuntime composition root

- **Status**: Accepted (2026-05-05)
- **Deciders**: Benjamin Dourthe (project owner) — codifies the v0.7.0 Phase 0 sub-task 0.4 hoist of the chat-panel construction graph

## Context

By the end of v0.6.0 [src/panels/GemmaCodePanel.ts](../../src/panels/GemmaCodePanel.ts) had shrunk from 1,724 to 935 lines but the remaining bulk was constructor wiring: ten dependent subsystems (ConversationManager, ContextCompactor, SubAgentManager, Orchestrator, AgentLoop, StreamingPipeline, MemorySubsystem, ConfirmationGate, ToolRegistry, MCP) all reaching into the panel's private fields and into the same `OllamaClient` instance via `this._runtime.getOllamaClient()`. ADR-0008 explicitly logged the < 400-line target as a partial deviation and deferred the "full ownership split" to v0.7.0 because hoisting required re-architecting the OllamaClient sharing model.

Three forces drove the v0.7.0 cleanup:

1. **Reasoning load.** The 935-line panel still hosted the full agent-loop construction graph (ten subsystems) inline in its constructor. Reading any single subsystem's wiring required navigating a 280-line constructor body.
2. **Test surface.** The construction graph had no targeted unit tests. Verifying that `GemmaRuntime` actually owned the `OllamaClient` (rather than a panel-private reach) required reading the panel constructor by eye.
3. **Phase 4 (UX overhaul) prerequisite.** v0.7.0 Phase 4 will add the structured render protocol, which requires injecting new collaborators into the agent loop. Doing that on top of an inline 280-line constructor risks accidentally re-introducing the coupling ADR-0008 was meant to prevent.

## Decision

The composition graph for the chat panel uses **factory injection rooted in `GemmaRuntime`**. Three concrete changes implement the pattern:

1. **`GemmaRuntime` is the canonical OllamaClient source.** `GemmaRuntime.getOllamaClient()` returns the cached vendor-neutral `LLMClient` for the current `(ollamaUrl, requestTimeout)` pair, invalidating the cache when either input changes via `onSettingsChange`. No subsystem may instantiate an `OllamaClient` directly; every consumer threads the runtime in and asks for the port. A new regression test [tests/unit/runtime/GemmaRuntime.test.ts](../../tests/unit/runtime/GemmaRuntime.test.ts) asserts this contract.
2. **Static factories on `ChatController` build the agent-loop construction graph.** `ChatController.buildContextCompactor`, `buildSubAgentManager`, `buildOrchestrator`, `buildAgentLoop`, and `buildStreamingPipeline` accept typed deps objects and return the constructed subsystem. These keep the existing `ChatControllerContext` injection contract (so the unit tests already covering `ChatController` continue to assert behaviour) but move the wiring out of `GemmaCodePanel`.
3. **A new `bootstrapChatPanel` function in [src/panels/ChatPanelBootstrap.ts](../../src/panels/ChatPanelBootstrap.ts) owns the ordered construction.** It accepts the panel's late-binding hooks (mcpTools, edit mode, ollama reachability, hardware tier, settings cache) via a `ChatPanelHooks` interface and returns a `BootstrappedPanel` record holding every subsystem the panel needs. The panel constructor is now < 60 lines: it builds the host, runs the bootstrap, hangs the returned subsystems on `private readonly` fields, and wires the configuration-change subscription.

Companion modules extracted from the same hoist:

- **[src/panels/ChatPanelInit.ts](../../src/panels/ChatPanelInit.ts)** — store / cache / log init helpers and the memory-subsystem builder.
- **[src/panels/ChatStatusReporter.ts](../../src/panels/ChatStatusReporter.ts)** — the `post*` status pushes plus the assistant-message render cache.
- **[src/panels/ChatMessageRouter.ts](../../src/panels/ChatMessageRouter.ts)** — the webview `WebviewToExtensionMessage` dispatcher (ready / sendMessage / clearChat / cancelStream / loadSession / setEditMode / rollbackRequest).
- **[src/panels/ToolActivationContext.ts](../../src/panels/ToolActivationContext.ts)** — `buildPromptContext`, `getEnabledToolMetadata`, `buildOllamaTools`.
- **[src/tools/ToolRegistryBuilder.ts](../../src/tools/ToolRegistryBuilder.ts)** — `buildToolRegistry` free function.

## Consequences

**Positive**

- `GemmaCodePanel.ts` shrunk from 935 to 305 lines (-67%), well under the 400-line target ADR-0008 set as a stretch goal. Constructor wiring fell from ~280 lines to ~50.
- The composition root invariant ("only `GemmaRuntime` instantiates an `OllamaClient`") is now testable in isolation rather than asserted by code review.
- New cross-cutting features can extend the bootstrap by adding a typed deps field instead of touching the panel's private constructor body. Adding a new subsystem to `BootstrappedPanel` is one new field on an interface plus the matching factory call.
- `ChatStatusReporter`, `ChatMessageRouter`, and `ToolActivationContext` each have a single responsibility. Behaviour previously coupled inside the panel is now visible at the module boundary.
- The static factories on `ChatController` mean the controller's existing unit tests continue to validate behaviour with mock-injected subsystems; the bootstrap is the only path that drives the factories.

**Negative**

- The bootstrap returns a 30-field `BootstrappedPanel` record. New contributors must read the bootstrap to find a particular subsystem's construction site. This is a deliberate trade-off: the alternative was 30 small panels-of-panels, which would have been worse for navigability.
- The `ChatPanelHooks` interface is a 12-method bag of late-bound state. It is the smallest interface that captures the panel's mutable state without leaking the panel reference into the bootstrap.
- One legacy private method (`_handleMessage`) is preserved as a thin wrapper over `_messageRouter.handle` to keep callers that simulate a webview message bus directly compatible. This is a temporary shim that v0.8.0 can drop once those tests migrate to the router-level seam.

**Neutral**

- The marked v4 -> v12 migration that v0.6.0 deferred (sub-task 0.5) lands alongside this work. The Renderer-API rewrite the v0.7.0 plan describes did not actually apply: marked v12 retains the v4-positional Renderer signature; the token-object Renderer was introduced in v15 and v15+ is ESM-only, incompatible with the CJS extension. The v12 bump still carries security fixes; the renderer code is unchanged-by-need.

## Alternatives considered

- **Keep the construction graph inline in `GemmaCodePanel`.** Rejected: this is what ADR-0008 explicitly logged as a deferred constraint. The panel already exceeded the navigability ceiling.
- **Move construction into `ChatController` itself (instance methods, not static factories).** Rejected: `ChatController`'s unit tests inject 12 mock subsystems through `ChatControllerContext`; making the controller construct its own dependencies would have invalidated the entire test surface.
- **Build a dedicated dependency-injection container (TSyringe, InversifyJS).** Rejected: 30 subsystems, each with one consumer, do not justify a DI container. The bootstrap is a ~300-line plain function and remains grep-friendly.
- **Bump `marked` to v15+ to actually use the token-object Renderer API.** Rejected this cycle: v15+ is ESM-only and the extension is CommonJS; converting requires tsconfig + import-pattern churn out of scope for Phase 0. Logged for v0.8.0 review.

## Links

- Implementation: [src/panels/GemmaCodePanel.ts](../../src/panels/GemmaCodePanel.ts), [src/panels/ChatPanelBootstrap.ts](../../src/panels/ChatPanelBootstrap.ts), [src/panels/ChatController.ts](../../src/panels/ChatController.ts), [src/panels/ChatStatusReporter.ts](../../src/panels/ChatStatusReporter.ts), [src/panels/ChatMessageRouter.ts](../../src/panels/ChatMessageRouter.ts), [src/panels/ToolActivationContext.ts](../../src/panels/ToolActivationContext.ts), [src/panels/ChatPanelInit.ts](../../src/panels/ChatPanelInit.ts), [src/tools/ToolRegistryBuilder.ts](../../src/tools/ToolRegistryBuilder.ts), [src/runtime/GemmaRuntime.ts](../../src/runtime/GemmaRuntime.ts)
- Tests: [tests/unit/runtime/GemmaRuntime.test.ts](../../tests/unit/runtime/GemmaRuntime.test.ts), [tests/unit/panels/ChatController.test.ts](../../tests/unit/panels/ChatController.test.ts), [tests/unit/panels/GemmaCodePanel.test.ts](../../tests/unit/panels/GemmaCodePanel.test.ts)
- Related ADRs: [ADR-0008 panel decomposition](./0008-panel-decomposition.md) (the v0.6.0 split this work completes), [AGENTS.md Module Authorship Contract](../../AGENTS.md)
- v0.7.0 plan: [docs/v0.7.0/plans/v0.7.0-cycle.md](../v0.7.0/plans/v0.7.0-cycle.md) Phase 0 sub-task 0.4

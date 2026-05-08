# ADR-0013: Webview render protocol expansion (v0.7.0 Phase 4)

- **Status**: Accepted
- **Date**: 2026-05-06
- **Deciders**: Gemma Code maintainers (v0.7.0 cycle plan, Phase 4)

## Note on numbering

The v0.7.0 cycle plan ([docs/v0.7.0/plans/v0.7.0-cycle.md](../v0.7.0/plans/v0.7.0-cycle.md)) referred to this decision as "ADR-0008", written before ADRs 0006-0012 were assigned during v0.6.0 Phases 5-8 and v0.7.0 Phase 0/3. ADR-0008 (panel decomposition) and ADR-0012 (model-callable compress tool) had already shipped, so this ADR is recorded as 0013. Same deviation pattern as ADR-0011 (OllamaClient injection).

## Context

Phase 4 of the v0.7.0 cycle adopts the Claude-Code-style chat UI primitives observed in S7 of [docs/v0.7.0/comparison-multi-source.md](../v0.7.0/comparison-multi-source.md): inline diff cards, action-type tags, numbered permission prompts, structured todo blocks, "Thought for Ns" meta-rows, queued-message fields during streaming, and end-of-task completion reports.

Before Phase 4, the webview rendered tool calls as ad-hoc DOM in [src/panels/webview/runtime.ts](../../src/panels/webview/runtime.ts) (one branch per message type, all written inline as a single ~700-line IIFE string). Adding seven new primitives on the same pattern would push the file past 1500 lines, mix presentational and protocol concerns, and make it impossible to unit-test individual cards without spinning up the whole panel host.

## Decision

Adopt a typed webview render protocol with three rules:

1. **One render helper per primitive.** Each primitive lives in `src/panels/webview/render/<name>.ts` and exports a `<NAME>_FN_SOURCE` string (the function body, in plain JS) plus a `compile<Name>(document)` factory used by tests under `// @vitest-environment jsdom`.

2. **Single source of truth.** The runtime IIFE in [src/panels/webview/runtime.ts](../../src/panels/webview/runtime.ts) inlines every `_FN_SOURCE` via string concatenation; tests instantiate the same source through `new Function(...)` against jsdom. There is no host-side TS twin to drift against -- the function body is the canonical implementation.

3. **All primitives use `document.createElement` + `textContent`.** No primitive may assign user-supplied text to `innerHTML`. This satisfies the DOMPurify requirement of [src/utils/MarkdownRenderer.ts](../../src/utils/MarkdownRenderer.ts) trivially: untrusted HTML is never interpreted, so DOMPurify is not needed inside the renderer. Each render-primitive test enforces this with a sentinel assertion (`expect(FN_SOURCE.includes("innerHTML")).toBe(false)`).

The wire protocol gains the following message types in [src/panels/messages.ts](../../src/panels/messages.ts):

| Message type | Source primitive |
|---|---|
| `renderToolCallStarted` | actionTag |
| `renderToolCallCompleted` | actionTag + diffCard |
| `renderToolCallFailed` | actionTag |
| `renderTodoUpdate` | todoBlock |
| `renderCompactionEvent` | (banner) |
| `renderCompletionReport` | completionReport |
| `renderThoughtMetaRow` | thoughtMetaRow |
| `renderPermissionPrompt` | permissionPrompt |

Inbound: `permissionPromptResponse` carries `{ id, value, freeformText? }` so [src/tools/ConfirmationGate.ts](../../src/tools/ConfirmationGate.ts) can resolve the prompt with the user's choice.

## Consequences

- **Positive**:
  - New primitives can be added by writing a render module + a unit test, with zero changes to the rest of the runtime IIFE.
  - Every primitive has a dedicated jsdom unit test; coverage of the webview render path improved from "scaffold-only" to per-primitive DOM assertions.
  - The typed wire protocol enables a future React/Svelte port: each primitive becomes a component with the same prop shape.
  - The "no innerHTML" rule eliminates one whole class of XSS regressions in the chat panel.

- **Negative**:
  - Each new primitive requires a message-type addition plus a render file plus a test. The friction is small but real.
  - The render-source-as-string pattern bypasses TS type-checking inside the function body. Mitigation: tests under jsdom catch logic regressions, and `_FN_SOURCE` strings are kept short.
  - Concatenating seven `_FN_SOURCE` strings into the IIFE adds about 280 lines to the inlined webview script. Bundle stays well under the CSP-mandated nonce budget.

- **Neutral**:
  - The legacy `confirmationRequest` modal still ships for callers that have not migrated to `renderPermissionPrompt`; it can be removed in v0.8.0 once every internal caller uses the numbered prompt.

## Alternatives considered

- **Alternative A: Build the renderer as actual TypeScript modules and bundle with esbuild.** Rejected because the v0.6.0 hygiene cycle deferred a webview build step (panel-decomposition ADR-0008 explicitly leaves the IIFE as a single string). Adding esbuild here would have widened Phase 4's scope past the cycle constraints.
- **Alternative B: Render every primitive as a host-side HTML string + DOMPurify, post via `messageComplete.renderedHtml`.** Rejected because (a) host-side rendering loses interactive elements (a permission prompt cannot resolve via host-side string), and (b) the existing `MarkdownRenderer.ts` pipeline is sized for assistant prose, not interactive cards.
- **Alternative C: Keep one large branch per primitive in `runtime.ts` with no extraction.** Rejected because it makes per-primitive tests impossible without spinning up the full panel.

## Links

- Cycle plan: [docs/v0.7.0/plans/v0.7.0-cycle.md](../v0.7.0/plans/v0.7.0-cycle.md) (Phase 4)
- Multi-source comparison report: [docs/v0.7.0/comparison-multi-source.md](../v0.7.0/comparison-multi-source.md) (S7, C21-C27)
- Related ADR: [ADR-0008 -- Panel decomposition](./0008-panel-decomposition.md)
- Implementation: render helpers under [src/panels/webview/render/](../../src/panels/webview/render/), unit tests under [tests/unit/panels/webview/render/](../../tests/unit/panels/webview/render/)

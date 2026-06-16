# ADR-0016: Add LM Studio as a second LLM backend

- **Status**: Accepted (adapter-selection mechanism superseded by [ADR-0019](./0019-local-adapter-registry.md))
- **Date**: 2026-05-16
- **Deciders**: v0.8.0 Phase 4 -- multi-source adoption cycle. Aligned with the jola.dev article on Gemma 4 quantisation and the multi-source comparison report Section 5a item F1.

## Context

Gemma-Code has shipped against a single LLM backend (Ollama on `:11434`) since v0.1.0. The multi-source comparison surfaced LM Studio as a credible second option for Apple Silicon users: it ships with an MLX backend that outperforms Ollama for several Gemma 4 quantisations and exposes an OpenAI-compatible REST surface on `:1234` by default. Several v0.8.0 adopters explicitly run LM Studio rather than Ollama, so the "single-backend" assumption blocks adoption without changing user habits.

The constraint is the local-only thesis: any second backend must speak loopback-only, must not introduce a network egress, and must drop in behind the existing `LLMClient` port so the agent loop, streaming pipeline, embedding client, and tool format adapters all keep working unchanged.

## Decision

Add a second `LLMClient` implementation, `LmStudioClient`, in `src/llm/LmStudioClient.ts` that speaks the OpenAI-compatible streaming protocol LM Studio exposes by default. Wire it into `GemmaRuntime.getOllamaClient()` (kept-named for compatibility) so a new `gemma-code.llm.backend` setting (`"ollama" | "lmstudio" | "auto"`, default `"ollama"`) selects between the two. `"auto"` resolves to `lmstudio` on macOS (`process.platform === "darwin"`) and to `ollama` elsewhere.

Concrete changes:

- New file `src/llm/LmStudioClient.ts` implementing `LLMClient` (`checkHealth`, `listModels`, `streamChat`, `embed`, `embedBatch`).
- New settings `gemma-code.llm.backend` and `gemma-code.lmstudio.baseUrl` (default `http://127.0.0.1:1234`).
- `GemmaRuntime._resolveBackend` selects the adapter and caches the client per `(backend, ollamaUrl, lmStudioBaseUrl, requestTimeout)` tuple.
- The streaming pipeline, agent loop, and embedding consumers are unchanged because they target the `LLMClient` interface.

## Consequences

- **Positive**: macOS users get the MLX speed-up without changing their Gemma-Code workflow. The `LLMClient` port proves itself as a real abstraction (a second implementation lands without an interface change). Local-only thesis preserved -- both backends loop back to `127.0.0.1`.
- **Negative**: One more code path to keep maintained. LM Studio's OpenAI-shape stream is similar but not identical to Ollama's; subtle delta-content vs full-content semantics need parity tests for each new feature shipped.
- **Neutral**: The omlx third backend is **explicitly deferred to v0.9.0** because of its alpha-stage maintenance risk (item F2 in the comparison report).

## Alternatives considered

- **Drop LM Studio**. Rejected: a measurable fraction of Apple Silicon users prefer it; not adopting it blocks their experience without a clear policy win.
- **Replace Ollama with LM Studio**. Rejected: Ollama is the default on Windows / Linux and has the broader user base.
- **Auto-detect only, no setting**. Rejected: surprise routing is a worse UX than an explicit toggle. `"auto"` is offered but is not the default; users must opt in.

## Links

- Source article: jola.dev "Running Gemma 4 on Apple Silicon" (referenced in the comparison report).
- Comparison report: `docs/archive/versions/v0/v0.7.0/comparison-multi-source-v2.md` Section 5a item F1.
- Plan reference: `docs/archive/versions/v0/v0.8.0/plans/v0.8.0-cycle.md` sub-task 4.2.

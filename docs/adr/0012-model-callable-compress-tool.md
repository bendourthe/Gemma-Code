# ADR-0012: Introduce a model-callable compress tool alongside deterministic compaction

- **Status**: Accepted
- **Date**: 2026-05-05
- **Deciders**: Gemma Code maintainers (v0.7.0 cycle)

> The original v0.7.0 plan called for ADR-0006; that number is already
> occupied by `0006-unified-path-guard.md` (v0.6.0 Phase 1). This ADR ships
> as 0012 to avoid colliding with the existing chain.

## Context

v0.5.0 / v0.6.0 ship a deterministic-only compaction pipeline:
`ToolResultClearing -> SlidingWindow -> CodeBlockTruncation -> RegenerateFromSource -> LlmSummary -> EmergencyTrim`. Each strategy is a pure function the
extension applies on the conversation transcript. Strengths: no model
involvement, no extra inference cost, every step is reproducible. Weaknesses:

- The strategies are blunt. SlidingWindow drops messages without understanding
  causal links. CodeBlockTruncation hides line counts but cannot tell which
  blocks were load-bearing. The LLM-summary strategy summarises everything
  past the last N messages with one prompt regardless of subject.
- The model itself is the only participant that knows which earlier facts
  the *next* step actually depends on. Pure deterministic strategies cannot
  inject that knowledge.
- Comparison-multi-source S5 (S5 = Section 9.3, entry C12 in
  [docs/v0.7.0/comparison-multi-source.md](../v0.7.0/comparison-multi-source.md))
  documents that other agents bridge this gap with a model-callable
  `compress` tool: when the model finishes a sub-task, it issues a
  `compress_range` call covering the messages it knows are no longer needed,
  with a per-call summary it writes itself.

The size of the v0.6.0 compaction problem -- a single 200-line file dump
that loses every other in-context detail when SlidingWindow finally drops
it -- is the immediate motivation. v0.7.0 Phase 3 introduces the compress
tool plus two new deterministic strategies (`deduplication`, `purgeErrors`)
that run BEFORE the v0.6.0 chain and cover the high-yield cases without
needing a model call.

## Decision

Introduce two new built-in tools, `compress_range` and `compress_message`,
both at permission tier 0 (auto-approve, never touches files / terminal /
network). The two strategies above run as additional steps in
`CompactionPipeline`; the existing v0.6.0 chain is preserved as the final
fallback.

Concrete changes:

- Add `src/chat/strategies/deduplication.ts` and
  `src/chat/strategies/purgeErrors.ts`. Both run before the existing chain
  and skip a configurable list of protected tools.
- Add `src/chat/state/CompressionState.ts` -- durable per-session state for
  block IDs (`b1`, `b2`, ...) and compression runs, with serialise /
  deserialise so the state can be persisted with chat history.
- Add `src/tools/handlers/compress.ts` exporting `CompressRangeTool` and
  `CompressMessageTool`. Range mode is unconditional; message mode is gated
  behind `gemma-code.compactExperimentalMessageMode` because S5 itself marks
  message-mode as experimental.
- Surface lifecycle to the user via `/compact context | stats | sweep [n] |
  decompress <id> | recompress <id> | manual on|off`.
- Honor a `gemma-code.contextLimitsPerModel` override map so per-model
  context windows (E2B/E4B 128K vs. 26B/31B 256K) are respected by
  `ContextCompactor`.

## Consequences

- Positive:
  - Surgical compression. The model picks spans it knows are no longer
    load-bearing; the rest of the conversation stays full-fidelity.
  - The deduplication + purge-errors strategies catch high-yield cases
    deterministically with no LLM cost.
  - Reversible: every block can be `/compact decompress`-ed back to its
    snapshot, so a regretted compression never loses information.
  - Manual mode (`/compact manual on`) lets a user freeze auto-compression
    when investigating a tricky issue.
- Negative:
  - More moving parts. The compress tool can be mis-used by the model on a
    range that still has unanswered user questions; the `protectedTools` and
    `protectedFilePatterns` settings, plus the user-message protection flag,
    are mitigations but not bulletproof.
  - Cache-invalidation cost on prefix-caching providers. Irrelevant for
    Ollama (no shared prefix cache across requests), but worth noting if the
    extension ever ships a non-Ollama backend.
  - Two new built-in tool slots in the catalog grow the system prompt by
    a small amount even when the user never invokes them. Both schemas are
    intentionally short to limit the cost.
- Neutral:
  - The feature is additive: legacy callers that build the registry without
    `compress: { ... }` get the v0.6.0 behavior unchanged.

## Alternatives considered

- **Deterministic-only with a richer LlmSummary** - Rejected because the
  LLM summary still happens AFTER context pressure has already forced data
  loss; by then the model has lost the very information it would need to
  identify load-bearing spans.
- **Auto-issue compress on every tool call** - Rejected because the
  pre-existing deterministic strategies (especially deduplication) already
  cover the cases where the heuristic is right, and they do it at zero LLM
  cost.
- **Persist compress state in a separate SQLite table** - Deferred. For
  v0.7.0 the in-memory `CompressionState` plus an optional JSON serialise
  is enough; promoting to a dedicated table is a v0.8.0 change once we have
  field data on how often users decompress an old run.

## Links

- v0.7.0 cycle plan: [docs/v0.7.0/plans/v0.7.0-cycle.md](../v0.7.0/plans/v0.7.0-cycle.md) Phase 3
- Comparison source: [docs/v0.7.0/comparison-multi-source.md](../v0.7.0/comparison-multi-source.md) Section 9.3 entries C12 / C13 / C14 / C15 / C16
- Prior compaction ADR: [docs/adr/0003-compaction-strategy-ordering.md](0003-compaction-strategy-ordering.md)
- Tool permission tiers: [docs/adr/0005-tool-permission-tiers.md](0005-tool-permission-tiers.md)

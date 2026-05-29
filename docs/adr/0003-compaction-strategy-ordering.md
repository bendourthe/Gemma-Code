# ADR-0003: Compaction Strategy Ordering

- **Status**: Accepted (2026-04-26)
- **Deciders**: Benjamin Dourthe (project owner) — codifies the v0.3.0 (`RegenerateFromSource` addition) ordering and v0.4.0 settings-provider refactor as they exist at the start of v0.5.0

## Context

Gemma 4 supports 128K context (`gemma4:e4b`) up to 256K (`gemma4:26b`/`31b`). Multi-turn agentic sessions routinely exceed those limits before the user's task is complete. A single compaction strategy is insufficient: a sliding window over messages discards small, high-signal exchanges; an LLM-summary on every tick burns tokens and adds latency on every turn; truncating code blocks is destructive when the agent still needs the body. Each strategy has a different cost and loss profile, and the right choice depends on what the conversation currently contains.

## Decision

Run a six-stage pipeline ordered cheapest-first, short-circuiting as soon as the conversation fits the budget. The pipeline is composed in [src/chat/ContextCompactor.ts](../../src/chat/ContextCompactor.ts) and the strategy classes live in [src/chat/CompactionStrategy.ts](../../src/chat/CompactionStrategy.ts) (with `RegenerateFromSource` in its own file at [src/chat/RegenerateFromSource.ts](../../src/chat/RegenerateFromSource.ts)). Each strategy implements `canApply(messages, budget)` and `apply(messages, budget)`; the pipeline visits them in order and skips any whose `canApply` returns false.

| # | Stage | Trigger | Cost | Loss |
|---|-------|---------|------|------|
| 1 | `ToolResultClearing` | More than `compactionToolResultsKeep` (default 8) tool-result blocks present | Zero (regex replace) | Old tool results replaced with one-line summary; recent ones intact |
| 2 | `SlidingWindow` | More than `compactionKeepRecent` (default 10) non-system messages | Zero (filter) | Middle messages dropped; first message + any `[Conversation summary]` anchors retained |
| 3 | `CodeBlockTruncation` | Fenced code blocks above an internal length threshold remain | Zero (text replace) | Long code bodies replaced by `... (N lines elided)` markers |
| 4 | `RegenerateFromSource` | A code block came from a workspace-local file the agent originally read | Zero LLM cost; one filesystem read | Block replaced with a deterministic `READ <path> at <hash>` reference (no info loss because the file is still on disk) |
| 5 | `LlmSummary` | Conversation still over budget after stages 1-4 | One Ollama call (latency + tokens) | Lossy — older turns become a paragraph summary; details lost |
| 6 | `EmergencyTrim` | Pipeline still over budget (rare; only when LLM summary fails or runs out of room) | Zero | Hard truncation from the head; last-resort safety valve |

The pipeline is invoked when `estimateTokens() >= maxTokens * compactionThreshold` (default threshold 0.8). The `_settingsProvider` callback is read on each invocation so changes to `gemma-code.compactionToolResultsKeep` and `gemma-code.compactionKeepRecent` take effect on the next compaction without restart.

## Consequences

**Positive**

- Most compaction events terminate before stage 4: the cheap regex/filter stages are usually enough for routine sessions, so users do not pay the LLM-call latency on every long turn.
- `RegenerateFromSource` is the killer feature for code-heavy sessions: read-once, recall-by-reference replaces large file bodies with a few bytes while preserving the agent's ability to re-read on demand.
- Each strategy is independently testable; the pipeline is a thin composition.
- The `EmergencyTrim` last resort means the agent never crashes on an over-budget conversation; it degrades.

**Negative**

- Six stages is more than the routa upstream's three-strategy default. Reasoning about the interaction between stages requires reading the strategy classes individually.
- `LlmSummary` (stage 5) introduces a circular dependency on Ollama: the same model that consumes the prompt is asked to summarise an earlier piece of it. If Ollama is degraded, compaction is degraded. We accept this because the offline-first constraint rules out a remote summariser.
- `RegenerateFromSource` is workspace-bound: it cannot reconstruct files outside the workspace root or files the user has since modified. The strategy guards against staleness via content-hash checks; a hash mismatch falls through to stage 5.

**Neutral**

- Stage thresholds (`compactionToolResultsKeep`, `compactionKeepRecent`, the 0.8 trigger ratio) are heuristic and exposed as settings. Future ADRs may refine the defaults based on telemetry from `MetricsCollector` (`compaction.stage_applied` events).

## Alternatives considered

- **Single sliding-window strategy.** Rejected: drops mid-session reasoning that anchors the task; brittle on tool-heavy sessions where the most useful context is a recent tool result, not a recent user turn.
- **`LlmSummary` as the only stage.** Rejected: latency on every long turn; cost on every long turn; fails closed when Ollama is unreachable; lossy by construction even when cheap stages would have sufficed.
- **Truncation only.** Rejected: head-truncation discards the task framing; tail-truncation discards the agent's working state; either way the model loses the part of the conversation that is most expensive to reconstruct.
- **Stage order: LLM summary first, regex stages as fallback.** Rejected: pays the LLM cost on every triggered compaction even when a cheaper stage would have produced an acceptable result.

## Links

- v0.3.0 implementation plan (RegenerateFromSource): [docs/archive/versions/v0/v0.3.0/implementation-plan.md](../v0.3.0/implementation-plan.md)
- v0.5.0 Phase 3 (compression foundation, settings reactivity): [docs/archive/versions/v0/v0.5.0/plans/implementation-plan.md](../v0.5.0/plans/implementation-plan.md)
- Strategy implementations: [src/chat/CompactionStrategy.ts](../../src/chat/CompactionStrategy.ts), [src/chat/RegenerateFromSource.ts](../../src/chat/RegenerateFromSource.ts)
- Pipeline composition: [src/chat/ContextCompactor.ts](../../src/chat/ContextCompactor.ts)

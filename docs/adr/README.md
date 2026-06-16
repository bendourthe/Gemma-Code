# Architecture Decision Records

This directory collects the architecture decision records (ADRs) for Gemma Code.

We follow the [MADR](https://adr.github.io/madr/) (Markdown Any Decision Records) convention. Each record is a short, dated note that captures:

- The context and forces that made the decision necessary
- The decision itself
- The consequences (positive, negative, and neutral)
- The alternatives considered and why they were rejected

ADRs are immutable once accepted. When a later decision supersedes an earlier one, we add a new ADR and cross-link the two rather than editing history.

## Conventions

- File name: `NNNN-kebab-case-title.md` where `NNNN` is a zero-padded sequential number.
- Status values: `Proposed`, `Accepted`, `Deprecated`, `Superseded by ADR-NNNN`.
- Author and date are recorded at the top of each record.
- Keep records short; link to supporting analysis in the relevant `docs/vX.Y.Z/` folder rather than inlining long discussions.

Use [template.md](./template.md) as a starting point for new ADRs.

## Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| [ADR-0001](./0001-python-backend-disposition.md) | Dispose of the Python FastAPI backend | Accepted | 2026-04-18 |
| [ADR-0002](./0002-memory-subsystem-layering.md) | Memory subsystem layering (Working / Episodic / Semantic / Graph) | Accepted | 2026-04-26 |
| [ADR-0003](./0003-compaction-strategy-ordering.md) | Compaction strategy ordering (six-stage cheapest-first pipeline) | Accepted | 2026-04-26 |
| [ADR-0004](./0004-sub-agent-isolation-contract.md) | Sub-agent isolation contract (verification / research / planning) | Accepted | 2026-04-26 |
| [ADR-0005](./0005-tool-permission-tiers.md) | Tool permission tiers (AUTO_APPROVE / CONFIRM / DANGEROUS) | Accepted | 2026-04-26 |
| [ADR-0006](./0006-unified-path-guard.md) | Unified path-guard for filesystem tool handlers | Accepted | 2026-05-04 |
| [ADR-0007](./0007-permission-tier-floor.md) | Permission-tier floor for confirmation-class tools | Accepted | 2026-05-04 |
| [ADR-0008](./0008-panel-decomposition.md) | Panel decomposition (ChatController + ChatWebviewHost + handlers) | Accepted | 2026-05-04 |
| [ADR-0009](./0009-predictive-cache-decision.md) | Delete PredictiveCache (wire-or-delete decision) | Accepted | 2026-05-03 |
| [ADR-0010](./0010-threshold-elevation-decision.md) | Per-provenance semantic threshold elevation (heuristic vs. ollama) | Accepted | 2026-05-03 |
| [ADR-0011](./0011-ollama-client-injection.md) | OllamaClient injection contract for the panel + controller graph | Accepted | 2026-05-05 |
| [ADR-0012](./0012-model-callable-compress-tool.md) | Model-callable compress tool surface | Accepted | 2026-05-07 |
| [ADR-0013](./0013-webview-render-protocol.md) | Webview render protocol expansion (7 primitives) | Accepted | 2026-05-06 |
| [ADR-0014](./0014-memory-file-architecture.md) | Memory file architecture (Instructions / Memory / Context) | Accepted | 2026-05-07 |
| [ADR-0016](./0016-second-llm-backend.md) | Add LM Studio as a second LLM backend | Accepted (selection superseded by ADR-0019) | 2026-05-16 |
| [ADR-0017](./0017-golden-runner-disposition.md) | Canonise the Python golden runner; defer a TS-native rewrite | Accepted | 2026-05-15 |
| [ADR-0019](./0019-local-adapter-registry.md) | Manifest-driven local-runtime adapter registry | Accepted | 2026-06-15 |

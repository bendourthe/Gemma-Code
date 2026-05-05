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

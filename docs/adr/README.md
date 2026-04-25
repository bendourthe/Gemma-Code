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

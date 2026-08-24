# Docs cleanup audit - v2.1.0

**Last audit**: 2026-08-20 (Phase 7)
**Mode**: audit (no files moved)

## Layout

`docs/v2/v2.1/{plans,comparisons,benchmarks,development/history}` already matches the two-level minor scheme. No stray comparison reports.

## Phase 1

Added catalog eval JSON under `benchmarks/`, session history, known-gaps. No scratch docs to delete.

## Phase 2

Added `development/history/2026-08-20_phase-2-adaptive-routing.md`. Updated plan checklist, known-gaps, DEVLOG, README What's new, ARCHITECTURE routing section.

## Phase 3

Added `development/history/2026-08-20_phase-3-studio-provenance-queue.md`. Updated plan checklist, known-gaps (DF-6, DF-7), DEVLOG, README What's new, ARCHITECTURE Image Studio section, AGENTS.md `core/generations/` layout line.

## Phase 4

Added `development/history/2026-08-20_phase-4-multimodal-chat-sam2.md`. Updated plan checklist, known-gaps (DF-8 through DF-11), DEVLOG, README What's new, ARCHITECTURE Chat + SAM2 sections, AGENTS.md `core/chat/` and `core/image/` layout lines.

## Phase 5

Added `development/unsloth-license-boundary.md`, `development/history/2026-08-20_phase-5-local-fine-tuning.md`, `ci-hardware-gates.md`. Updated plan checklist, known-gaps (DF-12 through DF-17), DEVLOG, README What's new, ARCHITECTURE fine-tuning section, AGENTS.md `core/tuning/` layout line.

## Phase 6

Added `development/json-cli.md`, `development/history/2026-08-20_phase-6-hardening.md`. Updated plan checklist, known-gaps (DF-18 through DF-22), DEVLOG, README What's new, ARCHITECTURE audit/CLI/budget sections, AGENTS.md `core/audit/` and `core/cli/` layout lines, `ci-hardware-gates.md`.

## Phase 7

Added `development/history/2026-08-20_phase-7-refactor-known-gaps-ci.md`. Updated plan checklist, known-gaps (DF-23 A13, DF-24 A14, reconciliation note), DEVLOG, `ci.yml` comments. `check:docs-layout` already canonical. Empty SkillLoader dirs retained.

## Recommendation

Leave as-is. No archive or rename.

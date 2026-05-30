# v1.4.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: open. v1.4.0 is the claude-code-harness adoption + known-gaps-closure + Nexus-Hub-sync cycle ([plans/adoption-claude-code-harness.md](plans/adoption-claude-code-harness.md), derived from [../v1.3.0/comparison-claude-code-harness.md](../v1.3.0/comparison-claude-code-harness.md)). Phase 1 (2026-05-30) ships the four skill-native adoption items (A3, A7, A12, A11) as documentation conventions under [development/](development/); no `core/` or `modules/` surface is touched. Phases 2-6 land the code-shaped adoptions (network/subprocess hardening, static-analysis + CI gates, the safety-config SSOT, operator tooling, and worktree-isolated parallel execution). Phases 7-8 close the 36 carryforward gaps from v1.1.0 / v1.2.0 / v1.3.0. Phase 9 (final) syncs Nexus-Hub and runs the whole-plan acceptance gate. This file is appended phase-by-phase; items move to `## 2. Resolved` when closed; the `## 3. Summary` is recomputed each pass.

**Audience**: v1.4.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-05-30 (Phase 1 -- skill-native adoptions)
**Sibling reviews**: [../v1.3.0/known-gaps.md](../v1.3.0/known-gaps.md), [../v1.2.0/known-gaps.md](../v1.2.0/known-gaps.md), [../v1.1.0/known-gaps.md](../v1.1.0/known-gaps.md) (the upstream gap logs; their open items are the 36-item carryforward set this cycle resolves in Phases 7-9), and [plans/adoption-claude-code-harness.md](plans/adoption-claude-code-harness.md) (the active plan).

**Cycle context**: This file is created in Phase 1 (rather than at the first code-shaped phase) because the implement-phase post-phase sequence appends gaps every phase. Phase 1 is documentation-only and introduces no new gap; the seeded sections below are forward-compatible with the per-sub-task ledger that Phases 2-9 will append.

**Wording convention**: every prose claim in this file follows [development/evidence-and-support-tiers.md](development/evidence-and-support-tiers.md) (A7): a gap describes its unbuilt capability at tier `future` or `candidate` (never `supported`), and the "Suggested next step" states what cited evidence would raise the tier. "not_observed != absent" applies throughout.

Each entry has a severity tag:

- **P0** -- release-blocker for v1.4.0 (must close)
- **P1** -- should-fix in v1.4.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v1.4.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 0. Adoption Ledger

Per-sub-task closure ledger for the claude-code-harness adoption plan. Rows land as each phase closes.

### claude-code-harness adoption (adoption-claude-code-harness)

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| T001 | A3 -- pre-commit/pre-PR self-review checklist (skill-native) | Resolved | Phase 1 (2026-05-30); [development/self-review-checklist.md](development/self-review-checklist.md) encodes G1-G5 (DRY / all-symbols-called / DoD-verified-with-evidence / no-test-regression / TDD-red-evidence); referenced from [.github/PULL_REQUEST_TEMPLATE.md](../../../../.github/PULL_REQUEST_TEMPLATE.md) Submission Checklist |
| T002 | A7 -- "not_observed != absent" evidence + support-tier convention (skill-native) | Resolved | Phase 1 (2026-05-30); [development/evidence-and-support-tiers.md](development/evidence-and-support-tiers.md) (four tiers: supported / internal-compatible / candidate / future); anchored from [AGENTS.md](../../../../AGENTS.md) Critical Rules; governs this file's wording |
| T003 | A12 -- evidence-pack discipline for PR/release (skill-native) | Resolved | Phase 1 (2026-05-30); [development/evidence-pack.md](development/evidence-pack.md) ("verified-only"; "PR ready is not release ready"); referenced from [.github/PULL_REQUEST_TEMPLATE.md](../../../../.github/PULL_REQUEST_TEMPLATE.md); upstream gate is T001 |
| T004 | A11 -- stakeholder HTML surfaces (skill-native) | Resolved | Phase 1 (2026-05-30); [development/stakeholder-surfaces.md](development/stakeholder-surfaces.md) with three self-contained zero-outbound HTML templates (plan brief / progress / acceptance) |
| T005 | Phase 1 testing + stabilization | Resolved | Phase 1 (2026-05-30); `nexus-check --rule skill-duplicate-name` -> 0 findings (exit 0); `npm run check:prompts` -> 0 errors (1 pre-existing `review-pr/SKILL.md` oversized warning, unrelated); all four docs ASCII-clean; `git diff --stat` confirms no `core/` or `modules/` change |
| T006-T031 | A1-A2, A4-A6, A8-A10 + architectural / wiring carryforward | Pending | Phases 2-8 (code-shaped) |
| T032-T035 | Nexus-Hub sync + whole-plan acceptance gate | Pending | Phase 9 (final) |

---

## 1. Open Items

### Phase 1 (skill-native adoptions)

No new gap. Phase 1 is documentation-only: it created four convention docs under [development/](development/) plus the two reference edits required by acceptance ([.github/PULL_REQUEST_TEMPLATE.md](../../../../.github/PULL_REQUEST_TEMPLATE.md) +2 lines, [AGENTS.md](../../../../AGENTS.md) +1 line). No deviation, test failure, coverage shortfall, suppressed lint, or bypassed quality gate occurred.

### Carryforward (resolved in Phases 7-9)

The 36 open items from the sibling gap logs remain in force until their owning phase closes them. They are not re-listed here to avoid divergence from the source of truth; see the linked files. The plan maps each to a sub-task tagged `[from ... known-gaps: ...]`:

- **v1.1.0** ([../v1.1.0/known-gaps.md](../v1.1.0/known-gaps.md)): `1.4.P1.B` (src -> modules/coding move) and `1.1.P1.A` (TS project references) -> Phase 7 (T020, T021).
- **v1.2.0** ([../v1.2.0/known-gaps.md](../v1.2.0/known-gaps.md)): the lone P1 `7.x.P1.D` (protobufjs CVE chain) -> Phase 8 (T025); `3.3.P2.G` (Tree-sitter scanner) and `4.2.P3.K` (HNSW) -> Phase 7 (T022, T023); the wiring/deferral set (`5.3.P2.R`, `5.3.P3.S`, `6.1.P3.W`, `5.4.P3.T`, `5.2.P3.Q`, `5.1.P2.P`, `5.1.P2.O`, `6.2.P2.X`, `6.2.P3.Y`, `6.3.P2.Z`, and the remaining hygiene items) -> Phase 8 (T026-T030).
- **v1.3.0** ([../v1.3.0/known-gaps.md](../v1.3.0/known-gaps.md)): `T012.P2.C`, `T013.P3.D` -> Phase 8 (T030); `T017.P3.E`, `T002.P2.A` -> Phase 9 (T033, Hub-dependent).

---

## 2. Resolved

| Item | Severity / Category | Resolved in | Evidence |
|---|---|---|---|
| A3 self-review checklist (T001) | n/a (adoption) | Phase 1 (2026-05-30) | [development/self-review-checklist.md](development/self-review-checklist.md) + PR template reference |
| A7 evidence + support tiers (T002) | n/a (adoption) | Phase 1 (2026-05-30) | [development/evidence-and-support-tiers.md](development/evidence-and-support-tiers.md) + AGENTS.md anchor |
| A12 evidence-pack discipline (T003) | n/a (adoption) | Phase 1 (2026-05-30) | [development/evidence-pack.md](development/evidence-pack.md) + PR template reference |
| A11 stakeholder HTML surfaces (T004) | n/a (adoption) | Phase 1 (2026-05-30) | [development/stakeholder-surfaces.md](development/stakeholder-surfaces.md) (3 templates) |

---

## 3. Summary

| Bucket | Count |
|---|---|
| Open items introduced by v1.4.0 phases so far | 0 |
| Carryforward open items (v1.1.0 / v1.2.0 / v1.3.0, resolved in Phases 7-9) | 36 |
| Resolved this cycle | 4 (A3, A7, A12, A11) |
| Adoption items landed (of 12) | 4 (A3, A7, A11, A12) |

**Phase 1 status**: complete. No release-blocker open. Next: Phase 2 (network & subprocess hardening, A4 + A5).

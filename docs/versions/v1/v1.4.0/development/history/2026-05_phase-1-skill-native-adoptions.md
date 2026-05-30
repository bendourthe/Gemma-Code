# Session history: v1.4.0 Phase 1 -- Skill-Native Adoptions

**Date**: 2026-05-30
**Cycle**: v1.4.0
**Phase**: 1 (Skill-native adoptions, claude-code-harness adoption track)
**Plan reference**: [docs/versions/v1/v1.4.0/plans/adoption-claude-code-harness.md](../../plans/adoption-claude-code-harness.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-claude-code-harness.md](../../../v1.3.0/comparison-claude-code-harness.md)
**Acceptance scope**: ship the four skill-native adoption items (A3, A7, A12, A11) as documentation conventions, with zero runtime code change. Stability gate: each convention documented and discoverable, `nexus-check --rule skill-duplicate-name` clean, no `core/` or `modules/` source changed. Per the user's Phase 0 decision, the deliverables are docs-only (no Nexus-Hub catalog skill authored this phase).

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T001 (A3) | [development/self-review-checklist.md](../self-review-checklist.md): a pre-commit/pre-PR self-review checklist encoding gates G1-G5 (dry-violation-none, all-declared-symbols-called, dod-items-verified-with-evidence, no-existing-test-regression, tdd-red-evidence-attached), each mapped to the harness `[worker.self_review]` source rule and re-expressed for Nexus's TS/Node stack. Referenced from the [PR template](../../../../../.github/PULL_REQUEST_TEMPLATE.md) Submission Checklist. | Closed |
| T002 (A7) | [development/evidence-and-support-tiers.md](../evidence-and-support-tiers.md): Part A codifies "not_observed != absent" (a behaviour unproven locally is "not proven here", never "impossible" or a silent pass); Part B defines the four-tier capability vocabulary (supported / internal-compatible / candidate / future) with an evidence bar per tier, tied into the known-gaps wording convention. Anchored from [AGENTS.md](../../../../../AGENTS.md) Critical Rules. | Closed |
| T003 (A12) | [development/evidence-pack.md](../evidence-pack.md): the verified-only evidence-pack discipline ("PR ready is not release ready"), with the PR-ready vs release-ready evidence-bar table, the threading through the Phase 9 release-readiness workflow + semantic-release, and the A2 anti-tampering link. Upstream gate is the A3 checklist (T001). Referenced from the PR template. | Closed |
| T004 (A11) | [development/stakeholder-surfaces.md](../stakeholder-surfaces.md): a reporting convention with three self-contained, zero-outbound HTML templates (plan brief / progress tracker / acceptance-handoff decision), each with inline CSS, a system font stack, no external resource, and a stated zero-outbound contract + verification step. | Closed |
| T005 | Stabilization: `node bin/nexus-check.mjs --rule skill-duplicate-name src/skills/catalog` -> 0 findings (exit 0); `npm run check:prompts` -> 0 errors, 1 pre-existing unrelated warning; non-ASCII scan of the four new docs -> no matches; `git diff --stat` confirms only [.github/PULL_REQUEST_TEMPLATE.md](../../../../../.github/PULL_REQUEST_TEMPLATE.md) (+2) and [AGENTS.md](../../../../../AGENTS.md) (+1) modified, no `core/` or `modules/` change. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan prompts for T001 / T004 mention an OPTIONAL Nexus-Hub catalog skill as an alternate home for the convention. | Per the Phase 0 user decision (docs-only scope), all four deliverables are Markdown conventions under `development/`; no `catalog/skills/` entry was authored, so `python scripts/validate_skills.py` was not needed. The convention docs remain compatible with a future Hub-skill promotion. |
| D2 | The plan lists T001's acceptance as "referenced from the husky pre-push flow OR the PR template". | The PR template Submission Checklist was chosen over the husky pre-push hook because it is the non-behavioral surface: adding a checklist item is a documentation reference, whereas wiring the checklist into pre-push would change the push gate's behaviour (outside the "no runtime change" stability gate). The check-pr-checklist gate parses the checklist generically, so the two added boxes become enforceable without a CI config change. |
| D3 | The plan describes A11 as "produces the three HTML surfaces from local inputs". | In docs-only scope the deliverable is the convention plus three complete, fillable templates (the reusable engine). A worked per-cycle instance under `development/surfaces/` is deferred to the Phase 9 acceptance gate; the convention records this as support tier `supported` for the templates and `candidate` for the live instances, per the A7 vocabulary it co-introduces. |

## 3. Open items added to known-gaps

None. Phase 1 is documentation-only and introduced no deviation-revealed bug, test failure, coverage shortfall, suppressed lint, or bypassed quality gate. The v1.4.0 [known-gaps.md](../../known-gaps.md) file was created this phase (seeded with the adoption ledger, the carryforward pointer to the 36 prior-cycle items, and the Phase 1 resolved rows) because the post-phase sequence appends to it every phase.

## 4. Verification evidence

- `node bin/nexus-check.mjs --rule skill-duplicate-name src/skills/catalog` -> `nexus-check: 0 findings`, exit 0.
- `npm run check:prompts` -> `0 error, 1 warning` (the warning is `review-pr/SKILL.md` ~811 tokens, pre-existing and unrelated to this phase), exit 0.
- Non-ASCII scan (`[^\x00-\x7F]`) over `development/` -> no matches (ASCII-clean, no em-dashes / curly quotes).
- `git diff --stat HEAD` -> `.github/PULL_REQUEST_TEMPLATE.md` +2, `AGENTS.md` +1; all other changes are new files under `docs/versions/v1/v1.4.0/`. No `core/` or `modules/` source touched.
- Lint / build: N/A this phase (ESLint targets `src`; no TypeScript/JS changed).

## 5. Next steps

- Advance to Phase 2 (Network & subprocess hardening): A4 (cloud-metadata + paste-site egress denylist in `src/utils/ssrf.ts`) and A5 (subprocess env scrubbing in `src/tools/handlers/terminal.ts`), both code-shaped with new unit tests.
- The A3 self-review checklist and A12 evidence-pack discipline authored here become the standing pre-push / PR / release gates for every subsequent phase; the A7 wording convention governs all known-gaps and release-notes prose for the rest of the cycle.

# v1.6.0 (openrouter-fusion) -- Known Gaps, Deferrals, and Carryovers

**Status**: in progress (Phase 1 of 5 closed 2026-06-16). This is the gap ledger for the **local panel + judge-fusion** companion plan ([plans/adoption-openrouter-fusion.md](plans/adoption-openrouter-fusion.md), derived from [comparison-openrouter-fusion.md](comparison-openrouter-fusion.md)). It is kept **separate** from the sibling [known-gaps.md](known-gaps.md) (which is owned by the aisuite-harness plan and already closed) because the two plans run as distinct ledgers in the same cycle; this file is seeded in Phase 1 because the implement-phase post-phase sequence appends gaps every phase. Phase 1 ships F1: a `fuse` skill that emits the structured judge-fusion schema (consensus / contradictions / partial coverage / unique insights / blind spots -> grounded answer) and an upgrade of `council`'s synthesis to the same analysis vocabulary, with a schema-conformance test. The headline panel capability (F2-F5) lands in later phases.

**Audience**: openrouter-fusion phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-06-16 (Phase 1 -- F1 fuse skill + council synthesis upgrade, OF001-OF003)
**Sibling ledgers**: [known-gaps.md](known-gaps.md) (the aisuite-harness plan's gap log; see its `O1` cross-comparison candidate, which is sequenced strictly after this plan) and [plans/adoption-openrouter-fusion.md](plans/adoption-openrouter-fusion.md) (the active plan).

**Cycle context**: Phase 1 introduces no bug, test failure, coverage shortfall, or bypassed quality gate. It adds two prompt-asset markdown files plus one test; no `.ts` source, dependency, credential, or outbound call. The two seeded entries below are a soft-warning follow-up (`OF002.P1.A`, introduced by the required council edit) and a pre-existing environmental note (`ENV.P1.A`, not owned by this plan).

**Wording convention**: every prose claim follows [../v1.4.0/development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md): a gap describes its unbuilt capability at tier `future` or `candidate` (never `supported`); the "Suggested next step" states what cited evidence would raise the tier.

Severity tags: **P0** release-blocker; **P1** should-fix; **P2** nice-to-have; **P3** out-of-scope for this plan / recorded for future planning.
Category tags: **NI** not implemented; **DF** deferred; **BG** bug; **MT** missing tests; **WN** warning; **QG** quality gate.

---

## 0. Adoption Ledger

Per-sub-task closure ledger for the openrouter-fusion adoption plan. Rows land as each phase closes.

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| OF001 | F1 -- `fuse` skill + fusion output schema | Resolved | Phase 1 (2026-06-16); [../../../../modules/coding/skills/catalog/fuse/SKILL.md](../../../../modules/coding/skills/catalog/fuse/SKILL.md) -- judge skill ingesting N labeled candidate answers and emitting the five-section structured analysis (Consensus / Contradictions / Partial coverage / Unique insights / Blind spots) followed by a grounded Fused answer, with reconcile-not-average discipline and a candidate-text-as-untrusted-data instruction (F5 groundwork consumed in Phase 2). Front-matter mirrors `council`; `metadata.related_skills: [council, critique, lens]`. ASCII, logical punctuation, no em-dashes. |
| OF002 | F1 -- align `council` synthesis with the fuse schema | Resolved | Phase 1 (2026-06-16); [../../../../modules/coding/skills/catalog/council/SKILL.md](../../../../modules/coding/skills/catalog/council/SKILL.md) -- the Synthesis section now reconciles the three passes through the shared consensus / contradictions / blind-spots vocabulary **before** committing to its decision output (the SHIP / SHIP-WITH-CHANGES / DEFER / DROP verdict + 1-3 acceptance criteria + 1-3 explicit risks are preserved), with a one-line cross-link noting `fuse` generalises the same synthesis over distinct models; `fuse` added to `metadata.related_skills`; latency note kept. |
| OF003 | F1 -- schema-conformance check for the fuse output | Resolved | Phase 1 (2026-06-16); [../../../../tests/unit/skills/fuse.test.ts](../../../../tests/unit/skills/fuse.test.ts) (8 cases) -- loads the real catalog `fuse` skill, asserts its prompt declares all six sections in order and the reconcile / labeled-candidate / untrusted-input discipline, and validates recorded/mock judge outputs (well-formed, gracefully-degraded malformed-candidate-set, and broken/empty/out-of-order negative controls) against a pure, total `validateFusionOutput` conformance helper -- no live model call. Auto-runs in CI via the existing `test-ts` job (the `vitest` config already globs `tests/unit/**`). The catalog-count assertion in [../../../../tests/integration/commands/skill-execution.test.ts](../../../../tests/integration/commands/skill-execution.test.ts) was bumped 16 -> 17 for the new skill. |

---

## 1. Open Items

### Phase 1 follow-ups (forward-tier / environmental, not defects)

| ID | Sev | Cat | Description | Suggested next step |
|---|---|---|---|---|
| `OF002.P1.A` | P3 | WN | The OF002-required additions (the consensus / contradictions / blind-spots synthesis vocabulary plus the `fuse` cross-link) pushed `council/SKILL.md`'s prompt body from ~790 to ~881 tokens, over the soft 800-token `prompt-oversized` budget reported by `npm run check:prompts`. This is a **warning, not an error**: the gate exits 0 (warnings do not flip the exit code), and the sibling `review-pr` skill already ships at ~811 tokens as an accepted warning. Trimming pre-existing council prose to compensate would be out of scope (changed lines must trace to the request); the added content is mandated by OF002. Tier: synthesis-vocabulary upgrade `supported`; under-budget prompt `future`. | If a hard token budget is ever enforced on the catalog, extract council's three-pass synthesis-vocabulary guidance into a shared reference snippet (or tighten the three pass-description sections), rather than dropping the fusion alignment. |
| `ENV.P1.A` | P3 | QG | `npm run catalog:check` fails on this branch from **pre-existing** drift unrelated to this plan: the regenerated [../../../../docs/index.md](../../../../docs/index.md) differs only in the `src/panels` module LOC (9671 -> 9790), a surface this plan never touched (`generate-catalog.mjs` scans `src/` modules, not `modules/coding/skills/catalog/`). Recorded so the Phase 5 FINAL gate is not surprised. Tier: not owned by this plan. | At the v1.6.0 FINAL gate (or whichever cycle next touches `src/panels`), run `npm run catalog` and commit the regenerated `docs/index.md` in a change that legitimately owns the `src/panels` LOC delta. |

---

## 2. Resolved

(none beyond the Adoption Ledger rows above)

---

## 3. Summary

| Metric | Count |
|---|---|
| Phases closed | 1 of 5 (Phase 1 -- F1 fuse skill + council synthesis upgrade) |
| Adoption sub-tasks resolved | OF001, OF002, OF003 |
| Open items | 2 (`OF002.P1.A` soft warning, `ENV.P1.A` pre-existing environmental note -- both P3) |
| Defects / quality-gate bypasses | 0 |

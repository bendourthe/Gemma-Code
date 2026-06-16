# v1.6.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: in-progress (Phase 1 closed 2026-06-15). v1.6.0 is the "aisuite harness adoptions + Nexus-AI interactive guide" cycle ([plans/adoption-aisuite-harness.md](plans/adoption-aisuite-harness.md), derived from [comparison-aisuite.md](comparison-aisuite.md)). Phase 1 ships the user-directed headline artifact: the self-contained, offline Nexus-AI interactive guide ([../../../../guides/interactive-guide/nexus-ai-guide.html](../../../../guides/interactive-guide/nexus-ai-guide.html)) -- a 7-page user guide reusing the Nexus-Hub interactive-guide design tokens and constellation background (AS001 + AS002, delivered 2026-06-14), now CI-guarded for offline integrity + reduced motion (AS003, closed 2026-06-15). Remaining phases: A4 session/trace viewer (2), A1 artifact dehydration (3), A2 trace nesting (4), A3 adapter registry (5, backlog), and the FINAL Nexus-Hub sync + acceptance gate (6). This file is appended phase-by-phase; items move to `## 2. Resolved` when closed; the `## 3. Summary` is recomputed each pass.

**Audience**: v1.6.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-06-15 (Phase 1 -- interactive guide AS003 offline-integrity test)
**Sibling reviews**: [../v1.5.0/known-gaps.md](../v1.5.0/known-gaps.md) (the prior cycle's gap log) and [plans/adoption-aisuite-harness.md](plans/adoption-aisuite-harness.md) (the active plan).

**Cycle context**: This file is created in Phase 1 (rather than at a later phase) because the implement-phase post-phase sequence appends gaps every phase. Phase 1 introduces no bug, test failure, coverage shortfall, suppressed lint, or bypassed quality gate; the single seeded entry below is a forward-tier follow-up (`candidate`), not a defect.

**Wording convention**: every prose claim follows [../v1.4.0/development/evidence-and-support-tiers.md](../v1.4.0/development/evidence-and-support-tiers.md) (A7): a gap describes its unbuilt capability at tier `future` or `candidate` (never `supported`); the "Suggested next step" states what cited evidence would raise the tier. "not_observed != absent" applies throughout.

Severity tags: **P0** release-blocker; **P1** should-fix; **P2** nice-to-have; **P3** out-of-scope for v1.6.0 / recorded for future planning.
Category tags: **NI** not implemented; **DF** deferred; **BG** bug; **MT** missing tests; **WN** warning; **QG** quality gate.

---

## 0. Adoption Ledger

Per-sub-task closure ledger for the aisuite-harness adoption plan. Rows land as each phase closes.

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| AS001-AS002 | H1 -- Nexus-AI interactive guide shell + content | Resolved | Phase 1 (2026-06-14); [../../../../guides/interactive-guide/nexus-ai-guide.html](../../../../guides/interactive-guide/nexus-ai-guide.html) -- single self-contained 7-page user guide, design tokens + constellation canvas ported from the Nexus-Hub reference guide, all CSS/JS inline, system-stack fonts, no remote assets. |
| AS003 | H1 -- offline-integrity + reduced-motion test | Resolved | Phase 1 (2026-06-15); [../../../../tests/unit/guides/nexus-ai-guide.offline.test.ts](../../../../tests/unit/guides/nexus-ai-guide.offline.test.ts) (18 cases). DOM-aware `findRemoteAssetRefs` over `node-html-parser` (no new dependency) asserts no remote asset references in load-fetched positions (`src`, `<link href>`, `srcset`, `poster`, `object[data]`, CSS `url()`/`@import`), with `data:` URIs and navigational `<a href>` correctly excluded; asserts the `#constellation` canvas is present and `aria-hidden`; asserts reduced motion takes the `frame(false)` static branch so the lone `requestAnimationFrame` (inside `loop()`) is unreachable. Positive + negative controls guard the checker. Runs in CI via the existing `test-ts` job. Verification: lint 0 errors, check:tampering 0 findings, root suite 4098 passed / 5 skipped / 0 failed, coverage 87.18% lines / 83.02% branches / 90.6% functions (above 80/75/80). |

---

## 1. Open Items

### Phase 1 follow-ups (forward-tier, not defects)

| ID | Sev | Cat | Description | Suggested next step |
|---|---|---|---|---|
| `AS003.P1.A` | P3 | MT | The reduced-motion no-animation guarantee is verified by static analysis of the boot script (the sole `requestAnimationFrame` lives in `loop()`, and `start()` takes the `frame(false)` branch when `REDUCE` is true) rather than by a live browser render. The plan prompt mentioned a "Playwright/e2e smoke" as one option, but the project ships no browser-e2e harness and adding Playwright for one static HTML file is disproportionate to the local-first / minimal-dependency ethos. Tier: offline-integrity + structural reduced-motion `supported`; live-browser render `candidate`. | If a browser-e2e harness is later introduced (e.g. for the Phase 2 A4 viewer), add a smoke that loads the guide with `prefers-reduced-motion` forced and asserts no `requestAnimationFrame` callback fires, raising the live-render half to `supported`. |

---

## 2. Resolved

(none beyond the Adoption Ledger rows above)

---

## 3. Summary

| Metric | Count |
|---|---|
| Phases closed | 1 of 6 (Phase 1) |
| Adoption sub-tasks resolved | AS001, AS002, AS003 |
| Open items | 1 (`AS003.P1.A`, P3 / forward-tier) |
| Defects / quality-gate bypasses | 0 |

# Session history: v1.3.0 Phase 7 -- Stabilization & Benchmarks (FINAL)

**Date**: 2026-05-29
**Cycle**: v1.3.0
**Phase**: 7 (Stabilization & Benchmarks, skill-cleaner adoption track -- FINAL phase)
**Plan reference**: [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](../../plans/adoption-skill-cleaner.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](../../comparison-skill-cleaner.md)
**Acceptance scope**: benchmark `skills audit` against the live catalog (T020), refresh AGENTS.md / README.md / ARCHITECTURE.md for the new audit surface (T021), append the full per-sub-task adoption ledger to the known-gaps file (T022), and run the final end-to-end integration gate (T023). As the plan's final phase, Phase 7 also triggers the release-readiness workflow (Phase 9).

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T020 | [docs/versions/v1/v1.3.0/benchmarks/skills-audit-2026-05-28.md](../../benchmarks/skills-audit-2026-05-28.md) -- skills-audit runtime benchmark. Reproducible harness [tests/fixtures/skills-audit-benchmark-results/2026-05-28/run-benchmark.mjs](../../../../tests/fixtures/skills-audit-benchmark-results/2026-05-28/run-benchmark.mjs) + audit-only RSS probe `rss-probe.mjs` + `results.json` + fixtures `README.md`. Measures wall-clock (CLI child process), peak RSS (audit-only probe), isolated O(N^2) similarity runtime, and deterministic report contents. | Closed |
| T021 | [AGENTS.md](../../../../AGENTS.md) gains a `### Skills audit (v1.3.0 adoption-skill-cleaner track)` subsection under Non-Obvious Tooling (command, five sections, flags, "suggest first" framing). [README.md](../../../../README.md) gains a `### v1.3.0 cycle status` table (7 phases, all Landed) mirroring the v1.2.0 table. [ARCHITECTURE.md](../../../../ARCHITECTURE.md) `core/` tree lists `SkillRenderLine.ts`, `SkillAuditor.ts`, `SkillSimilarity.ts`, `SkillUsageScanner.ts`. | Closed |
| T022 | [docs/versions/v1/v1.3.0/known-gaps.md](../../known-gaps.md) -- appended ledger rows T020-T023 (all Resolved), added a Phase 7 update note to `T013.P3.D` (similarity runtime now captured; MinHash still deferred), recomputed the `## 3. Summary` tally to 23 of 23 sub-tasks resolved. File pre-existed (seeded Phase 1), so T022 appended rather than created. | Closed |
| T023 | Final exit gate: build + full suite + lint + architecture + CLI smokes. Plan checkboxes for T020-T023 and the Phase 7 Exit Checklist marked complete. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan's T020 prompt frames the benchmark against "the live 213-skill catalog". | The live catalog on this host is the builtin-only root (16 skills); the full ~213-skill Nexus-Hub catalog flows in only through an upstream-release sync (carryforward `1.1.P3.B`), exactly as Phase 3 (T010) and Phase 5 (T016) recorded. The benchmark is published as a builtin-catalog baseline with a catalog-size-independent harness, so a future cycle reruns it once the full catalog syncs. Documented explicitly in the benchmark's "Catalog under test" section. |
| D2 | The plan's T020 prompt asks for "3 runs, report median + p95". | The harness runs 1 warmup (discarded) + 10 timed runs so the median and p95 are statistically meaningful; 10 >= the plan's 3-run floor. |
| D3 | The plan's T022 says "Create (if absent) ... known-gaps.md". | The file already existed (seeded in Phase 1 because the implement-phase post-phase sequence appends gaps every phase), so T022 appended the T020-T023 ledger rows and recomputed the summary instead of creating the file. The seeded sections were already forward-compatible with this pass. |
| D4 | n/a (housekeeping) | The full test run rewrote an unrelated benchmark fixture (`tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json` -- only host-dependent `ingestMs`/`compactMs` fields; the gated `onDiskBytes`/`storageRatio` were byte-identical). It was reverted so the commit stays scoped to Phase 7, and the byte-identical ratio confirms T023's "prior benchmarks still reproduce" requirement. |

## 3. Test + gate results

- `npm run build` (tsc): clean.
- `npm run lint` (`eslint src`): 0 errors. The new files are docs + a plain-JS benchmark harness under `tests/fixtures/` (outside the `eslint src` scope); no production TypeScript was added.
- `npm run check-architecture` (`depcruise src core modules`): 0 errors. The 11 pre-existing warnings (orphan stubs + one known `MemoryHub` circular) are unrelated to this phase, which added no TS modules.
- `npm run test`: 3,704 passed, 0 failed, 5 skipped (332 files, 2 skipped). The full suite includes the v1.2.0 token-usage and storage-size benchmark tests, both of which reproduced within tolerance (storage ratio 18.68% unchanged).
- Live smoke runs: `node bin/nexus.mjs skills audit` renders all five sections (Skill Budget, Description candidates, Duplicates with By-name + By-similarity, Unused candidates, Root summary).
- `node bin/nexus.mjs skills sync --dry-run`: returns "upstream did not return tag_name" -- the expected manifestation of carryforward `1.1.P3.B` (the network sync path needs an upstream release; not present on this host, not a regression from this track). The new skill's presence is verified via the local `buildManifest` walk in the syncer test suite (green).
- Benchmark capture (T020): wall-clock median 118.6 ms / p95 159.7 ms (10 runs), peak RSS 51.5 MB, similarity pass 4.4 ms median over 120 comparisons (16 skills, 0 pairs >= 0.85), budget pressure 34.8% at the default 2% envelope, 12 of 16 description candidates, render rung `full`.

## 4. Known-gaps changes

In [docs/versions/v1/v1.3.0/known-gaps.md](../../known-gaps.md):

- **Added** four adoption-ledger rows (T020, T021, T022, T023), all `Resolved` for Phase 7.
- **Updated** `T013.P3.D`: a Phase 7 update note records that the similarity runtime is now captured in the T020 benchmark; the item stays open because the MinHash/LSH pre-filter itself is not implemented (deferred until the catalog roughly doubles).
- **Summary** recomputed: 23 of 23 adoption sub-tasks resolved (T001-T023). The 4 open items (1 WN `T002.P2.A`, 3 DF `T012.P2.C` / `T013.P3.D` / `T017.P3.E`) are all carryforward/deferred follow-ups, none release-blocking for v1.3.0.

## 5. Next steps

- Phase 9 (release-readiness workflow) runs next: resolve/triage known gaps (9A), verify tests + CI/CD (9B), docs + project refactor audits (9C), `/update-*` checks (9D), and prepare the v1.3.0 version bump + tag + release notes (9E).
- The 4 open items carry forward to the next cycle's `/generate-plan` Step 0.6: `T002.P2.A` and `T017.P3.E` are Nexus-Hub-side (secret-scan false positives + allowlist drain); `T012.P2.C` (multi-root usage scan) and `T013.P3.D` (MinHash/LSH pre-filter) are Nexus-side enhancements gated on catalog growth.
- The adoption-skill-cleaner track is **complete** -- all 7 phases landed and all 23 sub-tasks are resolved.

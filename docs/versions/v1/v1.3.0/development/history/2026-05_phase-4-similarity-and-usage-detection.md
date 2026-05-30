# Session history: v1.3.0 Phase 4 -- Similarity + Usage Detection

**Date**: 2026-05-29
**Cycle**: v1.3.0
**Phase**: 4 (Similarity + Usage Detection, skill-cleaner adoption track)
**Plan reference**: [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](../../plans/adoption-skill-cleaner.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](../../comparison-skill-cleaner.md)
**Acceptance scope**: complete the five-report shape by populating the `By similarity` and `Unused candidates` sections -- content-similarity duplicate detection (insight I-08) and session-log usage-evidence scanning (insight I-10) -- with no false-positive deletion recommendations (audit stays "suggest first", insight I-12).

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T011 | [core/skills/SkillSimilarity.ts](../../../../../core/skills/SkillSimilarity.ts) -- `shingles` / `jaccard` / `findSimilarPairs` (Jaccard over k-shingles, default threshold 0.85) plus `normalizeBody` (strip frontmatter + code, collapse whitespace) (insight I-08). Test: [tests/unit/core/skills/SkillSimilarity.test.ts](../../../../../tests/unit/core/skills/SkillSimilarity.test.ts) (14 cases). | Closed |
| T012 | [core/skills/SkillUsageScanner.ts](../../../../../core/skills/SkillUsageScanner.ts) -- `scanUsage({ skillsRoot, sessionsRoot?, months? })` with 3-tier signal detection (HookBus event > slug mention > SKILL.md path), mtime-windowed, counts-only (insight I-10). Test: [tests/integration/SkillUsageScanner.test.ts](../../../../../tests/integration/SkillUsageScanner.test.ts) (7 cases). | Closed |
| T013 | [core/skills/SkillAuditor.ts](../../../../../core/skills/SkillAuditor.ts) -- `duplicates.bySimilarity` + `unused` populated; exported `UNUSED_FRAMING`; confidence ladder; `usage` injection seam. [bin/nexus.mjs](../../../../../bin/nexus.mjs) -- `--months` pass-through + new `--sessions-root`. Tests: `SkillAuditor.test.ts` (12 cases), `skills-audit-cli.test.ts` updated. | Closed |
| T014 | Build + lint + architecture + full-suite gate; live `skills audit --months 3` smoke run with similarity + usage populated. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan has `auditSkills` call `scanUsage` directly, but the T013 unit test needs "a skill with zero usage signals" without disk coupling, and the live CLI scan over `~/.nexus/sessions/` would be non-deterministic. | Added a `usage?: ReadonlyMap` injection seam to `SkillAuditOptions`. `auditSkills` prefers an injected `usage` Map, falls back to calling `scanUsage` when a `skillsRoot` is set, else leaves `unused` empty. Unit tests inject a synthetic Map; the CLI passes `skillsRoot` so the real scan still runs. |
| D2 | T013 names only `--months` for the CLI. | Also added `--sessions-root <dir>` (mirroring the existing `--skills-root` testing seam) so the integration test scans a controlled empty log root. Without it the Unused output depends on the host's real session logs (common words like "beta" match) -- non-deterministic and potentially slow. Documented in `HELP`. |
| D3 | The plan places the new tests at `tests/skills/...`. | Tests follow the repo's actual layout: `tests/unit/core/skills/SkillSimilarity.test.ts` and `tests/integration/SkillUsageScanner.test.ts` (consistent with Phases 2-3). |
| D4 | The T013 unit test for near-duplicates used a short base body + short addition, which yields Jaccard ~0.72 (below 0.85). | Classified TEST (test-data error, not an implementation bug). Switched to a long base body with a tiny appended delta so a genuine near-duplicate clears the 0.85 threshold. |
| D5 | The smoke run anticipates a synced ~213-skill Nexus-Hub catalog. | This host's `~/.nexus/skills` is empty, so the live catalog is the 16-skill bundled `src/skills/catalog`. The detectors function identically at any size; `By similarity` reports "no near-duplicates above threshold" and all 16 skills surface as zero-evidence Unused candidates (the host has no matching session-log evidence). |

## 3. Test + gate results

- `npm run build` (tsc): clean (new modules emit to `out/core/skills/`).
- `npm run test`: 3,691 passed, 0 failed, 5 skipped (328 files). The new/modified files add 33 tests (14 SkillSimilarity unit + 7 SkillUsageScanner integration + 4 new SkillAuditor unit + updated CLI integration cases).
- `npm run lint` (`eslint src`): 0 errors (`core/**` is intentionally outside the `eslint src` scope; the new modules are type-checked by `tsc`).
- `npm run check-architecture` (`depcruise src core modules`): 0 errors. The new `core/skills` modules import only node built-ins and sibling `core/skills` files; the `core/** -> modules/**` boundary holds.
- Live smoke run (`node bin/nexus.mjs skills audit --months 3`): all five sections render. Budget 891 / 2,560 tokens, 34.8% pressure on gemma4:e4b; 12 Description candidates; name-Duplicates "none found"; `By similarity` reports "no near-duplicates above threshold"; `Unused candidates` lists 16 zero-evidence skills under the suggest-first framing with no destructive imperatives; Root summary lists the builtin root (16 skills).

## 4. Known-gaps changes

In [docs/versions/v1/v1.3.0/known-gaps.md](../../known-gaps.md):

- **Added** four adoption-ledger rows (T011-T014), all `Resolved` for Phase 4.
- **Added** two deferred open items: `T012.P2.C` (the usage scan covers only the primary skill root, not all three; scoped to the Unused section), and `T013.P3.D` (content-similarity is O(N^2); MinHash/LSH deferred until the catalog roughly doubles, per the plan).
- **Summary** recomputed: DF open 0 -> 2; total open 1 -> 3. Adoption ledger 14 of 23 (T001-T014); 9 pending across Phases 5-7.

## 5. Next steps

- Advance to Phase 5 (Render-Budget Enforcement, T015-T016): add the full -> equal-truncate -> omit-min fallback ladder to `core/skills/SkillRenderLine.ts`, and have `SkillAuditor` report which rung the catalog would land on (a new `Render rung:` line in the Budget section). The live agent-loop render path is intentionally NOT changed in Phase 5.
- Consider folding `T012.P2.C` (multi-root usage scan) into Phase 6 (T018 `--by-root`), since both touch the same root-resolution surface.

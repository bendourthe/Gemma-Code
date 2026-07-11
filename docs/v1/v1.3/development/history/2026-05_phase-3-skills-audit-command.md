# Session history: v1.3.0 Phase 3 -- Skills Audit Command

**Date**: 2026-05-29
**Cycle**: v1.3.0
**Phase**: 3 (Skills Audit Command, skill-cleaner adoption track)
**Plan reference**: [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](../../plans/adoption-skill-cleaner.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](../../comparison-skill-cleaner.md)
**Acceptance scope**: wire the four Phase-2 utilities into a `nexus skills audit` CLI command that produces four of the five report sections (Budget, Description candidates, name-Duplicates, Root summary) against the live catalog. Content-similarity duplicates and unused-candidates remain labelled Phase 4 placeholders.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T008 | [core/skills/SkillAuditor.ts](../../../../core/skills/SkillAuditor.ts) -- `auditSkills(opts)` composition + `formatAuditReport(report)` Markdown renderer (insights I-01 / I-05 / I-06 / I-09). Catalog + model registry injected. Test: [tests/unit/core/skills/SkillAuditor.test.ts](../../../../tests/unit/core/skills/SkillAuditor.test.ts) (8 cases). | Closed |
| T009 | [bin/nexus.mjs](../../../../bin/nexus.mjs) -- `skills audit` subcommand with `--context-tokens` / `--budget-percent` / `--months` (Phase-4 no-op) / `--json` / `--skills-root`; read-only live-catalog builder. Test: [tests/integration/skills-audit-cli.test.ts](../../../../tests/integration/skills-audit-cli.test.ts) (3 cases). | Closed |
| T010 | Build + test + live-catalog smoke run; baseline captured for Phase 7 (T020). | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan's `SkillAuditOptions` interface does not list a `catalog` field, but the T008 unit test requires "a small in-memory fixture catalog". | Added `catalog` (required) and `modelRegistry` (optional) to `SkillAuditOptions` so the auditor is pure composition with no filesystem access: tests inject a fixture catalog, the CLI injects the live one. This is the only way to satisfy both "use the existing SkillCatalog" and the in-memory-fixture test in the same signature. |
| D2 | The plan places the tests at `tests/skills/...` and `tests/integration/...`. | The unit test mirrors source under `tests/unit/core/skills/` (the repo convention for every `core/skills` test); the integration test sits at the plan's `tests/integration/skills-audit-cli.test.ts`. |
| D3 | T009's flag list is `--context-tokens` / `--budget-percent` / `--months` / `--json`. The integration test must run "against a fixture skills root". | Added a `--skills-root <dir>` override flag (documented in `HELP`) so the test can point the read-only catalog builder at a temp fixture; with no override the CLI uses the default trio (builtin `src/skills/catalog`, `~/.nexus/skills/user`, active DevAI-Hub tag). |
| D4 | T009 says "invoking the CLI as a child process". | The integration test invokes the exported `runSkillsAudit` in-process with injected stdout/stderr capture streams -- the repo convention for the other `runSkills*` CLI functions and faster / less flaky on Windows. It still exercises the full CLI surface across the compiled `out/` auditor bundle, and a `beforeAll` builds that bundle if missing so the test is self-sufficient. |
| D5 | The smoke run expects ~213 skills (a synced Nexus-Hub catalog). | This host's `~/.nexus/skills` is empty (no synced DevAI-Hub tag, no user skills), so the live catalog is the 16-skill bundled `src/skills/catalog`. The auditor functions identically at any catalog size; the five sections render and `usedTokens` is non-zero. A full-catalog run will reproduce once a DevAI-Hub tag is synced (Phase 7 benchmark, T020). |

## 3. Test + gate results

- `npm run build` (tsc): clean (new `SkillAuditor.ts` emits to `out/core/skills/`).
- `npm run test`: 3,666 passed, 0 failed, 5 skipped (326 files). The two new files add 11 tests (8 unit + 3 integration), all passing.
- `npm run lint` (`eslint src`): 0 errors (`core/**` is intentionally outside the `eslint src` scope).
- `npm run check-architecture` (`depcruise src core modules`): 0 errors. Importing `tokenize` + `ModelRegistry` into `SkillAuditor` removed the Phase-2 `TokenCost` orphan warning.
- Live smoke run (`node bin/nexus.mjs skills audit`): all five sections render. Budget 891 / 2,560 tokens, 34.8% pressure on gemma4:e4b's 128K window; 12 Description candidates; name-Duplicates "none found"; `By similarity` + `Unused candidates` show the `_(populated by phase 4)_` placeholder; Root summary lists the builtin root (16 skills). `--json` output validated (well-formed, `bySimilarity` / `unused` empty arrays).

## 4. Known-gaps changes

In [docs/versions/v1/v1.3.0/known-gaps.md](../../known-gaps.md):

- **Resolved** `T007.P2.B` (the Phase-2 `TokenCost.ts` dependency-cruiser orphan) -- moved to `## 2. Resolved`; T008 imports `tokenize` + `ModelRegistry`, removing the orphan edges.
- **Added** three adoption-ledger rows (T008, T009, T010), all `Resolved` for Phase 3.
- **Summary** recomputed: WN open 2 -> 1, resolved 0 -> 1; total open 2 -> 1, resolved 0 -> 1. Adoption ledger 10 of 23 (T001-T010); 13 pending across Phases 4-7. No new open items: Phase 3 had no skipped sub-tasks, no failing tests, no bypassed gates.

## 5. Next steps

- Advance to Phase 4 (Similarity + Usage Detection): create `core/skills/SkillSimilarity.ts` (Jaccard over shingles, T011) and `core/skills/SkillUsageScanner.ts` (session-log scan, T012), then wire both into `SkillAuditor` to populate `duplicates.bySimilarity` and `unused`, and pass the `--months` window through end-to-end (T013).
- The `--months` flag is parsed and accepted today but is a no-op until T013; the `bySimilarity` / `unused` report arrays stay empty until then.

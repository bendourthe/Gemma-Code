# Session history: v1.3.0 Phase 6 -- Upstream Hygiene + P3 Backlog

**Date**: 2026-05-29
**Cycle**: v1.3.0
**Phase**: 6 (Upstream Hygiene + P3 Backlog, skill-cleaner adoption track)
**Plan reference**: [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](../../plans/adoption-skill-cleaner.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](../../comparison-skill-cleaner.md)
**Acceptance scope**: land the P2 upstream Nexus-Hub validator extension (insight I-03 -- single-line `name`/`description` discipline enforced at PR time) and the two P3 CLI backlog flags (`--deep-logs` to scan archived + gzip session logs, `--by-root` to scope the audit to one provenance source). Stability gate: the Nexus-Hub validator rejects malformed frontmatter; both P3 flags pass through `bin/nexus.mjs` end-to-end.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T017 | `../Nexus-Hub/scripts/validate_skills.py` -- new `validate_frontmatter_format` helper (single-line kebab `name`; <=250-char single-line `description`; absent-`name` -> parent-dir default) wired into `validate_skill_dir`; new `--allow-existing` flag + `load_allowlist` reading `scripts/validate_skills.allowlist.json` (137 grandfathered offenders) to demote known violations to warnings. New `tests/validators/test_validate_skills.py` (11 tests). | Closed |
| T018 | [core/skills/SkillUsageScanner.ts](../../../../core/skills/SkillUsageScanner.ts) -- `deepLogs` option + `walkSessionLogs` / `readLogText` (archive subtree + `*.jsonl.gz` via `zlib.gunzipSync`). [core/skills/SkillAuditor.ts](../../../../core/skills/SkillAuditor.ts) -- `byRoot` filter (scopes all sections + Unused set, sets `filteredToRoot`), `deepLogs` thread-through; `formatAuditReport` prints `Filtered to root:` header and suppresses `## Root summary`. [bin/nexus.mjs](../../../../bin/nexus.mjs) -- `--by-root` (validated) + `--deep-logs` parsing, help text, usage-scan root alignment. Tests: 2 new auditor by-root cases + new [tests/integration/skills-audit-deep-logs.test.ts](../../../../tests/integration/skills-audit-deep-logs.test.ts) (2 cases). | Closed |
| T019 | Build + full-suite + lint + architecture gate; live `skills audit --by-root builtin` and `--deep-logs --months 12` smoke runs; upstream validator `--allow-existing` verification. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan places the new tests at `tests/skills/...` and `tests/integration/...`. | The auditor unit test follows the repo's actual layout (`tests/unit/core/skills/SkillAuditor.test.ts`); the deep-logs integration test sits at `tests/integration/skills-audit-deep-logs.test.ts` (consistent with Phases 2-5). |
| D2 | The plan expects T017 to leave the upstream validator green (or absorbed by the allowlist). | Enforcing the 250-char rule surfaced 137 pre-existing over-long descriptions; per the "do not mass-edit" instruction these were grandfathered into `validate_skills.allowlist.json`. An unflagged run is 144 errors; `--allow-existing` reduces it to 7 -- the 7 remaining are pre-existing secret-scan false positives (`T002.P2.A`), out of scope for T017. The allowlist drain is recorded as new open item `T017.P3.E`. |
| D3 | The plan suggested folding `T012.P2.C` (multi-root usage scan) into T018's `--by-root`. | `--by-root` narrows the scan to one matching root rather than widening it to all roots; the single-`skillsRoot` limitation in `scanUsage` is unchanged, so `T012.P2.C` remains open (a Phase 6 status note was added to it). |
| D4 | n/a (housekeeping) | An unrelated benchmark fixture (`tests/fixtures/memory-tier-benchmark-results/2026-05-26/results.json`) rewritten by the test run was reverted so the commit stays scoped to Phase 6. |

## 3. Test + gate results

- `npm run build` (tsc): clean.
- `npm run test`: 3,704 passed, 0 failed, 5 skipped (330 files). New/modified local tests: 2 auditor by-root cases + 2 deep-logs integration cases; the existing SkillUsageScanner and skills-audit-cli suites pass unchanged.
- Upstream `python -m pytest tests/validators/`: 55 passed (11 new in `test_validate_skills.py`).
- `npm run lint` (`eslint src`): 0 errors (`core/**`, `bin/**`, and `tests/**` are outside the `eslint src` scope; the new code is type-checked by `tsc`).
- `npm run check-architecture` (`depcruise src core modules`): 0 errors / 0 new violations. The 11 pre-existing warnings (orphan stubs + one known circular) do not reference the touched files; the `core/** -> modules/**` boundary holds (the scanner adds only a `node:zlib` built-in import).
- Live smoke runs (`node bin/nexus.mjs skills audit`): `--by-root builtin` prints `Filtered to root: builtin` and emits 0 `## Root summary` headings; `--deep-logs --months 12` emits all five sections and exits 0.
- Upstream validator: `python scripts/validate_skills.py` -> FAIL (144 errors); `--allow-existing` -> FAIL (7 errors, the pre-existing secret-scan findings only) -- confirming the new rules fire and the allowlist absorbs the 137 format violations.

## 4. Known-gaps changes

In [docs/versions/v1/v1.3.0/known-gaps.md](../../known-gaps.md):

- **Added** three adoption-ledger rows (T017, T018, T019), all `Resolved` for Phase 6.
- **Added** one open item: `T017.P3.E` (DF, P3) -- drain the 137-entry Nexus-Hub allowlist of over-long descriptions.
- **Updated** `T002.P2.A`: the `--allow-existing` mechanism now exists (format-rule-scoped); the item stays open for the secret-scan grandfathering only.
- **Updated** `T012.P2.C`: a Phase 6 status note records that `--by-root` touched the same surface but did not widen the scan; still open.
- **Summary** recomputed: DF 3 open, WN 1 open + 1 resolved; total 4 open / 1 resolved. **Adoption ledger** 19 of 23 (T001-T019); 4 pending in Phase 7 (T020-T023).

## 5. Next steps

- Advance to Phase 7 (Stabilization & Benchmarks, T020-T023): benchmark `skills audit` against the live catalog (T020), refresh AGENTS.md / README.md / ARCHITECTURE.md for the new audit surface and the `--deep-logs` / `--by-root` flags (T021), append the full per-sub-task adoption ledger (T022, already partly seeded here), and run the final integration gate (T023). Phase 7 is the final phase of this plan and triggers the release-readiness workflow.
- Upstream follow-ups carried by `T017.P3.E` (allowlist drain) and `T002.P2.A` (secret-scan false positives) are Nexus-Hub-side; a future Nexus cycle's `/generate-plan` Step 0.6 can ingest both.
- Commit the upstream Nexus-Hub changes (`validate_skills.py`, `validate_skills.allowlist.json`, `tests/validators/test_validate_skills.py`) separately in that repo, scoped away from its other in-progress edits.

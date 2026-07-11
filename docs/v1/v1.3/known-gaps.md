# v1.3.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: open. v1.3.0 opens with the skill-cleaner adoption track ([plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md), derived from [comparison-skill-cleaner.md](comparison-skill-cleaner.md)). Phase 1 (2026-05-28) ships the one skill-native item: the `skill-description-authoring` Nexus-Hub skill encoding the trigger-noun preservation rule (product / tool / action / object) plus single-line / ASCII-sanitized description discipline. No code surface in `core/` or `modules/` is touched in Phase 1; the deliverable lives entirely in the sibling Nexus-Hub repo. Phases 2-7 land the code-shaped items (foundational utilities, the `nexus skills audit` command, similarity + usage detection, render-budget enforcement, upstream hygiene, and stabilization). The known-gaps file is appended phase-by-phase; items move to `## 2. Resolved` when closed in a later phase; the `## 3. Summary` at the bottom is recomputed each pass.

**Audience**: v1.3.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-05-29 (Phase 7 -- adoption-skill-cleaner track complete)
**Sibling reviews**: [docs/versions/v1/v1.2.0/known-gaps.md](../v1.2/known-gaps.md) (the upstream cycle gap log; carryforward open items remain in force during v1.3.0); [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) (the active adoption plan); [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](comparison-skill-cleaner.md) (the single-source comparison this track adopts).

**Cycle context**: This file is created in Phase 1 (rather than deferred to T022 / Phase 7 as the plan text anticipated) because the implement-phase post-phase sequence appends gaps every phase. T022 in Phase 7 will append the full per-sub-task adoption ledger to this same file; the seeded sections below are forward-compatible with that pass.

Each entry has a severity tag:

- **P0** -- release-blocker for v1.3.0 (must close)
- **P1** -- should-fix in v1.3.0
- **P2** -- nice-to-have; documented for completeness
- **P3** -- out-of-scope for v1.3.0; explicitly recorded for future planning

Each entry has a category tag:

- **NI** (not implemented) -- a plan sub-task that was skipped
- **DF** (deferred) -- a plan sub-task explicitly deferred to a later phase / cycle
- **BG** (bug) -- a deviation that revealed a real defect
- **MT** (missing tests) -- a coverage shortfall
- **WN** (warning) -- a suppressed lint or runtime warning
- **QG** (quality gate) -- a Phase 7 gate the cycle author bypassed with "Proceed anyway"

---

## 0. Adoption Ledger

This is the per-sub-task closure ledger for the skill-cleaner adoption plan. T022 (Phase 7) appends the full ledger; the Phase 1 rows are recorded here as they land.

### Skill-cleaner adoption (adoption-skill-cleaner)

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| T001 | Author `skill-description-authoring` Nexus-Hub skill (insight I-15, P1) | Resolved | adoption-skill-cleaner Phase 1 (2026-05-28); committed in Nexus-Hub; upstream release flow pending per carryforward `1.1.P3.B` |
| T002 | Validate the new Hub skill + manifest walk (Phase 1 stabilization) | Resolved | adoption-skill-cleaner Phase 1 (2026-05-28); `validate_skills.py` PASS (0 errors, 0 quality warnings); `buildManifest` walk reports 219 skills with the new skill present |
| T003 | Create model-agnostic `tokenize()` helper at `core/observability/TokenCost.ts` (insight I-04, P0) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `ceil(utf8_bytes / 4)`; 4 unit tests (ASCII / Latin-accent / emoji+CJK / empty) |
| T004 | Add `contextWindow` + `getActiveContextWindow()` to `core/registry/ModelRegistry.ts` (insight I-05, P0) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `DEFAULT_CONTEXT_WINDOW=272000`, gemma4:e4b seeded at 128000; 9 unit tests |
| T005 | Create canonical render formatter at `core/skills/SkillRenderLine.ts` (insight I-02, P0) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `renderSkillLine` / `renderSkillBlock`; newline-flattening + empty-description handling; 6 unit tests |
| T006 | Realpath dedup before insertion in `core/skills/SkillCatalog.ts` (insight I-07/I-09, P1) | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `dedupeByRealpath` + `skills.dedup` TelemetryBus event; builtin>user>devai-hub keep-priority; 7 unit tests (junction fixture) |
| T007 | Phase 2 build + test + lint + architecture gate | Resolved | adoption-skill-cleaner Phase 2 (2026-05-29); `npm run build` clean, 3655 tests pass (0 fail), `eslint src` 0 errors, `check-architecture` 0 errors; see open item T007.P2.B |
| T008 | Create the auditor module at `core/skills/SkillAuditor.ts` (insights I-01/I-05/I-06/I-09, P0) | Resolved | adoption-skill-cleaner Phase 3 (2026-05-29); `auditSkills` + `formatAuditReport` compose TokenCost / ModelRegistry / SkillRenderLine / SkillCatalog into Budget + Descriptions + name-Duplicates + Roots; `bySimilarity` / `unused` stubbed for Phase 4; 8 unit tests |
| T009 | Add the `skills audit` subcommand to `bin/nexus.mjs` (insight I-11 minus P3 flags) | Resolved | adoption-skill-cleaner Phase 3 (2026-05-29); `--context-tokens` / `--budget-percent` / `--months` (no-op until Phase 4) / `--skills-root` / `--json`; read-only disk catalog builder; 3 integration tests |
| T010 | Phase 3 build + test + live-catalog smoke run | Resolved | adoption-skill-cleaner Phase 3 (2026-05-29); `npm run build` clean, 3666 tests pass (0 fail), `eslint src` 0 errors; live smoke run emits all five sections (budget 891/2560 tokens, 34.8% pressure on gemma4:e4b; 12 description candidates; 16 builtin skills) |
| T011 | Create Jaccard-over-shingles similarity detector at `core/skills/SkillSimilarity.ts` (insight I-08, P1) | Resolved | adoption-skill-cleaner Phase 4 (2026-05-29); `shingles` / `jaccard` / `findSimilarPairs` (default threshold 0.85) over frontmatter-and-code-stripped bodies; 14 unit tests (identical / disjoint / near-duplicate / sort order) |
| T012 | Create session-log usage scanner at `core/skills/SkillUsageScanner.ts` (insight I-10, P1) | Resolved | adoption-skill-cleaner Phase 4 (2026-05-29); `scanUsage` with 3-tier signal detection (HookBus `skill.loaded`/`invoked`/`entry` event > slug mention > SKILL.md path), mtime-windowed, counts-only (no deletion proposals); 7 integration tests covering all tiers + window exclusion; see open item T012.P2.C |
| T013 | Wire `SkillSimilarity` + `SkillUsageScanner` into `core/skills/SkillAuditor.ts`; thread `--months` + `--sessions-root` through `bin/nexus.mjs` (insights I-08 / I-10 / I-12) | Resolved | adoption-skill-cleaner Phase 4 (2026-05-29); `duplicates.bySimilarity` + `unused` now populated; exported `UNUSED_FRAMING` suggest-first string; confidence ladder (low <6mo / medium <12mo / high >=12mo); `usage` Map injection seam for the CLI + tests; 12 unit tests |
| T014 | Phase 4 build + test + live-catalog smoke run | Resolved | adoption-skill-cleaner Phase 4 (2026-05-29); `npm run build` clean, 3691 tests pass (0 fail), `eslint src` 0 errors, `check-architecture` 0 errors; live smoke run populates By-similarity ("no near-duplicates above threshold") + 16 Unused candidates with the suggest-first framing and no destructive imperatives |
| T015 | Add the budget-driven fallback ladder to `core/skills/SkillRenderLine.ts` (insight I-06, P1) | Resolved | adoption-skill-cleaner Phase 5 (2026-05-29); `renderSkillBlockWithinBudget` (full -> equal-truncate -> priority-ordered omit, devai-hub before user before builtin per I-09); `name`/`path` never truncated (I-15); auditor surfaces a `Render rung:` line in `## Skill Budget`; 6 fallback unit tests + 3 auditor rung tests; live render path intentionally untouched in v1.3.0 |
| T016 | Phase 5 build + test + live-catalog rung verification | Resolved | adoption-skill-cleaner Phase 5 (2026-05-29); `npm run build` clean, 3700 tests pass (0 fail), `check-architecture` 0 new violations; CLI smoke run shows `Render rung` line; `--budget-percent 100` -> `full`, `--budget-percent 0.1` -> `omitted` (drops 14 of 16); default 2% is `full` on this host (16-skill builtin-only catalog) since the 213 Hub skills await the upstream-release sync tracked by carryforward `1.1.P3.B` |
| T017 | Extend Nexus-Hub `scripts/validate_skills.py` with single-line `name` / `description` rules + `--allow-existing` (insight I-03, P2) | Resolved | adoption-skill-cleaner Phase 6 (2026-05-29); three checks (kebab-case `name`, <=250-char `description`, absent-`name` -> parent-dir default); `--allow-existing` + `scripts/validate_skills.allowlist.json` grandfathers 137 pre-existing over-long descriptions (144 errors -> 7 with the flag; the 7 remaining are the pre-existing secret-scan false positives tracked by T002.P2.A); 11 new tests in `tests/validators/test_validate_skills.py` (55 validator tests pass); allowlist drain tracked by new open item T017.P3.E |
| T018 | Add P3 CLI flags `--deep-logs` + `--by-root` to `bin/nexus.mjs` + `core/skills/SkillAuditor.ts` (insight I-11 P3 subset) | Resolved | adoption-skill-cleaner Phase 6 (2026-05-29); `--deep-logs` extends `SkillUsageScanner` into the `archive/` subtree + gzip `*.jsonl.gz` logs (via `zlib.gunzipSync`, no new dependency); `--by-root builtin\|user\|devai-hub` scopes every report section to one source, suppresses the Root summary, and prints a `Filtered to root:` header; 2 new auditor unit tests (by-root) + a new `tests/integration/skills-audit-deep-logs.test.ts` (2 archive/gz cases) |
| T019 | Phase 6 build + test + end-to-end flag smoke runs | Resolved | adoption-skill-cleaner Phase 6 (2026-05-29); `npm run build` clean, 3704 tests pass (0 fail), `eslint src` 0 errors, `check-architecture` 0 new violations; live `--by-root builtin` suppresses Root summary + shows header, `--deep-logs --months 12` emits all five sections and exits 0; upstream `validate_skills.py --allow-existing` absorbs the 137 format violations |
| T020 | Publish the skills-audit runtime benchmark (Phase 7 stabilization) | Resolved | adoption-skill-cleaner Phase 7 (2026-05-29); [benchmarks/skills-audit-2026-05-28.md](benchmarks/skills-audit-2026-05-28.md) + harness + `results.json` ([tests/fixtures/skills-audit-benchmark-results/2026-05-28/](../../../tests/fixtures/skills-audit-benchmark-results/2026-05-28)); builtin-catalog baseline (16 skills; full 213-skill catalog awaits carryforward 1.1.P3.B): wall-clock median 118.6ms / p95 159.7ms, peak RSS 51.5MB, similarity pass 4.4ms over 120 comparisons, budget pressure 34.8% at the default 2% envelope; partially addresses T013.P3.D (similarity runtime now captured) |
| T021 | Documentation refresh -- AGENTS.md / README.md / ARCHITECTURE.md (Phase 7) | Resolved | adoption-skill-cleaner Phase 7 (2026-05-29); AGENTS.md gains a `### Skills audit` Non-Obvious-Tooling subsection; README.md gains a `### v1.3.0 cycle status` table (7 phases, all Landed); ARCHITECTURE.md `core/` tree lists `SkillRenderLine.ts` / `SkillAuditor.ts` / `SkillSimilarity.ts` / `SkillUsageScanner.ts` |
| T022 | Append the adoption ledger to `docs/versions/v1/v1.3.0/known-gaps.md` (Phase 7) | Resolved | adoption-skill-cleaner Phase 7 (2026-05-29); this ledger -- file pre-existed (seeded Phase 1), so T022 appends the T020-T023 rows and recomputes the summary rather than creating the file |
| T023 | Full Phase 1-7 test suite + exit gate (Phase 7) | Resolved | adoption-skill-cleaner Phase 7 (2026-05-29); `npm run build` clean, `eslint src` 0 errors, `check-architecture` 0 errors (11 pre-existing orphan/circular warnings), `npm run test` 3704 passed / 0 failed / 5 skipped (332 files); `skills audit` renders all five sections; `skills sync --dry-run` network path blocked by carryforward 1.1.P3.B (no upstream release on this host) -- not a regression |

---

## 1. Open Items

### T002.P2.A -- Nexus-Hub validate_skills.py reports 7 pre-existing false-positive secret matches (WN, P2)

- **Source phase**: adoption-skill-cleaner Phase 1 (T002)
- **Plan reference**: [plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) Phase 6 sub-task T017
- **Reason**: Running the full Nexus-Hub `python scripts/validate_skills.py` (no `--path` filter) exits 1 with 7 ERROR-level "potential Generic secret assignment" findings in unrelated, pre-existing skills (`ai-development/google-antigravity-sdk`, `documentation/user-documentation` x2, `infrastructure/cd-pipeline-generator` x2, `infrastructure/rollback-strategy-advisor` x2). These are example snippets (e.g. `password = "..."` in runbook / pipeline samples), not real secrets. They predate this track and are not introduced by the new `skill-description-authoring` skill, which passes both the targeted full validator and the quality pass with 0 errors / 0 warnings. The plan's Phase 6 explicitly says not to mass-edit pre-existing violations; an `--allow-existing` allowlist (`validate_skills.allowlist.json`) is the intended remedy.
- **Suggested next step**: Phase 6 / T017 introduced the `--allow-existing` allowlist (`scripts/validate_skills.allowlist.json`), but it is scoped to the new single-line `name` / `description` violations only -- it does not yet demote these 7 secret-scan false positives, which still surface as ERROR-level findings on an unflagged full run. Remaining work: either extend the allowlist semantics to also grandfather known secret-scan false positives, or refine the `Generic secret assignment` regex to skip fenced code-block examples. Track as a Nexus-Hub-side issue.
- **Phase 6 update (2026-05-29)**: the `--allow-existing` mechanism now exists (format-rule-scoped); this item stays open for the secret-scan grandfathering only.

### T012.P2.C -- Usage scan covers only the primary skill root (DF, P2)

- **Source phase**: adoption-skill-cleaner Phase 4 (T012 / T013)
- **Plan reference**: [plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) Phase 4 sub-task T012
- **Reason**: `scanUsage` takes a single `skillsRoot` (the plan-fixed signature), and the CLI passes only the primary root (`skillRootsFor(flags)[0]` -- the `--skills-root` override when given, otherwise the bundled built-in catalog). On a host with active `user` and `devai-hub` roots, the Unused report enumerates only the primary root's skills; skills that live exclusively in the other two roots are not surfaced as unused candidates. The audit's other four sections (Budget / Descriptions / name-Duplicates / Roots) already span all roots via the injected catalog, so this gap is scoped to the Unused section only.
- **Suggested next step**: Either widen `scanUsage` to accept multiple roots (and have the auditor pass every loaded catalog root), or have the auditor derive the usage universe from its own injected catalog rather than re-walking a single disk root. Natural to fold into Phase 6 (T018 `--by-root`) since both touch the same root-resolution surface.

### T013.P3.D -- Content-similarity detection is O(N^2); MinHash/LSH deferred (DF, P3)

- **Source phase**: adoption-skill-cleaner Phase 4 (T011 / T013)
- **Plan reference**: [plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) Phase 4 sub-task T011 (implementation note)
- **Reason**: `findSimilarPairs` compares every skill pair (`~N^2/2`). For the current catalog (16 builtin here; ~213 on a full Nexus-Hub sync) this is well under ~22,700 comparisons and runs in milliseconds, so no indexing is warranted yet. The plan explicitly defers a MinHash / LSH pre-filter until catalog size roughly doubles.
- **Suggested next step**: Capture the similarity-detection runtime separately in the Phase 7 benchmark (T020); if it becomes the cost driver as the catalog grows, add a MinHash band pre-filter before the exact Jaccard pass.
- **Phase 7 update (2026-05-29)**: T020 captured the isolated similarity runtime in [benchmarks/skills-audit-2026-05-28.md](benchmarks/skills-audit-2026-05-28.md) (4.4ms median over 120 comparisons on the 16-skill builtin catalog). The suggested measurement is now done; the item **stays open** because the MinHash/LSH pre-filter itself is not implemented (deferred until the catalog roughly doubles past the ~213-skill scale). A future cycle reruns the benchmark on the full catalog and decides.

### T017.P3.E -- Nexus-Hub allowlist drain: 137 over-long descriptions grandfathered (DF, P3)

- **Source phase**: adoption-skill-cleaner Phase 6 (T017)
- **Plan reference**: [plans/adoption-skill-cleaner.md](plans/adoption-skill-cleaner.md) Phase 6 sub-task T017
- **Reason**: Enforcing the new <=250-char single-line `description` rule against the live Nexus-Hub catalog surfaced 137 pre-existing SKILL.md files whose descriptions exceed the ceiling (lengths from 251 up to ~1276 chars; many are multi-trigger workflow descriptions). Per the plan, these were not mass-edited; instead they were grandfathered into `scripts/validate_skills.allowlist.json` so `python scripts/validate_skills.py --allow-existing` demotes them to warnings while new skills are held to the rule. The allowlist is explicitly transitional.
- **Suggested next step**: Drain the allowlist incrementally in the Nexus-Hub repo -- shorten each over-long `description` to a single trigger-noun-preserving line per the `skill-description-authoring` skill, removing its allowlist entry as it lands. When the allowlist reaches zero entries, delete the file and drop the `--allow-existing` flag from any CI invocation. Track as a Nexus-Hub-side issue; a future Nexus cycle's `/generate-plan` Step 0.6 can ingest this item.

### T012.P2.C status note (Phase 6)

T018's `--by-root` flag touched the same root-resolution surface flagged by T012.P2.C but narrows (scopes to one source) rather than widens the usage scan; the CLI now points the single-root scan at the matching root when `--by-root` is set. The underlying single-`skillsRoot` limitation in `scanUsage` is unchanged, so **T012.P2.C remains open**.

_(T002.P2.A and T012.P2.C remain open; T007.P2.B was resolved in Phase 3 -- see `## 2. Resolved`.)_

---

## 2. Resolved

### T007.P2.B -- core/observability/TokenCost.ts dependency-cruiser orphan (WN, P2)

- **Source phase**: adoption-skill-cleaner Phase 2 (T007)
- **Resolved in**: Phase 3 (T008, 2026-05-29)
- **Reason it is now closed**: `core/skills/SkillAuditor.ts` (T008) imports `tokenize` from `core/observability/TokenCost.ts` and `DEFAULT_CONTEXT_WINDOW` + `ModelRegistry` from `core/registry/ModelRegistry.ts`, removing both orphan edges. The Phase 3 `npm run check-architecture` run no longer lists either module as a `no-orphans` warning (the remaining warnings are pre-existing orphan stubs unrelated to this track), and `npm run deps:check` reports zero violations.

---

## 3. Summary

| Category | Open | Resolved |
|---|---|---|
| NI (not implemented) | 0 | 0 |
| DF (deferred) | 3 | 0 |
| BG (bug) | 0 | 0 |
| MT (missing tests) | 0 | 0 |
| WN (warning) | 1 | 1 |
| QG (quality gate) | 0 | 0 |
| **Total** | **4** | **1** |

**Adoption ledger**: 23 of 23 sub-tasks resolved (T001-T023); the adoption-skill-cleaner track is complete. The 4 open items below are all carryforward / deferred follow-ups (1 WN, 3 DF), none release-blocking for v1.3.0; they remain for a future cycle's `/generate-plan` Step 0.6 to ingest.

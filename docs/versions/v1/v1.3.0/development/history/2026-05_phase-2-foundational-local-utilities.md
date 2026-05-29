# Session history: v1.3.0 Phase 2 -- Foundational Local Utilities

**Date**: 2026-05-29
**Cycle**: v1.3.0
**Phase**: 2 (Foundational Local Utilities, skill-cleaner adoption track)
**Plan reference**: [docs/versions/v1/v1.3.0/plans/adoption-skill-cleaner.md](../../plans/adoption-skill-cleaner.md)
**Source comparison**: [docs/versions/v1/v1.3.0/comparison-skill-cleaner.md](../../comparison-skill-cleaner.md)
**Acceptance scope**: land the four small, independent modules (`TokenCost.ts`, `ModelRegistry.contextWindow`, `SkillRenderLine.ts`, `SkillCatalog` realpath dedup) that the Phase 3 `nexus skills audit` command will compose. All four touch separate files, ship with unit tests, and pass one build + test + lint + architecture gate. No consumer wiring yet -- that is Phase 3 onward.

---

## 1. Sub-tasks completed

| Sub-task | Output | Status |
|---|---|---|
| T003 | [core/observability/TokenCost.ts](../../../../../core/observability/TokenCost.ts) -- `tokenize(text) = ceil(utf8Bytes/4)` (insight I-04). Test: [tests/unit/core/observability/TokenCost.test.ts](../../../../../tests/unit/core/observability/TokenCost.test.ts) (4 cases). | Closed |
| T004 | [core/registry/ModelRegistry.ts](../../../../../core/registry/ModelRegistry.ts) -- optional `contextWindow` on `ModelRecord`, `DEFAULT_CONTEXT_WINDOW=272000`, `setActiveModel` + `getActiveContextWindow` on the interface + `InMemoryModelRegistry`, gemma4:e4b seeded at 128000 (insight I-05). Test: [tests/unit/core/registry/ModelRegistry.context-window.test.ts](../../../../../tests/unit/core/registry/ModelRegistry.context-window.test.ts) (9 cases). | Closed |
| T005 | [core/skills/SkillRenderLine.ts](../../../../../core/skills/SkillRenderLine.ts) -- `renderSkillLine` / `renderSkillBlock` producing `- id: description (file: path)` (insight I-02), newline-flattened, no trailing whitespace. Test: [tests/unit/core/skills/SkillRenderLine.test.ts](../../../../../tests/unit/core/skills/SkillRenderLine.test.ts) (6 cases). | Closed |
| T006 | [core/skills/SkillCatalog.ts](../../../../../core/skills/SkillCatalog.ts) -- exported `dedupeByRealpath(skills, telemetry?)` invoked at the in-memory insertion point; `fs.realpathSync` collapse with `builtin > user > devai-hub` keep-priority (insights I-07 + I-09) and a new `skills.dedup` TelemetryBus event. Test: [tests/unit/core/skills/SkillCatalog.realpath-dedup.test.ts](../../../../../tests/unit/core/skills/SkillCatalog.realpath-dedup.test.ts) (7 cases). | Closed |
| T007 | Build + test + lint + architecture gate. | Closed |

## 2. Deviations from the plan text

| # | Deviation | Resolution |
|---|---|---|
| D1 | The plan places tests at `tests/observability/`, `tests/registry/`, `tests/skills/`. | The repo convention mirrors source under `tests/unit/core/...`; tests were placed there (`tests/unit/core/observability/`, `.../registry/`, `.../skills/`) to match every existing test for these modules. |
| D2 | T006 says to "locate the disk-scan code path that walks the configured skill roots" in `SkillCatalog.ts` (a `loadFromDisk` / `scanRoots` method). | No such method exists -- `SkillCatalog.ts` is in-memory only and dedups by `skill.id` at construction. The realpath dedup was added as an exported pure helper `dedupeByRealpath` invoked at the in-memory insertion point (constructor + `resetForTesting`), which is the faithful "before insertion into the in-memory map" location the prompt describes. |
| D3 | T006 says to "Emit a TelemetryBus event of type `skills.dedup`", but `TelemetryEventKind` is a closed union without that member. | Added `"skills.dedup"` to the union in [core/telemetry/TelemetryBus.ts](../../../../../core/telemetry/TelemetryBus.ts) and threaded an optional `telemetry` bus through a new `SkillCatalogOptions` second constructor arg (skills array stays the first positional arg, so all existing call sites are unaffected). |
| D4 | T004 says add `contextWindow: number` on "every `ModelRecord`". | Made the field optional (`contextWindow?: number`) on the interface and normalised an absent value to `DEFAULT_CONTEXT_WINDOW` inside the registry on store, so existing `ModelRecord` literals in tests do not regress while `list()` / `metadata()` still always return a concrete number. There is no pre-existing "active model" concept, so a minimal `setActiveModel` / `_activeId` was added to back `getActiveContextWindow()`. |

## 3. Test + gate results

- `npm run build` (tsc): clean.
- `npm run test`: 3,655 passed, 0 failed, 5 skipped (324 files). The four new files add 26 tests, all passing; the 7 realpath-dedup cases ran (junctions available on the host).
- `npm run lint` (`eslint src`): 0 errors.
- `npm run check-architecture` (`depcruise src core modules`): 0 errors. The `core/** -> modules/**` boundary holds; new modules import only `node:*` and sibling `core/**` files.

## 4. Open items added to known-gaps

One new entry appended to [docs/versions/v1/v1.3.0/known-gaps.md](../../known-gaps.md) `## 1. Open Items`, plus 5 ledger rows (T003-T007):

- **T007.P2.B** -- `core/observability/TokenCost.ts` is a dependency-cruiser `no-orphans` warning until Phase 3 wires it into `SkillAuditor` (T008/T009). By design per T003's prompt; `no-orphans` is a `warn` so the gate exits 0, and `npm run deps:check` (which includes `tests`) reports zero violations. To be moved to Resolved at the Phase 3 gate (T010). (WN, P2.)

## 5. Next steps

- Advance to Phase 3 (Skills Audit Command): create [core/skills/SkillAuditor.ts](../../../../../core/skills/SkillAuditor.ts) composing `TokenCost`, `ModelRegistry`, `SkillRenderLine`, and `SkillCatalog`, then wire `bin/nexus.mjs skills audit` (T008-T010). Wiring `tokenize` into the auditor closes known-gap `T007.P2.B`.
- The `--months` window and the `bySimilarity` / `unused` report arrays are stubbed in Phase 3 and populated in Phase 4 (T013).

# v1.10.0 Known Gaps -- `nexus-hub-consumption-rearchitecture`

Tracks unfinished work, deferrals, and cross-repo coordination for the v1.10.0 Nexus-Hub consumption re-architecture ([plan](plans/nexus-hub-consumption-rearchitecture.md)). One row per gap.

**Severity:** P0 (blocker) / P1 (high) / P2 (medium) / P3 (low).
**Category:** NI (note/info) / DF (deferred) / BG (bug) / MT (migration) / WN (warning) / QG (quality-gate) / CO (coordination).

---

## 1. Phase 1 -- shared catalog-path + layout resolver (landed 2026-07-09)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.P1.A | P2 | DF | The `NEXUS_AI_HOME` override is intentionally NOT read in `core/storage/paths.ts` (kept pure, mirroring `nexusHome()` which also defers `NEXUS_HOME` to `bin/nexus.mjs`). | Wire the override at the CLI / composition / first-launch layer in Phase 6, consistent with existing `NEXUS_HOME` handling. |
| NHC.P1.B | P3 | DF | The resolver + manifest I/O are built but not yet consumed by any reader or the syncer. | By design: `NexusHubSyncer` consumes it in Phase 2; `ChatPanelBootstrap`/`SkillsReloader`/`SkillLoader`/`codingBootstrap`/Hub-mcp reader in Phase 3. |
| NHC.P1.C | P3 | NI | Manifest read/write was placed in a new `core/storage/hubVersionManifest.ts` rather than in `paths.ts` (plan T003), to preserve `paths.ts`'s no-filesystem purity invariant. | Refinement, not a gap. `paths.ts` purity is asserted by a CI test in `tests/unit/core/storage/hubCatalogPaths.test.ts`. |

## 2. Cross-repo coordination (Nexus-Hub)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.COORD.1 | P1 | CO | Nexus-Hub's "nexus-ai" installer integration and its `nexus-hub-version.json` `layout` map must write the catalog under `~/.nexus-ai/catalog/` so both populators agree with `NexusHubSyncer`. | Confirm on the Nexus-Hub side before Phase 2 lands. |
| NHC.COORD.2 | P2 | CO | `NEXUS_AI.md` (instruction file) and the `templates/` subdir are new; the current Nexus-Hub `catalog/` has `templates/` but no `NEXUS_AI.md` / `nexus-hub-version.json` yet. | The resolver tolerates missing optional entries; Nexus-AI writes `nexus-hub-version.json` itself; coordinate `NEXUS_AI.md` authorship with Nexus-Hub. |

## 3. Deferred to a separate plan

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.HOME.1 | P1 | DF | App-data home consolidation `~/.nexus/*` -> `~/.nexus-ai/*` (settings.json, mcp.json, models/, session-artifacts/, credentials vault) with copy -> verify -> remove + backout + tests, then retire `~/.nexus/`. | Deliberately NOT in this plan (data-loss-sensitive; touches `paths.ts` `nexusHome()`, the model/weights root, the session store, the credentials vault, and installer paths). File as its own tested plan after the catalog path is proven. |

## 4. Summary

Phase 1 landed additive-only and green (`tsc -b` clean; `tests/unit/core/storage` 64 passed / 0 failed). No P0/P1 blockers open against Phase 1 itself. The two open P1s are forward work: the cross-repo coordination (`NHC.COORD.1`) and the deferred app-data home consolidation (`NHC.HOME.1`).

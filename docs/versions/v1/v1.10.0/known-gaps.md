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

## 1b. Phase 2 -- rename + retarget syncer (landed 2026-07-09)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.P2.A | P2 | DF | The `"devai-hub"` provenance/namespace token rename (T012: `SkillCatalog`/`SkillAuditor`/`SkillRenderLine`/tracer/IPC `z.enum`/slash namespaces -> `"nexus-hub"`) was deferred from Phase 2. | It is coupled to how the loader assigns provenance from the on-disk namespace dir, which reroutes in Phase 3; renaming it in Phase 2 would leave a half-changed enum + a runtime value/type mismatch. Kept as-is through Phase 3 (nothing rerouted there produces the token -- SkillLoader is unchanged). Renamed in Phase 7 (the naming scrub). |
| NHC.P2.B | P3 | NI | Transitional legacy path helpers (`defaultSkillsRoot`, `activeTagPointerPath`, `tagDir`, `tmpDirFor`, `readActiveTag`, `writeActiveTag`, `readManifestOnDisk`) are retained in `NexusHubSyncer.ts` pointing at the old `~/.nexus/skills/devai-hub/` layout, for the not-yet-rerouted readers (`SkillsReloader`, `SkillInstaller`, `ChatPanelBootstrap`) + the CLI audit command. After Phase 2 the syncer writes the new path while those readers read the old one. | **RESOLVED in Phase 3**: the readers were rerouted to the catalog resolver and the helpers removed from `NexusHubSyncer.ts`. (`defaultSkillsRoot` was kept -- it is the app-data user-skills root, not a Hub helper.) |
| NHC.P2.C | P3 | DF | The Hub skill index (repo-root `data/skills.json`) and the repo-root `rules`/`extensions` dirs are no longer fetched (the sparse set is now `catalog` + `.claude-plugin`). Index category-enrichment degrades to `null` (advisory only). | Acceptable: the on-disk skills tree stays authoritative and the new catalog-only layout has no `data/`. If a future Nexus-Hub ships `catalog/data/skills.json`, `buildManifestWithIndex` resolves it under the catalog dir with no code change. |

## 1c. Phase 3 -- reroute readers to the catalog resolver (landed 2026-07-09)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.P3.A | P2 | DF | SkillLoader still does not load Hub `SKILL.md` skills. Hub content reaches the runtime as commands/agents/rules via the dedicated loaders (`HubCommandCatalogLoader`, `HubAgentPersonaLoader`, the language-rules resolver), not through `SkillLoader`; the bundled first-party catalog remains the offline fallback. | Behavior-preserving decision for the reroute phase. Whether to surface Hub `SKILL.md` skills through `SkillLoader` from `<catalogRoot>/skills` is a separate product decision (not required for correctness). |
| NHC.P3.B | P3 | DF | The Hub mcp-configs reader (`modules/coding/mcp/hubMcpRegistry.ts`) is built + tested but not yet consumed by the live MCP connect flow; it only reads + policy-filters, never auto-connects. | Matches the existing filter-only posture. Live consumption of the allowed set is wired with the in-app surface in Phase 6. |
| NHC.P3.C | P3 | NI | `bin/nexus.mjs`'s `skills audit` command still resolves the old `~/.nexus/skills/devai-hub/` path inline (not via the removed exports). | Cosmetic + inert for a dev CLI; folded into the Phase 7 naming scrub / any later CLI pass. |

## 1d. Phase 4 -- rename AutoSync + one-shot migration + guarded cleanup (landed 2026-07-10)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.P4.A | P2 | DF | The one-shot legacy-cache cleanup and the weekly auto-sync worker are wired into `bootstrapCoding`, which the live sidecar (`desktop/sidecar/src/main.ts`) does not yet call. So the cleanup does not actually run on a real launch yet. | Activates when Phase 6 wires `bootstrapCoding` (+ first-launch fetch + update detection) into the live sidecar startup. Fully built + tested now. |
| NHC.P4.B | P3 | NI | The setting-key rename (`autoSync.devai-hub` -> `autoSync.nexus-hub`) migrates the value in the sidecar `SettingsStore` (`~/.nexus/settings.json`) forward. A value set only in VS Code's own `settings.json` (the contributed setting) is not auto-migrated. | Low impact: the feature is opt-in + default-off and not wired live yet; a user re-opts-in via the renamed setting if their old value lived only in VS Code settings. |

## 1e. Phase 5 -- remove the installer bundled-baseline redundancy (landed 2026-07-10)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.P5.A | P3 | NI | The installer carries a pre-existing lint/type baseline untouched by this phase: `build/fetch-payload.py` has a UP037 + an E501 (on lines Phase 5 did not modify), and `storage.py` `refresh()` has a `QLayoutItem \| None` union-attr mypy nit (pre-existing; line-shifted by the row removal). | Not introduced by Phase 5; the changed src + tests are ruff-clean and the phase adds no new mypy errors. Left as-is (out of scope; the installer's existing baseline). |

## 1f. Phase 6 -- live first-launch fetch + skills.* IPC + update detection (landed 2026-07-10)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.P6.B | P2 | DF | Full skill-management IPC is not wired: `SkillsSettings` can list / enable-disable / approve-quarantine / pick-divergence via its client contract, but no sidecar handlers back those. `ipcSkillsClient.list()` returns `[]` and the mutation methods reject; only the update-detection subset (status / upstreamLatest / sync) is live. | Out of this plan's update-detection DoD; it is a separate SkillCatalog read+write IPC feature. File as its own plan when skill-management UI is prioritized. |
| NHC.P6.C | P2 | DF | The weekly *idle* auto-sync worker is not live, and the Settings auto-sync toggle is not wired to a settings IPC (`ipcSkillsClient.autoSyncEnabled` -> false, `setAutoSyncEnabled` -> no-op). The request-driven sidecar has no idle-activity loop to drive `IdleScheduler`. | First-launch fetch + manual "Sync now" cover the DoD. Wiring the idle-scheduler loop (+ a settings IPC for the toggle) is a follow-up; the worker + setting-key migration are already built (P4). |
| NHC.P6.D | P3 | QG | The sidecar `skills.*` handlers + the `main.ts` first-launch routine have no hermetic tests: they construct `NexusHubSyncer` internally and resolve `~/.nexus-ai` via `os.homedir()` (no `NEXUS_AI_HOME` override -- `NHC.P1.A`), so a test cannot redirect the home or inject deps, and `skills.sync`/`upstreamLatest` do real git/network. | Covered indirectly: the underlying logic is unit-tested (`NexusHubSyncer` P2, `migrateLegacyCatalog` P4), the IPC contract is exercised client-side (`ipcSkillsClient` test), and the wiring is typechecked. Add injection seams when the app-data-home plan lands the `NEXUS_AI_HOME` override. |

## 1g. Phase 7 -- DevAI/devai naming scrub (landed 2026-07-10)

| ID | Sev | Cat | Gap | Disposition |
|----|-----|-----|-----|-------------|
| NHC.P7.A | P3 | NI | The `check:naming` gate ([scripts/check-no-devai-hub.mjs](../../../../scripts/check-no-devai-hub.mjs)) is JS/TS-scoped (`core`, `modules`, `src`, `desktop/src`, `desktop/sidecar/src`, `bin`) and matches only the quoted `"devai-hub"` enum value. It does not scan the Python installer (whose only remaining mentions are correct negative regression-guards, e.g. `assert "devai-hub" not in ...`), does not scan `docs/`/CHANGELOG (dated historical notes), and does not flag bare-prose old-path mentions in comments. | Intended scope: the gate guards the load-bearing token from creeping back into shipped code, not historical prose. The installer guards are enforced by the installer's own suite. |
| NHC.P7.B | P3 | DF | `bin/nexus.mjs`'s `skills audit` command still resolves the old `~/.nexus/skills/devai-hub/` path inline and is therefore allowlisted in the naming gate (supersedes `NHC.P3.C`). | Inert for a dev-only CLI reader; reroute to the catalog resolver when the CLI gets its own pass. Removing the allowlist entry then re-tightens the gate automatically. |

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

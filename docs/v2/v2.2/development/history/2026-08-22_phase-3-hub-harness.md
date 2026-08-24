# Session History - Phase 3: Nexus-Hub Harness Provisioning and Skills Surface

**Date**: 2026-08-22
**Plan**: [v2.2.0-runtime-repair-and-ux-overhaul.md](../../plans/v2.2.0-runtime-repair-and-ux-overhaul.md) - Phase 3 of 8
**Outcome**: All 4 sub-tasks complete; all quality gates green. Two defects found and fixed in-phase.

## Context

Phase 1 made the backend start; Phase 2 made it tell the truth about models. Phase 3 addresses the third reported symptom: the Nexus-Hub harness (skills, commands, rules, hooks) was absent, Settings > Skills showed `(0)` everywhere, pressing Sync did nothing, and the Agentic tab offered only 8 generic slash commands.

## Sub-tasks

### 3.1 Harness provisioning at install time

- New `desktop/sidecar/src/cli/hubCatalogCli.ts` + `hubCatalogEntry.ts`, bundled by esbuild as a SECOND output `hub-catalog.js`. Kept separate from `main.js` deliberately: that module starts the agent scheduler, binds the serving gateway, and opens the studio DB as import-time side effects, none of which belong in a one-shot catalog sync.
- Modes: `--sync-hub-catalog`, `--extract-hub-snapshot <archive> --sha256 <hex>`, `--hub-catalog-status`, all accepting `--catalog-dir`. Newline-delimited JSON events on stdout; nonzero exit on failure.
- `scripts/installer/build/build-hub-snapshot.py` packs a synced catalog into `catalog.tar.gz` + `manifest.json` with a real sha256, refusing a catalog missing `skills/` or `commands/`.
- PyInstaller spec stages the snapshot when present and REFUSES a placeholder digest (v1.10.0 removed an earlier bundled baseline precisely because its pins were placeholders).
- `HubCatalogProvisioner` runs as an always-on installer step after the runtime step: extract snapshot when the catalog is absent, then refresh from upstream when online. A network failure never undoes a working snapshot, and the step never fails the install.

### 3.2 Real skills listing + auto-sync (closes NHC.P6.B / P6.C / P6.D)

- New vscode-free `sidecar/src/skills/hubSkillReader.ts` reads `<catalog>/skills/*/SKILL.md` and the user overlay, parsing only frontmatter. Deliberately not `SkillCatalog`/`SkillLoader`: those load skills INTO a session; this answers "what is on disk" without paying the loading cost or injecting bodies into a prompt.
- `skills.list` IPC + `ipcSkillsClient.list()` wired (was a hardcoded `[]`).
- `skills.autoSync.get/set` persist under `NEXUS_HUB_AUTO_SYNC_SETTING_KEY`, now exported from `NexusHubAutoSync` so the IPC and `codingBootstrap` share one key. Note the idle worker itself already existed and was already wired in `codingBootstrap`; only the settings surface was missing.
- Hermetic fixture-based tests (no git, no network) close NHC.P6.D.

### 3.3 Hub command discovery in the Agentic composer

- `commands.list` IPC backed by `readHubCommands` (same vscode-free reader).
- `filterSlashCommandsWithHub` merges built-ins with hub commands; built-ins always win a name collision so the dropdown matches what the router executes; malformed entries are skipped.
- `useHubCommands` hook loads them once per mount, degrading to built-ins-only on any failure.
- The `.slice(0, 8)` cap is replaced by a scrollable list with a source badge and a no-catalog hint.

## Defects found and fixed in-phase

1. **`HubCommandCatalogLoader` cannot run in the sidecar.** The plan called for constructing it there; it imports a vscode-coupled logger, so importing it broke ~30 handler test files at collection. That coupling is exactly why only the VS Code extension ever wired it. Replaced with the vscode-free reader.
2. **A scanner-blocked sync was reported as success.** `sync({apply:true})` returns `applied: false` when the injection scanner blocks the bundle; the CLI returned `{kind:"done", ok:true}`, which would have told the installer the harness landed while the catalog was untouched. Now a `scan-quarantine` error with exit 1.
3. **The CLI could only target the real `~/.nexus-ai/catalog`.** A round-trip test invoking the real extractor overwrote the developer's installed catalog with a one-skill fixture. The catalog was rebuilt from the intact top-level `~/.nexus-ai/` trees (23 skill categories, 19 commands) and its original tag `3.12.0` restored; nothing else was affected. `--catalog-dir` / `NEXUS_HUB_CATALOG_DIR` now exist, the test passes an explicit target and asserts nothing was written outside it, and a regression test pins the override.

## Gates

| Gate | Result |
|---|---|
| Root vitest | 5339 passed / 12 skipped / 0 failed |
| Desktop vitest | 1170 passed / 0 failed (142 files) |
| Desktop coverage | 89.54% lines / 82.65% branches (gate: 80%) |
| Installer pytest | all green (incl. a real builder-to-extractor round trip) |
| tsc -b / eslint / ruff (touched) | clean |

Three pre-existing tests were updated to the new contracts (skills client no longer read-only, `gpu.sample`/`skills.list`/`commands.list` implemented, engine emits the `hub-catalog` step).

## Next steps

Phase 4 - Smart Single-GPU Model Orchestration. Note DF-7: no snapshot is produced by any build script yet, so today's installer still depends on a network sync for the harness; wiring `build-hub-snapshot.py` into the build scripts is what actually delivers the offline guarantee.

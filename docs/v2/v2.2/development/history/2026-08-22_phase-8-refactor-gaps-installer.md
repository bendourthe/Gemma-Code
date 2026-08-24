# Session History - v2.2.0 Phase 8: Refactor, Known Gaps, Installer Rebuild

**Date**: 2026-08-22
**Plan**: `docs/v2/v2.2/plans/v2.2.0-runtime-repair-and-ux-overhaul.md`
**Phase**: 8 (final) - Architecture Refactor, Known-Gaps Reconciliation, and CI/CD
**Commits**: `0a22f53`, `208144b`, `06a8f3a`, `6362a90`, `6310721`

## What this session set out to do

Commit Phase 7, implement Phase 8, push, address the known gaps, and rebuild the installer for testing.

## The important finding

The installer rebuild is what surfaced the real problem. Two defects had already shipped, and either one alone produces exactly the reported "nothing is working":

1. **`npm run build:sidecar` failed outright.** The sidecar reuses the coding runtime, which was written for the VS Code extension and reaches `vscode` through its logger. There is no VS Code process in the sidecar, so esbuild could not resolve the module. Since Phase 1 the installer embeds `sidecar/dist` as a Tauri resource, so a sidecar that cannot be built means the app ships with a stale backend or none at all.

2. **Even once it built, the sidecar died at startup.** `better-sqlite3` is a native addon. Bundling its JS wrapper inlined a `require` for a `.node` binary that was then looked up relative to the bundle and never found. `GenerationIndex` constructs a database at module scope, so the process threw before answering a single request.

Both were confirmed pre-existing by stashing the session's changes and reproducing the failure on the untouched tree.

The fixes: a `vscode` shim exposing only `window.createOutputChannel` and writing to **stderr** (stdout carries the JSON-RPC stream, so a log line there corrupts the protocol); and keeping `better-sqlite3` external while copying the real package next to the bundle, with the build failing loudly if the binary is missing afterwards.

Verified by running the built bundle rather than trusting the compile: it answered `ping` and `data.categories` over real JSON-RPC on stdin/stdout.

## Gaps closed

| Gap | What was wrong | Resolution |
|---|---|---|
| DF-7 | The PyInstaller spec embedded a hub catalog snapshot, but no build script ever produced one, so every installer shipped without an offline harness | All three installer build scripts build it; a host without a local catalog still builds and syncs at install time |
| DF-9/10/11 | Video Lab loaded models unconditionally while Image Studio had honoured the switch policy since Phase 4 | Video gated on submit only, with prompt-preserving confirm and self-explaining refusals |
| DF-12 | The chat empty state said "Create your first folder", which is why the module looked like it required a folder | It starts a chat; the store always accepted `folderId: null` |
| DF-13 | The Phase 5 title generator had no call site, so every chat stayed "New chat" | The first prompt names the chat, once, only while still default-named |
| DF-16 | The transfer runtime and the Data page existed but were never connected | `data.categories` / `data.export` / `data.import` wired, with Preview before Import |

## Refactor

Removed `LocalModelStatusDock` (superseded by the sidebar GPU footer in Phase 6) and `ModulePlaceholder` (its last routes became redirects in Phase 7). Neither was reachable from app code.

## CI/CD

No change was needed and none was made. `ci.yml` already runs both suites and both new test files fall inside its globs; 17 of 19 workflows carry concurrency groups and 13 cache dependencies.

## Tests updated rather than worked around

Two `FolderTree` tests pinned the folder-first empty state, and the handler suite's implemented allow-list did not know the new data methods. The `FolderTree` pair was rewritten to the new intent: a test pinning the exact behaviour a user reported as broken is not a reason to keep the behaviour.

## Gates

Root vitest **5432 passed / 12 skipped / 0 failed**. Desktop vitest **1258 passed / 0 failed** (149 files). Installer pytest exit 0. eslint clean. `tsc -b` clean.

## Build artifacts

- Desktop bundle: `Nexus AI Studio_2.1.0_x64-setup.exe`, 4.98 MB, built after the sidecar repair.
- Installer: `dist/NexusSetup.exe`, 84.7 MB, sha256 `F3855BD2...`.
- Confirmed by inspection that the hub snapshot (3.6 MB, tag 3.12.0) is embedded and the 1.9 MB native addon ships in `sidecar/dist/node_modules`.

Not signed: `signtool` is not on this machine.

## Still open

- **DF-16 remaining**: no native file dialog (needs a Tauri plugin plus a capability change, which does not belong in a build about to be installed) and the import still stages under `~/.nexus/import-staging` rather than merging into final destinations, so it is preview-and-stage rather than a full restore.
- **DF-17**: settings tabs are still a hand-written list rather than a URL-addressable registry.
- **MT-1..MT-3**: live-GPU generation paths remain unverified on real hardware; the smoke script exists but is gated behind `NEXUS_LIVE_GPU=1`.
- The version is still 2.1.0. The 2.2.0 bump, changelog, and tag belong to `/update release` and were deliberately not done automatically.

## Next

Install `dist/NexusSetup.exe` and confirm the sidecar starts, models list in Image and Video, the harness is present offline, and a new chat names itself from its first message.

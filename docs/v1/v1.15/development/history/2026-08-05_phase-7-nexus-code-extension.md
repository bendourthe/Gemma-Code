# Session History - v1.15.0 Phase 7: VS Code extension "Nexus Code" activation fix

**Date**: 2026-08-05
**Plan**: [../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)
**Phase**: 7 of 8 - "VS Code Extension: 'Nexus Code' Activation Fix + Claude Code-Style UX (Issue 6)"
**Outcome**: Sub-tasks 7.1-7.3 + 7.5 complete and verified. Sub-task 7.4 (Claude Code-style UX rework) DEFERRED by explicit user decision to its own plan (IRSC.P7.A). Quality gate GO (root suite 424 files / 4646 pass, 0 fail; tsc + eslint clean).

## Goal

Fix Issue 6: clicking the Nexus icon reported `command 'nexus.coding.newChat' not found`, and the sidebar's Chat / Memory / Traces views loaded forever. Also rename the extension to "Nexus Code".

## Root cause (confirmed against the code)

One upstream failure produced both symptoms. `activate()` had **no error containment**, and the engine branch registers its commands and webview providers only AFTER constructing `NexusCodingPanel` (`extensionOnly.ts:152`; `newChat` at :320, the three providers at :263/:304/:313). The panel's construction reaches `buildMemorySubsystem` (`ChatPanelInit.ts`), the only subsystem helper WITHOUT a try/catch (its siblings all return null on failure) - and memory is ON by default, so it opens a `better-sqlite3` database on every activation. A native module that cannot load (Electron ABI mismatch - very reachable because `package:quick` skips `@electron/rebuild` and the full script hardcoded Electron 36.4.0) threw straight out of `activate()`, so the late registrations never ran: the command did not exist and the declared views had no provider (a declared view with no provider spins forever).

## What was done

### 7.1 Activation resilience (fixes both symptoms)
- `src/panels/ChatPanelInit.ts`: `buildMemorySubsystem` now try/catches and returns `MemorySubsystem.disabled()`, matching every sibling helper. Removes the actual thrower.
- `src/activation/safeMode.ts` (new): declares every command id + view id from `package.json` and registers explanatory safe-mode handlers for any that are missing, so the surface always exists. Only fills gaps (a healthy activation is untouched); defensive if `getCommands` is unavailable.
- `src/extension.ts`: wraps both activation branches in try/catch, logs the failure, then invokes the safe-mode fallbacks; the compat-shim install is guarded too.

### 7.2 Packaging + discovery honesty
- `scripts/build-vsix.ps1`: the Electron rebuild version is now a parameter (`-ElectronVersion` > `NEXUS_ELECTRON_VERSION` > default), no longer hardcoded inline.
- `scripts/warn-package-quick.mjs` (new) + `package.json`: `package:quick` warns it skips the native rebuild and **fails** for a release build (`NEXUS_RELEASE=1` / `CI` / `--release`), so a release VSIX can only come from the full pipeline.
- `src/desktop/daemonDiscovery.ts`: replaced the comment claiming the extension performs a live pipe ping (it does not) with an accurate description - on Windows a named pipe is invisible to `existsSync`, so the launch honestly resolves to extension-only; the `existsFn` seam remains for a real probe later.

### 7.3 Rename to "Nexus Code"
- `package.json`: `displayName`, view-container title, all six command titles, and the configuration title.
- `src/**`: output channel, all `[Nexus Coding]` log prefixes, the editor panel title, the proxy placeholder, and the leftover legacy "Gemma Code" webview `<title>`s / placeholder copy ("Ask Nexus Code...", "Nexus Code is thinking").
- `src/activation/compatShim.ts`: new `NEXUS_CODE_ALIAS_MAP` registers `nexus.code.*` forwarders to the canonical `nexus.coding.*` ids (silently - the new namespace is supported, not deprecated). Canonical ids / view ids / settings keys deliberately unchanged (see IRSC.P7.C).

## Test results

- New `tests/unit/activation-resilience.test.ts` (5): with `activateExtensionOnly` mocked to throw a NODE_MODULE_VERSION error, `activate()` does not throw and **every** declared command (including `nexus.coding.newChat`) and all three view ids still register.
- `tests/unit/activation/compatShim.test.ts`: updated subscription count + 2 new alias tests.
- `tests/setup.ts`: added `vscode.commands.getCommands` to the shared mock (used by safe mode).
- Full root suite: **424 files / 4646 tests, 0 failures** (3 files / 6 tests skipped) - better than the v1.14 baseline (4637 + 2 load flakes). `tsc -b` and `eslint` clean.

### Environment note
The first full run showed 415 failures from the *same* `better-sqlite3` NODE_MODULE_VERSION mismatch (135 vs 137) documented in v1.14 - a local dev-env artifact, repaired with `npm rebuild better-sqlite3`, after which the suite was fully green. Fittingly, that is exactly the class of failure this phase hardens the extension against.

## Deviations / known gaps

- **IRSC.P7.A (DF)**: 7.4 Claude Code-style UX rework deferred to its own plan (explicit user decision) - it is a feature effort comparable to Phases 4-6 combined, and Issue 6's defects are resolved without it.
- **IRSC.P7.B (NI)**: registration is still after heavy construction; the cheaper guard + safety net fully fix the symptom, and reordering carries real regression risk.
- **IRSC.P7.C (DF)**: command/view/settings ids and the Marketplace identity keep the `nexus-coding` spelling on purpose (renaming breaks keybindings/settings and republishes the extension); `nexus.code.*` aliases bridge the gap.
- **IRSC.P7.D (DF)**: the Electron default is still a constant, now overridable.

## Next steps

- Phase 8 (final): architecture refactor, known-gaps reconciliation, and CI/CD - then release readiness via `/update release`.

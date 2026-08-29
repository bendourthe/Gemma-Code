# VS Code host policy (v2.3.1)

**Date**: 2026-08-29
**Plan**: [v2.3.1-installer-field-repair.md](../plans/v2.3.1-installer-field-repair.md) T012
**Decision**: **A** (ABI-matched Microsoft stable `code`, not an exact 1.134.0 pin)

## Options

| Id | Policy |
|---|---|
| A | Rebuild `better-sqlite3` for the current stable VS Code Electron ABI and set `engines.vscode` to a range that matches that ABI. |
| B | Keep exact 1.134.0. Always show a disabled checkbox plus install-this-version copy. |
| C | Allow tick on mismatch with a written ABI-risk warning; fail closed at install if `--install-extension` errors. |

## Evidence

- Operator host (2026-08-28 field review): Microsoft stable `code` **1.135.0**. The 1.134.0-only pin hid the extension checkbox.
- `scripts/build-vsix.ps1` is in-repo and fail-closed rebuilds `better-sqlite3` 12.11.1 for **Electron 42.8.1** (`$SupportedElectronVersion = '42.8.1'`).
- [vscode-versions](https://github.com/ewanharris/vscode-versions): VS Code **1.134.0** and **1.135.0** both ship Electron **42.8.1** / Node 24.18.1. Same native ABI. No rebuild is required to admit 1.135.0.
- 1.136.0 and later are unproven here (`not_observed != absent` for a later Electron bump).

The plan said: recommend A if a rebuild is in-repo; otherwise C plus B copy. The rebuild path exists. A applies.

## Chosen policy

1. **Supported hosts**: Microsoft stable `code` whose major.minor is **1.134 or 1.135**. Insiders, Cursor, and Windsurf stay unsupported.
2. **`engines.vscode`**: `>=1.134.0 <1.136.0`. That range is the ABI window proven against Electron 42.8.1. It is not `^1.134.0` (that would claim 1.136+).
3. **Rebuild pin**: keep Electron **42.8.1** in `scripts/build-vsix.ps1`. Do not change the native rebuild in this phase.
4. **Wizard**: the extension checkbox stays visible. It is enabled and default-checked when `code` is 1.134 or 1.135. It is visible but disabled when `code` is missing or outside that window (disabled indicator uses `BG_INPUT`, not `BG_CARD` on `BG_CARD`).
5. **Replace**: if `--list-extensions` reports `nexus-coding.nexus-coding` or `gemma-code.gemma-code`, the control offers replace and install uses `--force`. A failed listing fails open (no `--force`, warning, not a false "already installed").
6. **1.136+**: treat as version-mismatch (visible, disabled). Do not take option C for this cycle.

## Not in this decision

Unsloth Core is not a VS Code option. T014 moves it to Configuration.

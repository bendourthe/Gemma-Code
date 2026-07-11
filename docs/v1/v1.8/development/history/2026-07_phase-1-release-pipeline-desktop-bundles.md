# v1.8.0 Phase 1 -- Release pipeline produces desktop bundles (T101-T104)

**Date**: 2026-07-02
**Branch**: `feat/v1.8.0-installer-phase-1`
**Plan**: [../../plans/one-shot-installer.md](../../plans/one-shot-installer.md) (Phase 1 of 6)
**Constraint honored**: GitHub Actions freeze ($0 until 2026-08-01) -- every proof below is local; the CI leg is a post-freeze Phase 6 rehearsal by design.

## What shipped

### T101 -- `desktop-bundle` job set in `release.yml`

A 3-OS matrix job (`windows-latest` / `macos-latest` / `ubuntu-latest`, `fail-fast: false`, 90-minute cap) between the installer jobs and `create-release`. `release.yml`'s only trigger is `push: tags: v*.*.*`, so the job set is tag-triggered by construction. Steps mirror `shell-build.yml`'s conventions (same pinned action SHAs: `dtolnay/rust-toolchain`, `actions/cache`, checkout/node/upload):

1. root `npm ci` (npm workspaces install `desktop/` deps; the root lockfile is the cache key),
2. `node scripts/sync-tauri-version.mjs` -- build-time version sync (below),
3. `npm run build:sidecar` as an explicit fail-fast (plan-mandated; `tauri build`'s `beforeBuildCommand` re-runs it),
4. `npm run build:shell` (Windows/Linux) or `npm run build:shell -- --target universal-apple-darwin` (macOS, after `rustup target add aarch64-apple-darwin x86_64-apple-darwin`),
5. stage under the canonical release names `Nexus-Desktop_{version}_x64-setup.exe` / `_universal.dmg` / `_amd64.AppImage` / `_amd64.deb`, upload as `desktop-bundle-{platform}`.

**Version sync**: [scripts/sync-tauri-version.mjs](../../../../scripts/sync-tauri-version.mjs) rewrites `desktop/src-tauri/tauri.conf.json`'s `version` from the semantic-release-owned root `package.json` (found stale at 1.5.0 vs 2.1.0 -- exactly the G1 symptom the plan called out). Exported pure functions (`readRootVersion`, `syncedTauriConf`) + a `--check` mode; 7 unit tests in [tests/unit/scripts/sync-tauri-version.test.ts](../../../../tests/unit/scripts/sync-tauri-version.test.ts) (parse fail-closed, idempotency, formatting preservation, spawned end-to-end apply/check/drift). The committed conf is bumped to 2.1.0, and future staleness is harmless because the sync runs before every bundle build.

### T102 -- `SHA256SUMS.txt`

`create-release` now `needs: desktop-bundle`, downloads the three bundle artifacts, and generates a single `SHA256SUMS.txt` over an **explicit list** of every attached asset (VSIX, `NexusSetup.exe`, `NexusSetup.dmg`, `NexusSetup-x86_64.AppImage`, the four `Nexus-Desktop_*` bundles) -- an absent asset fails the release loudly rather than shipping an incomplete checksum file. Attached as a release asset; Phase 2's `desktop_provisioner` verifies its downloads against it (fail closed).

### T103 -- `GemmaCodeSetup.*` -> `NexusSetup.*` (grep-audited)

The audit found the PyQt build scripts already emit `NexusSetup.*` -- meaning `release.yml`'s upload paths (`GemmaCodeSetup.exe` etc.) were **dead-broken**, not just stale. Fixed in `release.yml`: the three installer upload paths, the release `files:` list, the macOS `Gemma Code Installer` -> `Nexus Installer` path, the Linux `gemma-code-setup` -> `nexus-setup` path, the `gemma-code-*.vsix` asset name (vsce emits `nexus-coding-*.vsix` from the package name), and the release title "Gemma Code v..." -> "Nexus v...". Also renamed the wizard's user-visible `setApplicationName("Gemma Code Installer")` + argparse description in [main.py](../../../../scripts/installer/pyqt/src/nexus_installer/main.py) and one integration-test banner. `installer-macos.yml` / `installer-linux.yml` / `installer-build.yml` carried no old names (audit result). Remaining repo-wide `gemma-code` references are classified in [known-gaps `NAME.P1.A`](../../known-gaps.md) (compat shims overdue for retirement; migration/history/legacy classes stay by design).

### T104 -- local Windows proof (the plan's de-risking step)

- **Toolchain**: the dev box had MSVC (VS Community 2022) + NSIS but no Rust (the v1.7.0 `RT.P7.A` blocker); installed rustup with `stable-x86_64-pc-windows-msvc` 1.96.1, minimal profile.
- **Build**: `npm run build:shell` -> `Finished 2 bundles` in **2m27s** (cold cargo, tauri 2.11.5):
  - `desktop/src-tauri/target/release/bundle/nsis/Nexus_2.1.0_x64-setup.exe` -- **1.6 MB**
  - `desktop/src-tauri/target/release/bundle/msi/Nexus_2.1.0_x64_en-US.msi` -- **2.1 MB**
  - Names confirm the workflow's `*-setup.exe` glob and the sync script's version stamping (compiled crate still reports `nexus-shell v1.5.0` from Cargo.toml -- bundle names come from `tauri.conf.json`, which is the synced surface).
  - Tauri self-fetched WiX 3.14 + NSIS 3.11 (SHA-validated by tauri-bundler) on first bundle.
- **Installability**: silent install `Nexus_2.1.0_x64-setup.exe /S /D=<scratch>` landed `nexus-shell.exe` (3.5 MB) + `uninstall.exe`; silent uninstall (`uninstall.exe /S`) removed everything. Round-trip clean.
- **SmartScreen**: not triggerable locally -- a locally-built exe carries no Mark-of-the-Web. The end-user warning on downloaded unsigned binaries is expected and recorded (`OSI001.P1.D`); signing is out of scope this cycle per plan Section 4.
- **Fixture**: the NSIS bundle is stashed at `.local-fixtures/Nexus_2.1.0_x64-setup.exe` (new gitignored directory) for Phase 2 / T204's Windows integration test.
- **Finding for Phase 2**: the bundle contains the shell only -- no sidecar dist is packaged (no `bundle.resources`/`externalBin`), so the installed app cannot serve the Coding pillar yet; recorded as `OSI001.P1.B` and pinned to Phase 2's DoD.

## Quality gates

| Gate | Result |
|---|---|
| Root Vitest suite | **4565 passed / 6 skipped / 0 failed** (+7 new) |
| `tsc -b` | clean |
| `npm run lint` | 0 errors |
| `release.yml` | YAML-parse validated; job graph: `build-vsix` -> {3 installers, `desktop-bundle` x3} -> `create-release` |
| Local bundle proof | build + silent install + silent uninstall all exit 0 |

## Decisions

- **No new third-party actions**: the Rust toolchain step reuses the exact pinned `dtolnay/rust-toolchain` SHA already trusted in `shell-build.yml` (supply-chain discipline).
- **Explicit checksum list over `sha256sum *`**: artifacts land beside non-attached files (e.g. the macOS raw PyInstaller dir), and a glob would silently absorb or omit; the explicit list is the fail-loud contract.
- **`Cargo.lock` left untracked** (pre-existing ignore policy) -- flagged as `OSI001.P1.C` rather than changed unilaterally.
- **rustup installed on the dev box** (user-scope, reversible via `rustup self uninstall`): required by T104's explicit commitment to a local `tauri build`; MSVC + NSIS were already present.

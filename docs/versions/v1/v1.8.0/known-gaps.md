# v1.8.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: IN PROGRESS -- Phase 1 of 6 closed (2026-07-02). v1.8.0 is the "one-shot end-user installer" cycle ([plans/one-shot-installer.md](plans/one-shot-installer.md)): download one file, get dependencies + VS Code extension + models + the Nexus desktop app installed and launchable. Phase 1 makes the release pipeline emit versioned, checksummed desktop bundles (the fetch-from-release prerequisite): a `desktop-bundle` 3-OS job set in `release.yml` (T101), a single `SHA256SUMS.txt` verification asset (T102), the `GemmaCodeSetup.*` -> `NexusSetup.*` artifact rename (T103), and a local Windows `tauri build` proof with the NSIS bundle stashed as the Phase 2 fixture (T104). This file is appended phase-by-phase; items move to `## 2. Resolved` when closed.

**Audience**: v1.8.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-07-02 (Phase 1 close)
**Sibling reviews**: [../v1.7.0/known-gaps.md](../v1.7.0/known-gaps.md) (the prior cycle's gap log; `RT.P7.A`/`RT.P7.B` interact with Phase 2 below) and [plans/one-shot-installer.md](plans/one-shot-installer.md) (the active plan).

**Cycle-wide constraint**: GitHub Actions minutes are frozen ($0 budget) until 2026-08-01 (2026-07-02 CI incident). Every CI-leg claim below is therefore `future` tier until the post-freeze rehearsal (Phase 6, T603); local proofs are the only `supported` evidence this cycle.

Severity tags: **P0** release-blocker; **P1** should-fix; **P2** nice-to-have; **P3** out-of-scope for v1.8.0 / recorded for future planning.
Category tags: **NI** not implemented; **DF** deferred; **BG** bug; **MT** missing tests; **WN** warning; **QG** quality gate.

---

## 0. Adoption Ledger

| Plan sub-task | Item | Status | Closing reference |
|---|---|---|---|
| T101 + T102 + T103 + T104 | Phase 1 -- release pipeline produces desktop bundles | Resolved (local legs) | Phase 1 (2026-07-02). **T101**: `desktop-bundle` 3-OS matrix job set added to [release.yml](../../../../.github/workflows/release.yml) (tag-push is the workflow's only trigger, satisfying "tag-triggered only" under the freeze) -- checkout -> setup-node (root workspace lockfile cache) -> Linux webkit2gtk-4.1 prerequisites -> pinned `dtolnay/rust-toolchain` (same SHA as `shell-build.yml`) -> cargo cache -> root `npm ci` (npm workspaces cover `desktop/`) -> `node scripts/sync-tauri-version.mjs` -> fail-fast `npm run build:sidecar` -> `tauri build` (macOS leg builds `--target universal-apple-darwin` after `rustup target add` for both arches) -> stage under canonical names `Nexus-Desktop_{version}_x64-setup.exe` / `_universal.dmg` / `_amd64.AppImage` / `_amd64.deb` -> upload. The build-time version sync ([scripts/sync-tauri-version.mjs](../../../../scripts/sync-tauri-version.mjs), exported pure functions + `--check` mode, 7 unit tests) fixes the stale-at-1.5.0 `tauri.conf.json` version from the semantic-release-owned root package.json (committed value bumped to 2.1.0; future staleness is harmless because the sync runs before every bundle build). **T102**: `create-release` now needs `desktop-bundle`, downloads the three bundle artifacts, and generates one `SHA256SUMS.txt` over an explicit list of every attached asset (VSIX + 3 wizard installers + 4 desktop bundles) -- fails loudly if any expected asset is missing; attached to the release as the installer's fail-closed verification source. **T103**: grep-audited rename -- `release.yml` was the only workflow still carrying `GemmaCodeSetup.*` (the PyQt build scripts already emit `NexusSetup.*`, so the workflow upload paths were dead-broken); fixed to `NexusSetup.exe` / `NexusSetup.dmg` / `NexusSetup-x86_64.AppImage` / `Nexus Installer` / `nexus-setup`, plus the stale `gemma-code-*.vsix` asset name (vsce emits `nexus-coding-*.vsix` from the package name) and the "Gemma Code v..." release title; the wizard's own `setApplicationName("Gemma Code Installer")` + argparse description ([main.py](../../../../scripts/installer/pyqt/src/nexus_installer/main.py)) and one integration-test banner renamed to "Nexus Installer". `installer-macos.yml` / `installer-linux.yml` / `installer-build.yml` carried no old names (audit result, not omission). **T104**: local Windows proof -- rustup (stable-msvc 1.96.1, minimal profile) installed on the dev box (MSVC VS2022 + NSIS were already present); `npm run build:shell` produced `Nexus_2.1.0_x64-setup.exe` (NSIS, 1.6 MB) + `Nexus_2.1.0_x64_en-US.msi` (2.1 MB) in 2m27s; silent install (`/S /D=<scratch>`) landed `nexus-shell.exe` (3.5 MB) + `uninstall.exe`, silent uninstall removed them cleanly; the NSIS bundle is stashed at `.local-fixtures/Nexus_2.1.0_x64-setup.exe` (new gitignored dir) as the Phase 2 / T204 integration fixture. SmartScreen: not triggerable locally (a locally-built exe carries no Mark-of-the-Web); the unsigned-download warning for end users is recorded as `OSI001.P1.D`. Gate green: root suite **4565 passed / 6 skipped / 0 failed** (+7 new), `tsc -b` clean, lint 0 errors, `release.yml` YAML-parse validated. |

---

## 1. Open Items

### Phase 1 (2026-07-02)

| ID | Sev | Cat | Description | Suggested next step |
|---|---|---|---|---|
| `OSI001.P1.A` | P1 | DF | The `desktop-bundle` job set has never executed in CI (Actions freeze until 2026-08-01). The 3-OS matrix, the macOS universal leg, the bundle-path globs, and the SHA256SUMS asset are `future` tier until a real run. The Windows leg's layout (`bundle/nsis/*-setup.exe`) is locally verified; macOS/Linux paths follow Tauri 2's documented bundle layout. | Phase 6 / T603: post-freeze, push a pre-release tag on a scratch branch (`workflow_dispatch` is not available on `release.yml`; its only trigger is tags) and verify all 8 assets + SHA256SUMS attach. Fix any mac/linux glob drift there. |
| `OSI001.P1.B` | P1 | DF | The NSIS bundle contains the Tauri shell only -- the Node sidecar dist (`desktop/sidecar/dist/`) is **not** packaged (no `bundle.resources` / `externalBin` in `tauri.conf.json`), and the shell expects a system Node to spawn it. This is the v1.7.0 `RT.P7.A`/`RT.P7.B` carryover surfacing in the installer path: an installed Nexus desktop cannot serve the Coding pillar yet. Phase 2's first-run health check (T203) will fail a sidecar ping until this is wired. | Resolve alongside Phase 2: either bundle the sidecar dist as a Tauri resource + spawn via the installer-provisioned Node, or land `RT.P7.B` first. The Phase 2 DoD ("launches, health check passes") cannot close without it. |
| `OSI001.P1.C` | P2 | WN | `desktop/src-tauri/Cargo.lock` is gitignored (pre-existing `.gitignore` policy), so desktop-bundle builds are not crate-pinned -- each CI run resolves crates fresh, violating the repo's versions.lock.json pinning discipline in spirit. The local T104 build resolved tauri 2.11.5 / tauri-build 2.6.3. | Track `Cargo.lock` for `desktop/src-tauri` (remove the ignore rule, commit the lockfile) in a follow-up; standard practice for application (non-library) crates. |
| `OSI001.P1.D` | P3 | WN | Release binaries are unsigned this cycle (plan Section 4 out-of-scope): downloaded copies of `Nexus-Desktop_*_x64-setup.exe` / `NexusSetup.exe` will trip SmartScreen ("Windows protected your PC"), and the unsigned DMG will trip Gatekeeper. Not locally reproducible (no Mark-of-the-Web on a locally-built exe). | Phase 6 / T605 documents the warning + click-through on the download page; the signing/notarization purchase decision is deferred per plan. |
| `NAME.P1.A` | P2 | DF | **Residual `gemma-code` references repo-wide** (operator-raised, 2026-07-02). The T103 grep-audit fixed the live user-visible stragglers (workflow artifact names, wizard app name, release title), but ~180 tracked files still contain `gemma[ -]?code`, in four deliberate-at-the-time classes: (1) the **backward-compat surface** -- legacy `gemma-code.*` settings keys (SettingsCompat, settingsKeyMap), legacy command IDs (compatShim), the `GemmaCodeSettings` type alias, and package.json descriptions -- whose removal was promised "until v1.2.0" but never executed (the repo now ships 2.1.0: the compat window is ~5 majors overdue); (2) **migration code** that must name the old paths (`~/.gemma-code/` -> `~/.nexus/` StorageMigration, marker files); (3) **history** (DEVLOG, CHANGELOG, ADRs, docs/archive, docs/versions) -- append-only records, correct to keep; (4) `scripts/installer/legacy/` -- explicitly legacy. Class 1 is the actionable debt; classes 2-4 are by-design. (Note: "Gemma 4" / `gemma4:*` references are the Google LLM the product runs, not the old project name.) | Schedule a dedicated **compat-retirement sweep** (candidate for the next hygiene cycle, or a v1.8.0 Phase 6 rider if the operator wants it sooner): delete the compat shim + SettingsCompat resolution + `GemmaCodeSettings` alias + legacy key descriptions, with a CHANGELOG `### Removed` entry and a migration note; keep classes 2-4. |

---

## 2. Resolved

*(rows move here from Open Items as later phases close them)*

---

## 3. Summary

- **Phases closed**: 1 / 6 (Phase 1, 2026-07-02, local legs; CI legs deferred to the post-freeze rehearsal by plan design).
- **Open**: 2 x P1 (both `DF`, both by the freeze / the v1.7.0 sidecar carryover -- neither is a Phase 1 defect), 2 x P2, 1 x P3.
- **No** open BG / MT / QG items: the phase introduced no bug, test failure, coverage shortfall, suppressed lint, or bypassed gate.

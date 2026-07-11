# Phase 11 - Hardening + security audit + release gate

**Goal**: Deep review, security audit, pen-test, signing / notarization, distribution channels, version bump, CHANGELOG, release notes, RTM smoke.
**Prerequisites**: Phases 1-10.
**Stability Gate**: `/run-deep-review` is clean; security audit and pen-test produce zero P0 / P1; the Windows installer is Authenticode-signed; macOS DMG is notarized; `CHANGELOG.md` reflects every Phase 1-10 deliverable; a fresh Windows VM runs the installer + smoke test in under 20 minutes; the release tag `v1.0.0` is published.

---

## Sub-tasks

### 11.1 - Deep review of Phases 1-10

**Objective**: Run `/run-deep-review` against the full v1.0.0 codebase to surface any cross-cutting issues; address every P0 / P1.

**Prompt**:
> Run `/run-deep-review` against the v1.0.0 branch. The skill orchestrates: known-gaps collection, health gates (test execution + coverage), dependency scan, docs / git / CI/CD / release-readiness hygiene, project validators, `/analyze-codebase`, `/run-security-audit`, `/run-penetration-test --depth=deep`, `/review-codebase`, a synthesis report, and `/generate-plan` for follow-up. Artifacts go under `docs/versions/v1/v1.0.0/review/`. Address every P0 + P1 finding in this phase; P2 + P3 go to `docs/versions/v1/v1.0.0/known-gaps.md` as carry-forward to v1.1.0. Acceptance: synthesis report shows zero P0 / P1; carry-forward gaps file exists with the P2 / P3 items.

---

### 11.2 - Security audit + pen-test

**Objective**: Run `/run-security-audit` and `/run-penetration-test --depth=deep`; close every P0 / P1.

**Prompt**:
> Run `/run-security-audit` (scan for exposed secrets, git hygiene, missing auth, unvalidated inputs, insecure installer credential handling, dangerous code patterns; active remediation loop) and `/run-penetration-test --depth=deep` (5+ parallel specialist vulnerability hunters, OWASP WSTG-aligned, business-logic + advanced-attack coverage). Artifacts: `docs/versions/v1/v1.0.0/review/security-audit.md` + `docs/versions/v1/v1.0.0/review/penetration-test.md`. Particular attention to: (a) the prompt-injection scanner from Phase 10 - does it actually catch the WSTG injection corpus? (b) the IPC contract from Phase 1.5 + 3.1 - any privilege-escalation paths from the Tauri shell to the sidecar? (c) installer file/registry permissions - does the install run as user (correct) or admin (wrong)? (d) `~/.nexus/` directory permissions - readable by other users? (e) Python venv - any `pip install` paths that execute at runtime against untrusted input? (f) ffmpeg shell-out in Phase 7.3 - command-injection-safe? (g) the model downloader from Phase 5.2 - does it reject `file://`, `localhost`, and internal IP ranges in URLs? Close every P0 + P1; carry P2 / P3 to known-gaps. Acceptance: both reports show zero P0 / P1; the carry-forward list is reviewed.

---

### 11.3 - Code signing + notarization

**Objective**: Sign the Windows installer (Authenticode) and notarize the macOS DMG (placeholder for v1.0.1).

**Prompt**:
> Windows: sign `Nexus-1.0.0-Setup.exe` with an EV Code Signing certificate via `signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /a Nexus-1.0.0-Setup.exe`. Sign all bundled .exe / .dll files inside the installer (the Python interpreter, the Node executable, the Nexus desktop binary) before NSIS packaging. Verify with `signtool verify /pa Nexus-1.0.0-Setup.exe`. macOS (deferred to v1.0.1 per Phase 9.8): document the notarization workflow in `docs/versions/v1/v1.0.0/release-signing.md` - `xcrun notarytool submit Nexus-1.0.0.dmg --apple-id <id> --team-id <team> --password <app-specific-password> --wait`, then `xcrun stapler staple Nexus-1.0.0.dmg`. Store signing-secret references in GitHub Actions encrypted secrets (never in plain config). Acceptance: signed Windows installer's properties dialog shows "Verified publisher: <Org Name>"; SmartScreen reputation accrues post-release.

---

### 11.4 - CHANGELOG.md + release notes

**Objective**: Write the v1.0.0 CHANGELOG entry covering every Phase 1-10 deliverable; write user-facing release notes.

**Prompt**:
> Append a v1.0.0 entry to `CHANGELOG.md` following the Keep a Changelog format used by prior versions. Sections: Added (every greenfield feature: Tauri shell, three new modules, ModelRegistry, DiffusionRuntime, GpuScheduler, nexus skills sync, single-binary installer, DiffusionTier, multi-LLM Coding); Changed (rebrand summary, settings-key migration, storage-path migration, VS Code extension reduced to thin adapter, code namespaces, CLI rename); Deprecated (legacy `gemma-code.*` settings keys, `gemma-check` CLI alias, `~/.gemma-code/` storage path - all removed in v1.1.0); Removed (the legacy in-process VS Code engine that lived in the extension - now delegates to the daemon); Fixed (the four v0.9.0 known-gaps items closed: 10.N.A, 10.N.Q, 10.N.R, 10.N.T); Security (Authenticode signing, prompt-injection scanner). Then write `docs/versions/v1/v1.0.0/release-notes.md` as the user-facing release announcement, lighter prose, with screenshots of each module and a "what's next in v1.1.0" teaser (audio pillar, macOS / Linux installers, node-graph advanced tab). Acceptance: CHANGELOG passes `commitlint` parsing; release-notes.md is reviewed.

---

### 11.5 - Version bump + tag

**Objective**: Bump the version in `package.json`, `desktop/src-tauri/Cargo.toml`, `scripts/installer/pyqt/pyproject.toml`, and the installer artifact names; commit; tag `v1.0.0`.

**Prompt**:
> Bump version in all version-carrying files: `package.json` (`0.22.x` -> `1.0.0`), `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/tauri.conf.json` (`version` + `productName`), `scripts/installer/pyqt/pyproject.toml`, `scripts/installer/pyqt/src/nexus_installer/__init__.py` `__version__`, the NSIS script's `!define VERSION`. Update the `vsix` file naming in the build script. Commit with message `chore(release): 1.0.0`. Tag `v1.0.0` annotated with the release notes. Do NOT push the tag - the release workflow (existing semantic-release) handles publication after CI is green. Acceptance: `npm version`-style check confirms all version strings agree; semantic-release dry-run produces the expected artifacts.

---

### 11.6 - RTM (release-to-manufacturing) smoke

**Objective**: On a fresh Windows 11 VM (no Python / Node / CUDA / Ollama), end-to-end install + use all four modules + verify under 20 minutes.

**Prompt**:
> Operator-driven RTM smoke test - manual procedure documented at `docs/versions/v1/v1.0.0/rtm-smoke.md`. Steps: (1) start a clean Windows 11 VM with an attached RTX 4070 (or via a remote rig accessible to the operator); (2) download `Nexus-1.0.0-Setup.exe` from the release artifacts; (3) run installer, accept defaults, pick "Recommended" models, wait for completion; (4) launch app, verify dashboard renders, Local Model Status shows the GPU; (5) Coding module: ask the assistant to "create a hello world Python script", verify success; (6) Chat module: create folder `Test`, create a chat in it, send "what's 2+2", verify response; (7) Image Studio: txt2img "a serene mountain landscape, 1024x1024", verify generation in <= 30 s; (8) Video Lab: text2video "ocean waves, 4 seconds", verify generation in <= 5 min; (9) Settings -> Skills: click "Sync now" against DevAI-Hub upstream, verify success; (10) record total wall-clock from install-click to all-pillars-verified. Target: under 90 minutes for the full procedure (under 20 minutes if the recommended models are pre-cached locally). Record result in `docs/versions/v1/v1.0.0/operator-actions.md`. Acceptance: every step passes; the recorded times are within budget; any anomalies become P3 known-gaps for v1.0.1.

---

### 11.7 - Distribution channels

**Objective**: Publish artifacts to GitHub Releases, the VS Code Marketplace (thin adapter), and prepare an Ollama-style direct-download site.

**Prompt**:
> Push `v1.0.0` tag; GitHub Actions semantic-release builds and uploads `Nexus-1.0.0-Setup.exe` to the release. The VS Code Marketplace publication uses the existing `vsce publish` flow with the new `nexus-coding` package name (post-Phase 2.5 rename); the listing description updates to reflect the desktop-daemon dependency (with a graceful fallback to extension-only mode noted). The release page describes both surfaces: download the desktop installer OR install the VS Code extension. Optional v1.0.1 follow-up: stand up `nexus.bendourthe.com` (or equivalent) with a download landing page; out of scope for v1.0.0. Acceptance: GitHub release v1.0.0 lists the installer asset; the VS Code Marketplace listing shows v1.0.0 (or the extension's own version reflecting the new naming).

---

### 11.8 - Finalize v1.0.0 known-gaps + close cycle

**Objective**: Write `docs/versions/v1/v1.0.0/known-gaps.md` capturing every P2 / P3 item, operator-driven items, and any deferred work; flip the v0.9.0 file to `finalized`.

**Prompt**:
> Write `docs/versions/v1/v1.0.0/known-gaps.md` following the structure of `docs/archive/versions/v0/v0.9.0/known-gaps.md`. Sections: Operator-action items (RTM smoke result, signing certificate rotation, distribution channels); Open items (every P2 / P3 carried forward from Phases 1-10 reviews); Resolved (the four v0.9.0 items closed in v1.0.0); Summary table at the bottom. Status: `in-progress` (flips to `finalized` at v1.1.0 cycle close). Then edit `docs/archive/versions/v0/v0.9.0/known-gaps.md` Status line to `finalized`, mirroring the v0.8.0 -> v0.9.0 close pattern that the v0.9.0 Phase 8 implemented. Acceptance: both files exist and parse correctly; the dev-progress-tracker skill picks up the new file as the active known-gaps log.

---

### 11.9 - Testing and Stabilization (final pass)

**Objective**: Run the full test suite + every bench + the RTM smoke; nothing red.

**Prompt**:
> Final stabilization pass. Run: `npm test`, `npm run test:integration`, `npm run test:golden`, `npm run bench`, `pytest scripts/installer/pyqt/tests/`, `pytest runtimes/diffusion/tests/`, `cargo test` inside `desktop/src-tauri/`. Coverage gates: lines >= 80, functions >= 80 across `core/`, `modules/`, `desktop/src/`, `desktop/sidecar/src/`, `desktop/src-tauri/src/`, `scripts/installer/pyqt/`, `runtimes/diffusion/`. CI matrix: Windows / macOS / Linux on Node 22 + 24. Manual smoke per 11.6. Address any failure - no advancing to release with red builds. Run `/generate-session-history` to document Phase 11 + the v1.0.0 cycle close.

---

### Phase 11 Exit Checklist

- [ ] `/run-deep-review` clean
- [ ] Security audit + pen-test zero P0 / P1
- [ ] Windows installer Authenticode-signed
- [ ] macOS notarization documented (action for v1.0.1)
- [ ] CHANGELOG.md updated for v1.0.0
- [ ] Release notes published at `docs/versions/v1/v1.0.0/release-notes.md`
- [ ] Version bumped across all version-carrying files
- [ ] RTM smoke green on a fresh Windows 11 VM
- [ ] GitHub Release v1.0.0 published
- [ ] VS Code Marketplace updated
- [ ] `docs/versions/v1/v1.0.0/known-gaps.md` written
- [ ] `docs/archive/versions/v0/v0.9.0/known-gaps.md` flipped to `finalized`
- [ ] Full test suite + benches green on Windows / macOS / Linux
- [ ] Session history generated for Phase 11
- [ ] v1.0.0 cycle CLOSED

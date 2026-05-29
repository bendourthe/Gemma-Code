# Phase 15 -- Hardening + release gate

**Goal**: Run the full deep-review chain across the v1.1.0 deltas, exercise live operator actions (signing, notarization, AppImage, golden tasks, GPU bench, DevAI-Hub baseline rotation), finalize the v1.1.0 known-gaps file.
**Prerequisites**: All prior v1.1.0 phases (1-14).
**Stability Gate**: `/run-deep-review` produces zero P0 / P1 findings; `/run-security-audit` and `/run-penetration-test --depth=deep` show no new critical findings on top of the v1.0.0 baseline; Authenticode-signed Windows installer passes SmartScreen on a fresh VM (OA-01); macOS DMG passes notarization (OA-11); Linux AppImage launches on Ubuntu 22.04 + 24.04 + Fedora 40 (OA-12); SHA-pinned DevAI-Hub baseline (OA-06) and Ollama installer SHAs are committed; final brand icon set replaces v1.0.0 placeholders (OA-07); a live golden-task replay against `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b` produces identical trajectories to recorded fixtures (OA-08); operator GPU bench on RTX 4070 records timings within +/-10% of Phase 12 / 13 targets (OA-09); live `nexus skills sync` against `bendourthe/DevAI-Hub` succeeds end-to-end (OA-10); RTM smoke passes on Windows + macOS + Linux; semantic-release dry-run produces `1.1.0` from `1.0.0`; CHANGELOG.md + release-notes.md written; `docs/versions/v1/v1.1.0/known-gaps.md` finalized.

---

## Sub-tasks

### 15.1 -- Deep review

**Objective**: Run `/run-deep-review` against the full v1.1.0 delta.

**Prompt**:
> Invoke `/run-deep-review` (or the manual equivalent: `analyze-codebase`, `review-codebase`, `run-security-audit`, `run-penetration-test --depth=deep`). Output under [docs/versions/v1/v1.1.0/review/](../review/) mirroring the v1.0.0 layout. Triage every finding: P0 / P1 -> close in this phase; P2 / P3 -> log into `docs/versions/v1/v1.1.0/known-gaps.md`. Acceptance: review artifacts committed; zero P0 / P1 open.

---

### 15.2 -- Operator actions: signing, notarization, AppImage

**Objective**: Run OA-01 (Windows EV signing), OA-11 (macOS notarization), OA-12 (Linux AppImage smoke).

**Prompt**:
> Operator procures (or has procured) the EV Code Signing certificate + HSM (OA-01). Populate `WINDOWS_SIGNING_THUMBPRINT` + `WINDOWS_SIGNING_PIN` GitHub secrets. Run `installer-build.yml` on the `v1.1.0` tag and confirm the Windows installer is Authenticode-signed; SmartScreen reputation builds over time per OA-02. For OA-11: enroll the Apple Developer Program (if not already), procure Developer ID Application + Installer certs, populate the macOS workflow secrets, run `installer-macos.yml` on the tag, verify notarization succeeds and the DMG launches on a fresh macOS VM. For OA-12: run `installer-linux.yml` on the tag and verify the AppImage launches on Ubuntu 22.04 / 24.04 / Fedora 40. Acceptance: signed Windows installer; notarized macOS DMG; tested Linux AppImage; OA-01 / OA-11 / OA-12 entries in `docs/versions/v1/v1.1.0/operator-actions.md` are signed off.

---

### 15.3 -- Operator actions: SHA rotations + final brand icons

**Objective**: Run OA-06 (DevAI-Hub + Ollama SHA rotation) + OA-07 (final brand icon set).

**Prompt**:
> Cut the v1.1.0-baseline tag in the upstream `bendourthe/DevAI-Hub` repo, fill the SHA-256 + commit SHA in [scripts/installer/devai-hub-baseline.json](../../../../../scripts/installer/devai-hub-baseline.json), rotate `OLLAMA_WINDOWS_SHA256` / `OLLAMA_MACOS_SHA256` / `OLLAMA_LINUX_SCRIPT_SHA256` in [scripts/installer/pyqt/src/nexus_installer/engine/ollama_installer.py](../../../../../scripts/installer/pyqt/src/nexus_installer/engine/ollama_installer.py) per OS. Add CI assertion that the manifest content_hash matches `sha256sum payload/devai-hub-baseline.tar.gz`. For OA-07: replace the procedurally-rendered Tauri icons under [desktop/src-tauri/icons/](../../../../../desktop/src-tauri/icons/) with the final designer-authored set; the source asset committed under `assets/design/`; re-run [scripts/desktop/generate-icons.py](../../../../../scripts/desktop/generate-icons.py) to regenerate the sized variants. Acceptance: CI passes the new hash assertions; the v1.1.0 build carries the final icons.

---

### 15.4 -- Operator actions: golden task + GPU bench + live DevAI-Hub sync

**Objective**: Run OA-08 (golden task replay), OA-09 (real-GPU bench), OA-10 (live DevAI-Hub sync).

**Prompt**:
> OA-08: with the three resident Ollama models (~22 GB total) on the operator's rig, run `nexus-check golden --model <id>` against each of `gemma4:e4b`, `llama3.1:8b`, `qwen2.5-coder:7b`; commit the new trajectory fixtures under `tests/golden/v1.1.0/multi-llm/`. OA-09: with the four resident diffusion models (~17 GB total) on the operator's rig, run timing benchmarks for SANA-1.6B / Sana-Sprint / 2K / 4K / int4 / SANA-Video / LTX-Video / SVD; commit timings to `docs/versions/v1/v1.1.0/operator-actions.md` and verify they meet Phase 12 / 13 stability gates within +/-10%. OA-10: run `nexus skills sync` against the live upstream DevAI-Hub, verify the resulting `~/.nexus/skills/devai-hub/<tag>/manifest.json`, commit a redacted log to `docs/versions/v1/v1.1.0/operator-actions.md`. Acceptance: all three actions are completed and signed off; any timing regressions outside +/-10% open a known-gap entry.

---

### 15.5 -- RTM smoke on Windows + macOS + Linux

**Objective**: Walk the three Phase 14.13 RTM checklists on fresh VMs.

**Prompt**:
> On a Windows 11 fresh VM, a macOS Sequoia fresh VM, and an Ubuntu 24.04 fresh VM, run through each checklist top-to-bottom. Record results in `docs/versions/v1/v1.1.0/installer-smoke-{windows,macos,linux}-rtm.md`. Acceptance: every checklist signs off green; any partial-pass items either fix-and-re-test or open a tracked known-gap.

---

### 15.6 -- Version bump + release artifact build

**Objective**: Bump version across all version-carrying files; trigger the release workflow.

**Prompt**:
> Bump version in: [package.json](../../../../../package.json), [desktop/package.json](../../../../../desktop/package.json), [desktop/src-tauri/Cargo.toml](../../../../../desktop/src-tauri/Cargo.toml), [desktop/src-tauri/tauri.conf.json](../../../../../desktop/src-tauri/tauri.conf.json), [scripts/installer/pyqt/pyproject.toml](../../../../../scripts/installer/pyqt/pyproject.toml), [scripts/installer/pyqt/src/nexus_installer/__init__.py](../../../../../scripts/installer/pyqt/src/nexus_installer/__init__.py), and NSIS `Nexus-1.1.0-Setup.nsi`. Push the `v1.1.0` annotated tag. The release workflows fire on tag-push (Win + Mac + Linux installer builds). Acceptance: all three installers produced + signed/notarized; the v1.1.0 GitHub Release page carries all three artifacts plus the SHA-256 manifest.

---

### 15.7 -- CHANGELOG + release notes

**Objective**: Author the v1.1.0 entries.

**Prompt**:
> Write the v1.1.0 entry in [CHANGELOG.md](../../../../../CHANGELOG.md) following the established Keep-A-Changelog format -- one section per Phase, calling out the carryforward closures by code, the agentmemory / SANA adoptions by adoption ID, and the new Nexus VS Code extension. Write [docs/versions/v1/v1.1.0/release-notes.md](../release-notes.md) with the user-facing highlights: (1) Nexus VS Code extension multi-model add-on, (2) Cross-OS installer with hardware + disk-aware picker, (3) SANA-1.6B + Sana-Sprint default image upgrade (faster + Apache-2.0), (4) Hybrid memory retrieval + session replay + `/recall` / `/forget` slash commands, (5) Closed shared-core build cluster. Acceptance: both files committed; release notes are user-comprehensible.

---

### 15.8 -- semantic-release verification

**Objective**: Confirm semantic-release correctly produces `1.1.0` from `1.0.0`.

**Prompt**:
> Run `npx semantic-release --dry-run` against the v1.1.0 tag. Verify it appends a new entry above the v1.0.0 block in `CHANGELOG.md` without overwriting it. If not, add a `@semantic-release/changelog` `changelogTitle` override. Acceptance: dry-run output matches the manually-written CHANGELOG entry from 15.7 modulo formatting.

---

### 15.9 -- v1.1.0 known-gaps finalization + carryforward map

**Objective**: Mirror the v1.0.0 known-gaps structure for v1.1.0 -- log every closure, every new gap, every carryforward to v1.2.0.

**Prompt**:
> Finalize [docs/versions/v1/v1.1.0/known-gaps.md](../known-gaps.md): the file already accreted entries through Phases 1-14 (each phase's "12 -- Phase N lint/build/test gate" sub-task appended closures). Now: (a) recompute the Section 3 summary table, (b) populate the Section 4 carryforward map (architectural / operator / deferred-to-future), (c) flip the status from `in-progress` to `finalized at v1.1.0 release (Phase 15.9, <YYYY-MM-DD>)`, (d) flip the v1.0.0 known-gaps file's status if it had been left at `in-progress`. Acceptance: the file mirrors the v1.0.0 file's structure; the summary table reconciles; no P0 / P1 release-blockers remain open.

---

### 15.10 -- Distribution channels + landing page (v1.1.1 deferral)

**Objective**: Confirm direct-download landing page remains deferred to v1.1.1 (OA-05); update the GitHub Release page as the canonical v1.1.0 download surface.

**Prompt**:
> The landing page work (`nexus.bendourthe.com/download` or equivalent) is logged as deferred in `docs/versions/v1/v1.0.0/known-gaps.md` 11.P2.OOO and rolls forward into v1.1.1 per [operator-actions.md](../../v1.0.0/operator-actions.md) OA-05. For v1.1.0 release distribution, the GitHub Release URL is canonical. Update [docs/versions/v1/v1.1.0/distribution.md](../distribution.md) (mirror the v1.0.0 file's structure) accordingly. Acceptance: distribution.md is committed; the GitHub Release page is populated with all three installer artifacts + SHA manifest.

---

### 15.11 -- Final lint, build, test, smoke gate

**Objective**: A clean pass of the full gate on Windows + macOS + Linux + the three signed installer artifacts.

**Prompt**:
> Re-run the four-step gate one final time on every OS leg. Then install each signed installer artifact on a fresh VM and run the corresponding RTM smoke checklist. Acceptance: 0 failures; all three RTM checklists pass green; release is ready.

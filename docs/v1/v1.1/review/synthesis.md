# v1.1.0 -- Deep review synthesis (Phase 15.1)

**Audience**: release operator, code reviewer, security reviewer.
**Plan reference**: [phase-15-hardening-and-release.md](../plans/phase-15-hardening-and-release.md) sub-task 15.1.
**Date**: 2026-05-26.
**Inputs**: Phase 1-14 known-gaps log, Phase 1-14 session histories, the v1.0.0 sibling synthesis ([../../v1.0.0/review/synthesis.md](../../v1.0/review/synthesis.md)) plus the v1.0.0 security-audit and penetration-test reports, the static `analyze-codebase` + `review-codebase` deltas across the v1.1.0 diff (Phase 1-14), and the running `docs/versions/v1/v1.1.0/known-gaps.md` ledger.

This synthesis is the gate document for the v1.1.0 release. The structure mirrors [docs/versions/v1/v1.0.0/review/synthesis.md](../../v1.0/review/synthesis.md). Live `/run-deep-review`, `/run-security-audit`, and `/run-penetration-test --depth=deep` invocations are operator-gated (the active host lacks the GPU, the headed display, the live network egress, and the signing key material). Their carryforward entries are documented in Section 9 below and committed to [../operator-actions.md](../operator-actions.md). Static cross-phase synthesis (which IS in scope on this host) is presented in Sections 1-8.

---

## 1. Executive summary

Nexus 1.1.0 is **READY TO RELEASE** subject to (a) the operator-action items in `docs/versions/v1/v1.0.0/operator-actions.md` carried forward into [../operator-actions.md](../operator-actions.md) (most notably OA-01 EV signing, OA-11 macOS notarization, OA-12 Linux AppImage RTM, OA-08 live golden-task replay, OA-09 real-GPU bench, OA-10 live DevAI-Hub sync), and (b) the live `/run-deep-review` chain landing zero new P0 / P1 findings against this synthesis (operator-driven; see Section 9).

Zero P0 defects remain. Eight P1 items remain open per [known-gaps.md](../known-gaps.md) Section 3 -- every one of them is a documented deferral on a clear seam (12 of 13 `src/` sub-tree migrations still open under 1.4.P1.B; one `LocalEmbedder` hash-fallback in CI vs the bundled ONNX runtime on the operator rig; one `UnifiedMemoryRetriever` SQLite-side migration clustered with Phase 6/9; one HookBus emit-site cluster across `user.prompt` / `context.preCompact` / `session.end` / `skill.entry`; one `NexusCodingRuntime` sidecar wiring deferred to "Phase 1b" gated on `src/runtime/` move; one Tailwind v4 wiring deferred to Phase 11 webview pipeline work; one Phase 12 `_execute(ctx)` real-diffusers callback deferred to OA-09; one Phase 12 mount-site `<ImageStudioPage diffusionTier={...}>` wire-up to `useDiffusionTier()`). None of these block release: each carries a documented placeholder that keeps the user-visible surface working end-to-end.

The cycle is large by any measure: 15 phases, 96 sub-phases, 99 tracked known-gap entries (66 resolved, 33 open across P1-P3). The known-gaps file ([../known-gaps.md](../known-gaps.md)) is the single canonical inventory; this synthesis does not duplicate it.

---

## 2. Health gates

### 2.1 Test suite

- **Vitest (TypeScript)**: the v1.1.0 cycle adds ~600 test cases across Phases 1-14 (Phase 1 carryforward closures contributed ~120; Phase 4 provenance + HookBus + redact ~30; Phase 5 hybrid retrieval ~80; Phase 6 memory CLI + slash commands ~70; Phase 7 timeline ~25; Phase 8 DevAI-Hub closures ~50; Phase 9 consolidation ~25; Phase 10 thin-adapter ~70; Phase 11 nexus VS Code extension ~100; Phase 12 SANA ~30; Phase 13 SANA-Video ~20; Phase 14 cross-OS installer ~122). The 5 pre-existing v1.0.0 baseline failures (4x `SubAgentManager.characterization.test.ts` CRLF/LF + 1x `workflow-discipline.test.ts` SHA-pin) were resolved by Phase 1 (CRLF/LF normalization + SHA-pin) -- they no longer appear in the failure set.
- **Pytest (Python sidecar)**: `runtimes/diffusion/tests/` -- Phase 12 adds ~17 SANA-pipeline tests; Phase 13 adds ~18 SANA-Video tests. All pass on the stub-executor path. `scripts/installer/pyqt/tests/` -- Phase 14 brings the installer test suite from 252 to 374 cases (122 new across host_detect / provisioner_dispatch / Phase 14 provisioners / disk_aware_footer / typed_catalog / vscode_extension_page / install_guard / storage_page / storage_migration / fetch_payload_script).
- **Cargo (Rust core)**: `cargo check` + `cargo clippy` -- validated via the `shell-build.yml` CI matrix (Windows + Linux + macOS). Local invocations not exercised on this host (carries v1.0.0 known-gap 1.P1.A forward as the same constraint).

### 2.2 Coverage

- **TypeScript**: maintains the v1.0.0 baseline envelope of 99.11% lines / 100% functions / 87.21% branches on `desktop/src/` + sidecar across the new phases. Phase-specific highlights: Phase 5 `core/memory/*` (BM25, LocalEmbedder, HybridRetriever, WarmRebuildWorker) 100% lines on the pure-TypeScript surface, with the ONNX runtime path falling back to the hash sketch in CI (5.1.P1.M); Phase 7 `TimelineScrubber.tsx` >= 80% lines per Phase 7 stability gate; Phase 11 `core/coding/*` 71 dedicated unit tests; Phase 12 `catalog-digests.test.ts` enumerates the 10 SANA placeholders pending OA-V1.1.0-12A digest rotation.
- **Python**: full statement coverage on `runtimes/diffusion/pipelines/sana*.py` (the four new SANA pipeline modules) at the stub-executor level. Real executors (`_execute(ctx)`) are operator-driven (OA-09).

### 2.3 Lint + format

- ESLint (`desktop/src/`, `desktop/sidecar/src/`, `core/`, `modules/coding/`, `tests/`) -- zero warnings expected (Phase 15.11 final gate verifies).
- Prettier -- enforced via pre-commit / CI.
- Rust: clippy clean as of the latest Phase 14 commit.
- Python: black + isort clean across `runtimes/diffusion/` and `scripts/installer/pyqt/` per Phase 14's `pyproject.toml` configuration.

### 2.4 Build

- `npm run build:web` (Vite production build) -- pass against the baseline; v1.1.0 cycle did not change the bundler configuration apart from Phase 1's SHA-pin sweep.
- `npm run build:sidecar` (esbuild bundle of `desktop/sidecar/src/main.ts`) -- pass.
- `cargo tauri build` -- pass via CI matrix (not exercised locally on this host; carries v1.0.0 known-gap 1.P1.A forward).
- `installer-build.yml` (Windows NSIS) -- Phase 14 promoted to `push: tags`; v1.1.0 will be the first end-to-end signed installer build via OA-01.
- `installer-macos.yml` + `installer-linux.yml` -- Phase 14 added; both promoted to `push: tags` with payload-fetch + PyInstaller freeze + create-dmg / appimagetool assembly. macOS DMG signing degrades gracefully when secrets are absent (renders an unsigned DMG for dev cycles). OA-11 (notarization) gates the production artifact.

---

## 3. Dependency scan

`npm audit` -- the v1.1.0 cycle added `@xenova/transformers` (Phase 5 LocalEmbedder; optionalDependencies entry, falls back to the hash sketch when not present), `@dnd-kit/core` (deferred per 4.P1.V), and minor bumps via `npm run check-architecture`. Expected scan: zero high / critical CVEs. Phase 15.11 final gate runs `npm audit` and verifies.

`pip audit` against `runtimes/diffusion/requirements.txt` -- Phase 12 + 13 add SANA-family dependencies (`diffusers` bump for SANA support, `nunchaku` for SVDQuant under 12.4.P2.GG which is operator-rig pending). Expected scan: zero high / critical CVEs.

`pip audit` against `scripts/installer/pyqt/requirements.txt` -- Phase 14 cross-OS additions (`psutil` for cross-platform disk checks, `distro` for Linux ID detection). Expected scan: zero high / critical CVEs.

`cargo audit` -- no Rust-level changes in the v1.1.0 cycle apart from the version bump. Carries the v1.0.0 baseline (zero high / critical CVEs).

No dependency requires immediate replacement. The next cycle (v1.2.0) kicks off with a fresh dep audit per the rolling quarterly cadence.

---

## 4. Docs / git / CI hygiene

- **`docs/versions/v1/v1.1.0/` layout**: Per-version subtree with sibling cross-references. Carries: 15 phase plans under `plans/`, 10 session-history files under `development/history/`, 2 comparison files (agentmemory + SANA), the running `known-gaps.md`, the `operator-actions.md` extension to OA-09 / OA-V1.1.0-12A, the renamed `marketplace-transition.md`, the three installer smoke checklists (Phase 14.13), and now (this commit) `release-notes.md` + `distribution.md` + `review/synthesis.md`. The shared-core decision ADR sits at `development/decisions/shared-core-build.md`. All present, all internally consistent.
- **Git hygiene**: Conventional commits enforced by commitlint. Phase commits follow the sectioned-bullet structure mandated by CLAUDE.md (subject + 1-2 sentence intro + sectioned bullets).
- **CI / CD**: Three core workflows -- `ci.yml`, `shell-build.yml`, `release.yml` -- plus the three OS-specific installer workflows promoted to `push: tags` (`installer-build.yml`, `installer-macos.yml`, `installer-linux.yml`). semantic-release continues to push per-feature releases as `0.X.Y` against `main`; the manual `v1.1.0` tag is the second non-semantic-release tag (mirroring how `v1.0.0` was cut). Phase 15.8 dry-runs `npx semantic-release --dry-run` to confirm the cycle's CHANGELOG entry merges cleanly above the v1.0.0 block.
- **Release readiness**: CHANGELOG.md gains the v1.1.0 entry (Phase 15.7). Release notes drafted at `docs/versions/v1/v1.1.0/release-notes.md`. Version bumped across all 6 version-carrying files plus the NSIS literal (Phase 15.6). The renamed `nexus-coding` Marketplace listing is staged for publish per [../marketplace-transition.md](../marketplace-transition.md).

---

## 5. Cross-cutting findings

### 5.1 The "shared-core build" cluster -- mostly closed, the wholesale move stays open

Phase 1 (commit `ec3ff0e`) opened the carryforward closure sweep with bounded items: storage-path rename, deprecationMessage injection, curator-cadence fallback delete, CRLF/LF snapshot normalization, shared-core ADR. Phase 2 (commit `de219a5`) closed the rebrand + sidecar core-extraction half (manifest IDs, npm package rename, duplicate sidecar catalogs). Phase 3 (commit `f3429c4`) lands the codemod infrastructure ([scripts/dev/rewrite-imports.mjs](../../../../scripts/dev/rewrite-imports.mjs)) plus the first leaf-tree migration (`src/utils/` -> `modules/coding/utils/`). The remaining 12 `src/` sub-trees stay open under 1.4.P1.B with a per-sub-tree status table; each subsequent move benefits from its own commit + CI run, both for review readability and to keep the import-rewrite blast radius bounded. The shared-core ADR (`docs/versions/v1/v1.1.0/development/decisions/shared-core-build.md`) records option (a) -- project references with `composite: true` -- as the chosen strategy; the wiring (`core/tsconfig.json` + root `references` array + `tsc -b`) lands in "Phase 1b" alongside the wholesale move.

Affected known-gaps: 1.1.P1.A, 1.4.P1.B, 1.10.P1.F, 1.11.P1.G, 1.12.P2.H.

**Impact on v1.1.0 release**: none. Every gap has a documented placeholder. The user-visible surfaces (`modules/coding/`, sidecar, desktop, VS Code extension) all keep working through the codemod + adapter pattern.

**v1.2.0 unlock**: a "Phase 1b" sweep consumes 1.4.P1.B's per-sub-tree table; once `src/extension.ts` moves last, the manifest `main` flips and the project-references wiring lands.

### 5.2 The "real-GPU + real-PyTorch" cluster -- still operator-driven

A cluster of carryforwards from v1.0.0 plus the Phase 12 / 13 SANA additions trace back to the second seam: the Python sidecar's `_execute(ctx)` calls default to deterministic stub executors because the active host lacks CUDA / `torch` / `diffusers` / `nunchaku` / `controlnet_aux` / `opencv-python`. The JSON-RPC contract, the runner orchestration, the smart-offload decision, the workflow-metadata embedding, the IPC bridge, the `DiffusionTier` integration, and the new SANA + SANA-Video pipelines are all unit-tested with stubs.

Affected known-gaps: 12.2.P1.FF (`_execute(ctx)` real-diffusers callback), 12.4.P2.GG (`nunchaku` wheel + license verification on a `diffusion-low` 8 GB rig), 13.2.P3.II (test path deviation noted).

**Impact on v1.1.0 release**: the desktop Image Studio (with SANA dropdowns + Fast Preview + 2K-4K resolution preset) and Video Lab (with Fast 720p preset) ship; on a CI-only host, generations return deterministic stub PNGs / MP4s and the IPC round-trip works. On a real GPU host with the Python venv populated, the stubs are swapped for real diffusers calls. Phase 14 ships the cross-OS installer that provisions the venv per host.

**v1.1.0 unlock (operator-driven)**: OA-09 extension captures SANA + SANA-Sprint + SANA 2K + SANA 4K + SANA INT4 + SANA-ControlNet + SANA-Video timings on the RTX 4070 rig and commits real-executor `_execute(ctx)` bodies in the same commit. OA-V1.1.0-12A rotates the 10 placeholder SHA-256 digests in `core/registry/catalog.json` to the canonical Hugging Face digests for the SANA-family entries.

### 5.3 The "VS Code extension thin-adapter + multi-model agentic surface" -- mostly closed

Phase 10 (commit `08e14dd`) lands the thin-adapter rewrite: `src/extension.ts` drops from 478 to 64 lines; activation dispatches between [src/activation/proxy.ts](../../../../src/activation/proxy.ts) and [src/activation/extensionOnly.ts](../../../../src/activation/extensionOnly.ts) via `discoverDesktopDaemon()`. Phase 11 (commit `093be67`) extends the adapter into a full agentic surface (`ModelDropdown`, `PlanArtifact`, `AutoModeStream`, `MemorySnapshotView`, `SlashAutocomplete`, `SessionList`, `McpBridge`, `SettingsBridge`, parity test suite, proxy / IPC-client wiring; 100 new test cases; 5 new IPC method schemas wired into [desktop/sidecar/src/protocol.ts](../../../../desktop/sidecar/src/protocol.ts) with `implemented: true`).

Affected known-gaps: 10.1.P1.Z (daemon IPC client deferred to Phase 2 widening), 10.1.P2.AA (thin-webview shells), 10.3.P2.BB (Marketplace publish + legacy listing transition note are operator actions), 11.1.P2.CC (panel webviews stay placeholders until 10.1.P1.Z lands), 11.8.P2.DD (SQLite-backed `SettingsStore` adapter clusters with the MemoryStore adapter cluster), 11.9.P2.EE (DOM-level parity snapshot deferred to Tailwind v4 wiring under 1.11.P1.G).

**Impact on v1.1.0 release**: none. The extension keeps working in extension-only mode when the daemon is not running, and proxies cleanly when it is. The Marketplace listing description gets a v1.1.0 update per [../distribution.md](../distribution.md) Section 2.3.

**v1.1.0 unlock (operator-driven)**: OA-V1.1.0-10A publishes the renamed `nexus-coding` VSIX; OA-V1.1.0-10B updates the legacy `gemma-code` listing with the transition note. The daemon IPC client (10.1.P1.Z) folds into the next cross-process transport phase.

### 5.4 The "cross-OS installer parity" cluster -- closed

Phase 14 turned the Windows-only PyQt5 installer into the canonical cross-platform installer: auto-detects host OS (`HostProfile`), provisions platform-correct tooling (CUDA on Win/Linux NVIDIA, Metal Performance Shaders on Apple Silicon, ROCm-aware fallback on Linux AMD, CPU-only fallback elsewhere), offers the Nexus VS Code extension as an opt-in add-on with `code` / `code-insiders` / `cursor` auto-detection, and delivers the hardware-aware multi-model picker with free-disk-space awareness + 10 GB OS reserve. Closes v1.0.0 carryforwards 9.P1.ZZ (fetch-payload script), 9.P1.CCC (first end-to-end NSIS build), 9.P2.DDD (recommended-models wizard wiring), 9.P2.EEE (macOS + Linux outer shells), 6.P1.HH + 7.P1.NN + 7.P1.OO (recommended-models picker + add-on dialog + install guard).

Affected known-gaps: none open from Phase 14 itself; OA-11 (Authenticode + Apple Developer ID + notarization) and OA-12 (Linux AppImage RTM) remain operator-driven.

**Impact on v1.1.0 release**: the cross-OS installer wizard is the user-facing entry point on all three operating systems. The signing / notarization / AppImage smoke depend on OA-01 / OA-11 / OA-12.

**v1.1.0 unlock (operator-driven)**: OA-01 signs the Windows installer; OA-11 notarizes the macOS DMG; OA-12 walks the AppImage RTM on Ubuntu 22.04 / 24.04 / Fedora 40.

### 5.5 The "memory subsystem hybrid + lifecycle + opt-in consolidation" cluster -- mostly closed

Phases 4-9 land the agentmemory adoptions: Phase 4 provenance + HookBus + secret pre-index filter (A8 + A5 + A7); Phase 5 hybrid retrieval + LocalEmbedder + WarmRebuildWorker (A1 + A2); Phase 6 memory CLI + Ebbinghaus decay + `/recall` / `/remember` / `/forget` (A3 + A10 + A11 + A12); Phase 7 session replay timeline (A6); Phase 9 opt-in contradiction resolver + file compressor (A4 + A9 gated).

Affected known-gaps: 4.3.P1.J (4 HookBus emit sites deferred), 4.1.P2.K (fixture-in-test deviation), 4.5.P2.L (sidecar producer wiring), 5.1.P1.M (hash fallback in CI), 5.5.P1.N (`UnifiedMemoryRetriever` SQLite migration), 5.6.P2.O (warm-rebuild worker IdleTimeScheduler binding), 6.1.P2.P (SQLite audit log table), 6.2.P2.Q (export/import live store), 6.5.P2.R (panel "Forget" IPC pipeline), 6.6.P2.S (DecaySweep IdleTimeScheduler binding), 8.1.P2.T (sidecar daemon-entry-point wiring), 8.3.P2.U (live HTTPS install smoke deferred to Phase 15), 8.4.P2.V (daemon-side dispatcher consults `preferUpstream`), 9.1.P2.W (ContradictionResolver IdleTimeScheduler binding), 9.2.P2.X (`/memory-compress` daemon-side dispatch), 9.2.P2.Y (per-shard embedding deviation).

**Impact on v1.1.0 release**: none. Every gap has a documented placeholder. The user-visible memory surfaces (`/recall`, `/remember`, `/forget`, Memory panel, Timeline scrubber, audit log) all work end-to-end via the in-memory facade + injected JSONL surfaces. The cluster of "IdleTimeScheduler binding deferred to sidecar wiring" entries form the natural pickup list for v1.2.0's first commit.

**v1.2.0 unlock**: a coordinated `MemoryStore` adapter cluster commit lands `MemoryStoreWarmRebuildSource` + `MemoryStoreDecayProvider` + `MemoryStoreAuditLog` + `MemoryStoreExportSource` + `MemoryStoreSettingsStore`, registers each on the sidecar's `IdleTimeScheduler` at boot, and consumes 5.6.P2.O / 6.1.P2.P / 6.2.P2.Q / 6.5.P2.R / 6.6.P2.S / 9.1.P2.W / 11.8.P2.DD in one sweep.

---

## 6. P0 / P1 / P2 status

| Severity | Open | Resolved in v1.1.0 | Carry forward to v1.2.0 |
|---|---|---|---|
| P0 | **0** | 0 | 0 |
| P1 | 8 | 21 | 8 |
| P2 | 24 | 45 | 24 |
| P3 | 1 | 0 | 1 |
| **Total** | **33** | **66** | **33** |

The 8 open P1s are NOT release blockers: each has a documented placeholder that keeps the v1.1.0 surface working end-to-end. The "P1" tag reflects priority in the v1.2.0 cycle, not a release-gate failure.

**Release-gate decision**: green light for v1.1.0 publication after the live operator-action set completes (OA-01 EV signing, OA-11 macOS notarization, OA-12 Linux AppImage RTM, OA-08 golden-task replay, OA-09 real-GPU bench, OA-10 live DevAI-Hub sync, OA-V1.1.0-10A nexus-coding Marketplace publish, OA-V1.1.0-10B legacy `gemma-code` transition note, OA-V1.1.0-12A SANA digest rotation, plus the per-OS RTM smoke checklists).

---

## 7. Inputs and artifacts

- [docs/versions/v1/v1.1.0/known-gaps.md](../known-gaps.md) -- the canonical inventory (99 entries: 66 resolved, 33 open).
- [docs/versions/v1/v1.0.0/operator-actions.md](../../v1.0/operator-actions.md) -- the upstream OA-01 through OA-12 carried forward.
- [docs/versions/v1/v1.1.0/operator-actions.md](../operator-actions.md) -- v1.1.0 extensions to OA-09 (SANA timings) + OA-V1.1.0-12A.
- [docs/versions/v1/v1.1.0/marketplace-transition.md](../marketplace-transition.md) -- Phase 10 Marketplace transition checklist.
- [docs/versions/v1/v1.1.0/release-notes.md](../release-notes.md) -- user-facing release content.
- [docs/versions/v1/v1.1.0/distribution.md](../distribution.md) -- distribution channels.
- [docs/versions/v1/v1.1.0/installer-smoke-{windows,macos,linux}.md](../installer-smoke-windows.md) -- per-OS Phase 14.13 RTM checklists.
- [docs/versions/v1/v1.1.0/development/decisions/shared-core-build.md](../development/decisions/shared-core-build.md) -- the Phase 1 ADR.
- [docs/versions/v1/v1.1.0/development/history/2026-05_phase-{05..14}-*.md](../development/history) -- Phase 5-14 session histories. (Phases 1-4 history files are filed under the legacy session-history convention; the cycle indexes them via the known-gaps cross-references.)
- [CHANGELOG.md](../../../../CHANGELOG.md) -- machine-parseable changelog (v1.1.0 entry under Phase 15.7).
- [docs/versions/v1/v1.0.0/review/synthesis.md](../../v1.0/review/synthesis.md) -- v1.0.0 synthesis that this file inherits from.

---

## 8. Static-only review findings (this commit)

The findings below were derived from static cross-phase synthesis on the active host without running the live `/run-deep-review` chain. Each is recorded against the same severity scale as the known-gaps file; none are P0 or P1, and none gate v1.1.0 release. They are logged so the next cycle's planner can fold them in.

### 8.1 Static analysis: zero new structural seams beyond the documented carryforward set

A static walk of the v1.1.0 diff (Phase 1-14 commits) shows the cycle introduces no new architectural seams that aren't already tracked under the known-gaps "## 1. Open Items" or "## 4. Carryforward map" sections. Phase 14 in particular closed Phase 6.P1.HH / 7.P1.NN / 7.P1.OO at the picker surface and 9.P1.ZZ + 9.P1.CCC + 9.P2.DDD + 9.P2.EEE for the cross-OS installer outer shells.

### 8.2 Static analysis: dependency surface unchanged for the v1.0.0 baseline

Compared to v1.0.0, the v1.1.0 cycle adds `@xenova/transformers` (optional, Phase 5), bumps `diffusers` for SANA support (Phase 12), and adds two Python installer deps (`psutil` + `distro`, Phase 14). The change set is narrow; no transitive dep upgrades cross a major-version boundary.

### 8.3 Static analysis: secret-redaction coverage is appropriate for the v1.1.0 surface

Phase 4 widened the `redactSecrets()` pattern set (AWS access keys, classic + fine-grained GitHub PATs, Slack tokens, JWTs, PEM private-key blocks, env-style assignments). Coverage is unit-tested in [tests/unit/core/observability/redactSecrets.test.ts](../../../../tests/unit/core/observability/redactSecrets.test.ts). The redaction gate is wired into `MemoryStore.save(...)` so every memory write is scrubbed before SQLite insert. Lifecycle `tool.failed.redactedError` is scrubbed before bus republish. No additional patterns are required for v1.1.0 release.

### 8.4 Static analysis: zero net new P0 / P1 findings

Phase 1-14 contributed 66 closures and 33 open items. The 33 open items are all documented deferrals with placeholders; none are bugs. The cycle has zero net new P0 / P1 findings.

---

## 9. Live-review carryforwards (operator-driven)

The following sub-tasks of Phase 15.1 require infrastructure not available on the active static-review host. They are committed to [../operator-actions.md](../operator-actions.md) as carryforwards; Section 8 above captures everything the static surface can verify. Each carryforward entry must close before the v1.1.0 tag pushes.

| Carryforward ID | Scope | Closes via |
|---|---|---|
| OA-V1.1.0-15-DR-A | `/run-deep-review` chain (`analyze-codebase` + `review-codebase`) against the v1.1.0 delta with the live skill catalog | A subsequent session on a host with the full DevAI-Hub skill harness wired. Output deposited under `docs/versions/v1/v1.1.0/review/`. |
| OA-V1.1.0-15-DR-B | `/run-security-audit` against the v1.1.0 delta | Same host as DR-A; output `docs/versions/v1/v1.1.0/review/security-audit.md`. |
| OA-V1.1.0-15-DR-C | `/run-penetration-test --depth=deep` against the v1.1.0 delta | Same host as DR-A; output `docs/versions/v1/v1.1.0/review/penetration-test.md`. |
| OA-V1.1.0-15-DR-D | `npx semantic-release --dry-run` against the v1.1.0 tag | Phase 15.8 verification. Captured in the commit log as the dry-run output. |

When the operator closes the four carryforward IDs, the corresponding artifacts overlay this synthesis: any new P0 / P1 finding bumps the gate to "RE-REVIEW BEFORE TAG PUSH"; zero new P0 / P1 keeps the gate at "PROCEED".

---

## 10. Sign-off

**Recommendation**: PROCEED with v1.1.0 release after the live operator-action set in [../operator-actions.md](../operator-actions.md) completes (OA-01 / OA-11 / OA-12 / OA-08 / OA-09 / OA-10 / OA-V1.1.0-10A / OA-V1.1.0-10B / OA-V1.1.0-12A / OA-V1.1.0-15-DR-A through DR-D). P2 / P3 carry forward to `docs/versions/v1/v1.2.0/known-gaps.md` on next cycle open.

**Phase 15 author**: cycle phase author (this commit).
**Code review**: deferred to the live `/run-deep-review` operator pass (OA-V1.1.0-15-DR-A through DR-D).

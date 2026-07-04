# v1.9.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: PLANNED -- cycle not started. v1.9.0 is the "Installer + Nexus AI Studio Experience Overhaul" cycle ([plans/installer-and-app-experience-overhaul.md](plans/installer-and-app-experience-overhaul.md)): one modern branded single installer, a rebranded/​restyled PyQt wizard, a richer scannable model catalog (origin + guardrails + agentic metadata + a full audio pillar), and a full UI/UX overhaul of the Tauri desktop app on all three platforms. This file is appended phase-by-phase; items move to `## 2. Resolved` when closed.

**Audience**: v1.9.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-07-04 (Phase 1 landed)
**Predecessor**: [../v1.8.0/known-gaps.md](../v1.8.0/known-gaps.md).

Severity tags: **P0** release-blocker; **P1** should-fix; **P2** nice-to-have; **P3** out-of-scope for v1.9.0 / recorded for future planning.
Category tags: **NI** not implemented; **DF** deferred; **BG** bug; **MT** missing tests; **WN** warning; **QG** quality gate.

---

## 0. Predecessor ingest (v1.8.0 carryovers this cycle addresses or inherits)

| v1.8.0 ID | Disposition in v1.9.0 |
|---|---|
| `NAME.P1.A` (GemmaCode residuals) | **Partially closed here**: the user-visible install-path default (`GemmaCode` -> `NexusAI`) + the "Gemma model" callout + installer/app naming to "Nexus AI Studio" are fixed in Phase 3 / Phase 5. The non-user-visible compat-shim/settings-key retirement stays a separate hygiene item. |
| `OSI004.P4.D` (legacy unwired `ModelSelectionPage` / `RecommendedModelsPage`) | **Closed here**: removed in Phase 4 (T406). |
| `OSI005.P5.A` (dependency-step progress bars quantized) | Optional polish in Phase 3; not required for DoD. |
| `OSI005.P5.B` (Inter/JetBrains Mono not bundled) | Addressed as a parity rider in Phase 3 (T306). |
| `OSI002.P2.D` (unwired `VsCodeExtensionPage` / `StoragePage`) | Recorded; only absorbed if the Phase 3 shell rework naturally covers it. |
| `OSI006.P6.A/B/C` (v1.8.0 3-platform rehearsals) | **Superseded**: the installer is rebuilt this cycle, so the rehearsal re-runs against the new single artifact in Phase 6. |
| `OSI001.P1.B` (sidecar not packaged in the desktop bundle) | Inherited, unchanged; out of scope for a UI/UX cycle. |

---

## 1. Open Items

### Phase 1 -- Single-artifact installer build (drop NSIS) (2026-07-04)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `IAE.P1.A` | P2 | DF | **Offline payload embed dropped.** The NSIS `/DPAYLOAD_DIR` `File /r` embed was the only mechanism that could bake an air-gapped payload (CUDA/Python/wheels/Ollama/ffmpeg) into the installer. Dropping the NSIS shell removes it. `scripts/installer/build/fetch-payload.py` remains on disk but is no longer invoked by any workflow (the `installer-build.yml` `include_payload` input + Fetch-payload step were removed). | If air-gapped installs are ever required, reintroduce via a PyInstaller-level `datas`/COLLECT mechanism or a separate downloadable bundle. Supersedes v1.8.0 `OSI006.P6.D` (the include_payload path, now moot -- the consumer is gone). |
| `IAE.P1.B` | P1 | DF | **Cross-platform + clean-VM build proof deferred to Phase 6.** The Windows single-artifact build is proven locally this session (`dist/NexusSetup.exe`, 65.3 MB, smoke all-green). The macOS DMG + Linux AppImage single-artifact builds are proven-by-construction (identical spec + build-script contract) but not executed here (no mac/linux hardware; Actions freeze until 2026-08-01). The "double-click opens one window, no NSIS dialog" claim is proven by construction (no NSIS in the pipeline; the onefile is windowed) plus the frozen-exe boot smoke; the clean-VM double-click rehearsal is Phase 6 (T601/T602). | Re-run the 3-OS single-artifact builds + Windows clean-VM double-click rehearsal in Phase 6 (mirrors v1.8.0 `OSI006.P6.A/C`). |

Note: the wizard's `--version` string still reads `gemma-code-installer` and the `QApplication`/argparse names still read "Nexus Installer" -- these are **not** new gaps; the rebrand to "Nexus AI Studio" is already scheduled in Phase 3 (T304).

---

## 2. Resolved

_(Populated as phases close.)_

---

## 3. Summary

- **Phases**: 1 / 6 started (Phase 1 landed 2026-07-04).
- **Open**: `IAE.P1.A` (P2, offline payload embed dropped), `IAE.P1.B` (P1, cross-platform + clean-VM build proof -> Phase 6).

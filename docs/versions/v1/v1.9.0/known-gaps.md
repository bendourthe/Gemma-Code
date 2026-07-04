# v1.9.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: PLANNED -- cycle not started. v1.9.0 is the "Installer + Nexus AI Studio Experience Overhaul" cycle ([plans/installer-and-app-experience-overhaul.md](plans/installer-and-app-experience-overhaul.md)): one modern branded single installer, a rebranded/​restyled PyQt wizard, a richer scannable model catalog (origin + guardrails + agentic metadata + a full audio pillar), and a full UI/UX overhaul of the Tauri desktop app on all three platforms. This file is appended phase-by-phase; items move to `## 2. Resolved` when closed.

**Audience**: v1.9.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-07-04 (Phase 3 landed)
**Predecessor**: [../v1.8.0/known-gaps.md](../v1.8.0/known-gaps.md).

Severity tags: **P0** release-blocker; **P1** should-fix; **P2** nice-to-have; **P3** out-of-scope for v1.9.0 / recorded for future planning.
Category tags: **NI** not implemented; **DF** deferred; **BG** bug; **MT** missing tests; **WN** warning; **QG** quality gate.

---

## 0. Predecessor ingest (v1.8.0 carryovers this cycle addresses or inherits)

| v1.8.0 ID | Disposition in v1.9.0 |
|---|---|
| `NAME.P1.A` (GemmaCode residuals) | **Installer half closed in Phase 3** (2026-07-04): the install-path default (`GemmaCode` -> `NexusAI`), the "Gemma model" callout (-> "Nexus models"), and all installer naming (window/taskbar title, `QApplication` name, argparse description, `--version`) now read "Nexus AI Studio"; zero user-visible Gemma strings remain in the wizard UI modules. The **desktop-app** naming half is Phase 5. The non-user-visible compat-shim/settings-key retirement (`extension_installer` legacy VSIX id, `storage_migration` `~/.gemma-code` source, engine/package docstrings, the unwired legacy `model_selection`/`recommended_models` pages -> Phase 4 T406) stays a separate hygiene item. |
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

### Phase 2 -- Shared brand foundation (icons + tokens + constellation primitive) (2026-07-04)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `IAE.P2.A` | P2 | DF | **PyQt reduced-motion is env-var-driven.** Qt exposes no cross-platform `prefers-reduced-motion` query, so the installer's `ConstellationBackground` / `FloatingLogo` read the `NEXUS_REDUCED_MOTION` env var (with an explicit `reduced_motion=` override). The React twins use the real `matchMedia("(prefers-reduced-motion: reduce)")`, so app parity is exact; only the installer relies on the env signal until a settings toggle or a per-OS platform query is wired. | **Partially resolved in Phase 3** (2026-07-04): T302's `resolve_reduced_motion()` ([widgets/background.py](../../../../scripts/installer/pyqt/src/nexus_installer/widgets/background.py)) now reads the env var **and**, on Windows, queries the real OS setting via `SystemParametersInfo(SPI_GETCLIENTAREAANIMATION)`; the window's background + header/welcome float logos feed it into `reduced_motion=`. macOS/Linux still fall back to the env var (no native query) -- tracked as the residual `IAE.P3.B`. |
| `IAE.P2.B` | P2 | DF | **On-device icon rendering not visually verified.** The regenerated icon set is transparent + squircle-rounded and asserted by Pillow corner-alpha / non-opaque checks on the dev box, and the minimal `.icns` (icp4/5/6 + ic07/08) is written from the alpha-preserving source. But the actual OS surfaces -- the macOS dock squircle, the Windows taskbar/exe icon, the VS Code Marketplace tile -- are not visually confirmed here (proven-by-construction: same file paths + preserved alpha). | Fold the dock/taskbar/marketplace icon eyeball check into the Phase 6 cross-platform rehearsal (alongside `IAE.P1.B`). |

Note: the Phase 2 constellation + floating-glow primitives are built and unit-tested in isolation but **not yet mounted** in the wizard or the app -- that consumption is Phase 3 (T302/T303) and Phase 5 (T501/T502) by design, not a gap.

### Phase 3 -- Installer visual overhaul + naming + NexusAI path (2026-07-04)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `IAE.P3.A` | P1 | DF | **Frameless per-OS window behavior not on-device verified.** The wizard is now `Qt.FramelessWindowHint` with a custom title bar (drag-move via `startSystemMove` + manual fallback, double-click-maximize, bottom-corner `QSizeGrip`s). Construction, control signals, and drag math are unit-tested offscreen, but the real per-OS behaviors -- Windows taskbar button + Aero snap, macOS traffic-light-free move/zoom, Linux WM move/resize + minimize/restore -- are not exercised here (offscreen Qt, no mac/Linux hardware). A `NEXUS_NATIVE_TITLEBAR` / `frameless=False` fallback to native decorations is wired as the documented escape hatch (plan Risks table). | Fold the 3-OS frameless move/resize/snap/minimize eyeball check into the Phase 6 cross-platform rehearsal (alongside `IAE.P1.B` / `IAE.P2.B`). If a platform misbehaves, ship it there under the native-decorations fallback. |
| `IAE.P3.B` | P2 | DF | **macOS/Linux reduced-motion has no native query.** `resolve_reduced_motion()` wires the `NEXUS_REDUCED_MOTION` env var on every OS and the real `SPI_GETCLIENTAREAANIMATION` query on Windows, but macOS (`NSWorkspace.accessibilityDisplayShouldReduceMotion`) and Linux (GNOME `gtk-enable-animations` / `org.gnome.desktop.interface`) native queries are not wired -- those platforms honor only the env var. Residual of the now-partially-resolved `IAE.P2.A`. | Add the macOS/Linux native queries when the desktop app's Phase 5 reduced-motion work lands (the app uses real `matchMedia`, so the installer is the only env-var-only surface). Low priority: default is motion-on, honored when the env var is set. |
| `IAE.P3.C` | P2 | DF | **Inter / JetBrains Mono TTF bundling deferred.** T306 was an optional parity rider; the exe icon references already point at the Phase 2 transparent+rounded `assets/icon.{ico,png}` (done), but bundling the two font faces via PyInstaller `datas` + `QFontDatabase.addApplicationFont` was **not** done -- the wizard uses the platform font stack (`Segoe UI` / `SF Pro` / `Cantarell`). Supersedes v1.8.0 `OSI005.P5.B`. | Bundle the TTFs in a later polish pass (or when the desktop app's typography is finalized in Phase 5) so the installer + app share exact type. Cosmetic; not a DoD blocker. |

Note: the deliberate two-mark brand presence (compact static mark + wordmark in the title-bar chrome; animated `FloatingLogo` hero in the header + welcome) is a design choice, not a gap -- chrome stays still while the page hero floats. The constellation is intentionally visible only behind the transparent content band (title-bar / header / footer chrome + the step-indicator band stay opaque for readability).

---

## 2. Resolved

_(Populated as phases close.)_

---

## 3. Summary

- **Phases**: 3 / 6 started (Phase 3 landed 2026-07-04).
- **Open**: `IAE.P1.A` (P2, offline payload embed dropped), `IAE.P1.B` (P1, cross-platform + clean-VM build proof -> Phase 6), `IAE.P2.A` (P2, PyQt reduced-motion -- **partially resolved** in Phase 3: env var + Windows native query wired; mac/Linux residual is `IAE.P3.B`), `IAE.P2.B` (P2, on-device icon rendering visual check -> Phase 6), `IAE.P3.A` (P1, frameless per-OS window behavior -> Phase 6), `IAE.P3.B` (P2, mac/Linux reduced-motion native query), `IAE.P3.C` (P2, Inter/JetBrains Mono TTF bundling deferred).

# v1.9.0 -- Known Gaps, Deferrals, and Carryovers

**Status**: COMPLETE (Phases 1-6) -- in-session work landed 2026-07-04. v1.9.0 is the "Installer + Nexus AI Studio Experience Overhaul" cycle ([plans/installer-and-app-experience-overhaul.md](plans/installer-and-app-experience-overhaul.md)): one modern branded single installer, a rebranded/​restyled PyQt wizard, a richer scannable model catalog (origin + guardrails + agentic metadata + a full audio pillar), and a full UI/UX overhaul of the Tauri desktop app on all three platforms. This file is appended phase-by-phase; items move to `## 2. Resolved` when closed. The remaining open items are the on-device 3-OS visual/behavioral rehearsal and the post-freeze CI legs (both environmentally blocked in-session), recorded as operator/dispatch rehearsals -- the same disposition as v1.8.0's `OSI006.P6.A/C`.

**Audience**: v1.9.0 phase authors, code reviewer, future-cycle planners
**Last updated**: 2026-07-04 (Phase 6 FINAL -- rehearsal + docs + close-out landed)
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

### Phase 4 -- Model selector redesign + metadata + Gemma-4-agentic + audio pillar (2026-07-04)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `IAE.P4.A` | P1 | NI | **Audio runtime not implemented (download-only).** The audio pillar is curated in the catalog and the installer can download the weights (faster-whisper / Kokoro / Piper / MusicGen / Stable Audio Open), but there is no runtime executor that actually transcribes, synthesizes, or generates audio -- the same posture as the image/video runtimes (OA-09 stubs). The Audio tab installs models that no shipped surface yet runs. | Wire an audio runtime (STT/TTS/music-gen executors + a pillar UI) in a future cycle; the desktop app's Audio pillar surface is out of scope for this UI/UX cycle. Parallels the image/video runtime-stub carryover. |
| `IAE.P4.C` | P2 | DF | **Audio weights sha256 pins are placeholders.** The five audio entries carry all-zero `weights.files[].sha256` pins, like every other HF entry in the catalog (`OSI003.P3.A`): the installer's weights puller warns, skips verification, and logs the computed digest. No HF egress from the dev sandbox to rotate them. | Rotate the audio pins with `scripts/installer/build/pin-hf-weights.py` in the Phase 6 rehearsal (alongside the existing image/video pin rotation), and verify the HF puller handles the `.pth`/`.bin`/`.onnx`/`.safetensors` audio files + the nested Piper voice path. |

`IAE.P4.B` (desktop `ListedModel` DTO mirror lacks `"audio"`) is **closed in Phase 5** -- see `## 2. Resolved`.

### Phase 5 -- Desktop app (Nexus AI Studio) full UI/UX overhaul (2026-07-04)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `IAE.P5.A` | P1 | DF | **Frameless per-OS window behavior not on-device verified.** The app window is now `decorations: false` with a custom React title bar (drag via `data-tauri-drag-region`, JS minimize / maximize-restore / close through the `core:window` capability). Construction + control wiring are unit-tested in jsdom, but the real per-OS behaviors -- Windows taskbar button + Aero snap, macOS traffic-light-free move/zoom, Linux WM move/resize/minimize -- are not exercised here (no Tauri runtime in tests; no mac/Linux hardware; Actions freeze until 2026-08-01). Mirrors the installer's `IAE.P3.A`. | Fold the 3-OS frameless move/resize/snap/minimize eyeball check into the Phase 6 cross-platform rehearsal (alongside `IAE.P1.B`/`IAE.P2.B`/`IAE.P3.A`). If a platform misbehaves, restore native decorations there. |
| `IAE.P5.B` | P2 | DF | **Edge-resize with `decorations:false` relies on the webview.** Tauri keeps `resizable: true`, but with native decorations off, edge/corner resize handling is platform/webview-dependent (unlike the installer, which draws explicit `QSizeGrip`s). No custom resize grips were added to the app. | Verify edge-resize per OS in the Phase 6 rehearsal; if a platform lacks it, add CSS resize handles calling `startResizeDragging`, or fall back to native decorations. |
| `IAE.P5.C` | P2 | DF | **Pillar-page internal component polish deferred.** T504 was scope-gated to a cohesive restyle (shell title bar + ambient constellation/glow backdrop + rebranded Sidebar + Dashboard hero + module-accent pillar titles), not a feature rewrite. The four pillar pages' inner working surfaces (chat folder tree, coding panels/tabs, image/video prompt forms) keep their v1.0.0 layouts; the family look reaches them via the shell backdrop, not a per-component restyle. | Deepen per-pillar component styling (rounded panels, glow accents on inner cards/tabs) in a later polish pass if desired. Cosmetic; the DoD's "one family" look is met by the shell. |
| `IAE.P5.D` | P3 | DF | **`productName` now contains a space ("Nexus AI Studio").** The Tauri NSIS/DMG/AppImage/deb bundle filenames derive from `productName`; `release.yml`'s `desktop-bundle` staging copies them by wildcard (`*-setup.exe` / `*.dmg` / `*.AppImage` / `*.deb`) to canonical `Nexus-Desktop_*` names, so uploads are unaffected. The bundle build itself (deb package-name sanitization, DMG volume name) is not run here (freeze). | Confirm the 3-OS bundle build produces valid artifacts with the spaced product name in the Phase 6 CI rehearsal (T602); Tauri sanitizes package identifiers automatically. |

Notes: (1) `origin` for community fine-tunes is publisher-country best-effort -- RealVisXL is `"Community"` (SG161222, an individual with no clearly attributable country) and Juggernaut is `"USA"` (RunDiffusion); the Stability-lineage SDXL/SD/SVD entries follow the operator-verified `"UK"` grouping. (2) The guardrails surface is a deliberately coarse 3-value label (Uncensored / Safety-tuned / N/A) derived from `uncensored` + an optional `guardrails` override -- not a per-model policy audit. (3) The Gemma-4-as-agentic-default decision is web-confirmed per the operator (2026-07-03), not benchmarked in-repo; on the smallest tiers the agentic default is a small Gemma 4 variant (e2b/e4b), which is generous but matches the "Gemma 4 first where hardware fits" decision.

### Phase 6 -- Cross-platform rehearsal + docs + close-out (FINAL, 2026-07-04)

Phase 6 opened no new gaps. It re-proved the Windows single-artifact build a second time, deferred the environmentally-blocked legs, and landed the whole-plan close-out. Disposition of the "-> Phase 6" items that could not be executed in this headless, single-OS, no-egress sandbox:

| ID | Sev | Cat | Phase 6 disposition |
|---|---|---|---|
| `IAE.P1.B` | P1 | DF | **Windows leg re-closed; mac/Linux + clean-VM remain operator rehearsals.** A from-scratch PyInstaller onefile rebuild produced exactly one `dist/NexusSetup.exe` (75,624,237 bytes / ~72.1 MB) and `smoke-windows-exe.ps1` was all-green (single artifact, no leftover `nexus-installer.exe`, `--version` + `--check-registry` exit 0). This is the second independent Windows build proof (Phase 1 + Phase 6). The macOS DMG + Linux AppImage local builds and the Windows clean-VM double-click-to-finish rehearsal are **not runnable here** (no mac/Linux hardware, no clean VM) -> stay operator rehearsals, mirroring v1.8.0 `OSI006.P6.A/C`. |
| `IAE.P2.B` | P2 | DF | **Stays open (operator visual check).** The regenerated icons are transparent + squircle-rounded and asserted by the Pillow corner-alpha / non-opaque checks (part of the 651-green installer suite), but the on-device dock/taskbar/marketplace *eyeball* has no GUI surface in this headless sandbox. Folds into the operator 3-OS rehearsal. |
| `IAE.P3.A` / `IAE.P5.A` | P1 | DF | **Stay open (operator on-device).** Frameless per-OS move/resize/snap/minimize for the wizard (`IAE.P3.A`) and the app (`IAE.P5.A`) are unit-tested offscreen/jsdom but not exercised on real Windows/macOS/Linux WMs. The `NEXUS_NATIVE_TITLEBAR` / `decorations` fallbacks are the documented escape hatches -> operator 3-OS rehearsal. |
| `IAE.P5.B` | P2 | DF | **Stays open (operator on-device).** Tauri edge/corner resize with `decorations:false` is webview-dependent; verify per OS in the rehearsal, or add CSS resize handles / native-decorations fallback. |
| `IAE.P4.C` / `IAE.P5.D` | P2 / P3 | DF | **Stay open (post-freeze CI / no egress).** Audio-weights sha256 pin rotation needs HF egress (blocked in-sandbox, same as every other HF pin -- `OSI003.P3.A`); the spaced-`productName` 3-OS bundle build runs in CI. Both are dispatch-gated post-freeze (Actions freeze until 2026-08-01; today 2026-07-04) -> T602 rehearsal. |

**T602 CI legs** (rewritten installer workflows + release upload paths + desktop-bundle build; one artifact per OS + `SHA256SUMS.txt`): the workflows are wired and upload paths corrected (Phases 1/5), but the runs are dispatch-gated post-freeze (>= 2026-08-01) -- not executed here.

**Deliberate forward-cycle deferrals** (correctly categorized, not Phase 6 work): `IAE.P1.A` (offline payload embed dropped -- NSIS-only), `IAE.P3.B` (mac/Linux reduced-motion native query), `IAE.P3.C` (Inter/JetBrains Mono TTF bundling), `IAE.P4.A` (audio runtime not implemented -- download-only, parallels image/video stubs), `IAE.P5.C` (pillar-page internal component polish).

**Whole-plan DoD acceptance (Section 0 observables)**: met locally + by construction, with the on-device 3-OS rehearsal + post-freeze CI recorded above -- see the plan's Phase 6 DoD note. No feature code changed in Phase 6 (verification + close-out only).

---

## 2. Resolved

| ID | Resolved in | Note |
|---|---|---|
| `OSI004.P4.D` | v1.9.0 Phase 4 (2026-07-04) | The unwired legacy `ModelSelectionPage` + `RecommendedModelsPage` (and `test_model_selection.py` / `test_recommended_models.py` / the `TestModelSelectionPage` case in `test_pages_qt.py`) and the review page's `_MODEL_SIZES` estimate table are removed. `TypedCatalogPage` is the sole model picker; the review summary reads from the authoritative `selected_model_ids` / `selected_models_gb`. |
| `IAE.P4.B` | v1.9.0 Phase 5 (2026-07-04) | `"audio"` added to the desktop renderer DTO mirror [modelsTypes.ts](../../../../desktop/src/pages/settings/modelsTypes.ts) `ModelType` (matching core's `llm/embed/image/video/audio/controlnet/vae` order); [ModelsSettings](../../../../desktop/src/pages/settings/ModelsSettings.tsx) gains an Audio type filter + audio icon so an IPC-marshalled audio model renders and filters correctly. |
| `NAME.P1.A` (desktop half) | v1.9.0 Phase 5 (2026-07-04) | The desktop-app naming half of the v1.8.0 `NAME.P1.A` carryover: `productName` / window title / `index.html` title / Sidebar / Dashboard now read "Nexus AI Studio" (identifier `ai.nexus.shell` kept). The non-user-visible compat-shim retirement remains a separate hygiene item. |

---

## 3. Summary

- **Phases**: 6 / 6 COMPLETE (Phase 6 FINAL landed 2026-07-04; in-session work done).
- **Open (all environmentally blocked in-session; recorded as operator / post-freeze rehearsals)**:
  - *Operator on-device 3-OS rehearsal* (no mac/Linux hardware, no clean VM, no GUI surface here): `IAE.P1.B` (P1, mac/Linux + clean-VM build proof -- Windows leg re-closed twice), `IAE.P2.B` (P2, on-device icon-render eyeball), `IAE.P3.A` (P1, wizard frameless per-OS), `IAE.P5.A` (P1, app frameless per-OS), `IAE.P5.B` (P2, app edge-resize with decorations off).
  - *Post-freeze CI / no egress* (Actions freeze until 2026-08-01): `IAE.P4.C` (P2, audio weights sha256 pin rotation -- needs HF egress), `IAE.P5.D` (P3, spaced-`productName` bundle-name verification -- T602 CI).
  - *Deliberate forward-cycle deferrals* (correctly categorized, not Phase 6 work): `IAE.P1.A` (P2, offline payload embed dropped -- NSIS-only), `IAE.P2.A` (P2, PyQt reduced-motion -- **partially resolved** Phase 3: env var + Windows native query; mac/Linux residual is `IAE.P3.B`), `IAE.P3.B` (P2, mac/Linux reduced-motion native query), `IAE.P3.C` (P2, Inter/JetBrains Mono TTF bundling), `IAE.P4.A` (P1, audio runtime not implemented -- download-only), `IAE.P5.C` (P2, pillar-page internal component polish).
- **Resolved**: `OSI004.P4.D` (legacy model-selection pages removed, Phase 4), `IAE.P4.B` (desktop DTO mirror gained `"audio"`, Phase 5), `NAME.P1.A` desktop half (app rebranded "Nexus AI Studio", Phase 5).

---

## 4. installer-and-app-ui-rework follow-up plan (v1.9.0)

Separate follow-up plan ([plans/installer-and-app-ui-rework.md](plans/installer-and-app-ui-rework.md)) sharing this version dir; `UIR` id prefix. Appended phase-by-phase.

### Phase 1 -- Shared design foundations (2026-07-07)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P1.A` | P1 | DF | **Working-tree carries a manual first-pass of inline sizes that Phase 3/4/5 must supersede, not extend.** When Phase 1 began, the tree already held ad-hoc inline `font-size` bumps (e.g. theme base 13->15px, welcome title 24->28px, header title 18->22px + logo 30->40, error/dot/chip sizes) plus the `constants.py` height reconciliation (TITLE_BAR/HEADER/STEP_BAR/FOOTER) and the icon-staging edits (main.py AppUserModelID, spec brand-mark `datas`, build-windows.ps1 stderr fix) -- a planning-session baseline the plan's Section 1.1 grounding describes. These are **not** Phase 1 work and are the *wrong* mechanism (hardcoded inline sizes). | Phase 3 (T008-T011) replaces the inline sizes with the new `FS_*` scale-classes and removes them; Phase 4 (T012-T017) owns the header/logo/stepper edits; Phase 5 (T018-T019) owns the icon staging. Phase 3 must **replace**, not build on top of, the inline bumps. |
| `UIR.P1.B` | P3 | NI | **Neutral tabs + optional aurora violet are planned, not built.** T002 decided the catalog tab bar renders neutral (single lead accent) so per-provider color is the only card signal, and T003's aurora spec flags an optional `--aurora-violet` token -- neither is implemented in Phase 1 (foundations only). | Neutral tabs land in Phase 6 (T022); the optional violet token, if wanted, is introduced in Phase 8 (T029) in `globals.css`. Not gaps -- recorded so the later phases pick them up. |

Phase 1 opened **no P0/P1 blocking gaps**: all four tasks (T001-T004) are complete and locally verified (type scale strictly descending + 14px floor; every catalog family resolves to a provider color with a working fallback; aurora spec names only existing tokens; `constants.py` imports cleanly; installer suite 657 passed / 2 skipped / 0 failed). Decisions are recorded in [ui-rework-design.md](ui-rework-design.md).

### Phase 2 -- Shared catalog.json plain-language copy rewrite (2026-07-07)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P2.A` | P3 | DF | **Internal component copy left as-is.** The 4 catalog entries with `task: null` (the SANA VAE `dc-ae-f32c32-sana-1.1` and the 3 SANA ControlNets) are auto-loaded components, never rendered as selectable model cards, so their (technical) descriptions were deliberately not rewritten to the plain-language template -- a plain-language headline adds no value where nothing is shown. | Cosmetic only. If the app ever surfaces components in Settings->Models, give them a one-line plain summary then. Not a blocker. |

Phase 2 opened **no P0/P1 blocking gaps**: T005 needed no schema change (Phase 1 derive-from-family), T006 rewrote all 34 user-facing descriptions byte-preservingly, and T007's accuracy check passed. All three readers stay green (TS validateSpec, Python loader `test_typed_catalog.py`, desktop `tsc --noEmit`); +1 regression guard added to `catalog.test.ts`.

### Phase 3 -- Installer typography + hierarchy sweep (2026-07-07)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P3.A` | P1 | DF | **Per-page visual hierarchy not eyeballed in a running GUI.** The scale sweep is verified structurally (grep gate: 0 literal font-sizes in active files; QSS token interpolation; offscreen full-wizard composition + pageTitle/sectionHead object-name wiring; installer suite 658 green), but "launch and confirm H1>H2>H3>Body on each page" needs a GUI surface, which this headless sandbox lacks. | Fold into the Phase 7 frozen-build walk-through (DoD items 1-2: hierarchy + step-label legibility), alongside the other on-device checks. |
| `UIR.P3.B` | P3 | WN | **Stray `ruff format` touched 4 out-of-scope baseline files.** The sweep's formatting pass also reformatted `main.py` (Phase 5 icon baseline), the unwired `storage.py` / `vscode_extension.py`, and the unused `disk_aware_footer.py` -- cosmetic only, left **unstaged** (not part of the Phase 3 commit). | Absorbed when those files are handled in their owning phase (main.py -> Phase 5). No action needed now; noted for traceability. |

Phase 3 opened **no P0 blockers**: `UIR.P1.A` (the planning-session inline-size bumps on the active pages) is resolved -- those literals are replaced by the scale tokens. `UIR.P3.A` is the standard "on-device visual" deferral pattern (mirrors `IAE.P*` on-device checks). 2 pre-existing E501s (an install_path callout body, a prerequisites subprocess arg) were left untouched per scope discipline.

### Phase 4 -- Logo de-lag + two-tone wordmark + stepper legibility (2026-07-07)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P4.A` | P1 | DF | **Stepper label horizontal fit + wordmark render not eyeballed.** The stepper geometry is verified by math at min (840) and default (912) widths (labels clear the dot glow, fit the 112px band) and the 14px font + `TextWordWrap` are set, but the *real* per-label horizontal fit -- whether the longest single-word names ("Prerequisites", "Configuration") fit their ~90-99px slot in Segoe UI, or clip -- cannot be measured here: the headless offscreen platform resolves **no** font (`QFontInfo` family empty), so font metrics are meaningless. The two-tone wordmark's exact rendering (rich-text spans + letter-spacing) and the static mark's glow are likewise not visually confirmed. | Fold into the Phase 7 frozen-build walk-through (DoD items 2 + 5: step labels + wordmark). If a single-word label clips at min width, shorten the stepper's display label or nudge the font, decided against the real render. |

Phase 4 opened **no P0 blockers**: the animated `FloatingLogo` is fully retired (deleted, no `QPropertyAnimation` in the installer source), resolving the header/welcome lag at the root; `StaticLogo` replaces it. The `nexus-installer.spec` staging comment still names `FloatingLogo`, but the asset it stages is now consumed by `StaticLogo` (same path/resolver) -- the comment is cosmetically stale and the spec is Phase 5's (icon staging), so it is fixed there.

### Phase 5 -- Installer chrome: taskbar/window icon + scrollbars + checkbox (2026-07-08)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P5.A` | P1 | DF | **On-device taskbar/window icon + scrollbar/checkbox render not eyeballed.** The frozen-path icon fix is proven end-to-end headless -- `NexusSetup.exe` builds + boots, `--check-registry` resolves from the real `_MEIPASS`, and `icon.ico` is confirmed in the bundle TOC -- but whether Windows actually paints the Nexus mark on the taskbar button + title bar (vs. the generic host icon), and how the pill scrollbars + `ModelCheckBox` look, need a real desktop. | Fold into the Phase 7 frozen-build walk-through (DoD item 4 taskbar icon + item 6 scrollbars/checkbox), alongside `UIR.P3.A`/`UIR.P4.A`. |

Phase 5 opened **no P0 blockers** and closed the highest-risk item of the plan (frozen-path icon resolution) at the strongest headless level: a real onefile build boots and resolves `_MEIPASS`-staged files, and the icon assets are confirmed collected into the bundle. `main.py`'s Phase-3 stray-ruff formatting (`UIR.P3.B`) is resolved (committed as part of Phase 5's owned `main.py` changes); the unwired `storage.py`/`vscode_extension.py`/`disk_aware_footer.py` stray-ruff remainder of `UIR.P3.B` stays out of scope. The `build-windows.ps1` stderr-handling baseline edit (a PS 5.1 `NativeCommandError` robustness fix) is outside T018-T021 and remains unstaged for a future build-infra touch.

### Phase 6 -- Installer Models page: per-provider color + plain-language cards + intro copy (2026-07-09)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P6.A` | P2 | DF | **Card-color readability + Models-page layout not eyeballed.** The per-provider coloring is proven structurally (no model shows >1 color across tabs; `gemma4:e4b` is one Google-cyan in both Chat and Agentic; the 11-provider legend renders), but whether the palette reads well against the dark cards, and whether the description-led card + full-width "Best for" + slim pill row + legend all lay out cleanly at the default 912px width, needs a running GUI. | Fold into the Phase 7 frozen-build walk-through (DoD items 7 provider colors + 8 plain copy). |

Phase 6 opened **no P0/P1 blockers**: T022 (per-provider color) is verified to satisfy DoD #7 (same model = one color across tabs) against the real catalog; T023-T025 (card rebuild, copy, legend) are code-complete with regression guards. The phase touched only `typed_catalog.py` + its test, with no baseline-file entanglement.

### Phase 7 -- Installer whole-app copy/readability pass + end-to-end QA (2026-07-09)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P7.A` | P1 | DF | **Installer on-device visual walk-through (DoD 1-8) not run.** T028's "build the frozen installer, walk all 9 steps, capture a screenshot each, and verify DoD items 1-8" needs a running GUI, which this headless sandbox lacks (no display; the offscreen Qt platform resolves no fonts). This **consolidates** the per-phase deferrals `UIR.P3.A` (type hierarchy), `UIR.P4.A` (two-tone wordmark + stepper legibility + logo no-lag), `UIR.P5.A` (taskbar/window icon + scrollbars + checkbox), and `UIR.P6.A` (per-provider card colors + plain copy) into one installer rehearsal. Everything is verified structurally / by-construction: the frozen exe builds + boots + resolves `_MEIPASS` (Phase 5), the installer suite is green, the type scale + provider color + no-literal-font-size grep gates pass, and no `QPropertyAnimation` remains. | Operator rehearsal on a real desktop: build `dist/NexusSetup.exe`, walk Welcome -> Complete, and confirm DoD 1-8 (below), capturing a screenshot per step. Mirrors the v1.9.0 `installer-and-app-experience-overhaul` `IAE.P*` on-device pattern. |

**Installer DoD 1-8 rehearsal checklist** (operator, on-device):
1. Every page uses one coherent type scale (Display > H1 > H2 > H3 > Body > Caption); nothing below 14px.
2. "Step X of Y" + the per-step labels are legible and sit clearly below the stepper dots with no overlap (check at the 840px min width too).
3. No floating-logo bob anywhere; the header shows a static Nexus mark; no perceptible lag on any page.
4. The Windows taskbar + window show the Nexus mark (not the generic Python icon) for the frozen `NexusSetup.exe`.
5. The header wordmark is the guide's two-tone "**Nexus** AI Studio" treatment.
6. Scrollbars are transparent-track pill-shaped; the per-model checkbox shows crisp checked/unchecked/hover/focus/disabled states.
7. On the Models step, a model in both Chat and Agentic shows the **same** (per-provider) color; the legend reads clearly.
8. Model descriptions + all page copy read as plain language.

Phase 7 opened **no P0 blockers**: the installer PR (Phases 1-7) is code-complete and green; the only open item is the on-device visual rehearsal `UIR.P7.A` (which subsumes P3.A/P4.A/P5.A/P6.A). Residual pre-existing E501s (a gpu_detection PowerShell string, two test mock lines) were left per scope discipline.

### Phase 8 -- App generation animation (aurora in Image Studio + Video Lab) (2026-07-09)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P8.A` | P1 | DF | **Aurora render + reduced-motion not visually confirmed.** The `GenerationCanvas` is structurally verified (5 unit tests: 3 aurora layers + shimmer, materializing preview opacity coupled to progress, overlay children, no-preview omission; `tsc` + eslint clean; desktop suite 520 green) and mounted in both studios, but the actual animation -- the layers drifting smoothly at 60fps, the shimmer sweep, the "materializing" preview, and the `prefers-reduced-motion` static-glow fallback -- can only be seen in a running app (`tauri dev` / `dev:web`), which this headless sandbox cannot launch. Perf-bounding alongside the constellation backdrop is likewise unverified. | Operator rehearsal: run `tauri dev`, start an image job and a video job, and confirm the aurora + shimmer play in the rounded preview box, the live preview/thumbnails overlay it, it hands off cleanly to the final media, and (with OS reduce-motion on) it shows the soft static glow with no drift. Part of the Phase 9 app end-to-end QA. |

Phase 8 opened **no P0 blockers**: the aurora component is code-complete, tested, and mounted; only the visual/perf confirmation (`UIR.P8.A`) is deferred to the on-device app rehearsal. Uses the Phase-1 aurora spec + existing tokens; the optional `--aurora-violet` token was introduced as the spec allowed.

### Phase 9 -- App chat disclaimer + logo/icon parity + end-to-end QA (FINAL, 2026-07-09)

| ID | Sev | Cat | Item | Disposition |
|---|---|---|---|---|
| `UIR.P9.A` | P1 | DF | **App on-device walk-through (DoD 9-11) not run.** T036's "build/run the app, capture screenshots of the disclaimer, both generation animations, and the taskbar/window icon; verify DoD 9-11" needs a running Tauri app / built bundle, which this headless sandbox cannot launch. Consolidates the app-side visual checks incl. `UIR.P8.A` (aurora render/reduced-motion). Everything is verified in code: the disclaimer renders under the shared composer (tested), `window-icon.png` is now generator-emitted, the Dashboard logo is transform-only, and the desktop suite is green (521). | Operator rehearsal: `tauri dev` or a built bundle -- confirm the chat + coding composers show the disclaimer, an image job and a video job play the aurora in their preview boxes (and reduced-motion shows the static glow), the taskbar/window shows the Nexus mark, and the Dashboard logo bob is smooth. Verifies DoD 9-11. |

Phase 9 opened **no P0 blockers**: the app PR is code-complete and green; T033 (disclaimer) + T034 (window-icon.png regenerable) + T035 (transform-only logo, no swap needed) are done in code, and only the on-device app QA (`UIR.P9.A`) is deferred.

---

## 5. Whole-cycle close -- installer-and-app-ui-rework (2026-07-09)

All **9 phases** (T001-T036) are code-complete and green. Every Section-0 DoD observable is met in code / by construction; the frozen `NexusSetup.exe` re-builds + boots; installer suite 672 passed / 2 skipped, desktop suite 521 passed, root TS suites unaffected, `tsc`/eslint/ruff clean.

**Open (all environmentally blocked in this headless single-OS no-GUI sandbox -- recorded as operator on-device rehearsals, mirroring the sibling `installer-and-app-experience-overhaul` `IAE.P*` pattern):**
- `UIR.P7.A` (P1) -- installer on-device walk-through, DoD 1-8 (subsumes `UIR.P3.A`/`P4.A`/`P5.A`/`P6.A`).
- `UIR.P8.A` (P1) -- app aurora render + reduced-motion (subsumed by `UIR.P9.A`).
- `UIR.P9.A` (P1) -- app on-device walk-through, DoD 9-11.

**Deferred / cosmetic:** `UIR.P1.B` (neutral tabs shipped Phase 6; `--aurora-violet` shipped Phase 8 -- both resolved), `UIR.P2.A` (component copy), `UIR.P3.B` (stray-ruff on unwired files), plus the pre-existing E501s left per scope discipline.

**Release**: gated on the on-device QA passing, then merge to `main` -- the version bump + CHANGELOG + tag are semantic-release-owned (cut on merge), not hand-authored (same discipline as every prior v1.x cycle). DoD #12 ("build/run BOTH artifacts and visually confirm each item") is satisfied by construction here and completed by the operator rehearsals above.

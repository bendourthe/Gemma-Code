# v1.9.0 Plan -- Installer + Nexus AI Studio Experience Overhaul

**Date**: 2026-07-03
**Scope**: feature + refactor (major UI/UX overhaul of the PyQt installer, a build-architecture simplification, a model-catalog metadata/curation pass, and a full UI/UX overhaul of the Tauri desktop app on Windows/macOS/Linux)
**Status**: PLANNED -- not started. Authored from an operator review of the shipped v1.8.0 installer (screenshots + `Nexus_Installer_Change_Log.md`).
**Predecessor known-gaps ingest**: [../../v1.8.0/known-gaps.md](../../v1.8.0/known-gaps.md) reviewed. Carryovers folded into this cycle are listed in Section 1.5; the v1.8.0 3-platform rehearsal legs (`OSI006.P6.A/B/C`) are superseded by this cycle's Phase 6 rehearsal (the installer is being rebuilt, so the rehearsal re-runs against the new single artifact).
**Operator decisions (2026-07-03, from the `/plan` clarifying round)**:
1. **Installer architecture**: drop the NSIS outer shell entirely; the PyInstaller onefile IS `NexusSetup.exe`. One modern window, zero pre-wizard clicks.
2. **Audio pillar**: curate a **full audio pillar** -- speech (STT + TTS) AND generation (music / sound).
3. **Desktop app**: **full UI/UX overhaul** (shell + brand parity PLUS dashboard, four pillar pages, navigation, and component polish), cross-platform.
4. **Gemma 4 in Agentic**: Gemma 4 is agentic-capable (web-confirmed 2026-07-03) and leads the Agentic list as the recommended agentic default, ranked best-for-agentic-coding first, with the coding specialists (Qwen-Coder / DeepSeek-Coder) below.

**Cycle-wide constraint (inherited)**: GitHub Actions minutes are frozen ($0 budget) until 2026-08-01 (2026-07-02 CI incident). Every phase below is local-first-verifiable; CI legs land as dispatch-gated rehearsals after the reset (Phase 6).

---

## 0. Goals (product-strategy anchor)

- **Problem**: The v1.8.0 installer works but does not look or feel like the product it installs. Running `NexusSetup.exe` shows a generic old-style Windows (NSIS) dialog first and only then the modern PyQt wizard (two installers). The wizard has a native OS title bar, no branded background, a black-boxed logo, a stale `GemmaCode` default install path, a text-dense model selector missing the metadata users need to choose (country of origin, guardrails), an empty Audio tab, and an Agentic list that excludes the flagship Gemma 4. The Windows build emits two `.exe` files into a deep `dist/` folder that must be hand-copied out. The resulting desktop app does not yet share the branded shell (native title bar, no constellation, inconsistent naming). Net effect: the first-run experience reads as a developer utility, not a premium local-AI product.
- **Persona**: A non-technical (or impatient technical) end user who downloads one file, expects a single modern branded installer, picks models from a scannable catalog, and lands in a desktop app that looks like the same product -- on Windows, macOS, or Linux.
- **North-star visual reference**: [guides/interactive-guide/nexus-ai-guide.html](../../../../guides/interactive-guide/nexus-ai-guide.html) -- dark near-black theme, an animated cyan/blue constellation (network) background, a floating glowing Nexus logo, cyan-blue glow accents, and the model-card mockup in `Nexus_Installer_Change_Log.md`.
- **Definition of done (observable)**:
  1. Double-clicking the single downloaded installer opens exactly ONE modern, branded window (no generic pre-wizard dialog) with a dark custom title bar (transparent floating Nexus logo + "Nexus AI Studio"), an animated constellation background, and the guide's glow palette.
  2. The default install path is `NexusAI` (never `GemmaCode`) on every OS; no user-visible `GemmaCode` / `Gemma Code` string remains in the installer or app.
  3. The model selector renders compact, scannable cards showing Origin (country), Best-at, Agentic (yes/no), and Guardrails (Safety-tuned / Uncensored / N/A), with Compatible / Recommended / Required badges and prominent disk-size accents -- close to the change-log mockup.
  4. The Agentic tab lists agentic-capable models best-for-agentic-coding first, with **Gemma 4 on top** as the recommended agentic default where hardware fits.
  5. The Audio tab is populated with real, local, downloadable open-source audio models (speech + generation) carrying the same metadata.
  6. Exactly one installer artifact per OS is produced by one build command into one easy-to-find location.
  7. The launched Nexus AI Studio desktop app shares the same branded shell (custom dark title bar + transparent floating logo + "Nexus AI Studio", constellation background, rounded transparent icons) and a cohesively restyled UI, on Windows, macOS, and Linux.

## 1. Grounding (verified 2026-07-03, file-cited)

### 1.1 The two-installer root cause (Windows)
`NexusSetup.exe` is an **NSIS MUI2 outer shell** ([scripts/installer/build/nsis/nexus-setup.nsi](../../../../scripts/installer/build/nsis/nexus-setup.nsi)) whose only job is to extract `nexus-installer.exe` to `%LOCALAPPDATA%\Nexus\Setup` and launch it from the NSIS Finish page (`MUI_FINISHPAGE_RUN`, nexus-setup.nsi:75). The extracted `nexus-installer.exe` is the PyInstaller-frozen PyQt wizard -- the modern UI. So the user sees the NSIS wizard first, then the PyQt wizard. Both `.exe` files land in [scripts/installer/pyqt/dist/](../../../../scripts/installer/pyqt/dist/); [build-windows.ps1](../../../../scripts/installer/pyqt/build/build-windows.ps1) then convenience-copies `NexusSetup.exe` to a gitignored repo-root `dist/`. The PyInstaller spec ([nexus-installer.spec](../../../../scripts/installer/pyqt/build/nexus-installer.spec)) already builds onefile + windowed; only `APP_NAME` (line 23) and the NSIS stage need to change.

### 1.2 Installer shell + branding
- Window: plain `QMainWindow`, native title bar, title `"Nexus -- Setup"` ([window.py:45](../../../../scripts/installer/pyqt/src/nexus_installer/window.py#L45)). No frameless flags, no constellation.
- Header: `QLabel("Nexus")` + `assets/icon.png` ([header.py:44-62](../../../../scripts/installer/pyqt/src/nexus_installer/widgets/header.py#L44-L62)). Welcome lockup uses `desktop/src-tauri/icons/128x128.png` ([welcome.py:36-47](../../../../scripts/installer/pyqt/src/nexus_installer/pages/welcome.py#L36-L47)).
- exe/taskbar icon: `assets/icon.ico` then `assets/icon.png` ([main.py:277-289](../../../../scripts/installer/pyqt/src/nexus_installer/main.py#L277-L289)).
- Palette: [constants.py](../../../../scripts/installer/pyqt/src/nexus_installer/constants.py) is already a token port of [desktop/src/styles/tokens.css](../../../../desktop/src/styles/tokens.css) (bg `#0a0d14`, accent cyan `#22d3ee`, module accents). Missing: the guide's glow/gradient tokens, radial-glow background, and the constellation.

### 1.3 Asset transparency (pixel-verified)
- BLACK opaque background: `assets/icon.png`, `assets/icon.ico`, `assets/icon.svg`, `assets/nexus-ai-primary.png`, `assets/nexus-ai-banner.png`, and the entire `desktop/src-tauri/icons/` PNG/ICO/ICNS/Store-tile set EXCEPT `window-icon.png`.
- TRANSPARENT: `assets/nexus-ai-primary_no-background.png` (1024, true alpha), `assets/nexus-ai-primary_no-background.svg`, `desktop/src-tauri/icons/window-icon.png` (256, true alpha).
- Gap: there is NO transparent `.ico` and NO transparent sized PNG tiles. Fixing the taskbar/header/dock icons requires regenerating the icon set from the transparent source with alpha preserved. [scripts/desktop/generate-icons.py](../../../../scripts/desktop/generate-icons.py) already reads the transparent source (`SOURCE_PNG = assets/nexus-ai-primary_no-background.png`) but its current outputs are black -- it either was not re-run or composites onto an opaque fill; this must be fixed so the ICO/ICNS/PNG frames keep alpha (and gain rounded corners for the taskbar).

### 1.4 Model catalog
- Schema `ModelSpec` ([catalog.ts:69-100](../../../../core/registry/catalog.ts#L69-L100)) and the runtime `CatalogModel` ([typed_catalog.py:98-118](../../../../scripts/installer/pyqt/src/nexus_installer/pages/typed_catalog.py#L98-L118)): **no country/origin field**; guardrails is only a boolean `uncensored` with no positive label; there is a free-text `provenance` (required when `uncensored`). No `agentic` capability flag.
- Tabs: Chat / Agentic Coding / Image / Video / Audio ([typed_catalog.py:68-75](../../../../scripts/installer/pyqt/src/nexus_installer/pages/typed_catalog.py#L68-L75)). Assignment is by `task`. All Gemma 4 entries are `task:"chat"`, so they never appear under Agentic (only `qwen2.5-coder:7b/14b`, `deepseek-coder-v2:16b` do).
- Ordering within a tab ([typed_catalog.py:528-534](../../../../scripts/installer/pyqt/src/nexus_installer/pages/typed_catalog.py#L528-L534)): tier-default first, then newest `releaseDate`, then A-Z. No manual priority.
- Recommended = id is in the resolved tier default ([recommended.json](../../../../core/registry/recommended.json), resolved by [tier_defaults.py](../../../../scripts/installer/pyqt/src/nexus_installer/tier_defaults.py)). No "Required" badge concept (nomic-embed is the de-facto required model).
- Audio: 0 entries; every tier's `audio` list is `[]`. `audio` is a valid `ModelTask` but NOT a valid `ModelType`, so `catalog.ts` `validateSpec` (line 111) would reject `type:"audio"` -- a schema tweak is needed for a clean audio entry.
- Download: by `source.protocol` -- `ollama` (`ollama pull <id-tag>`) or `huggingface` (`repo` + `weights.files[]` manifest via [hf_weights_puller.py](../../../../scripts/installer/pyqt/src/nexus_installer/engine/hf_weights_puller.py)). Audio can use either path.
- Inventory: 10 chat (incl. embed) + 3 agentic + 11 image + 5 video + 0 audio = 29 user-facing entries.

### 1.5 Desktop app (Tauri v2 + React 19 + Vite, `desktop/`)
- Native title bar (`decorations: true`, [tauri.conf.json](../../../../desktop/src-tauri/tauri.conf.json)); title "Nexus - Local AI Studio"; productName "Nexus". No custom title-bar component; the brand mark lives in the Sidebar. No Tauri capabilities file yet (window-control JS needs a `core:window` capability).
- Same `tokens.css` palette as the installer. **No constellation background anywhere.** Tailwind v4 is a dep but not wired; styling is inline `CSSProperties`.
- Cross-platform via Tauri bundles (NSIS/DMG/AppImage+deb), built by [release.yml](../../../../.github/workflows/release.yml) `desktop-bundle`. The installer downloads and installs exactly these bundles.
- Clean of `GemmaCode`; naming is just inconsistent ("Nexus" / "Nexus - Local AI Studio").

### 1.6 v1.8.0 carryovers folded into this cycle
- `NAME.P1.A` (GemmaCode residuals): the **install-path default** (`_default_install_path` -> `GemmaCode`, [installer_state.py:13-18](../../../../scripts/installer/pyqt/src/nexus_installer/installer_state.py#L13-L18)) and the install-path callout "Gemma model" ([install_path.py:73](../../../../scripts/installer/pyqt/src/nexus_installer/pages/install_path.py#L73)) are user-visible and fixed here (Phase 3). The broader compat-shim retirement stays its own item.
- `OSI004.P4.D` (legacy `ModelSelectionPage` / `RecommendedModelsPage`, unwired): removed during Phase 4.
- `OSI005.P5.A` (dependency-step progress bars quantized) and `OSI005.P5.B` (Inter/JetBrains Mono not bundled): addressed opportunistically in Phase 3 (font bundling for typography parity; progress polish optional).
- `OSI002.P2.D` (unwired `VsCodeExtensionPage` / `StoragePage`): out of scope unless the flow rework in Phase 3 naturally absorbs it; recorded, not required.

## 1.7 Alignment / policy check
- Local-first, zero-outbound: unchanged. New audio models download from Hugging Face `resolve/main` or Ollama to the user's machine (same class as existing image/video weights); no new services or credentials. Uncensored audio entries (if any) carry license + provenance per the existing curation policy ([catalog.ts:117-120](../../../../core/registry/catalog.ts#L117-L120)).
- No-degradation: the installer/app remain fully functional at each phase; the constellation respects `prefers-reduced-motion` and is perf-bounded.
- MCP Registry Policy: not touched (no new MCP entries).

## 2. Phases at a glance

| # | Phase | Depends on | Rec. model / effort |
|---|---|---|---|
| 1 | Single-artifact installer build (drop NSIS) + one output location | -- | strong reasoning tier, high effort (assess at implementation time) |
| 2 | Shared brand foundation: transparent+rounded icon regen, glow tokens, reusable constellation + float-logo primitive | -- (parallel with 1) | mid-high tier, medium effort |
| 3 | Installer visual overhaul: frameless dark title bar, constellation bg, floating logo, "Nexus AI Studio" naming, NexusAI path | 2 | strong tier, high effort |
| 4 | Model selector redesign: origin + guardrails + agentic metadata, card restyle, Gemma-4-agentic ordering, audio pillar | 2 (card tokens) | strong tier, high effort |
| 5 | Desktop app full UI/UX overhaul (Win/mac/Linux) | 2 | strong tier, high effort |
| 6 | Cross-platform rehearsal + docs + close-out | 1-5; Actions reset for CI legs | strong tier, high effort (operator-assisted) |

## 3. Phase detail

### Phase 1 -- Single-artifact installer build (drop NSIS) + simplified output

Eliminate the two-installer experience and the two-artifact/deep-path build confusion. The PyInstaller onefile becomes the distributable directly.

- [x] T101: Rename the frozen wizard to the user-facing name in [nexus-installer.spec](../../../../scripts/installer/pyqt/build/nexus-installer.spec): `APP_NAME` -> `NexusSetup` (Windows) so PyInstaller emits `NexusSetup.exe` directly; align mac (`Nexus AI Studio Setup`) / linux (`nexus-setup`) names. Keep onefile + windowed + icon.
- [x] T102: Rewrite [build-windows.ps1](../../../../scripts/installer/pyqt/build/build-windows.ps1): delete the `[4/6]` NSIS stage and the two-artifact loop; produce the single `NexusSetup.exe`; write it to ONE clean, documented location (proposal: repo-root `dist/NexusSetup.exe`, gitignored, as the canonical local output -- no more deep `pyqt/dist` + hand-copy). Update `build-macos.sh` / `build-linux.sh` for the same single-artifact-to-one-location contract (DMG / AppImage are already single files; standardize the output dir + names).
- [x] T103: Retire the NSIS shell: move [nexus-setup.nsi](../../../../scripts/installer/legacy/nexus-setup.nsi) to `scripts/installer/legacy/` (or delete) and remove NSIS steps from [installer-build.yml](../../../../.github/workflows/installer-build.yml); fix the upload paths in `installer-build.yml` / `installer-macos.yml` / `installer-linux.yml` / [release.yml](../../../../.github/workflows/release.yml) to the single artifact's new location/name.
- [x] T104: Preserve the dropped-NSIS responsibilities that still matter: confirm the onefile runs by double-click with no console (windowed); document that the installer no longer self-registers an uninstaller (the product's uninstaller ships with the desktop-app bundle) and no longer needs a Start-menu "re-run setup" shortcut; keep the SmartScreen/Gatekeeper unsigned-binary note in [docs/install.md](../../../install.md).
- [x] T105: Update the packaging tests + [smoke-windows-exe.ps1](../../../../scripts/installer/pyqt/build/smoke-windows-exe.ps1): assert exactly one artifact, no NSIS invocation, the new output path; the frozen `--version` / `--check-registry` boot probes stay. Update [scripts/installer/build/windows-pipeline.md](../../../../scripts/installer/build/windows-pipeline.md) + [VERSIONS.md](../../../../scripts/installer/pyqt/VERSIONS.md) (VERSIONS.md had no NSIS / artifact-path content, so it needed no change).
- **DoD**: `python`/`pwsh` one build command produces exactly one `NexusSetup.*` per OS in one easy location; double-clicking the Windows exe opens ONLY the PyQt wizard (no NSIS dialog); the installer test suite is green. **DONE 2026-07-04**: `dist/NexusSetup.exe` (65.3 MB) built end-to-end on the dev box via the rewritten single-onefile pipeline; `smoke-windows-exe.ps1` all-green against the frozen exe (single artifact, no leftover `nexus-installer.exe`, `--version` + `--check-registry` exit 0); installer suite **591 passed / 2 skipped / 0 failed**. macOS DMG + Linux AppImage single-artifact builds are proven-by-construction here and re-run in the Phase 6 rehearsal (`IAE.P1.B`).

### Phase 2 -- Shared brand foundation (icons + tokens + constellation primitive)

Build the visual assets and reusable primitives both the installer (Phase 3) and the app (Phase 5) consume, so the two read as one product.

- [x] T201: Fix + re-run [generate-icons.py](../../../../scripts/desktop/generate-icons.py) so every emitted frame preserves alpha from `assets/nexus-ai-primary_no-background.png` (no opaque composite): regenerate `assets/icon.png`, a **transparent** `assets/icon.ico` (multi-size, alpha-preserving), `assets/icon.svg`, and the full `desktop/src-tauri/icons/` set (PNG sizes, `.ico`, `.icns`, Store tiles). Add a **rounded-corner** variant for the OS taskbar/dock icon (superellipse mask) per the operator note.
- [x] T202: Extend the shared design tokens with the guide's glow layer: add cyan/blue glow + signature-gradient + radial-background tokens to installer [constants.py](../../../../scripts/installer/pyqt/src/nexus_installer/constants.py) and desktop [tokens.css](../../../../desktop/src/styles/tokens.css) (keep the existing values; add, do not churn). Record the palette + typography in a short `docs/versions/v1/v1.9.0/design-tokens.md`.
- [x] T203: Author a reusable **constellation** spec + two implementations from the guide's canvas routine (~40 nodes scaled to width, `#38bdf8` links <=150px at alpha `(1-d/maxd)*0.45`, `#7dd3fc` nodes r=1.5, `prefers-reduced-motion` -> single static frame): a PyQt `ConstellationBackground(QWidget)` (QTimer ~60fps + QPainter, perf-capped, pauses when hidden) and a React `<ConstellationBackground/>` canvas component. Author a reusable **floating-glow logo** primitive: PyQt (`QGraphicsDropShadowEffect` blur~24 `rgba(56,189,248,.5)` + `QPropertyAnimation` y +/-9px, 7s InOutSine, reduced-motion aware) and React (CSS `drop-shadow` + `@keyframes float`), both fed the transparent logo.
- [x] T204: Tests: icon alpha/rounding assertions (Pillow corner-alpha + non-opaque background checks); constellation widget/component unit tests (node count bounds, reduced-motion static path, hidden-pause); token presence tests.
- **DoD**: Running the icon generator yields transparent, rounded brand icons; the constellation + float-logo primitives render in an isolated harness in both stacks and honor reduced-motion; tokens exist in both palettes. **DONE 2026-07-04**: the generator now preserves source alpha and applies a superellipse (squircle) mask, so all regenerated frames (`assets/icon.{png,ico}`, the full `desktop/src-tauri/icons/` set) are transparent with rounded corners (corner-alpha 0, opaque-ratio ~0.19 vs. the previous 1.00 black boxes) -- verified by the new `test_icon_generation.py` assertions. Glow / signature-gradient / radial-glow tokens added to both `tokens.css` and `constants.py` (additive, base palette untouched) + [design-tokens.md](../design-tokens.md). Constellation + floating-glow primitives shipped in both stacks (PyQt `constellation.py` / `float_logo.py`; React `constellation.ts` / `ConstellationBackground.tsx` / `FloatingLogo.tsx` + `@keyframes nexus-float`), reduced-motion aware, hidden-pause wired. Gates: installer **632 passed / 2 skipped / 0 failed** (+41), new widgets 97% lines; desktop **496 passed / 0 failed** (+34), new files 100% lines (suite 93.75% / 85.31% / 82.96% >= gate), `tsc --noEmit` + eslint clean; ruff clean. New gaps `IAE.P2.A` (PyQt reduced-motion env-var signal) + `IAE.P2.B` (on-device icon rendering visual check -> Phase 6). Primitives are built + unit-tested but not yet mounted (consumption is Phase 3 T302/T303 + Phase 5 T501/T502, by design). [phase history](../development/history/2026-07_phase-2-shared-brand-foundation.md).

### Phase 3 -- Installer visual overhaul + naming + NexusAI path

Restyle the PyQt wizard to the guide's look and finish the rebrand.

- [ ] T301: Frameless dark title bar: switch the window to `FramelessWindowHint`, add a custom dark title-bar widget (transparent floating Nexus logo + "Nexus AI Studio" + min/close controls + drag-move + double-click-maximize + resize grips), and set the OS window/taskbar title to "Nexus AI Studio". Handles high-DPI and multi-monitor.
- [ ] T302: Constellation background: mount the Phase 2 `ConstellationBackground` behind the wizard's content band with the guide's radial-glow + dark-gradient body treatment; ensure text/cards stay readable (opacity ~0.55, content z-above).
- [ ] T303: Header + welcome logo: repoint [header.py](../../../../scripts/installer/pyqt/src/nexus_installer/widgets/header.py) and [welcome.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/welcome.py) to the transparent logo with the Phase 2 float-glow primitive (fixes the black-box logo). Restyle the step indicator with glowing completed steps + highlighted current step.
- [ ] T304: Finish the rebrand to "Nexus AI Studio": `QApplication` name + argparse description ([main.py](../../../../scripts/installer/pyqt/src/nexus_installer/main.py)), window title ([window.py](../../../../scripts/installer/pyqt/src/nexus_installer/window.py)), header/welcome titles; grep the installer tree for residual "Nexus -- Setup" / "Nexus Installer" / "Gemma".
- [ ] T305: Fix the install path: `_default_install_path()` -> `C:\Program Files\NexusAI` / `/Applications/NexusAI` / `/usr/local/share/nexus-ai` ([installer_state.py](../../../../scripts/installer/pyqt/src/nexus_installer/installer_state.py)); update the "Gemma model" callout copy to "Nexus models" ([install_path.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/install_path.py)).
- [ ] T306: (Optional parity riders) bundle Inter + JetBrains Mono TTFs via PyInstaller + `QFontDatabase.addApplicationFont` (`OSI005.P5.B`); update the exe icon references to the transparent+rounded set.
- [ ] T307: Tests: frameless window construction + drag/resize handlers, title-bar controls, naming assertions, install-path default per-OS, background mount + reduced-motion; update the existing `test_pages_qt.py` / window suites; refresh the before/after capture archive.
- **DoD**: A dry-run wizard shows a single frameless dark-titled "Nexus AI Studio" window with a floating transparent logo, moving constellation, glow palette, a `NexusAI` default path, and zero `GemmaCode` strings; suite green.

### Phase 4 -- Model selector redesign + metadata + Gemma-4-agentic + audio pillar

Make the catalog scannable and complete, per `Nexus_Installer_Change_Log.md` and the mockup.

- [ ] T401: Schema: add `origin` (country) and an explicit guardrails surface (derive a display label -- "Uncensored" / "Safety-tuned" / "N/A" -- from `uncensored` + a new optional `guardrails` field for nuance) and an `agentic` capability boolean to `ModelSpec` ([catalog.ts](../../../../core/registry/catalog.ts)) + `CatalogModel` ([typed_catalog.py](../../../../scripts/installer/pyqt/src/nexus_installer/pages/typed_catalog.py)); allow audio cleanly (add `"audio"` to `ModelType` or map task->type in `validateSpec`). Keep `uncensored`-requires-`provenance`.
- [ ] T402: Populate `origin` + guardrails + `agentic` for all 29 existing entries (verified per entry, e.g. Gemma USA/Google, Qwen + Qwen-Coder China/Alibaba, DeepSeek China, Llama USA/Meta, Mistral France, SDXL/SD/SVD Stability UK, FLUX Germany, SANA USA/NVIDIA, LTX-Video Israel/Lightricks, Wan China/Alibaba, Nomic USA). Record sources in the phase history.
- [ ] T403: Card redesign to the mockup: compact chip/row layout -- title + release, Compatible/Recommended/**Required** badge, prominent right-aligned disk-size accent, and a metadata row of chips (Origin, Best-at, Agentic yes/no, Guardrails, context, license). Larger cyan selection boxes; add the "Required" state for `nomic-embed-text`; keep it uncluttered (no per-model logo tiles). Add the footer: **Refresh Models** + reassurance note + strong **Continue** button.
- [ ] T404: Rename the tab "Agentic Coding" -> "Agentic"; make the Agentic tab include agentic-capable models (so Gemma 4 appears), and order/rank the Agentic list best-for-agentic-coding first with **Gemma 4 as the recommended agentic default** where VRAM fits (web-confirmed 2026-07-03), coders below. Update [recommended.json](../../../../core/registry/recommended.json) tier matrix so the agentic default per tier is the top agentic-coding Gemma 4 variant that fits (fall back to a coder only when no Gemma 4 fits). Adjust the ordering key + `tier_defaults` so an `agentic`-capable chat model can be the agentic pick.
- [ ] T405: Audio pillar curation (full: speech + generation): add real local open-source audio entries with license + provenance + origin + guardrails + `weights`/ollama source (candidates to verify at implementation: Whisper / faster-whisper STT; Kokoro / Piper TTS; MusicGen / Stable Audio Open generation), wire per-tier `audio` defaults in `recommended.json` (GPU-gated like image/video where a model needs it), and confirm the HF/ollama puller handles them. Verify licenses; exclude any without a clear license from defaults.
- [ ] T406: Remove the unwired legacy `ModelSelectionPage` + `RecommendedModelsPage` + their tests and the review page's legacy `_MODEL_SIZES` fallback (`OSI004.P4.D`).
- [ ] T407: Tests: schema (origin/guardrails/agentic/audio validation), card rendering (chips/badges/Required), Agentic ordering with Gemma 4 on top, tier-default matrix incl. audio, catalog.ts Vitest.
- **DoD**: The catalog page matches the mockup (scannable chips, Origin + Guardrails visible, disk accent, Required badge), the Agentic tab lists Gemma 4 first as the default, and the Audio tab lists real downloadable local audio models; suites green.

### Phase 5 -- Desktop app (Nexus AI Studio) full UI/UX overhaul

Bring the app to visual parity with the installer and do the broader UX pass (operator choice), cross-platform.

- [ ] T501: Frameless dark title bar in Tauri: set `decorations: false`, add a React title-bar component (`data-tauri-drag-region`, min/max/close via `@tauri-apps/api/window`, transparent floating logo + "Nexus AI Studio"); add the `src-tauri/capabilities/` entry with `core:window` permissions (none exists yet). Keep the runtime dark-theme + `window-icon.png` behavior in [lib.rs](../../../../desktop/src-tauri/src/lib.rs).
- [ ] T502: Constellation background: mount the Phase 2 React `<ConstellationBackground/>` behind the app shell with the radial-glow body treatment; reduced-motion aware; ensure it does not regress interaction/perf of the four pillars.
- [ ] T503: Naming to "Nexus AI Studio": `productName` + window title ([tauri.conf.json](../../../../desktop/src-tauri/tauri.conf.json)), [index.html](../../../../desktop/index.html) `<title>`, Sidebar/Dashboard brand strings; keep identifier `ai.nexus.shell`. Point the app UI to the transparent logo (`nexus-mark` refresh from the Phase 2 assets).
- [ ] T504: Broader UI/UX pass (the "full overhaul" decision): apply the glow tokens, gradients, typography, spacing, and rounded-panel treatment across the Dashboard, the four pillar pages (Chat / Coding / Images / Videos), navigation/Sidebar, and shared components; wire Tailwind v4 (currently a dep but unwired) or standardize the inline-token approach. Scope-gate to a cohesive restyle, not a feature rewrite.
- [ ] T505: Tests: title-bar component + window-control wiring, constellation component, naming assertions, Dashboard/pillar render snapshots; desktop Vitest green; `cargo check`/clippy clean.
- **DoD**: The desktop app opens with the same custom dark title bar + transparent floating logo + "Nexus AI Studio", a constellation background, rounded transparent icons, and a cohesively restyled UI that reads as one family with the installer; desktop suite + Rust checks green (per-OS build proven locally where hardware allows, else recorded for Phase 6).

### Phase 6 -- Cross-platform rehearsal + docs + close-out

- [ ] T601: Local single-artifact builds on each available OS; where hardware is absent, record a rehearsal gap (mirrors v1.8.0 `OSI006.P6.A/C`). Windows clean-VM double-click-to-finish rehearsal of the new one-window flow.
- [ ] T602: Post-Aug-1 CI legs (dispatch-gated): the rewritten installer workflows + release upload paths + desktop-bundle build with the new title bar/icons; verify one artifact per OS attaches with `SHA256SUMS.txt`.
- [ ] T603: Docs + close-out: update [docs/install.md](../../../install.md) (single-installer flow, no NSIS, screenshots), README/DEVLOG/CHANGELOG, [docs/todos.md](../../../todos.md), and the v1.9.0 known-gaps; archive before/after captures for installer + app.
- **DoD (whole-plan acceptance)**: Section 0 observables hold -- one branded single installer per OS producing a branded app on Windows/macOS/Linux -- verified locally now and via the post-freeze CI/pre-release rehearsal.

## 4. Out of scope (recorded, not forgotten)
- Code signing / notarization purchase decisions (unsigned SmartScreen/Gatekeeper warnings documented, as in v1.8.0).
- The broader `gemma-code` compat-shim retirement (`NAME.P1.A` non-user-visible classes) beyond the install-path + naming fixed here.
- Desktop auto-update (Tauri updater) and the sidecar-packaging carryover (`OSI001.P1.B`).
- Wiring the still-unwired `VsCodeExtensionPage` / `StoragePage` (`OSI002.P2.D`) unless Phase 3 absorbs it.
- Light theme (product ships dark-only).

## 5. Risks

| Risk | Mitigation |
|---|---|
| Frameless PyQt title bar loses native move/resize/snap on some OSes | Implement drag-move + edge resize grips + double-click maximize explicitly; test per-OS in Phase 6; keep a fallback flag to native decorations |
| Constellation animation costs CPU/GPU on low-end machines | Perf-cap node count, pause when window hidden/minimized, honor `prefers-reduced-motion`, cap DPR at 2 (as the guide does) |
| Dropping NSIS loses the per-user extract + self-uninstaller | The onefile runs directly; the product uninstaller ships with the desktop bundle; document the change (T104) |
| ICO/tile regeneration drops alpha again | T204 asserts corner-alpha + non-opaque background on every generated frame |
| Audio model licensing ambiguity | T405 records license + provenance per entry; entries without a clear license are excluded from defaults (same rule as image/video) |
| Making Gemma 4 agentic-capable mis-ranks the Agentic default at some tiers | T404 fit-gates per tier and falls back to a coder specialist when no Gemma 4 variant fits VRAM; T407 asserts the per-tier default |
| Full app overhaul scope creep | T504 is scoped to a cohesive restyle over existing pages, not a feature rewrite; cut-line explicit |
| Actions freeze blocks CI proof until Aug 1 | Every phase has a local DoD; CI is a Phase 6 rehearsal, not a dependency |

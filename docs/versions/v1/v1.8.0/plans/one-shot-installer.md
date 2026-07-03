# v1.8.0 Plan -- One-Shot End-User Installer (download one file, get everything running)

**Date**: 2026-07-03
**Scope**: feature (major enhancement on the existing PyQt/NSIS installer + release pipeline)
**Status**: IN PROGRESS -- Phases 1-2 closed 2026-07-02 (local legs; CI rehearsal deferred to Phase 6 / post-freeze per design). See [../known-gaps.md](../known-gaps.md), [../development/history/2026-07_phase-1-release-pipeline-desktop-bundles.md](../development/history/2026-07_phase-1-release-pipeline-desktop-bundles.md), and [../development/history/2026-07_phase-2-desktop-provisioner.md](../development/history/2026-07_phase-2-desktop-provisioner.md).
**Decisions (operator, 2026-07-03)**: all three platforms in this cycle (Windows first among equals); the Nexus desktop app is **fetched from the GitHub release at install time** (SHA-256-verified), not bundled inside the installer executable.
**Predecessor known-gaps ingest**: [../../v1.7.0/known-gaps.md](../../v1.7.0/known-gaps.md) reviewed -- no installer-blocking carryovers. Cycle-wide constraint inherited from the 2026-07-02 CI incident: **GitHub Actions minutes are frozen ($0 budget) until 2026-08-01**, and `nightly` / `shell-build` / `installer-smoke` / `golden-tasks` are disabled. Every phase below is local-first-verifiable; CI legs land as dispatch-gated rehearsals after the reset.

---

## 0. Goals (product-strategy anchor)

- **Problem**: Getting Nexus running end-to-end currently requires a developer (clone, npm, Rust, Python, Ollama, model pulls, GPU runtime). A non-developer cannot use the product. The existing installer stops short of the desktop app, has placeholder image/video model tabs with no download path, and doesn't look like the product it installs.
- **Persona**: A non-technical (or impatient technical) end user on a gaming-class PC or Mac who downloads **one file**, answers a few friendly questions, and finishes with a working Nexus desktop app + (optionally) the VS Code extension + local models matched to their hardware -- never touching a terminal.
- **Definition of done (observable)**: On a clean machine with none of the dependencies present, running the platform installer completes with:
  1. all dependencies provisioned (GPU runtime CUDA/ROCm/Metal/CPU-only, Node, Ollama, ffmpeg, diffusion venv);
  2. the VS Code extension installed when opted in (default checked);
  3. all selected models downloaded with live progress -- including image/video weights (new capability);
  4. **Nexus desktop installed, launchable from the OS (Start menu / Applications / .desktop), and passing a first-run health check**;
  5. every step visualized in a wizard styled with the desktop app's design tokens, with per-phase progress (deps -> extension -> models -> desktop).
  Rehearsed end-to-end on Windows, macOS, and Linux.

## 1. Grounding (verified 2026-07-03, file-cited by the research sweep)

**What already exists (build on, don't rebuild):**
- Wizard: welcome -> prerequisites -> GPU detection -> install path -> storage -> configuration -> typed model catalog -> VS Code extension -> review -> installing -> complete (`scripts/installer/pyqt/src/nexus_installer/pages/`).
- Engine provisioners: CUDA / CUDA-Linux / ROCm / Metal / CPU-only, Node, Ollama (win+mac+linux, SHA-256 + Authenticode verified), ffmpeg, diffusion venv (offline wheels), DevAI-Hub baseline, storage migration (`engine/`).
- Install orchestration: 4 ordered steps (Ollama -> VSIX -> diffusion venv -> `ollama pull`) with 0.0-1.0 progress signals + per-step logs (`engine/installer.py:26-76`).
- Typed model catalog UI: Text/Image/Video/Audio tabs fed by `core/registry/catalog.json` + `recommended.json`, with VRAM/RAM/disk fit, context window, censored flag, license, disk-aware footer (`pages/typed_catalog.py`).
- Packaging: mac (PyInstaller .app + DMG, notarization-optional) and linux (PyInstaller + AppImage) workflows are functional; `release.yml` attaches VSIX + `GemmaCodeSetup.{exe,dmg,AppImage}`.
- Build-time payload pinning: `scripts/installer/build/versions.lock.json` (SHA-256 per asset) + `fetch-payload.py` verification.

**The five gaps this plan closes:**
- **G1 (critical)**: No desktop-app installation step exists anywhere in the installer; no CI builds a distributable Tauri bundle (`shell-build.yml` only `cargo check`s; `tauri.conf.json` has `bundle.targets: "all"` configured but unused; productName "Nexus", conf version stale at 1.5.0).
- **G2 (critical, surfaced by the sweep)**: Image/video models are catalog placeholders -- `model_puller.py` only does `ollama pull`; HF-protocol entries (SANA, SDXL, FLUX, LTX-Video, SVD) have **no download path**. The user can "select" them today and nothing happens.
- **G3**: Catalog UX vs the vision: no chat-vs-agentic split (single Text tab), thin per-model copy (no "what it's good at / why recommended / differentiators"), and **no uncensored image/video entries** (all current entries `uncensored: false`) although the product decision is uncensored image+video defaults.
- **G4**: Installer visual style is single-accent teal `#0ABFBF` on `#0f1318`; the desktop app uses darker `#0a0d14` bg + per-module accents (`--accent-chatbot #22d3ee`, `--accent-coding #ec4899`, `--accent-image #f97316`, `--accent-video #22c55e`) (`desktop/src/styles/tokens.css`). No per-phase progress grouping.
- **G5**: Windows `installer-build.yml` is a TODO skeleton (PyInstaller + NSIS steps unimplemented); artifact names still say `GemmaCodeSetup`; no end-to-end .exe rehearsal has ever run.

**Constraints:**
- Actions freeze until 2026-08-01: all verification local-first; CI workflows dispatch-only rehearsals after reset. `tauri build` and PyInstaller/NSIS run locally during the cycle.
- Local-first / zero-outbound policy: model weights download from Hugging Face `resolve/main` URLs to the user's own machine (same class as the existing Ollama/ffmpeg fetches; SHA-256-pinned). No new services, no credentials. Uncensored model entries must carry explicit license fields; curation records provenance per entry.
- Branch model: feature branches -> `develop` -> `main`. Desktop-bundle release assets require a tagged release; use a pre-release tag for rehearsal.

## 2. Phases at a glance

| # | Phase | Depends on | Rec. model / effort |
|---|---|---|---|
| 1 | Release pipeline ships desktop bundles + artifact rename | -- | strong reasoning tier, high effort (assess at implementation time) |
| 2 | Desktop provisioner + wizard step + first-run health check | 1 (asset shape), local bundle for tests | strong reasoning tier, high effort |
| 3 | Hugging Face weights downloader (image/video become real) | -- (parallel with 2) | strong reasoning tier, high effort |
| 4 | Catalog curation: chat/agentic split, rich copy, uncensored image/video defaults | 3 | strong tier for schema/UI, mid tier acceptable for copywriting |
| 5 | Desktop-token restyle + per-phase progress UX | 2, 3 (steps exist to group) | mid-high tier, medium effort |
| 6 | Windows NSIS completion + 3-platform end-to-end rehearsal + release | 1-5; Actions reset for CI legs | strong tier, high effort (operator-assisted) |

## 3. Phase detail

### Phase 1 -- Release pipeline produces desktop bundles (the fetch-from-release prerequisite)

The installer cannot fetch what no release publishes. Make the release pipeline emit versioned, checksummed Nexus desktop bundles for all three platforms, and fix stale naming.

- [x] T101: Add a `desktop-bundle` job set to `release.yml` (3-OS matrix, tag-triggered only): `npm ci` -> `npm run build:sidecar` -> `tauri build` -> attach `Nexus-Desktop_{version}_x64-setup.exe` (NSIS), `Nexus-Desktop_{version}_universal.dmg`, `Nexus-Desktop_{version}_amd64.AppImage` (+ `.deb`). Sync `tauri.conf.json` version from package.json at build time (it is stale at 1.5.0). *(Done 2026-07-02: `scripts/sync-tauri-version.mjs` + 7 tests; CI execution deferred to the T603 post-freeze rehearsal.)*
- [x] T102: Emit a single `SHA256SUMS.txt` release asset covering every attached artifact (desktop bundles + installers + VSIX); this is the installer's verification source. *(Done 2026-07-02: explicit fail-loud asset list in `create-release`.)*
- [x] T103: Rename installer artifacts `GemmaCodeSetup.*` -> `NexusSetup.*` across `release.yml`, `installer-macos.yml`, `installer-linux.yml`, `installer-build.yml`, and any docs referencing the old names (grep-audited). *(Done 2026-07-02: only `release.yml` carried old names -- its upload paths were dead-broken vs the scripts' actual `NexusSetup.*` output; also fixed the wizard app name + vsix asset name + release title. Residual repo-wide `gemma-code` classes recorded as known-gaps `NAME.P1.A`.)*
- [x] T104: Local proof under the freeze: run `tauri build` on the dev Windows box; record bundle name/size/SmartScreen behavior in the phase notes; stash the produced NSIS bundle as the Phase 2 test fixture. *(Done 2026-07-02: rustup stable-msvc installed; `Nexus_2.1.0_x64-setup.exe` 1.6 MB + MSI 2.1 MB in 2m27s; silent install/uninstall round-trip clean; fixture at `.local-fixtures/`; sidecar-not-bundled finding -> known-gaps `OSI001.P1.B`.)*
- **DoD**: A dry-run tag on a scratch branch (post-Aug-1) attaches all bundles + SHA256SUMS; locally, `tauri build` produces an installable NSIS bundle. No signing this cycle (record as known gap; unsigned SmartScreen warning documented on the download page).

### Phase 2 -- Desktop provisioner: the installer installs Nexus

- [x] T201: New `engine/desktop_provisioner.py`: resolve the matching release asset for the running OS/arch from the pinned release tag (URL template `https://github.com/bendourthe/Nexus-AI/releases/download/{tag}/{asset}`), download with resume, verify against `SHA256SUMS.txt` (fail closed), then install per-OS: Windows NSIS silent (`/S /D=<path>`), macOS mount DMG + copy `Nexus.app` to `/Applications`, Linux install AppImage to `~/.local/bin` + write `.desktop` entry + icon. Follow the `ollama_installer.py` download/verify/install structure and its test shape. *(Done 2026-07-02: pinned tag `v2.1.0`; resumable `.partial` download; verify-before-dispatch fail-closed; Windows exe resolution handles the bundle's actual `nexus-shell.exe`; `--desktop-bundle` local override for the freeze-era path.)*
- [x] T202: Append step 5 "Nexus Desktop" to `engine/installer.py`'s ordered steps with progress + log wiring; add a components choice (desktop default-checked, like the extension page) and thread it through `InstallerState` + the review page. *(Done 2026-07-02: own progress band + cancel wiring, fixed the model step's final-step progress assumption; default-checked ConfigurationPage toggle (the wired components surface -- `OSI002.P2.D`); headless step + `--skip-desktop` in the 3 smoke scripts.)*
- [x] T203: First-run health check: after install, launch the app once headless-ish (`--version` / sidecar ping with a timeout) and surface pass/fail on the complete page; add a "Launch Nexus" checkbox (default checked) to `pages/complete.py`. *(Done 2026-07-02: launch-probe tier -- exit-0 or alive-past-grace; the sidecar-ping tier is `OSI002.P2.B`, blocked on the `OSI001.P1.B` sidecar packaging; complete-page services row + Finish-hook launch.)*
- [x] T204: Tests mirroring the existing provisioner suites (`test_desktop_provisioner.py`): download/verify/fail-closed on bad hash, per-OS install dispatch (mocked subprocess), state threading, step ordering. Use the T104 local bundle as an integration fixture on Windows. *(Done 2026-07-02: 39 new tests + engine/state/pages suite updates; env-gated `NEXUS_DESKTOP_FIXTURE_TEST=1` integration run green -- real install, health check passed, clean uninstall.)*
- **DoD**: On the dev box, the wizard installs the locally-built desktop bundle end-to-end, the app appears in the Start menu, launches, and the health check passes; unit suite green. *(Met 2026-07-02 via the engine path + fixture: silent install -> `Nexus.lnk` present -> app launches -> health check passes -> clean uninstall; installer suite 433/1/0.)*

### Phase 3 -- Hugging Face weights downloader (closes G2; image/video selection becomes real)

- [ ] T301: Add per-model weight manifests: extend `core/registry/catalog.json` entries (`source.protocol: "huggingface"`) with an explicit file list + SHA-256 per file (versions.lock.json discipline), destination layout matching what `runtimes/diffusion` expects at load time (verify the runtime's model-path contract first and document it).
- [ ] T302: New `engine/hf_weights_puller.py`: download `https://huggingface.co/{repo}/resolve/main/{path}` with resume + retry + SHA-256 verify + per-file and per-model progress callbacks; no API key (public models only); disk-space pre-check via the existing disk-aware state.
- [ ] T303: Route by protocol in the model step (`provisioner_dispatch` / `model_puller`): `ollama` -> `ollama pull` (unchanged), `huggingface` -> weights puller; aggregate progress across mixed selections; per-model failure isolation (one failed model does not abort the rest; summarized on complete page).
- [ ] T304: Tests: manifest parsing, resume-from-partial, hash-mismatch fail-closed, mixed ollama+hf progress aggregation, dispatch routing. Integration smoke: download the smallest real entry (`sana-1.6b-int4`, 1.4 GB) on the GPU box and load it via the diffusion runtime.
- **DoD**: Selecting an image and a video model in the wizard results in verified weights on disk in the runtime's expected layout, and the desktop Image pillar can load them (GPU box verification, per the operator's earlier commitment).

### Phase 4 -- Catalog curation + selection UX (closes G3)

- [ ] T401: Schema: add `task` (`chat` | `agentic` | `image` | `video` | `audio` | `embed`), `description`, `strengths[]`, `why_recommended`, `differentiators` to catalog entries; split the Text tab into **Chat** and **Agentic Coding** sections; render the new copy in the model cards (the table-with-sections presentation from the product vision).
- [ ] T402: Curate + author copy for the text side: chat defaults (gemma4 family by VRAM tier) and agentic defaults (qwen2.5-coder tiers), each with the "what it's good at / where it excels / why recommended" copy.
- [ ] T403: Curate uncensored image/video entries (the product decision): research current open-weight uncensored-capable image models (e.g. SDXL-lineage fine-tunes; FLUX-schnell-lineage) and video models (LTX-Video / Wan-lineage), record license + provenance per entry, set `uncensored: true` flags accurately, define per-VRAM-tier defaults with **uncensored image + video selected by default** where hardware fits; keep censored alternatives listed. Verify each default entry actually loads in the diffusion runtime (GPU box).
- [ ] T404: Hardware-tier default matrix test: for each simulated GPU tier (8/12/16/24 GB + CPU-only), assert the default selection fits VRAM/disk and always includes one chat + one agentic model, plus image/video when the tier allows.
- **DoD**: Fresh wizard run shows four sections (Chat, Agentic, Image, Video) with rich per-model copy, hardware-fit-gated defaults including uncensored image/video, and every default is a real, loadable, downloadable entry.

### Phase 5 -- Desktop-token restyle + per-phase progress UX (closes G4)

- [ ] T501: Port `desktop/src/styles/tokens.css` into `nexus_installer/constants.py` (bg `#0a0d14`/`#11151f`/`#181d2a`, fg `#f5f7fb`/`#d6dbe7`, per-module accents) as the single palette source; restyle all pages; section accents in the catalog (chat cyan `#22d3ee`, agentic magenta `#ec4899`, image orange `#f97316`, video green `#22c55e`).
- [ ] T502: Per-phase progress on `pages/installing.py`: group the step list into Dependencies -> VS Code extension -> Models -> Nexus Desktop, each with its own labeled progress bar + collapsible log, overall bar on top (the vision's "clear progress along the way").
- [ ] T503: Welcome/complete page polish to product quality (Nexus wordmark/icon assets from `desktop/`, consistent typography); before/after screenshots archived in the phase history doc.
- **DoD**: Side-by-side screenshot of installer vs desktop app reads as one product family; a full dry-run install shows the four phase groups progressing.

### Phase 6 -- Windows .exe completion + 3-platform rehearsal + release (closes G5)

- [ ] T601: Finish `installer-build.yml`'s TODO skeleton for real: fetch-payload -> PyInstaller wizard -> NSIS outer shell -> silent-install smoke; produce `NexusSetup.exe`; mirror any missing pieces in the mac/linux workflows (they are close to done).
- [ ] T602: Local Windows end-to-end rehearsal on a clean VM: full flow from double-click to launched desktop app + extension + models; log every rough edge as a fix-or-gap.
- [ ] T603: Post-Aug-1 CI legs: `workflow_dispatch` the three installer workflows + the release dry-run tag; re-enable `shell-build.yml` (now cost-gated by the redesign) and verify the conditional matrices; attach everything to a pre-release for download testing.
- [ ] T604: macOS + Linux rehearsals (clean VM / spare machine): DMG drag-install + AppImage run; record notarization/Gatekeeper + FUSE caveats in the download docs.
- [ ] T605: Docs + close-out: end-user download/install page (incl. unsigned-binary warnings), known-gaps (signing/notarization deferred, any curation follow-ups), DEVLOG, todos.
- **DoD (whole-plan acceptance)**: The Section 0 definition-of-done holds on all three platforms from the published pre-release artifacts.

## 4. Out of scope (recorded, not forgotten)

- Code signing / notarization purchase decisions (Windows cert, Apple Developer ID) -- documented as warnings this cycle; own decision later.
- Auto-update of the desktop app post-install (Tauri updater) -- next cycle.
- Audio model downloads (catalog tab exists; same HF puller will serve it, curation deferred).
- In-installer uninstaller UX beyond what NSIS/dmg/AppImage natively provide.

## 5. Risks

| Risk | Mitigation |
|---|---|
| `tauri build` bundling issues surface late (icons, sidecar path, WebView2 bootstrap) | T104 builds locally in Phase 1, before anything depends on it |
| Uncensored model curation hits licensing ambiguity | T403 records license + provenance per entry; entries without clear licenses are excluded from defaults |
| HF weight downloads are large (4-23 GB) and flaky on consumer connections | T302 resume + retry + per-file hashes; disk-aware pre-checks already exist |
| Actions freeze blocks CI proof until Aug 1 | Every phase has a local DoD; CI is a Phase 6 rehearsal, not a dependency |
| PyQt wizard restyle regresses existing pages | Existing `tests/test_pages_qt.py` suite + screenshot archive in T503 |

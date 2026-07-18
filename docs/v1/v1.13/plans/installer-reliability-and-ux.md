# Plan - Installer Reliability and UX Polish

**Project**: Nexus (Nexus AI Studio)
**Version**: v1.13.0
**Slug**: installer-reliability-and-ux
**Plan Type**: Feature / Enhancement
**Created**: 2026-07-17
**Goal**: A fresh one-file install lands a fully working Nexus AI Studio - every default model actually downloads AND loads, and the installer UI matches the banner brand and the installing-page mockup.

## Overview

A real end-to-end install (2026-07-17) revealed that a fresh install visibly half-fails: two of eight default models did not install. The recommended default chat model (`gemma-4-12b-it-gguf`) downloads to 100% then fails Ollama manifest registration with `Error: 400` (the known open Ollama bug #15447 for Unsloth Gemma 4 GGUFs), and an opt-in image model (`sana-1.6b-int4`) fails with HTTP 401 because its Hugging Face repo is gated and its int4 file layout is wrong. Underneath both is a class defect the v1.11 `D1` gated-model audit did not fully close, plus a download engine that cannot tell a permanent error (401/403/404) from a transient one, has no Hugging Face token path for gated assets, and skips integrity checks on placeholder SHA-256 pins. The single largest systemic risk is that the entire recommended chat/agentic default line is Google Gemma 4, which needs a new-enough Ollama both to pull and to load at runtime - and nothing verifies that before a user hits it.

Alongside the model failures, six installer UI/UX defects were reported: the sidebar wordmark reads "Nexus AI Studi" (the "o" is clipped) with "AI Studio" in plain gray instead of the banner's blue gradient; the Welcome disk-space check shows an amber warning even with ~484 GB free (it probes a not-yet-created install path and falls into its error branch reporting 0 GB, against a hardcoded flat 10 GB threshold); the Models page "Next" button jumps straight to Configuration instead of walking the category tabs; models are not sorted by VRAM and over-budget models stay selectable; the Installing page does not auto-expand the running section; and the per-model progress bars have inconsistent widths, with dated log and detail buttons that do not match the supplied mockup.

This cycle delivers, in dependency order: (1) model catalog correctness + Ollama pinning + download-engine hardening; (2) a local-runnable preflight harness that verifies every default model pulls AND loads (CI wiring deferred under the 2026-07-17 GitHub Actions budget freeze, matching the v1.11 `IO.P2.A` precedent); (3) the gradient "AI Studio" wordmark and truncation fix on both the PyQt installer and the React desktop app; (4) the Welcome disk-check fix with a dynamic requirement, tab-walking Next, and VRAM-ascending sort with over-budget models disabled; (5) the Installing-page redesign to match the mockup (uniform-width bars, iconed section tiles, circle/spinner status, auto-expand/collapse, and a modern pill button system including modernized log copy/download buttons); and (6) the mandatory architecture-refactor, known-gaps, and CI/CD close-out. Success is a clean-machine install where every default model is present and loadable, and the installer visually matches the banner and mockup.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No constitution file found at `docs/v1/v1.13/constitution.md` (nor a repo-level constitution) - skipping check. Recommend running `/constitution` to establish project principles. This is informational, not blocking.

Grounding note (Phase B.5): no `STRATEGY.md` and no `docs/solutions/` store exist, so knowledge-base grounding is best-effort. The plan is instead grounded in the prior-version known gaps it closes: v1.11 `D1` (gated-model catalog audit re-pointing dead/gated URLs) and `IO.P2.A` (first real clean-machine harness runs), and the v1.8 `OSI006.P6.A/B/C` clean-machine rehearsal deferrals. The MCP Registry Policy (local-first, no third-party data services) constrains all model sourcing: prefer public open mirrors and the user's own Ollama/Hugging Face access, never a hosted generation/scraping service.

## Phases at a Glance

| Phase | Title | Outcome | Rec. model / effort |
|-------|-------|---------|---------------------|
| 1 | Model catalog correctness, Ollama pinning, and download-engine hardening | The two failing models are fixed, gated/broken entries remediated, Ollama pinned to a Gemma-4-capable version, and the engine handles gated/permanent/integrity cases correctly | Strong reasoning tier (Opus 4.8), high effort - Python engine + catalog + error-handling correctness across several modules |
| 2 | Default-model preflight harness (pull + load verification) | A local-runnable preflight verifies every default model per tier pulls AND loads; CI wiring added but deferred under the Actions freeze | Strong reasoning tier (Opus 4.8), high effort - subprocess orchestration + tier matrix + fail-closed reporting |
| 3 | Brand wordmark: gradient "AI Studio" + truncation fix (installer + desktop app) | "Nexus AI Studio" renders fully with the blue gradient on "AI Studio" in the installer and the desktop app | Strong reasoning tier (Opus 4.8), medium effort - QPainter gradient + React CSS, contained surface |
| 4 | Welcome disk-check fix + Models-page tab-walk Next + VRAM sort/disable | Real free-space check against a dynamic requirement; Next walks the model tabs; models sort by VRAM ascending with over-budget disabled at the bottom | Strong reasoning tier (Opus 4.8), high effort - three interacting PyQt behaviors across welcome/typed_catalog/window |
| 5 | Installing-page mockup redesign | The installing page matches the mockup: uniform bars, iconed tiles, circle/spinner status, auto-expand/collapse, and a modern pill button + log-panel system | Strong reasoning tier (Opus 4.8), high effort - layout refactor + design-system fidelity across widgets |
| 6 | Architecture Refactor, Known-Gaps Reconciliation, and CI/CD | Clean layout, v1.11/v1.13 gaps reconciled, CI/CD covers all changes and is optimized | Strong reasoning tier (Opus 4.8), high effort - repo-wide refactor + reference repair is high-risk |

---

## Phase 1: Model catalog correctness, Ollama pinning, and download-engine hardening

**Goal**: Every default model has a correct, reachable reference; gated/broken entries are fixed or removed; the bundled Ollama is pinned to a Gemma-4-capable version; and the download engine correctly handles gated repos, permanent-vs-transient errors, and integrity pins.
**Prerequisites**: None.
**Stability Gate**: On a machine with a Gemma-4-capable Ollama, all default models for the detected tier pull and load; the catalog contains no gated/dead default references; the HF puller rejects a 401 immediately (no pointless retries) with a clear message and supports an optional token; SHA-256 is enforced wherever a real (non-placeholder) pin exists.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - correctness-critical Python across `catalog.json`, `model_puller.py`, `hf_weights_puller.py`, `model_router.py`, and the Ollama provisioner; re-confirm against the then-current model set at implementation time.

### Sub-tasks

#### 1.1 - Fix the Gemma 4 default chat model (route off the buggy hf.co GGUF path)

**Objective**: Make the recommended default chat model install reliably by routing off the Unsloth `hf.co` GGUF path that triggers Ollama bug #15447.

**Prompt**:
> In `core/registry/catalog.json`, the entry `gemma-4-12b-it-gguf` has `source.protocol: "ollama"` with `url: "ollama://hf.co/unsloth/gemma-4-12b-it-GGUF"` and `tag: "Q4_K_XL"`, which resolves to `hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL`. This downloads fully then fails Ollama manifest registration with `Error: 400` (open Ollama bug ollama/ollama#15447, specific to Unsloth Gemma 4 GGUFs). Re-point this default to the Ollama-registry Gemma 4 12B reference (verify the exact working tag against the installed Ollama - e.g. `gemma4:12b` - do not assume; the Phase 2 preflight will confirm it pulls AND loads). Keep `sizeGB`/`vramGB`/metadata consistent with the chosen tag. If the registry tag differs in quant/size, update those fields. Confirm `recommended.json` still points the 12 GB and 16 GB tiers at this id. Acceptance: `ollama pull <chosen-ref>` succeeds and `ollama run <chosen-ref>` loads and answers a one-word prompt on a Gemma-4-capable Ollama. Do not hardcode a tag you have not verified resolves.

---

#### 1.2 - Pin a Gemma-4-capable Ollama version

**Objective**: Guarantee the installed/bundled Ollama can both pull and load the Gemma 4 architecture (the entire default chat/agentic line depends on it).

**Prompt**:
> The whole recommended chat/agentic default line is Gemma 4 (`gemma4:e2b`, `gemma4:e4b`, `gemma4:31b`, and the 12B). Gemma 4 needs a new-enough Ollama to pull (bug #15447) and to load at runtime (ollama/ollama#15235 runtime 500 on old llama.cpp). In the Ollama provisioner / installer path (`engine/ollama_installer.py`, `engine/ollama_linux_provisioner.py`, `engine/ollama_macos_provisioner.py`, and the pinned version in `scripts/installer/VERSIONS.md`), set the minimum/pinned Ollama version to one that supports the `gemma4` architecture for both pull and runtime load. Add a runtime version gate: on install/first-run, if the detected Ollama is older than the required minimum, upgrade it (installer path) or surface a clear blocking message. Record the required version and the reason (Gemma 4 support) in `VERSIONS.md`. Acceptance: the provisioner refuses to proceed with, or upgrades, an Ollama too old for Gemma 4; the pinned version is documented with a checksum consistent with the existing supply-chain verification.

---

#### 1.3 - Remediate gated / broken / unpinned HF model entries

**Objective**: Remove or correct every catalog model that cannot install for an unauthenticated public client, and replace placeholder integrity pins on default models.

**Prompt**:
> Audit `core/registry/catalog.json` for Hugging Face entries that are gated or have a wrong file layout. Confirmed problems: (1) `sana-1.6b-int4` -> repo `Efficient-Large-Model/SANA1.5_1.6B_1024px_int4` returns HTTP 401 (gated) and its int4 weights are not in the `transformer/diffusion_pytorch_model.safetensors` layout (real int4 SANA is single-file SVDQuant at `mit-han-lab/nunchaku-sana` and needs the `nunchaku` runtime). Since it is an opt-in (not a tier default) and public alternatives (`sana-1.6b-1024`, `realvisxl-v5`, `juggernaut-xl-v9`) cover image, either DROP it or re-point it to the correct public nunchaku repo + single-file path + a REAL sha256 and declare the `nunchaku` runtime dep - default to dropping unless the nunchaku path is verified working. (2) Flag the other gated opt-ins with the same 401 risk class - `sd1.5` (`runwayml/stable-diffusion-v1-5`), `svd` (`stabilityai/stable-video-diffusion-img2vid-xt-1-1`), `stable-audio-open-1.0` - and either re-point to public mirrors, mark them clearly as gated/token-required in the catalog + UI, or remove them. (3) Replace all-zero placeholder `source.sha256` / `weights[].sha256` on DEFAULT models (`wan2.1-t2v-1.3b` and any others) with real digests, or explicitly document why a pin is deferred. Acceptance: no tier-default model references a gated/dead URL; every remaining HF default either has a real sha256 pin or a documented deferral; the catalog JSON still validates against `manifest.schema.json`.

---

#### 1.4 - Harden the download engine (gated, permanent-vs-transient, integrity)

**Objective**: Make the engine fail fast and clearly on permanent errors, support gated assets via a token, and enforce integrity on real pins.

**Prompt**:
> Harden the model download engine. In `engine/hf_weights_puller.py`: (a) classify HTTP errors - treat 401/403/404 as PERMANENT (do not consume the 3-retry budget; fail immediately with a specific message like "gated or not found - see docs" and, for 401/403, a hint that a Hugging Face token may be required); keep retry/backoff/resume only for transient (5xx, network, timeouts). (b) Add OPTIONAL Hugging Face token support: read a token from an env var (e.g. `HF_TOKEN`) or installer config and send `Authorization: Bearer` when present; never require it for public models and never log it. (c) Keep the existing sha256 behavior but ensure a REAL pin is always enforced (fail-closed, delete file on mismatch) and placeholders are logged as an integrity gap, not silently trusted. In `engine/model_puller.py` (Ollama path): surface the `Error: 400`-class manifest-registration failure with a user-facing explanation and a pointer to the pinned-version requirement rather than a bare code. In `engine/model_router.py`: ensure a permanent per-model failure is reported distinctly from a transient one in `state.failed_models` / `events.failed`. Acceptance: a gated repo fails on the first attempt with a clear gated message (not 3 identical retries); a token, when provided, unlocks a gated asset; a real-pin mismatch fails closed; unit tests cover permanent-vs-transient classification and the token header.

---

#### 1.5 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase. Iterate until the phase is stable before advancing to Phase 2.

**Prompt**:
> Generate comprehensive tests for Phase 1: installer pytest covering (a) catalog integrity - no default model references a gated/dead URL, every default HF entry has a real sha256 or a documented deferral, the JSON validates against `manifest.schema.json`; (b) HF puller error classification (401/403/404 permanent, no retry; 5xx transient, retried), the optional token header, and fail-closed sha256; (c) the Ollama version gate refuses/upgrades an under-version Ollama; (d) the Gemma 4 default resolves to the corrected reference. Mock network/subprocess boundaries; do not hit the network in unit tests. Run the installer suite (`scripts/installer/.venv/Scripts/python -m pytest scripts/installer/tests`) plus the root vitest suite for any TS catalog changes, fix failures, and iterate until green. Then create or update the CI/CD pipeline to cover the installer engine changes and optimize it (path filters so installer-only changes do not run the full matrix, concurrency cancel-in-progress, pip/venv caching), keeping coverage comprehensive; GitHub Actions is the primary example. Do not proceed to Phase 2 until stable. After all tests pass, run `/generate-session-history` to document Phase 1.

---

## Phase 2: Default-model preflight harness (pull + load verification)

**Goal**: A local-runnable preflight verifies that every default model, per hardware tier, actually pulls AND loads - catching failures like the Phase 1 ones before a user does.
**Prerequisites**: Phase 1.
**Stability Gate**: `preflight` run locally against a Gemma-4-capable Ollama reports PASS for every default model in at least the 12 GB and 16 GB tiers (pull + minimal load smoke), and reports a clear per-model FAIL for any gated/dead/unloadable entry; a fast reachability-only mode flags gated/dead refs across the whole catalog without downloading; the CI job exists but is gated/skipped under the Actions freeze with a documented deferral.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - subprocess orchestration, tier-matrix iteration, and fail-closed reporting; re-confirm at implementation time.

### Sub-tasks

#### 2.1 - Default-model preflight runner (pull + load)

**Objective**: Verify each default model pulls and then performs a minimal load/inference smoke.

**Prompt**:
> Add a preflight runner (e.g. `scripts/installer/src/nexus_installer/engine/model_preflight.py` plus a `nexus-installer preflight` entry point or a `smoke.py` extension). Given a hardware tier (or all tiers) from `recommended.json`, for each default model: pull it via the same routing the installer uses (`model_router`), then run a minimal LOAD smoke - for Ollama models, load + a one-token generation to prove the architecture loads at runtime (this is what catches the Gemma 4 #15235 runtime-500 class, which a pull-only check misses); for HF weight models, verify all manifest files exist and integrity-check real pins. Report a structured pass/fail per model with the failure reason and exit non-zero if any default fails. Make it idempotent (skip already-present+verified). Acceptance: running it after Phase 1 reports PASS for the 12 GB and 16 GB tier defaults on a Gemma-4-capable Ollama, and would have reported FAIL for the pre-fix `gemma-4-12b-it-gguf` and `sana-1.6b-int4`.

---

#### 2.2 - Whole-catalog reachability probe (no download)

**Objective**: A fast check that flags gated/dead references across the entire catalog before any full download.

**Prompt**:
> Add a fast, no-download reachability mode to the preflight: for every catalog model (not just defaults), probe its source without downloading - an authenticated-aware HEAD/GET check on HF `resolve` URLs (classify 401/403 gated, 404 dead, 200 ok) and an Ollama registry manifest existence check for `ollama://` refs. Emit a report grouping models by ok / gated / dead / unknown so catalog rot is caught during development. Keep it quick (HEAD where possible, small timeouts, bounded concurrency reusing the router pool). Acceptance: the probe flags the known gated opt-ins (`sd1.5`, `svd`, `stable-audio-open-1.0`, and `sana-1.6b-int4` if retained) and passes the public defaults; it runs in well under a minute for the full catalog.

---

#### 2.3 - Wire into local flow + deferred CI

**Objective**: Make the preflight runnable locally and add the CI job, deferred under the Actions freeze.

**Prompt**:
> Make the reachability probe runnable in the fast local/test flow (a pytest marker or a make/CLI target) so it runs on every installer change; keep the full pull+load preflight as an explicit, network-gated local command (not in the default unit run). Add a GitHub Actions job for the full preflight but gate it OFF under the current Actions budget freeze (frozen until ~2026-08-01) - use a `workflow_dispatch`/`schedule` trigger or an `if:` guard and a repo variable, and record the deferral in `docs/v1/v1.13/known-gaps.md` as the continuation of v1.11 `IO.P2.A`. Document how to run both modes in the installer README. Acceptance: `pytest` runs the reachability probe (mocked/offline-safe or clearly network-marked) without hitting the freeze; the full preflight CI job is present but does not consume action minutes until enabled; the deferral is recorded.

---

#### 2.4 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase. Iterate until stable before advancing to Phase 3.

**Prompt**:
> Generate tests for the preflight harness: unit tests for the pass/fail reporting and exit codes (mock the pull/load and HTTP boundaries - no real network in unit tests), the reachability classifier (401->gated, 404->dead, 200->ok), and the tier-matrix iteration. Run the installer pytest suite, fix failures, iterate until green. Update CI/CD to run the mocked preflight tests and register (but keep deferred) the live preflight job; optimize with path filters and caching. Do not proceed to Phase 3 until stable. After all tests pass, run `/generate-session-history` to document Phase 2.

---

## Phase 3: Brand wordmark - gradient "AI Studio" + truncation fix (installer + desktop app)

**Goal**: "Nexus AI Studio" renders in full (no clipping) with a blue gradient on "AI Studio" matching `assets/nexus-ai-banner.png`, in the installer sidebar and welcome hero AND in the desktop app.
**Prerequisites**: None (independent of Phases 1-2; sequenced here so model reliability lands first).
**Stability Gate**: The installer sidebar shows the complete "Nexus AI Studio" wordmark with white "Nexus" and a blue-gradient "AI Studio" (no truncated "o"); the Welcome hero heading uses the same treatment; the desktop app renders the identical gradient wordmark; the gradient stops match the banner within reason.
**Recommended model**: Strong reasoning tier (Opus 4.8), medium effort - a QPainter/QLinearGradient widget plus a React/CSS change; contained surface but cross-framework.

### Sub-tasks

#### 3.1 - Installer gradient wordmark + truncation fix

**Objective**: Paint "AI Studio" with the brand gradient and stop the sidebar from clipping the wordmark.

**Prompt**:
> In `scripts/installer/src/nexus_installer/widgets/header.py:63-74`, the wordmark is a single `QLabel` with two colored spans; "AI Studio" uses `WORDMARK_SECONDARY = "#6f8990"` (gray) and the 28px text overflows the fixed 244px sidebar (`SIDEBAR_WIDTH`) with no wrap/elide, clipping the final "o". Qt cannot gradient-fill glyphs via stylesheet, so implement a custom wordmark: keep "Nexus" in white (`WORDMARK_PRIMARY`) and paint "AI Studio" with a `QLinearGradient` built from `SIGNATURE_GRADIENT_STOPS` (constants.py:167-171, blue #3b82f6 -> #38bdf8 -> cyan #22d3ee) via `QPainter` + `setPen(QPen(QBrush(gradient)))` in a custom `paintEvent` (either one custom-painted widget for the whole wordmark, or a white "Nexus" QLabel + a gradient-painted "AI Studio" widget in an HBox). Fix truncation by auto-fitting the font size to the available width (or widening the sidebar / enabling wrap) so the full "Nexus AI Studio" always shows. Apply the same white+gradient treatment to the Welcome hero heading "Welcome to Nexus AI Studio" (`pages/welcome.py:140-144`), gradient only on "AI Studio". Acceptance: at the default window size the full wordmark and hero render with the gradient, verified visually; no clipping at the sidebar width.

---

#### 3.2 - Desktop app gradient wordmark

**Objective**: Render the same gradient "AI Studio" wordmark in the running desktop app.

**Prompt**:
> In the desktop app (`desktop/src/components/Sidebar.tsx` renders "Nexus AI Studio" via `className="nexus-gradient-text"`), make the wordmark render "Nexus" in white/foreground and "AI Studio" with the blue gradient matching `assets/nexus-ai-banner.png` (and the installer's `SIGNATURE_GRADIENT_STOPS`). Locate the `nexus-gradient-text` token / CSS (theme CSS or a design-tokens file) and align its gradient stops to the banner; split the wordmark so only "AI Studio" gets the gradient while "Nexus" stays solid, consistent with the installer. Apply the same treatment anywhere the app prints the product wordmark (e.g. a top bar or about screen) for consistency. Acceptance: the desktop sidebar wordmark visually matches the installer's gradient treatment; theme-aware (readable in the app's dark theme).

---

#### 3.3 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase. Iterate until stable before advancing to Phase 4.

**Prompt**:
> Add tests appropriate to the surface: for the installer, a widget test that the custom wordmark constructs and paints without error and that the full "Nexus AI Studio" string is present/rendered at the sidebar width (offscreen QPixmap render, assert no elision); for the desktop app, a testing-library assertion that the wordmark renders "Nexus" and "AI Studio" with the gradient class/segments. Run installer pytest + desktop vitest, fix failures, iterate until green. Update CI/CD to cover the changed files with path filters; keep it optimized. Do not proceed to Phase 4 until stable. After all tests pass, run `/generate-session-history` to document Phase 3.

---

## Phase 4: Welcome disk-check fix + Models-page tab-walk Next + VRAM sort/disable

**Goal**: The Welcome disk check reports real free space against a dynamic requirement; the Models "Next" walks the category tabs before advancing; and models sort by VRAM ascending with over-budget models disabled and pushed to the bottom.
**Prerequisites**: None (independent PyQt behaviors).
**Stability Gate**: With ample free space the disk dot is green and the reported figure matches reality; the requirement reflects base install size + selected-model total; on the Models page, Next advances Chat -> Agentic -> Image -> Video -> Audio (from whichever tab is active), reaching Configuration only from the last tab; each tab lists models sorted by required VRAM ascending with over-budget models rendered in a distinct disabled style at the bottom, non-selectable but still readable.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - three interacting behaviors across `welcome.py`, `typed_catalog.py`, and `window.py`.

### Sub-tasks

#### 4.1 - Fix the disk-space check + dynamic requirement (Issue C)

**Objective**: Report real free space and base the requirement on the actual install footprint.

**Prompt**:
> In `scripts/installer/src/nexus_installer/pages/welcome.py:66-71`, `_QuickCheckWorker` calls `shutil.disk_usage(self._install_path)` where `_install_path` defaults to `C:\Program Files\NexusAI`, which does not exist yet, raising `FileNotFoundError` (an `OSError` subclass) -> the `except` branch emits `disk_ok.emit(False, 0.0)` -> amber dot even with hundreds of GB free. Fix: probe an existing anchor - the drive root / nearest existing parent - reusing the pattern in `engine/host_detect.py:525` (`_disk_probe_path`). Then make the requirement dynamic: instead of the hardcoded flat `10.0` GB (welcome.py:69,179), compute required = base install size (a documented constant) + the selected-model total (`state.selected_models_gb`, populated by the picker via `TypedSelection.total_gb()`); on the Welcome page (before selection) show the base requirement, and reflect the dynamic figure where selection is known (the picker footer already does dynamic math in `widgets/disk_aware_footer.py`). Set the dot green/amber/red against the real requirement. Acceptance: with 484 GB free the dot is green and the figure is correct; selecting the full default model set raises the requirement above the flat 10 GB; the amber-with-ample-space bug is gone.

---

#### 4.2 - Models-page tab-walk Next (Issue D)

**Objective**: Make Next walk the model category tabs before proceeding to Configuration.

**Prompt**:
> On the Models page (`pages/typed_catalog.py`, tabs are a `QTabWidget` at :616 with `TYPE_TABS` chat/agentic/image/video/audio), the wizard Next (`window.py:_go_next`, ~:350-379) is purely linear and jumps straight to Configuration. Implement: add `try_advance_tab() -> bool` on `TypedCatalogPage` - if the current tab index < last, `setCurrentIndex(idx+1)` and return True (consumed); else return False. In `window.py:_go_next`, before `switch_page(current+1)`, if the current page is the Models page and `try_advance_tab()` returns True, return early (stay on Models, page/stepper unchanged). From any manually-selected tab, Next continues to the next tab to its right, reaching Configuration only when Next is pressed on the last tab. Preserve the existing per-category "decided" validation/gating. Since `_go_next` is also bound to the Return shortcut (`window.py:242`), this covers keyboard too. Acceptance: the example flow works - Chat -> (Next) -> Agentic -> (click Video) -> (Next) -> Audio -> (Next) -> Configuration.

---

#### 4.3 - VRAM-ascending sort + over-budget disable (Issue E)

**Objective**: Sort each tab by required VRAM ascending and disable models that exceed the detected GPU.

**Prompt**:
> In `pages/typed_catalog.py`, rewrite `_sorted_section_models` (:761-792) so every category tab sorts by required VRAM ASCENDING (largest at the bottom), with over-budget models forced last - e.g. key `(over_budget, required_vram_gb, display_name)`. Thread `host_vram_gb` (computed in `_build_tab` from `state.vram_mb`) into the sort. For models whose `required_vram_gb > host_vram_gb`: disable the card (`setEnabled(False)` on the checkbox / `_ModelCard`), render it in a distinct "disabled/over-budget" color (a new stylesheet branch at ~:411-414, e.g. a muted/dimmed accent) while keeping the name, description, and the existing "Requires N GB VRAM (you have M)" requirement text fully readable, and place it at the bottom. Keep the current disk-shortfall and required/embed disabling behavior intact; add VRAM-fit as an additional disable condition. Reuse the already-computed `fits` from `_card_status` (:347). Acceptance: on a 16 GB GPU, `Gemma 4 26B` (needs 18 GB) appears at the bottom, dimmed, non-selectable, with its requirement text visible; smaller models sort above it ascending by VRAM.

---

#### 4.4 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase. Iterate until stable before advancing to Phase 5.

**Prompt**:
> Generate tests: (a) the disk check - with a mocked `shutil.disk_usage` returning large free space against a non-existent install path, assert the anchor-probe path is used and the dot is green with the correct figure; assert the dynamic requirement = base + selected-model total; (b) tab-walk Next - assert `try_advance_tab` advances through all five tabs then returns False, and that `_go_next` stays on Models until the last tab; (c) sort/disable - assert ascending VRAM order with over-budget last and disabled, requirement text still present. Run installer pytest, fix failures, iterate until green. Update CI/CD (path filters, caching) to cover these files. Do not proceed to Phase 5 until stable. After all tests pass, run `/generate-session-history` to document Phase 4.

---

## Phase 5: Installing-page mockup redesign

**Goal**: The Installing page matches `installation-mockup.png` - uniform-width progress bars, iconed section tiles, circle/spinner status, auto-expand/collapse of the running section, and a modern pill button system including modernized log copy/download buttons.
**Prerequisites**: None (installing-page widgets; sequenced after the functional work).
**Stability Gate**: All per-model progress bars share the same start-x and width (fixed-column grid); each section header has a distinct iconed rounded tile; status shows a green circle-check when done and a spinner when running; the running section's details auto-expand and auto-collapse when it completes, with the next running section expanding; View Logs / View Details / log copy / log save / Install / Cancel all use the modern pill style from the mockup.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - a layout refactor plus design-system fidelity across `phase_group.py`, `log_panel.py`, `primary_button.py`, `secondary_button.py`, and `theme.py`.

### Sub-tasks

#### 5.1 - Uniform-width progress rows (Issue G core)

**Objective**: Make every model progress bar the same width via a fixed-column layout.

**Prompt**:
> In `scripts/installer/src/nexus_installer/widgets/phase_group.py`, `_ProgressRow.__init__` (:139-177) uses a `QHBoxLayout` where the `bar` takes `stretch=1` and the `detail` label (:162-165, text built at :500-507 with size/speed/ETA) has no fixed width and sizes to content, so bars end at different x-positions per row. Convert `_ProgressRow` to a `QGridLayout` (or fixed-width columns) with locked columns: name (fixed width) | progress bar (fixed/identical width across rows) | metrics detail (fixed-width, right-aligned, reserving space even when empty) | status (fixed-width, right-aligned). All bars must share the same start-x and the same width regardless of name length or metric text. Match the mockup's alignment: name left, metrics and status right-aligned in their columns. Acceptance: with a mix of long/short model names and present/absent speed/ETA text, every bar is visually identical in position and width (verify against `installation-mockup.png`).

---

#### 5.2 - Auto-expand/collapse the running section (Issue F)

**Objective**: Expand the running section's details and collapse them when it completes.

**Prompt**:
> In `phase_group.py`, auto-expand currently fires only on failure (`_apply_state` STATE_FAILED, `set_model_failed`, `show_failure_reason`). In the single state funnel `_apply_state` (:634-662), add: on `STATE_ACTIVE` set `self._toggle.setChecked(True)` (expand details); on `STATE_DONE` set `self._toggle.setChecked(False)` (collapse). Keep the failure-expand behavior (failed sections stay open). Because a phase spans multiple steps and settles via `_maybe_settle`, keying off phase-level state gives exactly "expand when the phase goes active, collapse when the whole phase finishes, next phase expands as it goes active." Verify against the installing sequence in `pages/installing.py` (Dependencies -> VS Code Extension -> Models -> Nexus Desktop). Acceptance: during install, exactly the running section is expanded; completed sections collapse; a failed section stays expanded showing its reason.

---

#### 5.3 - Design system: iconed tiles, status glyphs, and pill buttons (Issues F/G)

**Objective**: Bring the section headers, status, and all buttons up to the mockup's modern pill/iconed-tile system, including the log copy/download buttons.

**Prompt**:
> Restyle the Installing page to match `installation-mockup.png` (analyze it in depth first). (1) Section headers: add a distinct icon in a rounded-square tile left of each title - a package/box (Dependencies), the VS Code logo (VS Code Extension), a cube/blocks (Models), a monitor (Nexus Desktop). (2) Status: use a green circle-check for Done and an animated spinner ring for in-progress (replacing the current plain check/dot). (3) Buttons - pill-ify all of them: "View Details"/"Hide Details" toggle (`_toggle_style` :391-399) and "View Logs" toggle to a rounded pill (radius ~12) with a chevron and hover/pressed/checked states; the log copy (`⧉`) and save (`⤓`) icon buttons (`_icon_button` :401-412) to the same modern pill style with clear hover/pressed feedback (keep the "Copied" confirmation); the Install (primary) and Cancel (secondary) buttons to the mockup's filled-blue-rounded / outlined-rounded style (`theme.py:178-225`, `BUTTON_RADIUS`). (4) The "Need help?" card: add the circular help glyph. Keep the palette single-sourced in `constants.py`/`theme.py`. Significantly modernize the log copy/download buttons specifically (the user called these out) so they match the new View Logs pill. Acceptance: side-by-side with the mockup, the section tiles, status glyphs, and every button match; the log panel's copy/save buttons look modern and consistent with View Logs.

---

#### 5.4 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase. Iterate until stable before advancing to Phase 6.

**Prompt**:
> Generate widget tests for the installing page: (a) a `_ProgressRow` grid test asserting identical bar geometry across rows with varying name/metric lengths; (b) auto-expand/collapse - drive a `PhaseGroup` through ACTIVE -> DONE and assert the toggle expands then collapses, and stays expanded on FAILED; (c) construction/smoke tests that the iconed tiles, status glyphs, and pill buttons build and render offscreen without error. Run installer pytest, fix failures, iterate until green. Update CI/CD (path filters, caching) to cover the widgets. Do not proceed to Phase 6 until stable. After all tests pass, run `/generate-session-history` to document Phase 5.

---

## Phase 6: Architecture Refactor, Known-Gaps Reconciliation, and CI/CD

**Goal**: Leave the project well-organized, its known gaps reconciled, and its CI/CD complete and optimized.
**Prerequisites**: All prior phases.
**Stability Gate**: The layout is clean (no deprecated/obsolete files, empty dirs, redundant files/dirs, or overcomplicated structure left un-triaged); the version's known gaps are reconciled; CI/CD covers every change and is optimized; project validation/tests pass.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - repo-wide refactor + reference repair is high-risk.

### Sub-tasks

#### 6.1 - Architecture refactor

**Objective**: Refactor toward a well-organized, intuitive layout.

**Prompt**:
> Identify deprecated/obsolete files, empty directories, redundant files/dirs, and overcomplicated structure introduced across this cycle (installer widgets/engine, catalog, desktop wordmark, the preflight harness), then refactor toward a clean, intuitive layout via [[project-refactor]] and [[docs-layout-refactor]] (propose-then-apply, with confirmation; repair every reference for anything that moves). Specifically check for a stale `core/registry/models.json` and any dead catalog fields left after the remediation.

---

#### 6.2 - Known-gaps reconciliation

**Objective**: Reconcile the version's open gaps.

**Prompt**:
> Reconcile this version's known gaps via [[known-gaps-tracker]]: resolve, defer, or transfer each open item, and finalize `docs/v1/v1.13/known-gaps.md`. Explicitly reconcile the inherited v1.11 `D1` (gated-model catalog audit - now closed for defaults) and `IO.P2.A` / v1.8 `OSI006` (clean-machine + preflight CI runs - deferred under the Actions freeze until ~2026-08-01), and record any new gaps (e.g. gated opt-in models retained behind a token, deferred sha256 pins, the live preflight CI job pending freeze lift).

---

#### 6.3 - CI/CD create/update/optimize

**Objective**: CI/CD covers all changes and is optimized.

**Prompt**:
> Create or update the CI/CD pipeline so it covers every change in this plan (installer engine + widgets, catalog, preflight harness, desktop wordmark), then optimize it to reduce action minutes (path filters so installer/desktop-only changes skip the full matrix, concurrency cancel-in-progress, pip/venv + npm caching, gating expensive-OS or matrix jobs and the live model preflight to merges/schedule/dispatch) while keeping comprehensive testing. Keep the live pull+load preflight job deferred under the Actions freeze. Keep it platform-agnostic; GitHub Actions is the primary example.

---

#### 6.4 - Testing and Stabilization

**Objective**: Prove the refactor preserved behavior and CI/CD is green.

**Prompt**:
> Run the full validation/test suite (root vitest, installer pytest, desktop vitest, plus the static gates: tsc, lint, check-architecture, check:tampering, security:check), confirm the refactor changed no behavior, confirm CI/CD passes and the action-minute reduction is real, and iterate until clean. Where the Actions freeze blocks live CI, verify locally and document the deferral. Generate a session-history entry for this phase.

---

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none - no constitution file; no FAIL bullets) | | |

---

### Phase 6 Exit Checklist

- [ ] All sub-tasks completed
- [ ] All tests passing (unit, integration, and any phase-specific tests)
- [ ] No known regressions from prior phases
- [ ] Session history generated for this phase
- [ ] Ready to tag/ship v1.13.0 (release readiness handed to `/update release`)

# v1.9.0 Plan -- Installer + App UI Rework (Legibility, Brand Polish, Generation Experience)

**Date**: 2026-07-07
**Scope**: feature + refactor (a legibility and brand-polish overhaul of the PyQt installer, a shared model-catalog copy rewrite, and a set of desktop-app experience fixes: an on-brand generation animation, a chat disclaimer, and logo/icon parity)
**Status**: COMPLETE (all 9 phases, T001-T036, landed 2026-07-07..2026-07-09) -- authored from an operator review of the shipped v1.9.0 installer and app (screenshots dated 2026-07-06/07). Successor to [installer-and-app-experience-overhaul.md](installer-and-app-experience-overhaul.md) (COMPLETE), which delivered the single-artifact installer, brand foundation, and app overhaul; this cycle fixes the readability, animation-lag, icon, and copy issues that surfaced on the shipped build. Code-complete + green; remaining work is the operator on-device visual QA (`UIR.P7.A`/`P8.A`/`P9.A` in [known-gaps.md](../known-gaps.md)) and the merge-to-`main` release (semantic-release-owned version/CHANGELOG/tag). See [known-gaps.md](../known-gaps.md) Section 5 for the whole-cycle close.
**Operator decisions (2026-07-07, from the `/plan` clarifying round)**:
1. **Generation animation location**: the aurora "generating" animation goes in the existing **Image Studio** and **Video Lab** preview boxes (where generation actually runs today), not in the chat pillar. Chat-inline generation is not in scope this cycle.
2. **Model copy**: rewrite the shared source of truth `core/registry/catalog.json` (plain-language summaries), so both the installer and the app's Models settings improve together.
3. **Plan scope**: one combined plan covering the installer and the app, shipped as separate PRs per workstream.

**Cross-cutting constraint (inherited)**: local-first, zero-outbound; every phase is local-verifiable. No new services, credentials, or MCP entries. Motion respects `prefers-reduced-motion`.

---

## 0. Goals (product-strategy anchor)

- **Problem**: The shipped v1.9.0 installer works but is hard to read and feels unpolished, and the app it installs is missing the finish a premium local-AI product needs. Concretely: installer body text is tiny (down to 8pt step labels) with no coherent type hierarchy; the floating Nexus logo animation lags badly; the Windows taskbar shows a generic icon instead of the Nexus mark; the stepper labels are cramped against the checkmark circles; model cards render an over-technical description with an unreadable truncated "Best at" pill; the model tabs are colored per-tab (so the same model shows different colors in Chat vs Agentic); scrollbars and checkboxes look dated; and the header wordmark does not match the brand wordmark used in the interactive guide. On the app side, image/video generation shows only a bare "latent preview will appear here" placeholder (no modern generating animation) and the chat has no accuracy disclaimer. The net first-run and in-app experience reads as a developer utility, not a finished product.
- **Persona**: A non-technical (or impatient technical) end user whose first impression of the product IS the installer, and who then lands in the desktop app expecting the same finish. Plus the maintainer (Benjamin) who needs one coherent design system spanning both codebases rather than ~90 scattered inline font sizes.
- **North-star visual reference**: [guides/interactive-guide/nexus-ai-guide.html](../../../guides/interactive-guide/nexus-ai-guide.html) -- the two-tone "**Nexus** AI Studio" wordmark (system sans, `#eaf6f8` 700 / `#6f8990` 600, letter-spacing .2px), the `clamp()` heading type scale, the cyan/blue glow palette, and the aurora/radial-glow gradients. Generation-animation inspiration: Gemini's pulsing gradient loader and ChatGPT's shimmer placeholder, adapted to the Nexus aurora palette (see Section 1.7).
- **Definition of done (observable)**:
  1. Every installer page uses one coherent type scale with a logical hierarchy (Display > H1 > H2 > H3 > Body > Caption); the smallest text is at least doubled from the current 8pt/11pt lows; there are no ad-hoc inline `font-size` strings left in the active pages.
  2. "Step X of Y" and the per-step labels ("Welcome", "Prerequisites", ...) are comfortably legible and sit clearly below the checkmark circles with no overlap.
  3. No floating-logo animation exists anywhere in the installer: the header shows a static Nexus mark (`nexus-ai-primary_no-background.png`) and the Welcome page has no logo beside its title. There is no perceptible lag on any page.
  4. The Windows taskbar and window show the Nexus mark (not a generic icon) in the frozen (PyInstaller) build.
  5. The header wordmark renders in the exact two-tone style of the interactive guide.
  6. Scrollbars are transparent-track, pill-shaped, and modern; the per-model checkbox is a modern control (clear checked/unchecked/hover/focus states).
  7. On the Models page, colors are keyed to the model's **provider** (publisher), so a model that appears in both Chat and Agentic shows the same color; tabs are visually neutral.
  8. Model descriptions read as plain language: a one-sentence summary of what the model is, who made it, where it is from, and what kind of model it is, followed by a readable "Best for" line. The "Choose Your Models" intro and all page copy are simplified with a cleaner layout.
  9. In the app, running an image job (Image Studio) or a video job (Video Lab) shows an on-brand aurora animation inside the rounded preview box while the job runs, replacing the bare placeholder text.
  10. A short accuracy disclaimer appears under the chat composer (and the coding composer, which shares the component).
  11. The app does not reproduce the installer's issues: the taskbar/window icon shows the Nexus mark, and the app logo shows no perceptible lag.
  12. Verified by building/running BOTH artifacts and visually confirming each item above (screenshots), and by confirming `catalog.json` still parses in the TS validator, the Python installer loader, and the app.

---

## 1. Grounding (verified 2026-07-07, file-cited)

### 1.1 Installer typography (no scale exists)
- The QSS base is `font-size: 15px` ([theme.py:36](../../../scripts/installer/src/nexus_installer/theme.py#L36)); everything else is ~90 inline `font-size:` strings scattered across pages/widgets. There is no `h1/h2/h3/body` abstraction and no size token in [constants.py](../../../scripts/installer/src/nexus_installer/constants.py) (fonts there are family-only, [constants.py:111-119](../../../scripts/installer/src/nexus_installer/constants.py#L111-L119)).
- Smallest text in use: **8pt** step-indicator labels ([step_indicator.py:77](../../../scripts/installer/src/nexus_installer/widgets/step_indicator.py#L77)); 11pt log mono ([theme.py:177](../../../scripts/installer/src/nexus_installer/theme.py#L177)); 13px pills/badges/dots ([typed_catalog.py:294](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L294)). Page titles are 28px ([welcome.py:146](../../../scripts/installer/src/nexus_installer/pages/welcome.py#L146) and 10 others). One-off 19px GPU-name label ([gpu_detection.py:318](../../../scripts/installer/src/nexus_installer/pages/gpu_detection.py#L318)). Object-name label hooks (`secondaryLabel`, `mutedLabel`) exist ([theme.py:86-95](../../../scripts/installer/src/nexus_installer/theme.py#L86-L95)) but are mostly bypassed by inline styles.
- Height constants disagree with docstrings (header 74 vs "64px"; step bar 96 vs "88px"), [constants.py:126-140](../../../scripts/installer/src/nexus_installer/constants.py#L126-L140).

### 1.2 Floating logo (the lag source)
- `FloatingLogo` bobs a `QLabel` vertically +/-9px via a `QPropertyAnimation` on a custom `pyqtProperty`, 7000ms loop, plus a `QGraphicsDropShadowEffect` glow ([float_logo.py:29-110](../../../scripts/installer/src/nexus_installer/widgets/float_logo.py#L29-L110)). Used in the **header** (`size=40`, [header.py:33](../../../scripts/installer/src/nexus_installer/widgets/header.py#L33)) and the **Welcome hero** (`size=64`, [welcome.py:137](../../../scripts/installer/src/nexus_installer/pages/welcome.py#L137)). Asset: `assets/nexus-ai-primary_no-background.png`. The title bar already uses a separate static mark ([title_bar.py:75-93](../../../scripts/installer/src/nexus_installer/widgets/title_bar.py#L75-L93)). The animated constellation backdrop ([constellation.py](../../../scripts/installer/src/nexus_installer/widgets/constellation.py)) is a separate effect and is out of scope.

### 1.3 Header wordmark + stepper
- Header title is a single-color `QLabel("Nexus AI Studio")` styled inline `font-size: 22px; font-weight: bold` ([header.py:40-44](../../../scripts/installer/src/nexus_installer/widgets/header.py#L40-L44)) -- not the guide's two-tone treatment. "Step X of Y" is a 14px label on the right ([header.py:48-57](../../../scripts/installer/src/nexus_installer/widgets/header.py#L48-L57)), set from [window.py:222](../../../scripts/installer/src/nexus_installer/window.py#L222).
- Stepper is custom-painted ([step_indicator.py:41-149](../../../scripts/installer/src/nexus_installer/widgets/step_indicator.py#L41-L149)): `DOT_RADIUS=13`, `LABEL_Y_OFFSET=22`, label rect top is only `center_y + r + 6` (a 6px gap), font `QFont(FONT_PRIMARY, 8)` -- this is the overlap/legibility problem. `STEP_BAR_HEIGHT=96`.

### 1.4 Window / taskbar icon (frozen-path fragility)
- `SetCurrentProcessExplicitAppUserModelID("com.nexusai.studio.installer")` IS set before `QApplication` ([main.py:275-282](../../../scripts/installer/src/nexus_installer/main.py#L275-L282)) and `app.setWindowIcon(...)` IS called ([main.py:289-302](../../../scripts/installer/src/nexus_installer/main.py#L289-L302)) -- BUT the icon path uses a hardcoded `../../../../assets/...` relative walk that will not resolve in a frozen PyInstaller onefile bundle, so the app silently falls back to the generic Qt/Python icon. The robust `parents`-walk resolver used by the widgets ([float_logo.py:35-45](../../../scripts/installer/src/nexus_installer/widgets/float_logo.py#L35-L45)) and [registry_paths.py](../../../scripts/installer/src/nexus_installer/registry_paths.py) is the correct pattern. `nexus-installer.spec` stages `assets/nexus-ai-primary_no-background.png` ([nexus-installer.spec:83](../../../scripts/installer/build/nexus-installer.spec#L83)) and sets the exe icon to `assets/icon.ico` ([:25](../../../scripts/installer/build/nexus-installer.spec#L25)); the runtime `.ico` for `setWindowIcon` must also be staged and resolved via `sys._MEIPASS`.

### 1.5 Models page (colors, checkbox, copy)
- The active Models step is `TypedCatalogPage` ([typed_catalog.py](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py)); `vscode_extension.py` and `storage.py` are built but NOT wired into the wizard and are OUT OF SCOPE (do not remove -- scope discipline).
- **Per-tab color** (the problem): `accent = SECTION_ACCENTS.get(section_key, ACCENT)` ([typed_catalog.py:696](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L696)); `SECTION_ACCENTS` maps chat->cyan, agentic->magenta, image->orange, video->green, audio->blue ([constants.py:46-52](../../../scripts/installer/src/nexus_installer/constants.py#L46-L52)). Cards, checkbox fill, size label and "why this one" all inherit the section accent, so a model in two tabs shows two colors.
- **Checkbox**: per-card `_CHECKBOX_QSS` ([typed_catalog.py:302-310](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L302-L310)), a 20px rounded indicator filled with the section accent; a separate base style at [theme.py:247-267](../../../scripts/installer/src/nexus_installer/theme.py#L247-L267).
- **Card copy**: `_ModelCard` ([typed_catalog.py:333-476](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L333-L476)) renders the description (14px) plus a cramped pill row where "Best at" is the first strength truncated to 32 chars ([:412-451](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L412-L451)) -- unreadable. Intro subtitle + "Total: X GB" at [:514-534](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L514-L534).

### 1.6 Model catalog (shared source of truth)
- `core/registry/catalog.json` ([_meta at :1-6](../../../core/registry/catalog.json#L1-L6)) is the single source read by the installer loader `load_catalog_models()` ([typed_catalog.py:181-228](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L181-L228)), the engine `model_router.py`, and the app's Settings->Models. Per-model fields include `family`, `origin` (publisher COUNTRY, e.g. "USA" -- not the publisher), `description`, `strengths[]`, `whyRecommended`, `differentiators`, `agentic`, `guardrails`, `sizeGB`, `vramGB`, `license`. Some descriptions are over-technical (the screenshot's "Unsloth Dynamic-2.0 GGUF quant ladder ... IQ2_M / Q3_K / Q4_K_XL ..." is the worst offender). There is a TS validator/schema at `core/registry/catalog.ts` (`validateSpec`) and app types at [desktop/src/pages/settings/modelsTypes.ts](../../../desktop/src/pages/settings/modelsTypes.ts) -- any field addition must update all three readers + the schema. **Note**: "provider" (publisher: Google, Meta, ...) is NOT currently a field; it must be derived from `family` or added as a `publisher` field for the per-provider coloring.

### 1.7 Desktop app (Tauri v2 + React 19 + Vite, `desktop/`)
- **Generation lives in dedicated pillars, not chat.** Image Studio ([ImageStudioPage.tsx](../../../desktop/src/modules/image/ImageStudioPage.tsx)) polls a job and shows a live latent preview or the placeholder text "Latent preview will appear here while the job runs." ([:326-350](../../../desktop/src/modules/image/ImageStudioPage.tsx#L326-L350)). Video Lab ([VideoLabPage.tsx](../../../desktop/src/modules/video/VideoLabPage.tsx)) shows a thumbnail strip or "Live previews appear here while a job runs." ([:329-368](../../../desktop/src/modules/video/VideoLabPage.tsx#L329-L368)). Both use a native `<progress>` bar; there are **no CSS spinners/skeletons** in the app.
- **Chat**: shared composer [ChatInput.tsx](../../../desktop/src/shared/chat/ChatInput.tsx) (used by chat and coding); NO disclaimer text exists anywhere in `desktop/`.
- **Tokens**: [desktop/src/styles/tokens.css](../../../desktop/src/styles/tokens.css) already defines `--glow-cyan #38bdf8`, `--glow-cyan-node #7dd3fc`, `--grad-signature: linear-gradient(100deg,#3b82f6,#38bdf8,#22d3ee)`, `--bg-radial-glow`, per-pillar accents, and `--violet`-class colors; [globals.css](../../../desktop/src/styles/globals.css) has `.nexus-glass`, `.nexus-gradient-text`, and the `nexus-float` keyframe.
- **Icon**: set two ways and low-risk -- runtime `window.set_icon(include_bytes!("../icons/window-icon.png"))` ([lib.rs:46-54](../../../desktop/src-tauri/src/lib.rs#L46-L54)) + bundle icons ([tauri.conf.json:37-43](../../../desktop/src-tauri/tauri.conf.json#L37-L43)). Caveat: `window-icon.png` is hand-committed and NOT regenerated by [scripts/desktop/generate-icons.py](../../../scripts/desktop/generate-icons.py), so it can go stale.
- **Floating logo**: [FloatingLogo.tsx](../../../desktop/src/components/FloatingLogo.tsx) + `nexus-float` keyframe animates `transform: translateY` only (GPU-compositable, reduced-motion aware), used on the Dashboard hero ([Dashboard.tsx:82](../../../desktop/src/pages/Dashboard.tsx#L82)). Lower lag risk than the installer's, but must be verified under load per DoD #11.
- **Aurora technique (grounded)**: oversized (`inset: -35%`) blurred (`filter: blur(24-28px)`) radial-gradient layers moved with `transform` (not gradient stops) on staggered 9-11s durations, `mix-blend-mode: screen`, inside a rounded `overflow: hidden` box; plus a sweeping shimmer bar (`background-position` -200%->200%); `@media (prefers-reduced-motion: reduce)` disables motion and shows a soft static glow.

## 1.8 Alignment / policy check
- Local-first, zero-outbound: unchanged. No new network calls, services, credentials, or dependencies. The aurora/shimmer are pure CSS; no Lottie/asset fetch.
- No-degradation: installer and app stay fully functional at each phase; all motion respects `prefers-reduced-motion` and is perf-bounded.
- MCP Registry Policy: not touched (no new MCP entries).
- Scope discipline (CLAUDE.md): only lines tracing to this feedback change. The unwired `vscode_extension.py` / `storage.py` pages and the unused `DiskAwareFooter` are recorded but NOT removed. No AI-attribution in commits; commit messages ASCII-only; branch off the integration branch, never the protected branch.

---

## 2. Phases at a glance

| # | Phase | Workstream | Depends on | Rec. model / effort |
|---|-------|-----------|-----------|--------------------|
| 1 | Shared design foundations (type scale, provider palette, aurora spec, copy template) | Shared | -- | Strong reasoning tier, high (claude-opus-4-8) |
| 2 | Shared `catalog.json` plain-language copy rewrite (+ 3 readers/schema) | Shared | 1 | Strong reasoning tier, high (claude-opus-4-8) |
| 3 | Installer typography + hierarchy sweep | Installer | 1 | Workhorse tier, medium (claude-sonnet-5) |
| 4 | Installer logo de-lag + two-tone wordmark + stepper legibility | Installer | 1,3 | Workhorse tier, high (claude-sonnet-5) |
| 5 | Installer chrome: taskbar/window icon, scrollbars, checkbox | Installer | 3 | Workhorse tier, high (claude-sonnet-5) |
| 6 | Installer Models page: per-provider color + plain-language card layout + intro copy | Installer | 2,3,5 | Strong reasoning tier, high (claude-opus-4-8) |
| 7 | Installer whole-app copy/readability pass + end-to-end visual QA | Installer | 3,4,5,6 | Strong reasoning tier, medium (claude-opus-4-8) |
| 8 | App generation animation (aurora in Image Studio + Video Lab) | App | 1 | Workhorse tier, high (claude-sonnet-5) |
| 9 | App chat disclaimer + logo/icon parity audit + end-to-end visual QA | App | 1,8 | Workhorse tier, medium (claude-sonnet-5) |

Recommendations record tier intent + a concretely-enumerated model id; `/implement` re-confirms each against the then-current model set. Uncertain phases default to the strongest available tier.

**PR / sequencing**: Phases 1-7 land as the **installer PR** on a branch off the current integration branch (continues `feat/v1.9.0-installer-phase-1`); Phase 2 touches shared `catalog.json` and ships in that PR (installer consumes it first). Phases 8-9 land as the **app PR** on a separate branch. Phase 1 (foundations) should merge or be shared before both workstreams fan out.

---

## 3. Phases (detailed)

### Phase 1 -- Shared design foundations
**Goal**: Decide, once, the design primitives every later phase consumes: a numeric type scale, a provider color palette, the aurora/shimmer animation spec, and the plain-language model-copy template. Produces a short spec section (append to this plan or a sibling `ui-rework-design.md`) plus the installer type-scale tokens.
**Recommended model**: strong reasoning tier, high effort (claude-opus-4-8) -- taste/hierarchy decisions.
**Tasks**:
- T001 Define the installer type scale as size tokens in [constants.py](../../../scripts/installer/src/nexus_installer/constants.py): `FS_DISPLAY`, `FS_H1`, `FS_H2`, `FS_H3`, `FS_BODY`, `FS_BODY_STRONG`, `FS_CAPTION` with concrete px, a strict descending order (Display > H1 > H2 > H3 > Body > Caption), and a hard floor of 14px for the smallest text (the 8pt/11pt lows roughly double). Proposed starting values (operator to confirm): Display 34, H1 28, H2 20, H3 17, Body 16, Caption 14. Add matching weight tokens.
- T002 Define the provider color palette + a `family/publisher -> provider color` map (e.g. Google=cyan `#22d3ee`, Meta=blue `#5b8def`, Mistral=orange `#fa5a2d`, Alibaba/Qwen=violet `#a78bfa`, DeepSeek=blue `#2563eb`, Community/other=slate neutral), with a neutral fallback. Record it in `constants.py` and the spec. Decide tabs render neutral (single accent) so provider color is the only card color signal.
- T003 Write the aurora + shimmer animation spec (the Section 1.7 technique) with exact tokens to reuse from [tokens.css](../../../desktop/src/styles/tokens.css), the reduced-motion fallback, and the progress-coupling behavior. This is the contract Phase 8 implements.
- T004 Write the plain-language model-copy template: sentence 1 = "{Publisher}'s {model} is a {size/kind} model from {country}." sentence 2 = plain "what it's good at"; keep tech detail (quant ladder, MoE) in an optional `differentiators`/detail line, not the headline. This is the contract Phase 2 applies.
**Verification**: the spec is self-consistent (scale strictly descending, palette has a fallback, aurora spec names only existing tokens); `constants.py` imports cleanly (`python -c "import ..."`).

### Phase 2 -- Shared catalog.json plain-language copy rewrite
**Goal**: Rewrite the model copy in the shared catalog so descriptions read as plain language per the T004 template, without breaking any of the three readers.
**Recommended model**: strong reasoning tier, high effort (claude-opus-4-8) -- copywriting quality + cross-reader safety.
**Tasks**:
- T005 If per-provider coloring needs a stored field, add a `publisher` string per model in [catalog.json](../../../core/registry/catalog.json) (else derive from `family` in Phase 6 -- decide in T002). If added, update the TS schema/validator `core/registry/catalog.ts`, the Python `CatalogModel` loader ([typed_catalog.py:181-228](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L181-L228)), and app types [modelsTypes.ts](../../../desktop/src/pages/settings/modelsTypes.ts).
- T006 Rewrite every model's `description` to the plain-language headline (drop the over-technical GGUF/quant-ladder wording from the headline; relocate it to `differentiators`). Keep `strengths[]` as the "Best for" source. Preserve all non-copy fields byte-for-byte.
- T007 Sanity-check copy accuracy (publisher, country, kind, size) against `origin`/`family`/`sizeGB`; no invented facts.
**Verification**: `catalog.ts` `validateSpec` passes for every entry (run the TS validator); the Python loader parses all models (`load_catalog_models()` returns the full set with no exceptions); the app typechecks (`npm run typecheck` in `desktop/`). Spot-check 3 model cards read as plain language.

### Phase 3 -- Installer typography + hierarchy sweep
**Goal**: Replace the ~90 inline `font-size` strings in the active pages/widgets with the Phase-1 scale tokens (or object-name QSS classes), giving every page a coherent, legible hierarchy.
**Recommended model**: workhorse tier, medium effort (claude-sonnet-5) -- mechanical once the scale exists.
**Tasks**:
- T008 Add scale-driven QSS classes / object names in [theme.py](../../../scripts/installer/src/nexus_installer/theme.py) (e.g. `pageTitle`, `sectionHead`, `subHead`, `bodyText`, `caption`) wired to the T001 tokens; make `secondaryLabel`/`mutedLabel` derive from the scale.
- T009 Sweep every active page (welcome, prerequisites, gpu_detection, install_path, configuration, review, installing, complete, typed_catalog) and widgets (header, footer, phase_group, callout_box) to consume the scale; remove inline `font-size` strings. Map each label to the correct level (page title -> H1, section subhead -> H2, etc.).
- T010 Fix the one-off/mixed sizes: the lone 19px GPU-name label ([gpu_detection.py:318](../../../scripts/installer/src/nexus_installer/pages/gpu_detection.py#L318)), 13px dots/pills, and the pt-vs-px mono usage -> consistent scale tokens.
- T011 Reconcile the height-constant/docstring mismatches in [constants.py](../../../scripts/installer/src/nexus_installer/constants.py) (header, step bar) so later phases build on correct numbers.
**Verification**: launch the installer (`python -m nexus_installer` or the dev entry) and confirm on each page that hierarchy is visually correct (H1>H2>H3>Body) and nothing is smaller than the 14px floor. `grep` for residual inline `font-size` in active pages returns only intentional exceptions.

### Phase 4 -- Installer logo de-lag + two-tone wordmark + stepper legibility
**Goal**: Kill the laggy floating logo, match the guide wordmark, and make the stepper readable and non-overlapping.
**Recommended model**: workhorse tier, high effort (claude-sonnet-5) -- custom-paint geometry needs care.
**Tasks**:
- T012 Replace `FloatingLogo` usage in the header with a static `QLabel` mark (scaled `nexus-ai-primary_no-background.png`, optional static glow, NO animation) ([header.py:33-38](../../../scripts/installer/src/nexus_installer/widgets/header.py#L33-L38)). Introduce a small `StaticLogo` helper or reuse the title-bar static-mark pattern ([title_bar.py:75-93](../../../scripts/installer/src/nexus_installer/widgets/title_bar.py#L75-L93)).
- T013 Remove the logo lockup beside "Welcome to Nexus AI Studio" ([welcome.py:134-150](../../../scripts/installer/src/nexus_installer/pages/welcome.py#L134-L150)) per operator request; keep the title, re-balance the layout.
- T014 Retire the `QPropertyAnimation` path in [float_logo.py](../../../scripts/installer/src/nexus_installer/widgets/float_logo.py) (delete the widget or reduce it to a static image) so no bob animation ships. Confirm no other active caller remains.
- T015 Restyle the header wordmark to the guide's two-tone treatment ([header.py:40-44](../../../scripts/installer/src/nexus_installer/widgets/header.py#L40-L44)): "Nexus" `#eaf6f8` weight 700 + " AI Studio" `#6f8990` weight 600, system sans, letter-spacing .2px, sized from the scale (>= H2). Use rich text or two labels.
- T016 Enlarge "Step X of Y" to a Body/caption scale token ([header.py:48-57](../../../scripts/installer/src/nexus_installer/widgets/header.py#L48-L57)).
- T017 Fix the stepper ([step_indicator.py](../../../scripts/installer/src/nexus_installer/widgets/step_indicator.py)): raise the label font from 8pt to a >=14px scale value ([:77](../../../scripts/installer/src/nexus_installer/widgets/step_indicator.py#L77)), increase the circle->label gap (`LABEL_Y_OFFSET`/rect top from +6 to a clearly separated value), and raise `STEP_BAR_HEIGHT` so labels never overlap the dots. Verify layout at min and default window widths.
**Verification**: launch the installer, click through all steps -> no logo bob anywhere, no perceptible lag; the header wordmark matches the guide screenshot; step labels are readable and clearly below the circles at min width.

### Phase 5 -- Installer chrome: taskbar/window icon, scrollbars, checkbox
**Goal**: Make the taskbar icon reliable in the frozen build and modernize the scrollbars and per-model checkbox.
**Recommended model**: workhorse tier, high effort (claude-sonnet-5) -- packaging/frozen-path nuance.
**Tasks**:
- T018 Replace the fragile `../../../../assets` icon resolution ([main.py:289-302](../../../scripts/installer/src/nexus_installer/main.py#L289-L302)) with the robust resolver used by the widgets, adding a `sys._MEIPASS` branch so the runtime `.ico`/`.png` resolves in the PyInstaller onefile bundle. Also call `setWindowIcon` on the window ([window.py](../../../scripts/installer/src/nexus_installer/window.py)), not only app-wide.
- T019 Ensure the runtime icon files are staged as PyInstaller `datas` in [nexus-installer.spec](../../../scripts/installer/build/nexus-installer.spec) (the `.ico` used for `setWindowIcon`, alongside the already-staged brand mark). Keep the AppUserModelID call ([main.py:275-282](../../../scripts/installer/src/nexus_installer/main.py#L275-L282)).
- T020 Modernize the scrollbar QSS ([theme.py:189-201](../../../scripts/installer/src/nexus_installer/theme.py#L189-L201)): transparent track (`background: transparent`), pill handle (`border-radius = width/2`, slim ~8-10px), a subtle default handle color that brightens on hover, zero-size arrows; add the horizontal rule too. Confirm nested catalog scroll areas inherit it.
- T021 Redesign the per-model checkbox (`_CHECKBOX_QSS`, [typed_catalog.py:302-310](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L302-L310), and base [theme.py:247-267](../../../scripts/installer/src/nexus_installer/theme.py#L247-L267)): a modern control with a comfortable hit target, rounded box, crisp check glyph, and distinct unchecked/checked/hover/focus/disabled(locked) states; checked fill uses the provider color (from Phase 6) rather than the section accent.
**Verification**: BUILD the frozen installer (`scripts/installer/build/build-windows.ps1`) and launch `dist\NexusSetup.exe` -> the taskbar and window show the Nexus mark (not the generic icon). In the running app, scrollbars are transparent pill-shaped and checkboxes show all states.

### Phase 6 -- Installer Models page: per-provider color + plain-language card layout + intro copy
**Goal**: Recolor by provider (not tab), rebuild the model card so the plain-language description and a readable "Best for" replace the cramped pill, and simplify the intro/total copy and layout.
**Recommended model**: strong reasoning tier, high effort (claude-opus-4-8) -- layout + provider mapping + consumes the rewritten catalog.
**Tasks**:
- T022 Replace the per-section accent (`SECTION_ACCENTS`) with a per-provider color resolved from `publisher`/`family` via the T002 map ([typed_catalog.py:696](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L696) and the card/checkbox/size-label/why-line consumers). Make the tab bar visually neutral (single accent), so the same model shows one consistent color across Chat/Agentic.
- T023 Rebuild `_ModelCard` copy layout ([typed_catalog.py:333-476](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L333-L476)): lead with the plain-language description (Phase 2), then a clearly-labeled, full-width "Best for" line built from `strengths[]` (no 32-char truncation, no cramped pill). Keep a small, scannable pill row for only the few key facts (Origin, Agentic yes/no, Context, license, Multimodal) using the scale's caption token.
- T024 Simplify the "Choose Your Models" intro subtitle and the "Total: X GB" line ([typed_catalog.py:514-534](../../../scripts/installer/src/nexus_installer/pages/typed_catalog.py#L514-L534)) into short, readable copy with a cleaner layout; align the "Refresh Models" footer copy.
- T025 Add a compact per-provider legend/affordance if more than one provider is present (so the color coding is self-explanatory); skip gracefully when only one provider exists.
**Verification**: launch the installer Models step -> a model present in both Chat and Agentic shows the SAME color in both; descriptions read plainly with a legible "Best for"; the intro/total copy is short and clear at default width.

### Phase 7 -- Installer whole-app copy/readability pass + end-to-end visual QA
**Goal**: Final copy/readability sweep across every active page, then a full build-and-click verification against the DoD.
**Recommended model**: strong reasoning tier, medium effort (claude-opus-4-8) -- writing quality + verification judgment.
**Tasks**:
- T026 Review and simplify the copy on prerequisites, gpu_detection, install_path, configuration, review, installing, complete: short sentences, logical layout, consistent scale, no jargon (e.g. plain wording for the Ollama warnings, the "what gets installed where" callout, the complete-page command rows).
- T027 Consistency pass: confirm callout boxes, phase groups, footers, and dots all use scale tokens and provider/semantic colors coherently.
- T028 Build the frozen installer and walk all 9 steps; capture a screenshot per step; verify DoD items 1-8 (hierarchy, step labels, static logo/no-lag, taskbar icon, wordmark, scrollbars, checkbox, provider colors, plain copy). File any residual issues in [known-gaps.md](../known-gaps.md).
**Verification**: the screenshot set demonstrates each DoD item; run the verify skill on the installer flow. Zero perceptible animation lag on any page.

### Phase 8 -- App generation animation (aurora in Image Studio + Video Lab)
**Goal**: Build a reusable on-brand aurora "generating" component and mount it in the two studios' preview boxes while a job runs.
**Recommended model**: workhorse tier, high effort (claude-sonnet-5) -- React/CSS component + integration.
**Tasks**:
- T029 Build a reusable `GenerationCanvas` React component implementing the Phase-1 aurora spec: a rounded (`overflow: hidden`) box with oversized blurred radial-gradient layers drifting via `transform` on staggered durations (`mix-blend-mode: screen`) using existing tokens (`--glow-cyan`, `--grad-signature`, violet accent), plus a sweeping shimmer bar; add the keyframes to [globals.css](../../../desktop/src/styles/globals.css) and gate all motion behind `@media (prefers-reduced-motion: reduce)` (static soft glow fallback).
- T030 Couple the animation to job progress (intensity/opacity or a progress ring driven by the existing drain-poll progress) and overlay the live latent preview image when one is available, so it reads as "materializing".
- T031 Mount it in Image Studio, replacing the "Latent preview will appear here..." placeholder ([ImageStudioPage.tsx:326-350](../../../desktop/src/modules/image/ImageStudioPage.tsx#L326-L350)); show only when `isGenerating`, hand off to the final `<img>` on completion.
- T032 Mount it in Video Lab, replacing the "Live previews appear here..." placeholder ([VideoLabPage.tsx:329-368](../../../desktop/src/modules/video/VideoLabPage.tsx#L329-L368)); overlay the per-second thumbnail strip on top of the aurora; hand off to `TimelinePreviewer` on completion.
**Verification**: `npm run dev` / `tauri dev`; run an image job and a video job -> the rounded preview box shows the aurora + shimmer while generating, respects reduced-motion, and cleanly swaps to the final media. Verify 60fps-feel (no jank) and that the constellation backdrop + this animation together stay perf-bounded.

### Phase 9 -- App chat disclaimer + logo/icon parity audit + end-to-end visual QA
**Goal**: Add the accuracy disclaimer under the composer, confirm the app does not reproduce the installer's icon/logo issues, and verify the app DoD.
**Recommended model**: workhorse tier, medium effort (claude-sonnet-5).
**Tasks**:
- T033 Add a short disclaimer under the shared composer [ChatInput.tsx](../../../desktop/src/shared/chat/ChatInput.tsx) (appears under both chat and coding), styled subtle/centered/caption-size, e.g. "Nexus runs locally and can make mistakes. Verify important information." Confirm placement in the chat footer wrapper ([ChatPage.tsx:222-230](../../../desktop/src/modules/chat/ChatPage.tsx#L222-L230)).
- T034 Icon parity: verify the Windows taskbar/window icon shows the Nexus mark for a built bundle; confirm `window-icon.png` is current, and either extend [generate-icons.py](../../../scripts/desktop/generate-icons.py) to emit it or document that it is hand-maintained (so a future rebrand does not leave it stale).
- T035 Logo-lag parity: exercise the Dashboard `FloatingLogo` under load ([Dashboard.tsx:82](../../../desktop/src/pages/Dashboard.tsx#L82)); confirm the `transform`-only bob is smooth. If any jank is observed, swap it to a static mark (matching the installer decision).
- T036 App end-to-end visual QA: build/run the app, capture screenshots of the disclaimer, both generation animations, and the taskbar/window icon; verify DoD items 9-11. File residuals in [known-gaps.md](../known-gaps.md).
**Verification**: screenshots demonstrate the disclaimer, both aurora animations, and the correct taskbar icon; the Dashboard logo shows no perceptible lag.

---

## 4. Constitution / rules check (CLAUDE.md)
- No project constitution file exists; the governing rules are CLAUDE.md. This plan complies: root-cause fixes (frozen-path icon resolution, real type scale) not band-aids; scope-disciplined (unwired pages and unused widgets recorded, not removed; only feedback-traceable lines change); commits will be ASCII-only with no AI attribution; work branches off the integration branch, never the protected branch; `docs/todos.md` updated as phases complete.

## 5. Complexity tracking / risks
- **Frozen PyInstaller path resolution (Phase 5)**: highest-risk item -- the taskbar-icon fix must be verified in the built `.exe`, not just the dev run. Mitigation: Phase 5/7 verification explicitly builds and launches the frozen artifact.
- **Shared catalog.json readers (Phase 2)**: a field addition or a malformed edit breaks the TS validator, the Python loader, or the app. Mitigation: run all three readers as the Phase-2 gate; keep non-copy fields byte-for-byte.
- **Provider vs origin (Phases 2/6)**: `origin` is a country, not a publisher; "color per provider" needs a publisher signal. Mitigation: T002/T005 decide derive-from-`family` vs add `publisher`. With a single-provider catalog today, the coloring must still look intentional (T025 legend only when >1 provider).
- **Custom-painted stepper geometry (Phase 4)**: raising label size + gap can overflow `STEP_BAR_HEIGHT` or collide at min width. Mitigation: verify at min and default widths.
- **Type-scale sweep breadth (Phase 3)**: ~90 inline edits risk missing a label or over-scaling dense UI. Mitigation: object-name QSS classes centralize the mapping; grep gate for residual inline sizes.
- **Two separate codebases / CI (all)**: installer (Python/PyInstaller) and app (Tauri/React) version and ship independently. Mitigation: separate PRs per workstream; Phase 1 foundations shared first.

## 6. Out of scope (recorded)
- Chat-inline image/video generation (operator deferred; the animation lives in the studios).
- Removing the unwired `vscode_extension.py` / `storage.py` pages and the unused `DiskAwareFooter`.
- The installer constellation backdrop and any non-logo animations.
- Any model-catalog curation beyond copy (no new/removed models, no tier changes).

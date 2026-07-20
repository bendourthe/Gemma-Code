# Plan - Installer Catalog Curation and Install Reliability

**Project**: Nexus (Nexus AI Studio)
**Version**: v1.14.0
**Slug**: installer-catalog-curation-and-reliability
**Plan Type**: Feature / Enhancement + Bug-fix campaign
**Created**: 2026-07-19
**Goal**: The Models page shows one clean, best-of-family choice per model (recommended at the top, hardware-incompatible ones grayed and disabled at the bottom, release date on every card), every model the installer offers actually downloads and installs (no silent skips, no 401/400 failures), and the Installing page is visually tidy (no dead space, proper button margins, a Cancel that lives on the install row and disappears when done).

## Overview

A test of the rebuilt v2.3.0 installer surfaced a second round of catalog and UX defects on top of the still-unresolved "some models fail to install" problem.

**Catalog / Models page.** The catalog offers 38 entries, many of which are multiple variants of the same model family (`sana` has 10 entries, `gemma4` has 5, `sdxl` and `qwen` have 4 each), including auxiliary non-models (a VAE and three ControlNets) and redundant quantization / resolution / speed variants. The Models page lists them all, unsorted by capability, so a user sees ten SANA rows and five Gemma rows with no clear "this is the one for you." The requirement: for each family show only the single best variant that fits the detected hardware (pre-selected, at the top), drop the smaller / superseded / redundant variants, and show any larger variants that exceed the user's VRAM as clearly grayed-out, disabled rows at the bottom. Each card must also show the model's release date as a first-class pill (the data lives in a `releaseDate` field that exists on some models but not all, and is currently rendered inline in the card title).

**Install reliability (critical).** The attached model-install log still shows two failures: `gemma-4-12b-it-gguf` pulling the old `hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_XL` path and failing with `Error: 400`, and `sana-1.6b-int4` failing with HTTP 401. Live investigation for this plan established that the log is **stale** (from a pre-v1.13 installer): the current catalog already routes Gemma 4 to `ollama://gemma4:12b`, and that tag resolves against the Ollama registry (HTTP 200) on the installed Ollama 0.24.0. The real, unfinished work is the class problem the user restated: **every model the installer *offers* must actually install** - the v1.13 approach of flagging gated opt-ins `gated: true` and skipping them "gracefully" still leaves an offered model that does not install, which the user has explicitly rejected. Live probes classified the four gated opt-ins precisely: `sd1.5` (`runwayml/stable-diffusion-v1-5`) is not truly gated - the repo was pulled and a public mirror exists (`stable-diffusion-v1-5/stable-diffusion-v1-5`, HTTP 302); `sana-1.6b-int4` (401) is a redundant INT4 quant of the SANA family that the public `sana-1.6b-1024` (302) already covers; `stable-audio-open-1.0` (401) is a license-gated open-weight model whose music-generation capability the public `musicgen-medium` (302) covers; and `svd` (401) is a genuinely license-gated Stability community-license model. The honest constraint (recorded so the plan does not over-promise): a license click-through is a legal gate, so the installer cannot auto-accept a license on the user's behalf or ship a shared token. The design therefore keeps the default recommended set 100% public (installs automatically, zero user action), re-points broken repos, prefers ungated public equivalents, auto-detects an existing Hugging Face token and uses it silently, and falls back to a one-time guided token/license step only as the last resort for a genuinely-gated model the user opts into.

**Installing page.** Three cosmetic defects on the (otherwise much-improved) installing page: the Dependencies section's progress bars have a wide empty gap on their right (the dependency rows do not use the model rows' uniform grid, so the bar column over-stretches); the "View Logs" button's left and bottom edges touch the section outline (no inner margin); and a grayed-out "Cancel" button lingers in the bottom-right after the install completes - Cancel should sit on the same footer row as the install action during the run and disappear on completion.

This cycle delivers, in dependency order: (1) catalog curation - collapse to a clean best-of-family data set, drop redundant/auxiliary/superseded entries, re-point/replace gated opt-ins, and give every retained model a `releaseDate`; (2) install-reliability closure - the HF-token auto-detect + guided-auth flow, re-point verification, a **live** per-tier preflight that gates the offered set, and real SHA-256 pin rotation, so every offered model provably installs (closes v1.13 IR.P1.A/B/C/E and IR.P2.A); (3) the Models-page collapse/sort/disable rendering plus the release-date pill; (4) the Installing-page polish (uniform dependency rows, View Logs margins, footer Cancel); and (5) the mandatory architecture-refactor, known-gaps, and CI/CD close-out. Success is a clean-machine install where the Models page is tidy and self-explanatory and every offered model - default or opt-in - actually installs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No constitution file at `docs/v1/v1.14/constitution.md` (nor a repo-level one) - skipping the formal check. Recommend `/constitution` to establish project principles; informational, not blocking.

Grounding note: no `STRATEGY.md` and no `docs/solutions/` store, so knowledge-base grounding is best-effort. The plan is grounded in the v1.13 known gaps it closes (`IR.P1.A` live pull+load verification, `IR.P1.B` real pin rotation, `IR.P1.C` gated re-point, `IR.P1.E` freeze-deferred preflight CI, `IR.P2.A` live preflight run) and carries forward the cosmetic on-device QA gaps (`IR.P3.A`, `IR.P4.A`, `IR.P5.A`). The **MCP Registry Policy** (local-first, no third-party data-as-a-service) constrains all model sourcing: prefer public open mirrors and the user's own Ollama / Hugging Face access; never a hosted generation, scraping, or download-proxy service. Ground-truth for the plan was gathered by live probes on 2026-07-19 (Ollama registry manifest HEAD for `gemma4:12b`; HF `resolve` first-hop status for the four gated repos and their candidate public replacements).

## Phases at a Glance

| Phase | Title | Outcome | Rec. model / effort |
|-------|-------|---------|---------------------|
| 1 | Catalog curation: best-of-family data set + release dates + gated remediation | The catalog is a clean, de-duplicated set - redundant/auxiliary/superseded entries dropped, gated opt-ins re-pointed or replaced with verified public sources, every retained model carries a `releaseDate`, and `recommended.json` ids are normalized | Strong reasoning tier (Opus 4.8), high effort - correctness-critical catalog + schema + source-routing decisions |
| 2 | Install-reliability closure: HF auth flow, live preflight gate, pin rotation | Every offered model provably installs - a re-point/replace/auto-token/guided-auth path per source class, a live per-tier preflight that fails the offered set on any non-installable model, and real SHA-256 pins rotated in | Strong reasoning tier (Opus 4.8), high effort - engine + auth flow + live subprocess verification, fail-closed |
| 3 | Models-page collapse, sort, disable, and release-date pill | The picker shows one best-fitting variant per family (pre-selected, top), larger incompatible tiers grayed/disabled at the bottom, smaller/redundant hidden, and a release-date pill on every card | Strong reasoning tier (Opus 4.8), high effort - VRAM-aware collapse logic + Qt rendering across typed_catalog |
| 4 | Installing-page polish: uniform dependency rows, button margins, footer Cancel | Dependency rows use the uniform bar grid (no right-side dead space), the View Logs button has inner margins, and Cancel lives on the install footer row and disappears on completion | Strong reasoning tier (Opus 4.8), medium effort - contained Qt layout + wizard footer state |
| 5 | Architecture Refactor, Known-Gaps Reconciliation, and CI/CD | Clean layout, v1.13/v1.14 gaps reconciled, CI/CD covers all changes and is optimized; release-readiness handed to `/update release` | Strong reasoning tier (Opus 4.8), high effort - repo-wide refactor + reference repair is high-risk |

---

## Phase 1: Catalog curation - best-of-family data set + release dates + gated remediation

**Goal**: Reduce the catalog to a clean, de-duplicated set where each family carries only its meaningful capability tiers, every retained model has a verified-public (or correctly-authenticated) source and a `releaseDate`, auxiliary non-models are excluded from selection, and `recommended.json` references are normalized and valid.
**Prerequisites**: None.
**Stability Gate**: The catalog validates against `manifest.schema.json`; no retained selectable model references a dead URL; every gated opt-in is either re-pointed to a verified public source, replaced by a verified public equivalent, or explicitly retained-with-token-required and documented; every retained selectable model has a non-empty `releaseDate`; `recommended.json` references only ids that still exist; auxiliary types (`vae`, `controlnet`) are excluded from the selectable set.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - catalog correctness, source routing, and schema validity across `core/registry/catalog.json`, `core/registry/recommended.json`, and the loaders; re-confirm against the then-current model set at implementation time.

### Sub-tasks

#### 1.1 - Define the family-collapse data policy and prune redundant / auxiliary / superseded entries

**Objective**: Encode which entries survive as distinct, selectable capability tiers and remove the rest, so the runtime picker (Phase 3) collapses cleanly.

**Prompt**:
> In `core/registry/catalog.json`, curate each `family` down to its meaningful, distinct capability tiers and drop redundant / auxiliary / superseded entries. Rules: (a) EXCLUDE auxiliary types from the selectable set - `type` in {`vae`, `controlnet`} are runtime add-ons, not user-choosable models (the loader already drops `vae`; extend the same exclusion to `controlnet`). Keep them in the catalog as dependency assets if the runtime pulls them, but they must never appear as picker rows. (b) Within each family, keep only entries that represent a distinct VRAM/capability tier; drop redundant speed/quant/resolution variants that another retained tier already covers. Concretely, for `sana`: keep the distinct VRAM tiers of the base image model (`sana-1.6b-1024` 6 GB, `sana-1.6b-2k` 12 GB, `sana-1.6b-4k` 20 GB) and the distinct `sana-video-2b-720p`; drop `sana-sprint-1024` (redundant speed variant of 1024) and `sana-1.6b-int4` (gated redundant quant - see 1.3); exclude the VAE + 3 ControlNets per (a). For `gemma4`: keep the distinct size tiers (`gemma4:e2b`, `gemma4:e4b`, the 12B, `gemma4:26b`, `gemma4:31b`) - these are genuine hardware tiers the Phase 3 collapse selects among, not duplicates. Review `sdxl` (4) and `qwen` (4) similarly - keep distinct tiers/roles (e.g. base vs coder for qwen), drop true duplicates. Do NOT hardware-filter here - keeping all real tiers is correct; Phase 3 does the per-machine best-fit collapse. Acceptance: the selectable catalog has no auxiliary rows, no redundant same-tier variants, and each family is a short list of genuine capability tiers; document the drop rationale in the `_meta.comment`.

---

#### 1.2 - Ensure a first-class `releaseDate` on every retained model

**Objective**: Guarantee the release-date pill (Phase 3) has data for every card.

**Prompt**:
> The catalog has a `releaseDate` field (ISO `YYYY-MM-DD`) on some models (e.g. `gemma-4-12b-it-gguf` = `2026-05-01`) but not all (e.g. `gemma4:e2b`/`e4b`/`26b` have none). For every retained selectable model, ensure a correct `releaseDate` is present, sourced from the model's known public release date (HF model card / Ollama registry / vendor announcement). Do not invent dates - if a precise date is unknown, use the documented month with `-01` and note the approximation in the entry's provenance/comment. Keep the field name `releaseDate` (already the established key) so no consumer rename is needed. Acceptance: every retained selectable model has a non-empty, plausible `releaseDate`; a schema/lint check (added in 1.5) fails if any selectable model lacks one.

---

#### 1.3 - Remediate gated opt-ins to verified public sources (re-point / replace)

**Objective**: Make every gated opt-in installable without special credentials wherever a public path exists, so only genuinely-gated models remain for the Phase 2 auth flow.

**Prompt**:
> Using the 2026-07-19 live-probe classification, remediate each gated opt-in in `catalog.json`: (1) `sd1.5` - the `runwayml/stable-diffusion-v1-5` repo was pulled (307/redirect); re-point `source.repo`/`url` (and the `weights` manifest paths) to the verified public mirror `stable-diffusion-v1-5/stable-diffusion-v1-5` (HTTP 302), clear `gated`, and refresh the file path(s) to match the mirror's layout. (2) `sana-1.6b-int4` - drop it (done in 1.1); the public `sana-1.6b-1024` (302) covers 1024px. (3) `stable-audio-open-1.0` - license-gated (401); replace the offered music-generation capability with the public `musicgen-medium` (`facebook/musicgen-medium`, 302) if not already offered, and either drop `stable-audio-open-1.0` or retain it flagged `gated: true` + `requiresLicense: true` for the Phase 2 opt-in token flow (default: drop, since `musicgen-medium` covers it and both are non-commercial opt-ins). (4) `svd` - genuinely license-gated (401) image-to-video; check whether a retained public video model (`ltx-video`, `wan*`) offers image-to-video; if a public i2v path exists, replace/rely on it and drop `svd`; otherwise retain `svd` flagged `gated: true` + `requiresLicense: true` with its license URL, for the Phase 2 guided flow. Any model retained as gated MUST carry the license/repo URL the guided step will link to. Re-verify every changed source with a live first-hop probe before finalizing. Acceptance: no retained model points at a dead/moved repo; every retained model is either public (verified 302/200) or explicitly `gated: true` + `requiresLicense: true` with a license URL; the default (recommended) set is 100% public.

---

#### 1.4 - Normalize `recommended.json` references and reconcile ids

**Objective**: Keep the tier defaults valid and consistent after curation.

**Prompt**:
> After 1.1-1.3, audit `core/registry/recommended.json` so every id it references still exists and is public (defaults must never be gated). Reconcile the mixed id conventions (the tiers reference both bare Ollama tags like `gemma4:31b` and the descriptive id `gemma-4-12b-it-gguf`); pick one consistent scheme for the Gemma 12B entry and update both files together if the id changes. Ensure each tier's per-section defaults still resolve to a retained, public, tier-appropriate model (chat/agentic/embed/image/video/audio for cpu/8/12/16/24). Acceptance: `recommended.json` references only existing public ids; no tier default is a gated model; loading `recommended.json` against the curated catalog raises no missing-id error.

---

#### 1.5 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase; iterate until stable before Phase 2.

**Prompt**:
> Generate comprehensive tests for Phase 1: installer pytest + root vitest covering (a) catalog validity - validates against `manifest.schema.json`, no selectable auxiliary (`vae`/`controlnet`) rows, no redundant same-tier duplicates per family, every selectable model has a non-empty `releaseDate`; (b) source hygiene - no retained model references a known-dead URL, every retained model is public or explicitly `gated:true`+`requiresLicense:true`+license URL, defaults are all public; (c) `recommended.json` - every referenced id exists and is public. Mock all network; do not hit the network in unit tests (the live re-verification in 1.3 is a one-time authoring check, not a unit test). Update `tests/unit/core/registry/catalog.test.ts` and the installer catalog tests to the curated set. Run `scripts/installer/.venv/Scripts/python -m pytest scripts/installer/tests` and the root `npm test`, fix failures, iterate to green. Create/update CI to cover the catalog changes with path filters (installer/registry-only changes skip the full matrix), concurrency cancel-in-progress, and caching. Do not proceed until stable. After green, run `/generate-session-history` to document Phase 1.

---

## Phase 2: Install-reliability closure - HF auth flow, live preflight gate, pin rotation

**Goal**: Guarantee that every model the installer offers - default or opt-in - actually downloads and installs: public models install automatically with zero user action; genuinely-gated opt-ins install via an auto-detected token or a one-time guided license/token step; a live per-tier preflight fails the offered set if anything cannot install; and real SHA-256 pins replace placeholders.
**Prerequisites**: Phase 1.
**Stability Gate**: A live `--preflight` run on the installed Gemma-4-capable Ollama reports PASS (pull + minimal load smoke) for every default model in the 12 GB and 16 GB tiers; the reachability probe reports every RETAINED selectable model as ok (public) or gated-with-token-path (never dead); a selected gated opt-in installs when a valid token is present (auto-detected or entered) and shows the guided step (not a silent failure) when no token is available; real SHA-256 pins are enforced fail-closed on every retained HF default that has been downloaded once; unit tests cover token discovery, the permanent-vs-transient/gated classification, and the guided-flow state machine.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - download engine, token discovery, a UI auth step, live subprocess verification, and fail-closed reporting; re-confirm at implementation time.

### Sub-tasks

#### 2.1 - Hugging Face token discovery + silent use

**Objective**: Use an existing HF token automatically so gated opt-ins install with zero user action when a token is already present.

**Prompt**:
> Extend `engine/hf_weights_puller.py` (which already has `hf_token_from_env()` reading `HF_TOKEN`/`HUGGING_FACE_HUB_TOKEN` and sends `Authorization: Bearer` when present, from v1.13). Add token DISCOVERY beyond env vars: read the Hugging Face CLI cached token (the `huggingface_hub` default at `~/.cache/huggingface/token`, and the newer `hf` location if present) and the installer's own config store, in a documented precedence order. Never require a token for public models, never log it, and mask it in any diagnostic output. When a `gated:true` model is pulled and a token is discovered, attempt the authenticated download silently. Acceptance: with a valid token in any supported location, a gated opt-in downloads without prompting; with no token, public models are unaffected; unit tests cover each discovery source and the masking.

---

#### 2.2 - Guided license/token step for genuinely-gated opt-ins (last resort)

**Objective**: When a user opts into a genuinely-gated model and no token is available, guide them through a one-time free HF login + license acceptance + token entry - never a silent skip.

**Prompt**:
> Add a guided-auth path for models flagged `gated:true` + `requiresLicense:true`. Trigger it only when such a model is SELECTED and no token was discovered (2.1). Design (installer wizard, PyQt): a clear step/dialog that (a) explains the model is open-weight but requires a free Hugging Face account and a one-time license acceptance, (b) opens the model's license URL (from the catalog entry) in the browser, (c) provides a field to paste a free read token, (d) validates the token against the gated repo (authenticated HEAD on the resolve URL - expect 200/302, not 401), and (e) stores it in the installer config for the rest of the run and offers to persist it to the HF cache for future use. Be honest in the copy: the installer cannot accept the license on the user's behalf. If the user declines, do not offer/queue that model for install (so nothing that would fail is ever queued). Auto-handle everything that can be auto-handled (token reuse, re-point) so this step appears for the minimum set of models. Acceptance: selecting a gated opt-in with no token shows the guided step and, on a valid token + accepted license, the model downloads; declining cleanly removes it from the install queue; the default set never triggers this step.

---

#### 2.3 - Offered-set install guarantee: live per-tier preflight gate + reachability

**Objective**: Prove that everything offered installs, by running the preflight for real and gating on it - closing v1.13 IR.P1.A / IR.P2.A.

**Prompt**:
> Using the v1.13 preflight harness (`engine/model_preflight.py`, `nexus-installer --preflight [TIER]` / `--reachability`), run it LIVE this cycle on the installed Ollama 0.24.0 (>= the 0.22.0 Gemma-4 floor): (a) `--reachability` across the whole RETAINED catalog - assert every retained selectable model is ok (public 200/302) or gated-with-a-token-path, and zero dead refs; (b) `--preflight 12` and `--preflight 16` - pull + minimal load smoke for every default in those tiers, confirming `gemma4:12b` (and the rest) pull AND load. Capture the outputs into `docs/v1/v1.14/development/` as the live evidence for the closed gaps. If any offered model fails, fix its source (back to Phase 1) or its handling (2.1/2.2) until the offered set is 100% installable - the offered set is defined as "what the picker can present as selectable for the detected tier", and the gate is that all of it installs. Also add a small `scripts/installer/README.md` usage section for `--preflight`/`--reachability` (closes IR.P2.B). Acceptance: recorded live PASS for the 12/16 GB defaults; recorded reachability report with no dead refs; the run is idempotent (skips already-present+verified).

---

#### 2.4 - Rotate real SHA-256 pins for downloaded defaults

**Objective**: Replace placeholder all-zero pins with real digests now that a live download exists - closing v1.13 IR.P1.B and clearing the build's placeholder-pin warning.

**Prompt**:
> After the live preflight (2.3) has downloaded the default HF weight models (e.g. `wan2.1-t2v-1.3b` and any other placeholder-pinned defaults), rotate their real SHA-256 digests into `catalog.json` using `scripts/installer/build/pin-hf-weights.py`. Enforce pins fail-closed in the puller (delete-on-mismatch, already present) and ensure the build's `pin-check.log` no longer warns for DEFAULT models (opt-in models that were not downloaded may remain documented deferrals). Update the `_meta.comment` pin note. Acceptance: default HF weight models carry real (non-zero) sha256 pins; `build-windows.ps1` reports no placeholder-pin warning for defaults; a deliberately corrupted file fails closed in a unit test.

---

#### 2.5 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase; iterate until stable before Phase 3.

**Prompt**:
> Generate tests for Phase 2: (a) token discovery precedence + masking (env, HF cache, installer config), mocked filesystem; (b) permanent-vs-transient + gated classification (401/403/404 permanent no-retry, 5xx transient) - regression-guard the v1.13 behavior; (c) the guided-auth state machine - selected gated model + no token -> step shown; valid token -> queued; declined -> removed from queue; default set -> step never shown; (d) pin fail-closed on mismatch. Mock all network/subprocess in unit tests. The live preflight (2.3) is operator-run evidence, not a CI unit test (its CI leg stays freeze-deferred per IR.P1.E; keep the reachability job on `installer-smoke.yml`). Run the installer pytest + root vitest, fix, iterate to green, update/optimize CI. Do not proceed until stable. After green, run `/generate-session-history` to document Phase 2.

---

## Phase 3: Models-page collapse, sort, disable, and release-date pill

**Goal**: The Models page presents one best-fitting variant per family (pre-selected, at the top), hides smaller/redundant fitting variants, shows larger hardware-incompatible tiers as clearly grayed-out disabled rows at the bottom, and renders each model's release date as a pill.
**Prerequisites**: Phase 1 (Phase 2 not required for rendering).
**Stability Gate**: For a given detected VRAM, each family renders exactly one enabled best-fit row (the largest variant whose `vramGB` <= host VRAM), pre-selected per `recommended.json`; smaller fitting variants of that family are not shown; larger variants (and families with no fitting variant) render disabled/grayed at the bottom, readable but not selectable; every card shows a `releaseDate` pill alongside the existing characteristic pills; the section validation/skip flow still works.
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - VRAM-aware collapse + sort + disable logic interacting with selection state in `pages/typed_catalog.py`; re-confirm at implementation time.

### Sub-tasks

#### 3.1 - VRAM-aware best-of-family collapse

**Objective**: Replace the flat per-section listing with a per-family collapse driven by detected VRAM.

**Prompt**:
> In `pages/typed_catalog.py`, add a per-family collapse over the section's models given the detected host VRAM (and GPU vendor). For each `family` in the section: compute `best_fit` = the variant with the greatest `vramGB` that is still <= host VRAM. Render only `best_fit` as the enabled, selectable row (pre-selected if it is the tier default). Do NOT render smaller-than-best-fit fitting variants of the same family (they are superseded by best_fit for this machine). Render every variant whose `vramGB` > host VRAM as a disabled/grayed row. If a family has NO fitting variant (smallest > host VRAM), render its smallest variant as a disabled/grayed row so the family still appears. This supersedes the v1.13 flat VRAM-ascending sort within a section. Keep the existing category-decided / skip semantics working on the collapsed set. Acceptance: on a 16 GB machine the Gemma family shows one enabled row (12B) with 26B/31B grayed below and e2b/e4b hidden; on a 4 GB machine it shows e2b enabled with the larger tiers grayed; unit tests cover best-fit selection, the hidden-smaller rule, the all-incompatible fallback, and vendor handling.

---

#### 3.2 - Sort order: recommended/best first, incompatible last; clear disabled styling

**Objective**: Order and style rows so the best choice is unmistakable and incompatible ones are obviously non-selectable.

**Prompt**:
> Order each section: the pre-selected recommended best-fit row(s) first, then any other enabled best-fit rows, then a visual divider, then the disabled/grayed incompatible rows at the bottom. Strengthen the disabled styling so it reads clearly as "not selectable on your hardware" - dim the whole card (reduced opacity/desaturated), keep text legible (meets contrast), disable the checkbox, and add a short reason chip (e.g. "Needs 22 GB VRAM"). Reuse/extend the v1.13 over-budget dimming rather than duplicating it. Acceptance: the recommended row is visually first and pre-checked; incompatible rows are grayed, non-interactive, readable, and labeled with the VRAM reason; a divider separates compatible from incompatible.

---

#### 3.3 - Release-date pill on every card

**Objective**: Surface `releaseDate` as a first-class characteristic pill.

**Prompt**:
> Render each model's `releaseDate` as a pill in the card's characteristic-pill row (alongside Origin / license / Agentic / Uncensored etc.), formatted human-readably (e.g. "Released May 2026" or "2026-05-01" per the existing pill style). Remove the release date from wherever it currently appears inline in the card title/name so it is not duplicated. If a model somehow lacks `releaseDate` (should not happen after Phase 1.2), omit the pill gracefully. Acceptance: every card shows exactly one release-date pill in the pill row and no date in the title; the pill matches the existing pill visual system.

---

#### 3.4 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase; iterate until stable before Phase 4.

**Prompt**:
> Generate Qt tests (using the `qt_app` offscreen fixture + `.grab()` where needed) covering: best-of-family collapse across representative VRAM values (4/8/12/16/24 GB) for multi-tier families; the hidden-smaller and all-incompatible-fallback rules; sort order (recommended first, incompatible last) and the divider; disabled rows are non-selectable, readable, and carry the VRAM reason chip; the release-date pill renders once per card and is gone from the title; category-decided/skip still works on the collapsed set. Update the v1.13 tests that asserted the flat VRAM-ascending order to the new collapse model. Run the installer pytest, fix, iterate to green, update/optimize CI. Do not proceed until stable. After green, run `/generate-session-history` to document Phase 3.

---

## Phase 4: Installing-page polish - uniform dependency rows, button margins, footer Cancel

**Goal**: The Installing page has no dead space in the Dependencies section, the View Logs button does not touch the section outline, and Cancel lives on the install footer row during the run and disappears when the install completes.
**Prerequisites**: None (independent UI; can follow Phase 3).
**Stability Gate**: The Dependencies section rows use the same uniform bar grid as the model rows (no wide empty gap right of the bars); the View Logs button has visible inner margins on its left and bottom edges; during install a Cancel control sits on the same footer row as the primary action, and on completion Cancel is removed (no lingering grayed button), leaving only the forward action.
**Recommended model**: Strong reasoning tier (Opus 4.8), medium effort - contained Qt layout + wizard footer state in `widgets/phase_group.py`, `pages/installing.py`, `window.py`, and the footer.

### Sub-tasks

#### 4.1 - Uniform dependency-row grid (remove right-side dead space)

**Objective**: Make the Dependencies section rows lay out like the model rows so the bar column does not over-stretch.

**Prompt**:
> On the Installing page, the Dependencies section rows (e.g. "Ollama runtime", "Python environment") leave a wide empty gap between the end of the progress bar and the "Done" status, because they do not use the shared uniform-bar grid the model rows use (v1.13 `_make_row_grid` in `widgets/phase_group.py`). Route the dependency rows (and any other section whose rows lack a middle metric column) through the same grid so the bar + optional metric + status columns align and the bar does not stretch into dead space. If dependency rows genuinely have no middle metric, size the columns so the bar ends where the model bars end (consistent right edge) rather than filling the row. Acceptance: the Dependencies bars have no wide empty gap on their right and align with the Models section bars; a Qt test asserts consistent bar geometry across sections.

---

#### 4.2 - View Logs button inner margins

**Objective**: Keep the View Logs button off the section outline.

**Prompt**:
> Add inner margins around the "View Logs" button (and the analogous log/detail buttons) so its left and bottom edges do not touch the section's outline/border. Adjust the section container's content margins or the button's layout margins (do not just move the button). Keep it visually consistent with the v1.13 pill button system. Acceptance: the View Logs button has a clear gap from the section border on all touching edges; a Qt geometry test asserts the margin.

---

#### 4.3 - Cancel on the install footer row; remove on completion

**Objective**: Fix the lingering grayed Cancel button; make Cancel part of the install action row and transient.

**Prompt**:
> Screenshot 4 shows a grayed-out "Cancel" button lingering in the bottom-right after the install finished. Move Cancel onto the wizard footer row alongside the primary action so that DURING the install the row shows the install/cancel controls together, and ON completion Cancel is removed entirely (not just disabled), leaving only the forward ("Next"/"Complete") action. Wire this to the installing page's running/finished state (`started`/`finished` signals + the window's `_install_active`) so Cancel's visibility tracks the run. Ensure cancel actually aborts the in-flight install when clicked mid-run (or, if abort is out of scope, that it is only shown when it can act - never as an inert grayed control post-completion). Acceptance: Cancel is visible only while the install is running, on the footer row; it is gone (removed) on completion; no grayed lingering button remains; a shell-navigation test asserts Cancel visibility across running -> finished.

---

#### 4.4 - Testing and Stabilization

**Objective**: Generate and run all tests for this phase; iterate until stable before Phase 5.

**Prompt**:
> Generate Qt tests covering: dependency-row bar geometry matches the model-row grid (no dead space); the View Logs button margin from the section border; Cancel visibility across the install lifecycle (hidden pre-install, shown on the footer row during install, removed on completion) and that no inert grayed Cancel persists. Reuse the `qt_app` fixture and the existing `test_phase6_shell.py` / `test_phase_group.py` patterns. Run the installer pytest, fix, iterate to green, update/optimize CI. Do not proceed until stable. After green, run `/generate-session-history` to document Phase 4.

---

## Phase 5: Architecture Refactor, Known-Gaps Reconciliation, and CI/CD

**Goal**: The repository layout is clean after the cycle's changes, the v1.13 and v1.14 known gaps are reconciled, CI/CD covers every change and is optimized, and release-readiness is handed to `/update release`.
**Prerequisites**: Phases 1-4.
**Stability Gate**: All static gates green (tsc build, lint, check-architecture 0 errors, check:tampering, security:check in sync); full installer pytest + root + desktop suites green (pre-existing/ENV flakes documented, not regressions); no deprecated files, empty dirs, duplicates, or orphans introduced; `docs/v1/v1.14/` is canonical; every v1.14 gap is recorded; release handed off (not auto-tagged).
**Recommended model**: Strong reasoning tier (Opus 4.8), high effort - repo-wide refactor + reference repair is inherently high-risk.

### Sub-tasks

#### 5.1 - Architecture refactor + reference repair

**Objective**: Verify the cycle's new/changed files sit in the correct trees with no drift.

**Prompt**:
> Audit the files touched/added this cycle (catalog + registry, `hf_weights_puller.py`, the new guided-auth UI, `typed_catalog.py`, `phase_group.py`/`installing.py`/`window.py`/footer, tests, `scripts/installer/README.md`). Confirm correct placement; remove any deprecated files, empty dirs, duplicates, or orphans; repair any moved references; ensure no stray `TODO`/`FIXME`/`# DEVIATION` markers remain in changed code. Keep `docs/v1/v1.14/` canonical (`plans/`, `known-gaps.md`, `development/history/`). Acceptance: `npm run check-architecture` shows 0 errors (pre-existing warnings documented); no orphaned or duplicated files from this cycle.

---

#### 5.2 - Known-gaps reconciliation (v1.13 carry-forward + v1.14 new)

**Objective**: Close the v1.13 gaps this cycle resolved and record v1.14's remaining gaps.

**Prompt**:
> Create `docs/v1/v1.14/known-gaps.md` (same format as v1.13). Reconcile v1.13 carry-forwards: mark IR.P1.A, IR.P1.C, IR.P2.A as RESOLVED (live preflight + gated remediation + auth flow this cycle) with the recorded evidence; note IR.P1.B (pin rotation) resolved for defaults, deferred for un-downloaded opt-ins; keep IR.P1.E freeze-deferred (the pull+load CI leg) and IR.P3.A/IR.P4.A/IR.P5.A (on-device visual QA + icon polish) carried forward. Record new v1.14 gaps (e.g. any opt-in retained-gated model whose guided flow was not live-exercised end-to-end; any pin still deferred; on-device QA of the new collapse/sort/pill and the installing-page polish). Use the `NI/DF/BG/MT/WN/QG` classes and a summary. Acceptance: every deferral this cycle is captured with a reason and a next step; resolved v1.13 gaps are marked with evidence.

---

#### 5.3 - CI/CD coverage + optimization

**Objective**: Ensure CI covers all v1.14 changes and stays freeze-safe and efficient.

**Prompt**:
> Verify the installer pytest CI job auto-covers the new test files; confirm the `installer-smoke.yml` reachability job still runs (dispatch/monthly cron) and covers the curated catalog; keep the live pull+load preflight leg freeze-deferred (IR.P1.E) with a documented note. Ensure path filters route registry/installer-only changes away from the full matrix, concurrency cancels in-progress, and caching is in place. Acceptance: CI covers the catalog + engine + UI changes; no new job needed beyond what exists, or the minimum added; the Actions-budget freeze is respected.

---

#### 5.4 - Release readiness (hand off to `/update release`)

**Objective**: Run the final documentation + release flow without auto-tagging.

**Prompt**:
> Resolve remaining known gaps and confirm tests + CI readiness, then hand the documentation cleanup, standard update checks, and the version bump / changelog / tag / push to `/update release` (which runs docs + devlog + gitignore + version via `scripts/check_version_sync.py` + changelog + refactor, then commits, tags, and pushes as one flow, keeping its own confirmation gates). Do NOT create a tag or push automatically. Note the GitHub Actions budget freeze (until ~2026-08-01) still blocks the tag-triggered binary build (`release.yml`); the local release cut mirrors v2.2.0/v2.3.0. Acceptance: the repo is release-ready; the release is handed to `/update release`; nothing is auto-tagged/pushed.

---

## Notes

- **Milestone vs release track**: this is milestone **v1.14.0**. The release-track version (git tag / `package.json`) is decided at `/update release` time (v2.3.0 -> next), consistent with the v1.x-milestone / v2.x-release mapping.
- **Scope boundary**: installer + catalog only. The desktop app and VSIX are not implicated by any item this cycle (the wordmark, the only prior desktop-touching item, shipped in v1.13).
- **Stale-log note**: the user's attached `nexus-install-models-log.txt` is from a pre-v1.13 installer (it shows the old `hf.co/unsloth` Gemma routing that the current catalog no longer uses, and `gemma4:12b` resolves live). The freshly built `dist/NexusSetup.exe` already routes Gemma 4 correctly; the reliability work here is about the *offered opt-in* set and a *live* proof, not re-fixing the stale-log symptoms.

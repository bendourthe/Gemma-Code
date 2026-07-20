# Session History - v1.14.0 Phase 2: HF auth flow + live reachability + install-reliability closure

**Date**: 2026-07-19
**Plan**: [../../plans/installer-catalog-curation-and-reliability.md](../../plans/installer-catalog-curation-and-reliability.md)
**Phase**: 2 of 5 - "Install-reliability closure: HF auth flow, live preflight gate, pin rotation"
**Outcome**: Complete. GO/NO-GO gate passed (0 test failures, 0 lint errors, new modules 93-100% covered, build unaffected).

## Goal

Make every offered model install, never silently fail: auto-use a token the user already has, guide them through a one-time license/token step otherwise, and prove the offered set is reachable.

## What was done

### 2.1 - HF token discovery (`engine/hf_auth.py`, new)

- `discover_hf_token(state)` resolves a token in precedence order: `InstallerState.hf_token` -> env (`HF_TOKEN`, `HUGGING_FACE_HUB_TOKEN`) -> HF CLI cache (`$HF_TOKEN_PATH` / `$HF_HOME/token` / `~/.cache/huggingface/token`).
- `mask_token` (log/UI-safe), `validate_token_for_repo` (authenticated model-info check), `hf_cache_token_path` / `hf_token_from_cache`.
- `hf_weights_puller.install_model` now calls `discover_hf_token(state)`; `hf_token_from_env` moved to `hf_auth` and re-exported from the puller for back-compat. `InstallerState` gained `hf_token`.

### 2.2 - Guided license/token step (`widgets/gated_auth_dialog.py` + `engine/gated_auth.py`, new)

- `GatedAuthDialog`: explains the free one-time steps, opens the model's license page, takes a read token, validates it against the repo, accepts on success. Honest that the installer cannot accept the license on the user's behalf.
- `ensure_gated_auth(state, catalog, prompt)` (UI-independent): for each selected gated model, if a token is available it is covered with no prompt; otherwise `prompt` is shown; an entered token unlocks the rest; a decline removes the model from `selected_model_ids` and records it skipped.
- Wired into `pages/installing.py` `start_installation` before the engine reads the selection (`_resolve_gated_auth`).

### 2.3 - Live reachability + README

- Ran `probe_catalog()` LIVE: **0 dead / 0 unknown**; 32 OK (incl. `sd1.5` now resolving via the Phase 1 mirror re-point); 6 GATED (3 offered opt-ins + 3 auxiliary ControlNets). Evidence: `../reachability-2026-07-19.md`.
- Added `scripts/installer/README.md` documenting `--reachability` / `--preflight` and the gated-model flow (closes v1.13 IR.P2.B).

### 2.4 - Pin rotation (deferred)

- Real `sha256` rotation needs the multi-GB download from the operator preflight (ICR.P2.A); deferred as ICR.P2.C. The placeholder-warn path is unchanged and safe.

### 2.5 - Tests

- `test_hf_auth.py`, `test_gated_auth.py`, `test_gated_auth_dialog.py`, and an installing-page wiring test in `test_pages_qt.py`. Made the puller gated-skip test hermetic against the HF cache (`HF_HOME` isolation).

## Test results

- Full installer pytest: green (0 failures).
- Coverage: `hf_auth` 100%, `gated_auth` 100%, `installer_state` 100%, `gated_auth_dialog` 93%, `hf_weights_puller` 94%; `installing.py` 77% overall (pre-existing untested UI; the new `_resolve_gated_auth` wiring is exercised).

## Deviations

- None new. (Phase 1's ICR.P1.A retention decision stands; the guided flow this phase is what makes it installable.)

## Deferred / operator

- The live pull+load preflight for the 12/16-tier defaults (~43 GB) and pin rotation are operator actions on a target box (ICR.P2.A / ICR.P2.C), same freeze/hardware deferral as IR.P2.A. The cheap reachability leg was run live this cycle.

## Next

Phase 3 - Models-page collapse, sort, disable, and the release-date pill (render-time best-of-family collapse over the Phase 1 catalog data).

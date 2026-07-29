# Session History - v1.15.0 Phase 3: Installer download reliability + gated-token UX

**Date**: 2026-07-28
**Plan**: [../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)
**Phase**: 3 of 8 - "Installer Download Reliability + Gated-Token UX (Issue 2)"
**Outcome**: Complete. Quality gate GO (full installer pytest green, ruff clean, all new modules mypy-strict clean, 0 new type errors).

## Goal

Fix Issue 2 - "models fail to download" - at its real roots. The two failures in the user's log (Gemma HTTP 400 from a broken Unsloth GGUF Ollama pull target; SANA int4 HTTP 401 from an unflagged access-gated repo) were **already fixed** in the current `core/registry/catalog.json`; the user had run a build predating the fix. So the work is (a) guarantee the shipped installer can never carry a stale/regressed catalog, (b) make the gated-model token flow clear and skippable for non-technical users, and (c) give a plain-language post-install summary with a retry for failed downloads.

## What was done

### 3.1 - Catalog stays current (build + CI guard)

- New `nexus_installer.catalog_invariants.validate_catalog` (pure): encodes the v1.13/v1.14 fixes as invariants - no model may use the known-broken `unsloth/gemma-4-12b-it-GGUF` Ollama reference; `requiresLicense` implies `gated`; a gated model must carry a reason/URL; and known access-gated ids (e.g. `sana-1.6b-int4`) must stay flagged.
- `build/check-catalog.py`: CLI wrapper (exit 1 on any violation) for ad-hoc/build runs.
- `build/nexus-installer.spec`: now FAILS CLOSED - a missing `catalog.json`, or one that violates the invariants, aborts the build (was silently skipped).
- `test_catalog_invariants.py`: runs the invariants in the installer pytest CI job (the always-on gate) + the direct Gemma/SANA regression checks.
- **Deviation**: the plan's "hash compare bundled vs repo" is implemented as a content-invariant guard - the spec bundles the catalog straight from the repo, so a literal hash compare is a no-op; the invariant guard catches a *regressed* catalog, which is what actually shipped the defects. Tracked as a note under IRSC.P3.

### 3.2 - Gated-model token UX

- `widgets/gated_auth_dialog.py`: plainer copy (explains what "gated" means, that it needs a free HF account + token, and that Skip omits only that one model and continues), plus a direct "Open Hugging Face token settings" button (`https://huggingface.co/settings/tokens`). The validate-before-queue and decline-removes-from-queue logic already existed (v1.14) and is unchanged.

### 3.3 - Post-install summary + retry

- New `engine/install_summary.py` (pure): `humanize_reason` maps raw errors (400/401/403/404/network) to one plain sentence; `summarize_install` buckets models into succeeded / skipped-needs-token / failed-with-reason and lists `retryable_ids`; `prepare_model_retry` narrows the selection to the failed ids and marks the non-model steps `completed` so a re-run executes only the model step (reusing the engine resume path).
- `InstallerState`: added `model_failures` (id -> raw reason) and `gated_skipped` (declined-for-token ids).
- `pages/installing.py`: stores the raw reason on model failure; records gated declines into `gated_skipped`; new `retry_models()` re-entry.
- `pages/complete.py`: the summary drives a plain-language callout (no raw "Error: 400"); a "Retry failed downloads" button (`retry_requested` signal) appears only when there are retryable failures (a gated skip needs a token, not a retry).
- `main.py`: wires `CompletePage.retry_requested` -> `installing_page.retry_models()` -> reveal the installing page.

## Test results

- Full installer pytest suite: green (3 pre-existing skips, 0 failures). New: `test_catalog_invariants.py` (10), `test_install_summary.py` (14), `test_gated_auth_dialog.py` (+1 token button), `test_pages_qt.py::TestCompletePage` (+4 retry surface).
- ruff: clean on all changed files. mypy: new modules (`catalog_invariants`, `install_summary`, `installer_state`) strict-clean; a HEAD-baseline stash confirmed the 7 mypy errors in the edited Qt/entry files are all pre-existing - this phase added 0 new type errors.
- `check-catalog.py` against the repo catalog: OK (38 models).

## CI/CD

- No new job. `test_catalog_invariants.py` runs in the existing installer pytest job (`ci.yml`), and the spec fail-closed assertion gates the build; together they cover the catalog guard. Installer CI already has concurrency + caching.

## Deviations / known gaps

- IRSC.P3.A (MT): the retry re-entry has unit-level (state-prep) + UI-signal coverage but no end-to-end Qt/thread integration test - folds into on-device QA.
- IRSC.P3.B (WN): pre-existing installer mypy-strict violations surfaced, left out of scope.
- IRSC.P3.C (DF): the fail-closed build behaviour is unit-verified, not exercised by a real PyInstaller build here.

## Next steps

- Phase 4: Real model registry - IPC + disk/Ollama reconciliation (Issue 3), which also unblocks the studio model selectors (Phases 5-6).

# Last-phase evidence: v2.2.7

**Date**: 2026-08-24
**Plan**: `docs/v2/v2.2/plans/v2.2.7-context-meter-and-transcript-chrome.md`
**Release handoff**: not run (`/update release` withheld unless asked). Package.json not bumped (root remains 2.1.0 in the lock; desktop 1.5.0; `tauri.conf.json` still 2.2.5).

## Architecture refactor

Deleted unused `desktop/src/modules/chat/Breadcrumb.tsx` after ChatPage stopped importing it (Phase 3). Tests already assert `chat-breadcrumb` is null. Updated the v2.2.8 plan grounding line that still said the header slash was present. No empty tracked directories. `core/**` still does not import `modules/**` (root dep-cruiser file passed in `npm run test`).

## Known-gaps

`docs/v2/v2.2/known-gaps.md` section v2.2.7 keeps DF-28 (packaged Settings/installer chips), DF-29 (live Ollama usage/thinking), DF-30 (packaged meter/80% CTA), DF-31 (packaged transcript chrome), WN-7 (TS/Python chip formatters). DF-2 and DF-4 remain from earlier cycles. No live GPU this cycle. not_observed != absent.

## CI/CD

`.github/workflows/ci.yml` already has concurrency `cancel-in-progress: true`. Desktop vitest (Node 22) comments name Settings chips, usage persist, ContextUsageBar 79/80, picker row, and MessageList day/time/tokens. `.github/workflows/installer-tests.yml` comments name installer `<val>k` chips. No new jobs. No live GPU. This repo has one Python installer plus Tauri NSIS; there is no `scripts/check_installer_parity.py` (Nexus-Hub dual-installer gate is a silent no-op here).

## Installer parity

`core/registry/contextWindow.ts` tests and `scripts/installer/tests/test_typed_catalog.py` both lock `<val>k` / omit-on-null / no trailing `in`. Dual formatters remain WN-7.

## Goal-vs-codebase

Catalog chips, session token persist, four-tab meter (or hidden bar), 80% new-session without wiping, no header slash/gear, date/time/tokens on shared MessageList used by all four modes. Packaged Explorer and live Ollama remain not_observed (DF-28 through DF-31, DF-2, DF-4).

## Full-suite testing

Quoted:

- `npm run test:shell` (desktop vitest): Test Files 175 passed (175); Tests 1506 passed (1506).
- `npm run test` (root vitest, `configs/vitest.config.ts`): Test Files 522 passed | 3 skipped (525); Tests 5481 passed | 12 skipped (5493).
- Installer `uv run pytest tests/test_typed_catalog.py -q` from `scripts/installer`: passed in this cycle (Phase 1 lock; not re-failed in Phase 5).

## Human testing suggestions

Operator field checklist in the v2.2.7 plan: Settings chips, installer chips, Chatbot meter plus 80% CTA that leaves the old chat, four-tab picker row, transcript date/time/tokens. Unsigned Windows installer is for that pass. Do not treat this file as a release tag.

## Unsigned installer rebuild

`npm run build:shell` (`tauri build` from `@nexus/desktop`) exited 0 in 267886 ms. Bundles:

- `desktop/src-tauri/target/release/bundle/nsis/Nexus AI Studio_2.2.5_x64-setup.exe`
- `desktop/src-tauri/target/release/bundle/msi/Nexus AI Studio_2.2.5_x64_en-US.msi`

Unsigned. Product version in `tauri.conf.json` remains 2.2.5 (do not bump unless asked). Artifacts stay untracked under `desktop/src-tauri/target/`.

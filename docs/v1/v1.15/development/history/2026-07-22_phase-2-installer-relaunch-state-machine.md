# Session History - v1.15.0 Phase 2: Installer relaunch state machine

**Date**: 2026-07-22
**Plan**: [../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](../../plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)
**Phase**: 2 of 8 - "Installer Relaunch State Machine (Issue 1)"
**Outcome**: Complete. Quality gate GO (0 test failures, ruff 0 errors, changed logic mypy-clean; 1 pre-existing mypy error recorded as IRSC.P2.A).

## Goal

Fix Issue 1: a fresh double-click of the installer opened on the "Installation Complete" page (even after uninstalling) instead of Welcome, because a terminal `state.json` was never cleared.

## Root cause (from Phase 1 investigation, re-verified)

A successful install writes `%LOCALAPPDATA%\NexusInstaller\state.json` with `status:"completed"`. `interpret_startup` mapped any cold-launch terminal (`completed`/`failed`) state to `DECISION_SHOW_COMPLETE`, so every later launch jumped to the Complete page. Nothing deleted the file (not Finish, not the uninstaller).

## What was done

### 2.1 - Clear terminal state on acknowledgement

- Added `state_store.clear_state(path)` - a best-effort, never-raising delete of the state file (`background/state_store.py`).
- `CompletePage.on_finish()` (`pages/complete.py`) now calls it, so clicking Finish drops the state; a later cold launch has no state -> Welcome.
- `main.py` clears the state right after a one-time SHOW_COMPLETE view applies its results, so even the crash-recovery outcome view does not linger.

### 2.2 - Cold terminal state -> Welcome

- `interpret_startup` (`background/resume.py`) now returns `DECISION_FRESH` for a cold-launch `completed`/`failed` state (was `DECISION_SHOW_COMPLETE`). The in-session tray reattach is a different path (`signal_running_instance` -> `DECISION_FORWARD`, or the tray reopens the window), so it is unaffected. `plan_startup`'s "interrupted-but-all-steps-done -> show-complete" crash-recovery promotion is preserved, so `DECISION_SHOW_COMPLETE` stays reachable.

### 2.3 - Uninstaller clears installer state

- Both NSIS uninstallers (`legacy/nexus-setup.nsi`, `legacy/setup.nsi`) now `RMDir /r "$LOCALAPPDATA\NexusInstaller"`, so a reinstall after uninstall starts fresh.

## Test results

- `tests/test_background_resume.py`: updated the two `interpret_startup` terminal-state tests and the `plan_startup` completed test to expect `DECISION_FRESH`; kept the interrupted-all-done -> SHOW_COMPLETE promotion test; added `TestClearState` (removes an existing file, no-op on absent file, and end-to-end clear -> reload None -> FRESH).
- Full installer pytest suite: green (3 pre-existing skips, 0 failures). ruff: clean on all changed files. mypy: the changed logic files (`state_store.py`, `resume.py`) are clean; `complete.py` has only the pre-existing `deleteLater` error (IRSC.P2.A), no new errors from this phase.

## CI/CD

- No change. The installer pytest job (`ci.yml`) auto-covers the new/updated tests; installer build/smoke jobs (`installer-build.yml`, `installer-smoke.yml`) are unaffected by the one-line NSIS additions. Installer CI already has concurrency cancel-in-progress + caching (per-workflow path filters remain the freeze-deferred optimization noted in v1.14).

## Deviations

- Did not fix the pre-existing `complete.py:203` mypy error (IRSC.P2.A) - out of scope (untouched code; verified pre-existing by stashing this phase's edits).
- Chose `DECISION_FRESH` for cold terminal states (the plan's primary directive) over a freshness/acknowledged-flag gate; simpler and deterministic, and the reopen-shows-results case is still served in-session by the reattach path.

## Next steps

- Phase 3: Installer download reliability + gated-token UX (Issue 2) - guarantee the shipped installer carries the current fixed catalog and smooth the gated-model HF-token flow + post-install verify/retry.

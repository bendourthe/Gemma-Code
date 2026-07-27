# Known Gaps - v1.15.0 (Installer, Registry, Window, and Studio-Chat Fixes)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)

## v1.15.0

### Open Items (Phase 1)

_No open items._ Phase 1 (desktop shell: window controls + open maximized) introduced no deviations, skipped tests, coverage gaps, suppressed warnings, or bypassed gates.

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| (none) | | Phase 1 | | | |

### Open Items (Phase 2)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IRSC.P2.A | WN | Phase 2 | `pages/complete.py:203` trips mypy strict (`Item "None" of "QWidget | None" has no attribute "deleteLater"`) in the services-list rebuild loop | Pre-existing on HEAD (verified by stashing this phase's edits and re-running mypy -- the error is at the same untouched loop); out of scope per the change-scope rule (my edits only added an import and the `on_finish` state-clear call, both type-clean) | Guard with `w = item.widget()` + `if w is not None: w.deleteLater()` in a dedicated cleanup pass |
| IRSC.P2.B | MT | Phase 2 | The two `state_store.clear_state` call sites -- `CompletePage.on_finish()` and the `main.py` SHOW_COMPLETE branch -- have no direct unit test | Both are thin one-line Qt / entry-point glue over the fully-unit-tested `clear_state` helper; the pure behaviour (clear -> reload None -> `interpret_startup` FRESH) is covered by `TestClearState` | Add a Qt offscreen test asserting `on_finish` clears the state file during the next Qt/on-device test pass |
| IRSC.P2.C | DF | Phase 2 | The NSIS uninstaller additions (`RMDir /r "$LOCALAPPDATA\NexusInstaller"`) are verified by inspection, not by a NSIS build | No NSIS compiler in this environment; the change is a one-line addition mirrored in both `legacy/nexus-setup.nsi` and `legacy/setup.nsi` | Confirm during the next on-device installer/uninstaller QA pass |

### Summary

- Open: Phase 1 = 0; Phase 2 = 3 (IRSC.P2.A pre-existing mypy WN, IRSC.P2.B two call-site MT, IRSC.P2.C NSI verify-by-inspection).
- Resolved so far:
  - Phase 1 (Issue 4) -- the custom title bar's window controls are un-buried (gave `.nexus-titlebar` its own stacking context above the opaque backdrop) and the window opens maximized while staying resizable.
  - Phase 2 (Issue 1) -- a normally completed/failed run no longer redirects a cold relaunch to the Complete page: `interpret_startup` routes cold terminal states to `DECISION_FRESH` (Welcome); `CompletePage.on_finish()` and the one-time SHOW_COMPLETE reopen both clear the persisted state via `state_store.clear_state`; and both NSIS uninstallers now remove `%LOCALAPPDATA%\NexusInstaller`. The crash-recovery "interrupted-but-all-done -> show-complete" promotion is preserved.
- Note: on-device visual confirmation of the maximized window/controls (Phase 1) and the uninstaller state-dir removal (Phase 2, IRSC.P2.C) fold into the standard on-device QA pass; the pure logic is unit-tested (`desktopBranding.test.ts`, `test_background_resume.py`).

_Last updated: 2026-07-22 (Phase 2)._

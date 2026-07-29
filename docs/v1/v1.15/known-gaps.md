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

### Open Items (Phase 3)

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| IRSC.P3.A | MT | Phase 3 | The model-only retry re-entry (`InstallingPage.retry_models` + the `main.py` `_retry_failed_models` wiring) has no end-to-end Qt/thread integration test | The pure retry-state prep (`prepare_model_retry`) and the Complete-page button surface (visibility rules + `retry_requested` emission) are unit-tested; a real retry needs a running engine thread + a failed download to reproduce | Exercise a live retry (fail a model, click "Retry failed downloads", confirm only that model re-downloads) during the next on-device installer QA pass |
| IRSC.P3.B | WN | Phase 3 | Pre-existing mypy-strict violations surfaced while editing (confirmed present at HEAD via a stash baseline, out of scope): `widgets/gated_auth_dialog.py` `entry: dict` bare type-args, `pages/installing.py` `request_cancel` QMessageBox StandardButton, `main.py:244/272/434` | Not on any line this phase changed; the change-scope rule keeps them out. This phase added 0 new mypy errors (new modules are strict-clean) | A dedicated installer strict-typing cleanup pass (fold in the Phase 2 `complete.py:203` item IRSC.P2.A) |
| IRSC.P3.C | DF | Phase 3 | The spec fail-closed assertion + catalog guard are verified by the pytest invariant test and `check-catalog.py`, not by an actual PyInstaller build in this environment | Building the frozen exe needs the Windows build toolchain / desktop payload; the invariant logic itself is fully unit-tested and runs in the installer pytest CI job | Confirm the fail-closed build behaviour on the next CI / on-device build |

Deviation note (Phase 3): the plan's 3.1 "hash compare the bundled catalog against the repo" was implemented as a **content-invariant regression guard** instead. The PyInstaller spec bundles `catalog.json` straight from the repo, so a literal bundle-vs-repo hash compare is a no-op; the invariant guard is higher-value (it fails when the catalog *regresses* to a broken shape, which is what actually shipped the v1.13/v1.14 defects).

### Summary

- Open: Phase 1 = 0; Phase 2 = 3 (IRSC.P2.A pre-existing mypy WN, IRSC.P2.B two call-site MT, IRSC.P2.C NSI verify-by-inspection); Phase 3 = 3 (IRSC.P3.A retry integration-test MT, IRSC.P3.B pre-existing mypy WN, IRSC.P3.C build-verify DF).
- Resolved so far:
  - Phase 1 (Issue 4) -- the custom title bar's window controls are un-buried (gave `.nexus-titlebar` its own stacking context above the opaque backdrop) and the window opens maximized while staying resizable.
  - Phase 2 (Issue 1) -- a normally completed/failed run no longer redirects a cold relaunch to the Complete page: `interpret_startup` routes cold terminal states to `DECISION_FRESH` (Welcome); `CompletePage.on_finish()` and the one-time SHOW_COMPLETE reopen both clear the persisted state via `state_store.clear_state`; and both NSIS uninstallers now remove `%LOCALAPPDATA%\NexusInstaller`. The crash-recovery "interrupted-but-all-done -> show-complete" promotion is preserved.
  - Phase 3 (Issue 2) -- a catalog content-invariant guard (`catalog_invariants` + `check-catalog.py` + fail-closed spec + `test_catalog_invariants`) stops a stale/regressed catalog shipping; the gated-model dialog gained plain-language copy + a direct token-settings link; and the Complete page now shows a plain-language per-model summary (succeeded / skipped-needs-token / failed-with-reason) plus a "Retry failed downloads" button that re-runs only the failed model ids via the engine resume path.
- Note: on-device confirmation of the maximized window/controls (Phase 1), the uninstaller state-dir removal (Phase 2, IRSC.P2.C), a live retry (Phase 3, IRSC.P3.A), and the fail-closed build (Phase 3, IRSC.P3.C) fold into the standard on-device QA pass; the pure logic is unit-tested (`desktopBranding.test.ts`, `test_background_resume.py`, `test_catalog_invariants.py`, `test_install_summary.py`, `test_gated_auth_dialog.py`, `test_pages_qt.py`).

_Last updated: 2026-07-28 (Phase 3)._

# Known Gaps - v1.15.0 (Installer, Registry, Window, and Studio-Chat Fixes)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.15.0-installer-registry-fixes-and-studio-chat.md](plans/v1.15.0-installer-registry-fixes-and-studio-chat.md)

## v1.15.0

### Open Items (Phase 1)

_No open items._ Phase 1 (desktop shell: window controls + open maximized) introduced no deviations, skipped tests, coverage gaps, suppressed warnings, or bypassed gates.

| ID | Class | Source phase | Item | Reason | Suggested next step |
|----|-------|--------------|------|--------|---------------------|
| (none) | | Phase 1 | | | |

### Summary

- Open: Phase 1 = 0.
- Resolved so far: Phase 1 (Issue 4) -- the custom title bar's window controls are un-buried (gave `.nexus-titlebar` its own stacking context above the opaque backdrop) and the window now opens maximized while staying resizable.
- Note: on-device visual confirmation that the maximized window + controls render correctly on a real display folds into the standard on-device QA pass (same pattern as the v1.14 installer visual-QA gaps); the logic is unit-tested via `desktopBranding.test.ts`.

_Last updated: 2026-07-22 (Phase 1)._

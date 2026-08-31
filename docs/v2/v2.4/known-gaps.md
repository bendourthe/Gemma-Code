# Known Gaps - v2.4

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-31

Per-version tracker of unfinished work, deferrals, and follow-ups. The next plan ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plans: [v2.4.0 adoption](plans/v2.4.0-adoption-unsloth-qwen38-gaussian-splatting.md), [v2.4.1 field reliability](plans/v2.4.1-field-reliability-chat-archives-models-workspaces.md), [v2.4.1 generation recovery](plans/v2.4.1-generation-recovery-and-ui-corrections.md), [v2.4.2 field UI and generation](plans/v2.4.2-field-ui-history-and-generation.md), [v2.4.3 field density](plans/v2.4.3-field-density-identity-and-runtime.md)

## v2.4.3

### Summary

| Category | Open | Resolved |
|---|---:|---:|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 0 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 4 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

Phases 1-4 are implemented locally. A packaged wizard screenshot of the two-column Configuration/Review pages and Unsloth lock on this 16 GB NVIDIA host is not observed here. Hairline pixels and dialog centering in a packaged window are not observed here. Thinking-pill glow containment in a packaged transcript is not proven in jsdom. Packaged Settings nowrap facts and icon colors are not observed here.

### Open Items

##### MT-1 - Packaged installer two-column layout and Unsloth lock are not observed

- **Source phase**: Phase 1 - Installer Two-Column Layout and Unsloth Lock
- **Plan reference**: [v2.4.3-field-density-identity-and-runtime.md](plans/v2.4.3-field-density-identity-and-runtime.md) T001 / 1.1
- **Reason**: Pytest proves two-column widgets, Unsloth disabled when Incompatible, Compatible after NVIDIA 16384 on showEvent, Review 16 GB, and the renamed time label. A packaged wizard run on this host is not recorded here.
- **Suggested next step**: Last-phase operator item (Configuration two columns and Unsloth Compatible on this 16 GB NVIDIA host).

##### MT-2 - Hairline pixels and delete-dialog centering are not proven in jsdom

- **Source phase**: Phase 2 - History Chrome, Selection, Titles, and Delete Overlay
- **Plan reference**: [v2.4.3-field-density-identity-and-runtime.md](plans/v2.4.3-field-density-identity-and-runtime.md) T007 / 2.1
- **Reason**: Tests assert the hairline node on `/images` (absent on Settings), New chat `onSelect`/`onOpenChat`, a pre-created Image title change, and `folder-tree-confirm-delete` as a child of `document.body`. jsdom does not layout a packaged window so the hairline's appearance and the dialog's visual center are not observed here.
- **Suggested next step**: Last-phase operator items (hairline under tabs; New chat selects empty; Image first prompt titles the row; delete dialog centered).

##### MT-3 - Thinking-pill glow pixel containment is not proven in jsdom

- **Source phase**: Phase 3 - Thinking Pill Geometry
- **Plan reference**: [v2.4.3-field-density-identity-and-runtime.md](plans/v2.4.3-field-density-identity-and-runtime.md) T013 / 3.1
- **Reason**: Tests pin min-width to `Searching...`, a 12 px left inset, and overflow visible on the pill host and chat pending row. jsdom does not layout a packaged transcript, so glow pixels vs the pane edge are not observed here. v2.4.2 MT-1 remains the prior-cycle statement of the same limit.
- **Suggested next step**: Last-phase operator item (thinking pill glow at 100% and 150% zoom).

##### MT-4 - Packaged Settings compact-card nowrap and icon colors are not observed

- **Source phase**: Phase 4 - Settings Models Compact Cards
- **Plan reference**: [v2.4.3-field-density-identity-and-runtime.md](plans/v2.4.3-field-density-identity-and-runtime.md) T016 / 4.1
- **Reason**: Tests pin a nowrap facts row without Company/License pills, pills inside Details, and green / red / blue action colors via inline style. A packaged Settings screenshot is not recorded here.
- **Suggested next step**: Last-phase operator item (Settings one facts line and icon colors).

## v2.4.2

### Summary

| Category | Open | Resolved |
|---|---:|---:|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 0 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 6 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

Phases 1-7 are implemented locally. Phase 7 recorded last-phase evidence and is waiting on T043 push/PR approval against `develop` ([PR 58](https://github.com/bendourthe/Nexus-AI/pull/58)). jsdom cannot prove thinking-pill pixel containment, a live overflow pane jumping to the latest turn, or two Settings cards filling a real viewport. Packaged img2img identity, empty-video fail-closed, and a live installer GPU/Unsloth/VS Code screenshot are not observed here. Operator items 1-9 remain Not observed (`not_observed != absent`).

### Open Items

##### MT-1 - Thinking-pill pixel containment is not proven in jsdom layout

- **Source phase**: Phase 1 - Sidebar History Host and Shared Chrome
- **Plan reference**: [v2.4.2-field-ui-history-and-generation.md](plans/v2.4.2-field-ui-history-and-generation.md) T005 / 1.5
- **Reason**: jsdom does not layout. The Phase 1 test asserts overflow visible, sibling pill chrome (so `border-radius: 999px` is not on the canvas host), and `rectFullyInside` with mocked boxes. A real `getBoundingClientRect()` crop cannot be observed here.
- **Suggested next step**: Phase 7 operator item 1 (thinking pill at 100% and 150% zoom) is the layout proof.

##### MT-2 - Composer stick-to-bottom is proven on a mocked scroller, not a live pane

- **Source phase**: Phase 2 - Transcript Honesty
- **Plan reference**: [v2.4.2-field-ui-history-and-generation.md](plans/v2.4.2-field-ui-history-and-generation.md) T009 / 2.1
- **Reason**: `useStickToBottom` tests assign `scrollHeight` / `clientHeight` and assert `stickNow` sets `scrollTop`. They do not layout Chat, Agents, Image, or Video overflow panes with real content height after send.
- **Suggested next step**: Phase 7 operator send on each of the four tabs and confirm the new user turn is in view unless the user scrolled up.

##### MT-3 - Packaged img2img identity for "Make that puppy black" is not observed

- **Source phase**: Phase 3 - Image Follow-up Identity
- **Plan reference**: [v2.4.2-field-ui-history-and-generation.md](plans/v2.4.2-field-ui-history-and-generation.md) T016 / 3.1
- **Reason**: Automated tests prove img2img against last PNG bytes, strength 0.45, and no SAM2 for that phrase. A packaged NVIDIA run that the same puppy is recolored rather than resampled is not recorded here.
- **Suggested next step**: Phase 7 operator item: generate a puppy, send "Make that puppy black" with no attachment, capture before/after.

##### MT-4 - Packaged empty-video fail-closed is not observed

- **Source phase**: Phase 4 - Video Fail-Closed Output
- **Plan reference**: [v2.4.2-field-ui-history-and-generation.md](plans/v2.4.2-field-ui-history-and-generation.md) T020 / 4.1
- **Reason**: Automated tests prove persist of the playable-clip error, Settings > Models on missing weights, and fail-closed when `resolveMp4Url` is empty. A packaged NVIDIA run that a first puppy-in-grass turn never paints an empty success bubble is not recorded here.
- **Suggested next step**: Phase 7 operator item: send a Video Lab prompt that cannot produce a clip (missing weights or empty path) and capture the written failure.

##### MT-5 - Settings Models density is not proven on a real viewport

- **Source phase**: Phase 5 - Settings Models Density
- **Plan reference**: [v2.4.2-field-ui-history-and-generation.md](plans/v2.4.2-field-ui-history-and-generation.md) T024 / 5.1
- **Reason**: Tests assert the catalog fingerprint is absent, chrome gap is `--space-1`, and card padding is `--space-2`. jsdom does not layout two downloaded cards against a packaged window height.
- **Suggested next step**: Phase 7 operator item 8 (Settings Models density).

##### MT-6 - Live installer VRAM / Unsloth / VS Code merge is not observed

- **Source phase**: Phase 6 - Installer VRAM, Unsloth, and VS Code Merge
- **Plan reference**: [v2.4.2-field-ui-history-and-generation.md](plans/v2.4.2-field-ui-history-and-generation.md) T028 / 6.1
- **Reason**: Pytest pins 16384 and 15360 display as 16 GB, Unsloth Compatible/Incompatible before opt-in, and a 7-step route with the VS Code checkbox on Configuration. A packaged wizard run on this NVIDIA host is not recorded here.
- **Suggested next step**: Phase 7 operator item 9 (installer GPU line shows whole GB and Unsloth badge on the same page as VS Code).

## v2.4.1

### Summary

| Category | Open | Resolved |
|---|---:|---:|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 6 | 1 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 2 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 3 | 3 |

Phases 1-6 of the generation-recovery plan are committed locally. Phase 7 proved packaged NVIDIA image and video generation on this host (exact installer SHA-256 `E29725ADE5671271962CE9FB6DE66DCAA38BA182DC257802DFA835C78120490D`). Remaining operator checklist items (clean-install visuals, gated Hugging Face account, reboot persistence, Settings/Data/Training, transcript/Agents screenshots) stay Not observed. Publication still requires the full local gate, one Phase 7 commit, and explicit push/PR approval. `not_observed != absent` throughout.

### Open Items

##### DF-1 - Packaged Windows clean and repair installer behavior is not observed

- **Source phase**: Phase 1 and Phase 8 human testing
- **Plan reference**: Phase 8.7 operator items 1-3
- **Reason**: The prior packaged field run exposed imperceptible fixed-value motion, low percentage contrast, and hidden finalization work that left the bar at 73% while visible groups said Done. The replacement implements and tests a repeating liquid gradient, contrast capsule, and complete visible step mapping, and its frozen smoke passes. A clean/repair visual run of the replacement is not observed.
- **Owner / next evidence**: Release operator. Run checklist items 1-3 on a clean Windows Sandbox and an existing Nexus install, then attach screenshots and `nexus-install-nexus-desktop-log.txt`.

##### DF-3 - Reasoning disclosure is not observed with a thinking-capable local model

- **Source phase**: Phase 3 and Phase 8 human testing
- **Plan reference**: Phase 8.7 operator item 6
- **Reason**: Component and hydration tests prove collapsed-by-default disclosure, keyboard access, absence when no reasoning exists, and token tooltip detail. No local provider turn with separate reasoning content was run here.
- **Owner / next evidence**: Desktop operator. Use a catalog model that emits separate reasoning, confirm the disclosure expands without moving reasoning into the answer bubble, and capture collapsed and expanded states.

##### DF-4 - Archive, delete, reset, and restore are not observed across all four pillars

- **Source phase**: Phase 4 and Phase 8 human testing
- **Plan reference**: Phase 8.7 operator item 7
- **Reason**: Store, IPC, cancellation, late-event, and page-reset tests cover Chatbot, Agents, Images, and Videos. A packaged four-pillar operator matrix was not run.
- **Owner / next evidence**: Desktop operator. Complete checklist item 7 and record one session id per pillar plus the reset and restore result.

##### DF-5 - Installer/Settings visual parity and live disk-meter change are not observed

- **Source phase**: Phase 5 and Phase 8 human testing
- **Plan reference**: Phase 8.7 operator item 8
- **Reason**: The prior packaged field run exposed Nomic as incorrectly required and incompatible rows above compatible rows. The replacement makes EmbeddingGemma 300M the required/default app-wide embedder and compatibility the first ordering partition in installer and Settings. Automated shared-policy tests pass; replacement visual parity and an observed free-space change after model install/remove are not recorded.
- **Owner / next evidence**: Release operator. Capture the same model in both surfaces, then install/remove it and record the disk meter before and after.

##### DF-6 - Native folder pickers outside Windows are not observed

- **Source phase**: Phase 7
- **Plan reference**: Phase 8.7 operator item 9
- **Reason**: The Tauri command and frontend cancellation/stale-result behavior are automated. macOS and Linux picker behavior was not run on native hosts.
- **Owner / next evidence**: Platform operator. On macOS and Linux, select, cancel, and rapidly reopen the picker and record the resulting workspace chips.

##### DF-7 - Windows multi-root OS sandbox confinement remains partial

- **Source phase**: Phase 6 and Phase 8 human testing
- **Plan reference**: Phase 8.7 operator item 9
- **Reason**: Canonical path guards and scoped tool tests allow both selected roots and deny outside paths. The Windows sandbox backend still does not kernel-enforce filesystem or network confinement, so the support tier remains partial even when the UI and path guard behave correctly.
- **Owner / next evidence**: Security owner. Keep the existing loud partial/unconfined status. A later sandbox phase must add kernel-enforced Windows filesystem and network boundaries before claiming confined support.

##### QG-2 - Indexed skill catalog paths remain absent from this checkout

- **Source phase**: Phase 8 architecture, known-gaps, docs layout, and CI reconciliation; generation-recovery Phase 7
- **Plan reference**: Phase 8.1-8.5 and generation-recovery T089-T093
- **Reason**: The plan-indexed `catalog/skills/...` paths and the repository `.agents/skills` bundle still do not contain `project-refactor`, `docs-layout-refactor`, `known-gaps-tracker`, `cicd-architect`, `verification-before-completion`, or `dev-progress-tracker`. This Phase 7 session loaded the user-level copies under `C:\Users\bdour\.agents\skills` and followed those procedures. The repo-local mapping is still missing.
- **Suggested next step**: Vendor or map the canonical skill files into the repository catalog before the next planning session, or update plan templates to the user-level install path.

##### QG-5 - Develop-targeted pull requests miss several merge-result workflows

- **Source phase**: Generation-recovery Phase 7 terminal CI comparison
- **Plan reference**: T093
- **Reason**: `ci.yml`, `installer-tests.yml`, `shell-build.yml`, `pr-quality.yml`, `coverage-diff.yml`, and `codeql.yml` limit `pull_request.branches` to `main`. Feature-branch `push` still runs `ci.yml` and path-gated installer tests, and `commitlint.yml` runs on any PR. There is no always-resolving aggregate required-check job, and `package.json` has no `fast` / `full` / `platform` / `report` / `release` profile scripts. Workflow files were not changed; silence is not approval.
- **Suggested next step**: After explicit approval, add `develop` to the listed `pull_request.branches` (or an aggregate gate job) in the smallest set of workflows that must validate the merge result. Record any remaining profile-script differences as environment-only.

##### QG-6 - Model-prompting freshness helper is absent

- **Source phase**: Generation-recovery Phase 7 advisory governance check
- **Plan reference**: implement-phase 9.0 duty 8
- **Reason**: `python scripts/check_model_prompting_freshness.py --advisory` cannot run because the file is absent. The duty is advisory and does not block the phase.
- **Suggested next step**: Add the helper in a later tooling change, or keep the logged no-op.

### Resolved Items

##### DF-2 - Real NVIDIA CUDA diffusion generation is now observed

- **Resolved**: 2026-08-30 in generation-recovery Phase 7.
- **Evidence**: Packaged `runtime.json` schema 3 reports `diffusion.status=ready`, `torch 2.3.0+cu121`, `cuda_available=true` on an RTX 3080 Ti Laptop (driver 596.08). Exact unsigned installer SHA-256 `E29725ADE5671271962CE9FB6DE66DCAA38BA182DC257802DFA835C78120490D` plus installed sidecar produced a 512x512 PNG (330437 bytes, SHA-256 `1db719ce7693e918e958e22f6b7de34fe9bede4b5e9b128bdad4fc96db35fa80`, sampled variance 4034.6219) and an H.264 MP4 (848x480, 13 frames, 1.083 s, SHA-256 `60bb5cb281b7845ec7839467ba4d3ababd3a15cea52dd43e4cdfbb54a9a22422`) via `scripts/installer/build/smoke-installed-media.ps1`. Reboot persistence is still Not observed.

##### WN-1 - Rust format drift resolved

- **Resolved**: 2026-08-29 in Phase 8.
- **Evidence**: Applied canonical `cargo fmt --all` output to `desktop/src-tauri/src/lib.rs` and `sidecar.rs`. Fresh `cargo fmt --all -- --check`, Clippy with warnings denied, and all 19 Rust tests pass.

##### WN-2 - Installer-wide Ruff drift resolved

- **Resolved**: 2026-08-29 in Phase 8.
- **Evidence**: Applied Ruff's safe fixes, repaired the remaining line-length and style findings, and formatted the complete installer tree. Fresh `uv run ruff check .` reports `All checks passed!`; `uv run ruff format --check .` reports 171 files formatted.

##### QG-4 - Repository-wide nexus-check baseline enforced

- **Resolved**: 2026-08-29 in Phase 8.
- **Evidence**: Removed the two insecure-random production/test calls and added `configs/nexus-check-baseline.json` plus CLI enforcement that consumes only exact rule/file/message counts, fails excess findings, fails stale entries, and rejects malformed baselines. Fresh `npm run check --silent` reports 0 errors, 53 warnings, 56 exact matches, and 0 stale entries; focused CLI/memory/workspace tests pass.

##### QG-1 - Release-preconditions helper is absent

- **Resolved**: 2026-08-30 in generation-recovery Phase 7.
- **Evidence**: `python scripts/check_release_preconditions.py --branches --repo-settings` now reports the current branch, dirty tree, origin, and GitHub repository settings without mutation. Focused tests in `tests/python/test_release_helpers.py` pass.

##### QG-3 - Unicode-safety helper is absent

- **Resolved**: 2026-08-30 in generation-recovery Phase 7.
- **Evidence**: `python scripts/validate_unicode_safety.py --strict` now rejects BOMs and unsafe punctuation and can fix them. The same focused helper tests pass, and the Phase 7 text additions scanned with 21 files / 0 failures.

### Reconciliation of Earlier Active Files

- `docs/v2/v2.3/known-gaps.md`: reviewed 2026-08-30; still in-progress. v2.4.1 generation recovery does not close MT-1 or the v2.3.0 DF/QG rows. They remain unchanged.
- `docs/v2/v2.2/known-gaps.md`: finalized; packaged GPU evidence is still absent, so historical rows remain unchanged.
- `docs/v2/v2.1/known-gaps.md`: finalized; no change.
- `docs/v2/v2.0/known-gaps.md`: reviewed 2026-08-30; still in-progress with DF-1 and other hardware/audio deferrals. This cycle produced no observed evidence for those rows.
- `docs/v1/v1.20/known-gaps.md` and `docs/v1/v1.19/known-gaps.md`: still in-progress. No v2.4.1 observation closes their remaining DF rows.
- `docs/v1/v1.8/known-gaps.md` and `docs/v1/v1.5/known-gaps.md`: still in-progress or rehearsal-blocked; not modified.
- `docs/v1/v1.3/known-gaps.md`: Status remains open for historical skill-cleaner carryforward; not modified.
- Glob of 31 `docs/**/known-gaps.md` files: archive and finalized ledgers were left in place. No historical GPU/visual row was closed without new observation.

# Known Gaps - v2.4

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-29

Per-version tracker of unfinished work, deferrals, and follow-ups. The next plan ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plans: [v2.4.0 adoption](plans/v2.4.0-adoption-unsloth-qwen38-gaussian-splatting.md), [v2.4.1 field reliability](plans/v2.4.1-field-reliability-chat-archives-models-workspaces.md)

## v2.4.1

### Summary

| Category | Open | Resolved |
|---|---:|---:|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 7 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 2 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 3 | 1 |

Phases 1-7 are code-complete at automated and internal-compatible evidence. Packaged Windows visuals, live NVIDIA generation, thinking-model disclosure, four-pillar archive operation, installed-model disk changes, non-Windows native pickers, and Windows multi-root OS confinement remain not observed. `not_observed != absent` throughout.

### Open Items

##### DF-1 - Packaged Windows clean and repair installer behavior is not observed

- **Source phase**: Phase 1 and Phase 8 human testing
- **Plan reference**: Phase 8.7 operator items 1-3
- **Reason**: Qt tests prove the larger animated overall progress bar, percentage, monotonic progress, reduced-motion behavior, optional Unsloth provisioning, repair-state compatibility, and exception containment. A frozen `NexusSetup.exe` clean install and repair install were not run in this session.
- **Owner / next evidence**: Release operator. Run checklist items 1-3 on a clean Windows Sandbox and an existing Nexus install, then attach screenshots and `nexus-install-nexus-desktop-log.txt`.

##### DF-2 - Real NVIDIA CUDA diffusion generation is not observed

- **Source phase**: Phase 2 and Phase 8 human testing
- **Plan reference**: Phase 8.7 operator item 4
- **Reason**: Runtime construction, pinned CUDA wheel selection, staged venv repair, readiness schema, and mocked CUDA probes pass. This host did not prove `torch.cuda.is_available()` inside the packaged diffusion environment or generate a real image.
- **Owner / next evidence**: GPU release operator. Record GPU/driver, Python and torch versions, readiness JSON, and one generated PNG from the packaged app.

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
- **Reason**: Golden roster/order tests and disk arithmetic prove the shared policy. A packaged installer-to-Settings visual comparison and an observed free-space change after model install/remove were not recorded.
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

##### QG-1 - Release-preconditions helper is absent

- **Source phase**: Phase 8 Git-tree hygiene
- **Plan reference**: Phase 8.4
- **Reason**: `python scripts/check_release_preconditions.py --branches --repo-settings` cannot run because the file is absent. This is the same gap recorded in v2.3 DF-4. Phase 8 uses read-only Git commands as the deterministic fallback.
- **Suggested next step**: Add a repository-owned helper in a dedicated hygiene phase or keep the raw Git fallback documented.

##### QG-2 - Four Phase 8 indexed skill files are absent

- **Source phase**: Phase 8 architecture, known-gaps, docs layout, and CI reconciliation
- **Plan reference**: Phase 8.1-8.5
- **Reason**: The indexed `project-refactor`, `docs-layout-refactor`, `known-gaps-tracker`, and `cicd-architect` skill files were not present under either installed skill root. Their bounded duties were performed directly with repository scans and workflow comparison.
- **Suggested next step**: Repair the local skill installation/catalog mapping before the next release-planning session.

##### QG-3 - Unicode-safety helper is absent

- **Source phase**: Phase 8 full stabilization
- **Plan reference**: Phase 8.8
- **Reason**: `scripts/validate_unicode_safety.py` is absent, so the exact planned command cannot run. A deterministic fallback strictly decoded every changed file as UTF-8, rejected BOMs and unsafe punctuation in release-owned additions, and passed with zero hits.
- **Suggested next step**: Add the planned repository-owned helper in a dedicated tooling change or formalize the deterministic fallback as the canonical command.

### Resolved Items

##### WN-1 - Rust format drift resolved

- **Resolved**: 2026-08-29 in Phase 8.
- **Evidence**: Applied canonical `cargo fmt --all` output to `desktop/src-tauri/src/lib.rs` and `sidecar.rs`. Fresh `cargo fmt --all -- --check`, Clippy with warnings denied, and all 19 Rust tests pass.

##### WN-2 - Installer-wide Ruff drift resolved

- **Resolved**: 2026-08-29 in Phase 8.
- **Evidence**: Applied Ruff's safe fixes, repaired the remaining line-length and style findings, and formatted the complete installer tree. Fresh `uv run ruff check .` reports `All checks passed!`; `uv run ruff format --check .` reports 171 files formatted.

##### QG-4 - Repository-wide nexus-check baseline enforced

- **Resolved**: 2026-08-29 in Phase 8.
- **Evidence**: Removed the two insecure-random production/test calls and added `configs/nexus-check-baseline.json` plus CLI enforcement that consumes only exact rule/file/message counts, fails excess findings, fails stale entries, and rejects malformed baselines. Fresh `npm run check --silent` reports 0 errors, 53 warnings, 56 exact matches, and 0 stale entries; focused CLI/memory/workspace tests pass.

### Reconciliation of Earlier Active Files

- `docs/v2/v2.3/known-gaps.md`: reviewed 2026-08-29; v2.4.1 does not provide new observed evidence for MT-1, v2.3.0 DF-1 through DF-4, WN-1, MT-1, QG-1, or QG-2. They remain unchanged.
- `docs/v2/v2.2/known-gaps.md`: finalized; v2.4.1 supersedes portions of DF-36, DF-37, and DF-33 in code, but packaged visual/GPU evidence is still absent, so the historical rows remain unchanged rather than being retroactively closed.
- Older active known-gap files were not modified because this cycle produced no direct observed evidence for their items.

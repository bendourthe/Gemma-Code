# Known Gaps - v1.20

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-19

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.20.0-adoption-docling.md](plans/v1.20.0-adoption-docling.md)

Carry-forward source: [../v1.16/known-gaps.md](../v1.16/known-gaps.md) (LSO.P4.B / LSO.P4.C / LSO.P3.C). v1.19.2 in-flight items stay in [../v1.19/known-gaps.md](../v1.19/known-gaps.md).

## v1.20.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 3 | 2 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Sidecar has no MemoryStore, so parse_document memory ingest is VS Code only

- **Source phase**: Phase 1 - Optional memory ingest (1.3)
- **Plan reference**: `docs/v1/v1.20/plans/v1.20.0-adoption-docling.md` (sub-task 1.3)
- **Reason**: The sidecar coding hosts (ACP, scheduler, headless runner) have no `MemoryStore`. The plan allows skipping ingest on that host. VS Code `ChatPanelBootstrap` wires `createDocumentMemoryIngestor` when both flags are on.
- **Suggested next step**: If a later sidecar memory cycle lands a store, pass it into `createSidecarHeadlessTools` the same way the panel does. Do not invent a second SQLite in the sidecar for this.

##### DF-2 - Desktop Settings UI has no parse_document toggle

- **Source phase**: Phase 1 - Sidecar / ACP / scheduler parser injection (1.1)
- **Plan reference**: `docs/v1/v1.20/plans/v1.20.0-adoption-docling.md` (sub-task 1.1)
- **Reason**: The flag already exists as `nexus.coding.parseDocument.enabled` (VS Code contributes) plus sidecar `NEXUS_PARSE_DOCUMENT` / `~/.nexus/settings.json`. A desktop Settings checkbox was not in the phase prompt.
- **Suggested next step**: Add a Settings row next to other coding opt-ins that writes `nexus.coding.parseDocument.enabled` into `~/.nexus/settings.json`.

##### DF-3 - Overlapping parse calls reject busy rather than queue

- **Source phase**: Phase 1 - VS Code composition-root wiring (1.2)
- **Plan reference**: `docs/v1/v1.20/plans/v1.20.0-adoption-docling.md` (sub-task 1.2)
- **Reason**: The plan allowed queue or reject. Reject is the chosen rule so two Python `parse` RPCs cannot interleave on one synchronous child. Chat `ocr.*` IPC still uses start/drain independently on the shared child (JSON-RPC is sequential on stdin).
- **Suggested next step**: Keep reject unless a measured product need for a parse queue appears.

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| LSO.P4.B | Wire parse_document at composition roots | Phase 1 | Sidecar `createSidecarHeadlessTools` + VS Code `ChatPanelBootstrap` / `buildParseDocumentDeps`. Flag off keeps the tool absent. |
| LSO.P4.C | Wire optional memory ingest | Phase 1 | VS Code only, both flags required. Injection rejection is stored=false. Sidecar remainder is DF-1. |

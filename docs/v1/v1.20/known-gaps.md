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
| Deferred (DF) | 6 | 3 |
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

##### DF-4 - Chat and Coding parse still use the first attachment only

- **Source phase**: Phase 2 - Chat accept list (2.3); Phase 3 kept the same rule
- **Plan reference**: `docs/v1/v1.20/plans/v1.20.0-adoption-docling.md` (sub-tasks 2.3 and 3.2)
- **Reason**: The plan default is first-only unless N-file parse is explicitly added. Multi-file drops still parse the first accepted file; the rest are ignored for that turn.
- **Suggested next step**: Add N-file parse only if product wants a multi-document turn. Do not silently concatenate.

##### DF-5 - A4 Docling layout engine deferred; OCR on-device QA incomplete

- **Source phase**: Phase 4 - Layout bake-off (4.1 / 4.2)
- **Plan reference**: `docs/v1/v1.20/plans/v1.20.0-adoption-docling.md` (Phase 4); note `docs/v1/v1.20/development/ocr-layout-bakeoff-2026-08.md`
- **Reason**: Decision is DEFER, not DECLINE and not DEFER-BUILD. RapidOCR default ONNX models were smoked on synthetic fixtures (wall-of-text tables). Nexus catalog RapidOCR is still blocked by placeholder SHA (LSO.P3.A / IRSC.P4.B). Unlimited-OCR was not run (torch absent in the probe interpreter despite an RTX 3080 Ti). Docling was not installed.
- **Suggested next step**: After catalog RapidOCR can install, and with torch in the Nexus OCR/diffusion venv, parse a real table PDF and a scan with RapidOCR vs Unlimited-OCR. Only then consider a local-only `docling-slim` extra. Do not merge torch into `runtimes/ocr/requirements.txt`.

##### DF-6 - `runtimes/ocr/` not renamed to `runtimes/documents/`

- **Source phase**: Phase 5 - Architecture refactor (5.1)
- **Plan reference**: `docs/v1/v1.20/plans/v1.20.0-adoption-docling.md` (sub-task 5.1)
- **Reason**: Office engines live under the OCR runtime, but renaming would touch CI, sidecar spawn paths, installer comments, tests, and every import in one change. The seam `core/documents` is already vscode-free and correctly named. A rename without a simultaneous reference sweep would break `test-python-runtimes`.
- **Suggested next step**: If a later cycle renames, do it as one commit that updates `runtimes/ocr/**`, `tests/python/ocr/**`, `.github/workflows/ci.yml`, sidecar runtime factory paths, and installer comments together.

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| LSO.P4.B | Wire parse_document at composition roots | Phase 1 | Sidecar `createSidecarHeadlessTools` + VS Code `ChatPanelBootstrap` / `buildParseDocumentDeps`. Flag off keeps the tool absent. |
| LSO.P4.C | Wire optional memory ingest | Phase 1 | VS Code only, both flags required. Injection rejection is stored=false. Sidecar remainder is DF-1. |
| LSO.P3.C | On-device OCR QA | Phase 4 | Partial. RapidOCR default ONNX models smoked on synthetic fixtures. Catalog RapidOCR install and Unlimited-OCR remain DF-5. |

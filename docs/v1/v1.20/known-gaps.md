# Known Gaps - v1.20

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-20 (v2.1.0 follow-up; no retag)

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v1.20.0-adoption-docling.md](plans/v1.20.0-adoption-docling.md)

Carry-forward source: [../v1.16/known-gaps.md](../v1.16/known-gaps.md) (LSO.P4.B / LSO.P4.C / LSO.P3.C). v1.19.2 in-flight items stay in [../v1.19/known-gaps.md](../v1.19/known-gaps.md).

## v1.20.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 2 | 7 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 0 |
| Quality-gate gaps (QG) | 0 | 1 |

### Open Items

#### Deferred

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
| LSO.P4.C | Wire optional memory ingest | Phase 1 | VS Code uses MemoryStore when both flags are on. Sidecar ingest is an in-process array (DF-1 resolved; no second SQLite). |
| LSO.P3.C | On-device OCR QA | Phase 4 | Partial. RapidOCR default ONNX models smoked on synthetic fixtures. Catalog RapidOCR install and Unlimited-OCR remain DF-5. |
| QG-1 | docs/index.md catalog stale on tag v1.20.0 | follow-up | Regenerated on develop after CI failed catalog-sync. No retag. |
| DF-1 | Sidecar parse_document ingest | v2.1.0 follow-up | In-process array (`readSidecarDocumentMemory`), not a second SQLite. VS Code still uses MemoryStore. |
| DF-2 | Desktop Settings parse_document toggle | v2.1.0 sweep | Settings > Security checkbox writes `nexus.coding.parseDocument.enabled` via `coding.parseDocument.setEnabled`. |
| DF-3 | Overlapping parse rejects busy | v2.1.0 sweep | Chosen rule kept: reject, not queue. `DOCUMENT_PARSER_BUSY` stays. |
| DF-4 | First attachment only | v2.1.0 sweep | Chosen rule kept: first accepted file per turn. No silent concatenate. |

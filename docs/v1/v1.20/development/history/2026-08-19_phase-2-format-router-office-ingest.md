# Session History - v1.20.0 Phase 2: Format Router + Native Office Ingest (A3 + A2)

**Date**: 2026-08-19
**Version**: v1.20.0
**Plan**: [../../plans/v1.20.0-adoption-docling.md](../../plans/v1.20.0-adoption-docling.md)
**Phase**: 2 of 5 - Format router + native Office ingest
**Outcome**: Complete. Magic-byte routing classifies PDF/image/Office; Chat accepts Office files; RapidOCR is not required for DOCX/PPTX/XLSX. Docling is not installed.

## Goal

Sniff the payload, route PDF/images to the existing OCR engines, parse DOCX/PPTX/XLSX with native libraries into `{ text, markdown, pages }`, and expand Chat's accept list only after that router exists.

## Pre-flight

`is_final_phase` = **false** (Phase 5 is the last phase). Model routing: plan recommended frontier / high. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-5 with local commits, then Phase 5 commit/push/`/update release`.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `318e944` (Phase 1 wire parse_document)
- **Environment**: Windows 10, Python 3.12, desktop Vitest
- **Package version**: 1.19.2 (version bump waits for `/update release` after Phase 5)

## 2. Chronological Steps

### 2.1 Magic-byte format router

**Plan specification**: `detect_kind` using magic / OOXML zip names, not caller MIME. Dispatch in `parse.py`. Filename hint never overrides a conflicting sniff.

**What happened**: `runtimes/ocr/documents.py` classifies pdf / image / docx / pptx / xlsx / unsupported. Zip member count and declared uncompressed size are bounded before any extract. OLE compound files and encrypted zip flags fail closed. `load_pages` rasterizes only pdf/image. `run_parse` routes Office kinds to `resolve_office_engine` before any OCR import.

**Key files**: `runtimes/ocr/documents.py`, `runtimes/ocr/parse.py`, `runtimes/ocr/engines/base.py`

### 2.2 Native DOCX / PPTX / XLSX engines

**Plan specification**: python-docx / python-pptx / openpyxl, markdown + pages, no process-global cache, succeed without RapidOCR, no torch, no Docling.

**What happened**: Three `DocumentEngine` implementations. Workbooks are closed after each parse. Corrupt / encrypted packages return `unsupported-media`. Requirements and installer `REQUIRED_WHEEL_PREFIXES` list the three packages. Tests monkeypatch `resolve_engine` to prove Office never loads RapidOCR.

**Key files**: `runtimes/ocr/engines/docx_engine.py`, `pptx_engine.py`, `xlsx_engine.py`, `office_common.py`, `runtimes/ocr/requirements.txt`

### 2.3 Chat accept list

**Plan specification**: Expand Chat accept after 2.1/2.2. Image Studio stays `image/*`. Office parse must run when no OCR model is installed.

**What happened**: Shared `DOCUMENT_ACCEPT` in `desktop/src/shared/chat/documentAccept.ts` (also exported for Phase 3 Coding). Placeholder names Office files. Composer stays usable next to the RapidOCR empty-state banner. First attachment only (DF-4).

**Key files**: `desktop/src/shared/chat/documentAccept.ts`, `desktop/src/modules/chat/ChatPage.tsx`, `docs/install.md`

### 2.4 Testing

Python OCR 80/80. Desktop Chat + MediaComposer 23/23. Installer provisioner 9/9. Desktop eslint + `tsc --noEmit` clean. Ruff on `runtimes/ocr` + tests clean. `test-python-runtimes` already installs `runtimes/ocr/requirements.txt`; no CI rewrite.

## 3. Decisions

- Magic wins over filename and over data-URL MIME.
- Office dispatch happens before `resolve_engine`, so a missing RapidOCR install cannot block Word/Excel/PowerPoint.
- `OcrParseResult` gained no `kind` field; `engine` (`docx` / `pptx` / `xlsx`) is enough for UI copy.
- Encrypted-zip tests patch the zip central-directory flag because stdlib `zipfile` cannot write encrypted members.

## 4. Issues and Resolutions

| Issue | Severity | Decision |
|---|---|---|
| First attachment only | P2 | Deferred (DF-4), plan default |
| Filename hint not sent from Chat IPC | P3 | Accepted: magic is sufficient; Python still accepts `filename` |

## 5. Plan Discrepancies

- Shared `DOCUMENT_ACCEPT` module landed in Phase 2 (Phase 3 also needs it). Chat is the owner.
- No `defusedxml`: sniff uses zip names, not XML parse.

## 6. Assumptions Made

- OOXML kind is `word/document.xml` / `ppt/presentation.xml` / `xl/workbook.xml` in the zip namelist.
- Word "pages" are Heading-1 chunks when present, otherwise one page.

## 7. Testing Summary

Stability gate: drop `.docx` in Chat tests with no document OCR model; PDF path unchanged; Image Studio still drops Office; HTML/random bytes `unsupported-media`; 64 MB + zip caps; no torch/docling in `runtimes/ocr/requirements.txt`.

## 8. TODO Tracker

- [x] 2.1 Format router
- [x] 2.2 Native Office engines
- [x] 2.3 Chat accept
- [x] 2.4 Tests
- [ ] Phase 3 Coding composer attach

## 9. Summary and Next Steps

Phase 2 closes A3 (router) and A2 (native Office) without Docling. Next: `/implement` Phase 3 (Coding composer attach using the shared accept list).

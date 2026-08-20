# Session History - v1.20.0 Phase 5: Architecture Refactor, Known-Gaps, CI/CD

**Date**: 2026-08-19
**Version**: v1.20.0
**Plan**: [../../plans/v1.20.0-adoption-docling.md](../../plans/v1.20.0-adoption-docling.md)
**Phase**: 5 of 5 - Refactor, known-gaps, CI/CD
**Outcome**: Complete. `is_final_phase` = true. Version bump, changelog, tag, and GitHub Release are owned by `/update release`.

## Goal

Leave the project well-organized, its known gaps reconciled, and its CI/CD complete and optimized.

## Pre-flight

`is_final_phase` = **true** (numerically last; title matches the v3.11.0 gate; Phases 1-4 committed as `318e944`, `374f227`, `a20c21a`, `c4530f5`). Model routing: plan recommended frontier / max. Cursor stayed on Grok 4.6. The user pre-authorized Phase 5, then commit, push, and `/update release`.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `c4530f5` (Phase 4 bake-off)
- **Package version**: 1.19.2 until `/update release`

## 2. Chronological Steps

### 5.1 Architecture refactor

Propose-then-apply: no empty dirs or duplicate docs introduced this cycle. `docs/v1/v1.20/` already has `plans/` and `comparisons/`. **Did not** rename `runtimes/ocr/` to `runtimes/documents/` (DF-6). `core/documents` remains the vscode-free seam.

### 5.2 Known-gaps

Open: DF-1..DF-6. Resolved: LSO.P4.B, LSO.P4.C, LSO.P3.C (partial). v1.19.2 items stay in `docs/v1/v1.19/known-gaps.md`. File stays in-progress.

### 5.3 CI/CD

No new GPU/weights job. `test-python-runtimes` already installs `runtimes/ocr/requirements.txt` (now includes Office wheels) and runs `tests/python`. Root `test-ts` runs `npm run test:shell` on Node 22 (Chat, MediaComposer, Coding). `parse-document-wiring` is in root Vitest. Comment on the Python job updated. Existing concurrency cancel-in-progress, npm/pip caches, and installer path filters kept. Shell-build still path-filters `desktop/**` + `core/**`.

### 5.4 Installer parity

Office wheels (`python_docx`, `python_pptx`, `openpyxl`) sit next to RapidOCR prefixes in `REQUIRED_WHEEL_PREFIXES`. CI Python job installs the same `runtimes/ocr/requirements.txt` on Linux. No second OCR requirements file for macOS/Linux sidecars. Cross-installer OS execution of the real wizards was not re-run this cycle (existing installer jobs unchanged).

### 5.5 Tests

Phase 2/3 suites already green. Python OCR 80/80 after Phase 4. This phase is docs + CI comment + setting copy.

## 8. TODO Tracker

- [x] 5.1 Refactor (no rename)
- [x] 5.2 Known-gaps
- [x] 5.3 CI comment / coverage confirmation
- [x] 5.4 Office wheel parity declaration
- [x] 5.5 Session history
- [ ] `/update release` for v1.20.0

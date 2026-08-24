# Session History - v1.20.0 Phase 4: Layout Bake-off (A4 Gate)

**Date**: 2026-08-19
**Version**: v1.20.0
**Plan**: [../../plans/v1.20.0-adoption-docling.md](../../plans/v1.20.0-adoption-docling.md)
**Phase**: 4 of 5 - Layout bake-off
**Outcome**: Complete. Decision is **DEFER**: do not install Docling. No product code changed. `runtimes/ocr/requirements.txt` still has no `docling` and no torch.

## Goal

Close the comparison's "not proven here" on PDF layout quality far enough to record adopt-or-decline. Do not add Docling to the default attach path.

## Pre-flight

`is_final_phase` = **false**. Model routing: plan recommended frontier / high. Cursor stayed on Grok 4.6. User pre-authorized Phases 1-5.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `a20c21a` (Phase 3 Coding attach)
- **Host**: Windows 10, RTX 3080 Ti Laptop GPU visible to `nvidia-smi`, probe Python without torch

## 2. Chronological Steps

### 4.1 On-device OCR quality pass

Catalog RapidOCR / Unlimited-OCR weights are absent from `~/.nexus/models` (LSO.P3.A / IRSC.P4.B). Unlimited-OCR could not load (no torch). RapidOCR default ONNX models were run on a synthetic invoice raster and a tiny digital PDF. Table cells came back as a token list, not a markdown grid. No user documents were committed.

### 4.2 A4 decision

**DEFER**, not DECLINE, not DEFER-BUILD. Incomplete bake-off cannot silently adopt a vendor-intrinsic extra. MCP Registry Policy: A4 stays skip-unless-bake-off.

### 4.3 Tests

`tests/python/ocr` 80/80. No code drift.

## 3. Decisions

See [ocr-layout-bakeoff-2026-08.md](../ocr-layout-bakeoff-2026-08.md).

## 4. Issues and Resolutions

DF-5 records the deferral. LSO.P3.C is only partially addressed.

## 8. TODO Tracker

- [x] 4.1 Measurement note
- [x] 4.2 Decision
- [x] 4.3 OCR smoke
- [ ] Phase 5 refactor / known-gaps / CI / release

## 9. Summary and Next Steps

Next: `/implement` Phase 5 then `/update release`.

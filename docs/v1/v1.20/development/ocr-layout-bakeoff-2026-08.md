# OCR layout bake-off - 2026-08

**Decision: DEFER.** Do not install Docling in v1.20.0. Do not add it to the default attach path. A4 stays a gated vendor-intrinsic item until Unlimited-OCR is measured on this host and RapidOCR is installed through the Nexus catalog.

This is not **DECLINE** (RapidOCR was not shown to be good enough on table layout) and not **DEFER-BUILD** (no v1.21 implementation is opened). The comparison's MCP Registry Policy still classifies A4 as vendor-intrinsic and skip-unless-bake-off.

## Why the bake-off is incomplete

| Engine | Status on this host (2026-08-19) | Reason |
|---|---|---|
| RapidOCR via Nexus Settings > Models | **not proven here** | `~/.nexus/models` has no RapidOCR / Unlimited-OCR weights. In-app HF install still fails digest verification on all-zero placeholder `source.sha256` (v1.16 LSO.P3.A / v1.15 IRSC.P4.B). |
| RapidOCR via `rapidocr-onnxruntime` default ONNX models | **measured** (synthetic fixtures only) | The portable wheel was already importable in the developer Python used for `tests/python/ocr`. This is not the catalog install path. |
| Unlimited-OCR | **not proven here** | Host has an NVIDIA GeForce RTX 3080 Ti Laptop GPU (`nvidia-smi`), but this Python has no `torch`, so the VLM engine cannot load. No scores are invented. |
| Docling | **not run** | Phase 4 forbids `pip install docling`. No Docling numbers. |

Incomplete measurement must not become a silent yes for a torch + IBM-models extra.

## Fixtures (synthetic, no user secrets)

No customer PDFs were committed. Two generated fixtures:

1. **Raster invoice** (Pillow, 800x400): heading `INVOICE 10001`, header row `Item Qty Price`, two line items, a total. Stands in for a scanned invoice.
2. **Digital PDF** (minimal PDF 1.1, Helvetica): lines `Digital PDF table` and `Name Qty`, rasterized with pypdfium2 at 2x then OCR'd. Stands in for a born-digital page. It is not a real multi-column invoice grid.

## RapidOCR qualitative notes (default ONNX models)

Reading order on both fixtures was top-to-bottom, left-to-right. That part is fine.

Table structure was **not** recovered as a grid:

- Invoice line `Widget A` came back as `WidgetA` (space dropped).
- `INVOICE 10001` came back as `INVOICE10001`.
- Header cells `Item`, `Qty`, `Price` and amounts `12.00`, `30.00`, `54.00` were recognized as **separate tokens**, not a GitHub-flavored markdown table.
- Digital PDF recovered the strings `Digital PDF table` and `Name Qty` as a wall of text.

So RapidOCR on these fixtures is usable for "what words are on the page" and weak for "keep the table". That is a **hint** of layout loss, not a bake-off win for Docling, because Unlimited-OCR (the in-product layout markdown engine) was not run.

Anonymized excerpt (raster invoice tokens, in order): `INVOICE10001`, `Item`, `Qty`, `Price`, `WidgetA`, `2`, `12.00`, `WidgetB`, `1`, `30.00`, `Total`, `54.00`.

## A4 / MCP Registry Policy

Comparison Section 6: A4 is vendor-intrinsic (TableFormer / Heron are not reverse-engineered this cycle). Step 5.4 says take it only if the bake-off shows RapidOCR + Unlimited-OCR lose on tables and reading order.

This cycle:

- Did not prove Unlimited-OCR quality (no torch in the probe interpreter).
- Did not install Docling.
- Did ship native Office ingest and a format router, which already cover the common attach miss without a layout SDK.

Therefore A4 is **deferred**, not adopted. Local-only mitigations (`artifacts_path` under `~/.nexus/models`, no `HttpSource`, `enable_remote_services` forced false, no mcp/serve, separate venv slice, never merge torch into `runtimes/ocr/requirements.txt`) remain the bar **if** a later cycle re-opens A4 after Unlimited-OCR is measured.

## Follow-up

Recorded as v1.20 known-gap DF-5. LSO.P3.C is only **partially** addressed (RapidOCR library smoke on synthetic pages). Catalog RapidOCR install and Unlimited-OCR on-device QA stay open.

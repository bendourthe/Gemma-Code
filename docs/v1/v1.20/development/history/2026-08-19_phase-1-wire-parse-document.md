# Session History - v1.20.0 Phase 1: Wire parse_document (A1)

**Date**: 2026-08-19
**Version**: v1.20.0
**Plan**: [../../plans/v1.20.0-adoption-docling.md](../../plans/v1.20.0-adoption-docling.md)
**Phase**: 1 of 5 - Wire `parse_document`
**Outcome**: Complete. Sidecar ACP/scheduler/coding runner and VS Code bootstrap register the existing tool behind the existing flags. Memory ingest is VS Code only.

## Goal

Register the already-written `parse_document` tool on every host that has a document runtime, gated on `nexus.coding.parseDocument.enabled`, with optional memory ingest gated on `nexus.coding.parseDocument.memoryIngest.enabled`.

## Pre-flight

`is_final_phase` = **false** (Phase 5 is the last phase). Model routing: plan recommended frontier / high. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-5 with local commits, then Phase 5 commit/push/`/update release`.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `a472acd` (Docling comparison and plan)
- **Environment**: Windows 10, root Vitest + desktop Vitest
- **Prior session**: plan/comparison push
- **Package version**: 1.19.2 (version bump waits for `/update release` after Phase 5)

## 2. Chronological Steps

### 2.1 Sidecar / ACP / scheduler parser injection

**Plan specification**: Pass a `HeadlessDocumentParser` into every production `createHeadlessTools` site. Flag wins over parser presence. Bytes in, never a path.

**What happened**: Added `createHeadlessOcrParser` (busy-reject) and `isParseDocumentEnabled` (env `NEXUS_PARSE_DOCUMENT` wins, then settings.json). Sidecar helper `createSidecarHeadlessTools` is the single construction site for `main.ts` scheduler, `AcpAgent`, and `createHeadlessAgentRunner`. Shared OCR singleton so Chat IPC and the agent tool use one Python child.

**Key files**: `core/documents/headlessOcrParser.ts`, `core/documents/parseDocumentEnabled.ts`, `desktop/sidecar/src/coding/sidecarHeadlessTools.ts`, `desktop/sidecar/src/ocr/sharedRuntime.ts`

**Deviation**: overlapping parses reject with a busy error rather than queue.

### 2.2 VS Code composition-root wiring

**Plan specification**: `ChatPanelBootstrap` passes `parseDocument` when the flag is on.

**What happened**: `buildParseDocumentDeps` is the bootstrap-shaped helper. Flag off returns undefined. Parser is lazy (Python not spawned until first parse). Missing runtime surfaces "Install RapidOCR from Settings > Models."

**Key files**: `src/tools/parseDocumentWiring.ts`, `src/panels/ChatPanelBootstrap.ts`

### 2.3 Optional memory ingest

**Plan specification**: Construct `createDocumentMemoryIngestor` only when both flags are on.

**What happened**: VS Code wires it with a live `sessionId` getter. Sidecar has no MemoryStore (DF-1). Injection rejection is stored=false.

**Key files**: `src/tools/handlers/documentMemoryIngestor.ts`, `src/tools/parseDocumentWiring.ts`

### 2.4 Testing

Added unit/integration tests for enablement, busy reject, base64-only, flag matrix, bootstrap registration, sidecar construction, headless redaction. CI path filters already cover `core/**`, `desktop/**`, `modules/**`, `src/**`.

## 3. Verification Gate

| Check | Result |
|---|---|
| Root Vitest (phase files) | PASS (58 tests) |
| Desktop Vitest (sidecar-parse-document, ocr-handlers, ACP, serving, runner) | PASS (40 tests) |
| `npm run lint` (src modules) | PASS |
| `tsc -b` | PASS |
| desktop `tsc --noEmit` | PASS |
| test-python-runtimes | NOT RUN (unchanged this phase) |

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Sidecar memory ingest | P2 | Deferred (DF-1) |
| No desktop Settings checkbox | P2 | Deferred (DF-2) |
| Busy reject vs queue | P2 | Accepted (DF-3) |

## 5. Plan Discrepancies

- Queue vs reject: chose reject.
- Sidecar ingest: skipped (allowed by the plan when no MemoryStore).
- Vitest skips reading a developer `~/.nexus/settings.json` so local opt-in cannot leak into unit tests.

## 6. Assumptions Made

- `NEXUS_PARSE_DOCUMENT` is the sidecar twin of `NEXUS_EXEC_SANDBOX`.
- Sharing one OCR child between Chat IPC and the agent tool is required.

## 7. Testing Summary

Flag off: tool absent. Flag on: tool present, parser sees base64, secrets redacted, CONFIRM still in the shared map, classifier still lists `parse_document`. Memory ingest matrix covered.

## 8. TODO Tracker

- [x] 1.1 Sidecar injection
- [x] 1.2 VS Code bootstrap
- [x] 1.3 Memory ingest (VS Code)
- [x] 1.4 Tests
- [ ] Phase 2 format router + native Office

## 9. Summary and Next Steps

Phase 1 closes LSO.P4.B on both hosts and LSO.P4.C on VS Code. Next: `/implement` Phase 2 (magic-byte router + DOCX/PPTX/XLSX).

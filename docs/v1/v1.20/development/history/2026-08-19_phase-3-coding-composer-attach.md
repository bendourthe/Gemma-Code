# Session History - v1.20.0 Phase 3: Coding Composer Attach (A5)

**Date**: 2026-08-19
**Version**: v1.20.0
**Plan**: [../../plans/v1.20.0-adoption-docling.md](../../plans/v1.20.0-adoption-docling.md)
**Phase**: 3 of 5 - Coding composer attach
**Outcome**: Complete. Coding accepts the same file kinds as Chat, parses through `ocr.*` IPC, and does not auto-prompt the coding model. Agent `parse_document` stays CONFIRM.

## Goal

Coding's input accepts the same file kinds as Chat and parses them with the same "show text, do not auto-prompt the model" contract, without bypassing `parse_document` CONFIRM for workspace-path agent calls.

## Pre-flight

`is_final_phase` = **false**. Model routing: plan recommended strong / high. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). The user pre-authorized Phases 1-5.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `374f227` (Phase 2 router + Office)
- **Package version**: 1.19.2

## 2. Chronological Steps

### 3.1 Shared accept list and Coding MediaComposer

**Plan specification**: Wrap MediaComposer or extend CodingInput; keep slash commands; export accept from one module.

**What happened**: Extended `CodingInput` (kept slash suggestions and existing test ids) with attach / drop / paste using `fileMatchesAccept` and Phase 2 `DOCUMENT_ACCEPT`. Empty text plus an attachment is a valid send.

**Key files**: `desktop/src/modules/coding/CodingInput.tsx`, `desktop/src/shared/chat/documentAccept.ts`

**Deviation**: Did not replace the composer with MediaComposer, so slash UI and `coding-input-*` test ids stay stable.

### 3.2 Parse-then-show on the coding thread

**Plan specification**: Same sidecar `ocr.*` path as Chat. Do not invoke the coding model. Do not auto-approve workspace `parse_document`.

**What happened**: `CodingPage` injects `DocumentClient`. Attachment turns call `documentClient.parse`, render with activity `document-parse`, and never call `coding.session.start` / `sendMessage`. A typed note becomes a follow-up hint.

**Key files**: `desktop/src/modules/coding/CodingPage.tsx`

### 3.3 Testing

Desktop CodingInput 15/15, CodingPage 15/15. Root `parse-document-wiring` 11/11 (CONFIRM unchanged). Desktop lint + `tsc --noEmit` clean.

## 3. Decisions

- Desktop UI parse is independent of `nexus.coding.parseDocument.enabled` (that flag is the agent tool).
- First attachment only (DF-4), matching Chat.

## 4. Issues and Resolutions

None new beyond DF-4 applying to Coding as well.

## 5. Plan Discrepancies

Extended CodingInput instead of wrapping MediaComposer.

## 6. Assumptions Made

- `createIpcDocumentClient` is the correct Chat-equivalent path; no HeadlessAgentSession on attach turns.

## 7. Testing Summary

Attachment turn never hits the model client; follow-up text turn does. Slash suggestions still render. CONFIRM still wraps `parse_document`.

## 8. TODO Tracker

- [x] 3.1 CodingInput attach
- [x] 3.2 Parse-then-show
- [x] 3.3 Tests + CONFIRM regression
- [ ] Phase 4 layout bake-off

## 9. Summary and Next Steps

Next: `/implement` Phase 4 (on-device layout bake-off note and A4 adopt-or-decline). No Docling install.

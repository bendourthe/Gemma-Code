# Session History - v2.0.0 Phase 1: Multimodal Chat + Local Voice Loop

**Date**: 2026-08-19
**Version**: v2.0.0
**Plan**: [../../plans/v2.0.0-adoption-governed-autonomy-multimodal.md](../../plans/v2.0.0-adoption-governed-autonomy-multimodal.md)
**Phase**: 1 of 6 - Multimodal Chat + Local Voice Loop
**Outcome**: Complete. Chat routes images to vision-capable local models, transcribes audio on-device, and can run an opt-in offline voice loop (PTT / button VAD / barge-in). No outbound.

## Goal

Chat accepts images and audio against capable local models and holds a fully local real-time voice conversation. STT, TTS, and capture stay on-device. Weights come from the installer catalog (`faster-whisper-large-v3`, `kokoro-82m`).

## Pre-flight

`is_final_phase` = **false** (Phase 6 is the last phase). Model routing: plan recommended mid-strong / high. Cursor cannot script a switch; this session stayed on Cursor Grok 4.6 (same-or-stronger). Visible degrade: map refresh not re-run; proceeded on the plan tier. The user pre-authorized Phases 1-6 with local commits after 1-5, then Phase 6 commit, push, and `/update release`.

## 1. Starting State

- **Branch**: `develop`
- **Starting commit**: `357df56` (docs: regenerate src module catalog after parse_document wiring)
- **Environment**: Windows 10, root Vitest, desktop Vitest, Python pytest
- **Package version**: 1.20.0 (version bump waits for `/update release` after Phase 6)

## 2. Chronological Steps

### 2.1 Vision-chat routing (1.1)

**Plan specification**: Gate image attach on catalog `modalities` including `image`. Send image bytes to the local chat session. Do not regress Image Studio.

**What happened**: `ListedModel.modalities` is copied onto the models.list DTO. Chat `imageEnabled` follows `imageAttachmentAffordance`. Vision turns call `chat.session.sendMessage` with stripped base64. Text-only models drop image files. Image Studio keeps default `imageEnabled` true and `audioEnabled` false.

**Key files**: `desktop/src/shared/chat/modalityGating.ts`, `desktop/src/modules/chat/ChatPage.tsx`, `desktop/sidecar/src/chat/sessionManager.ts`

### 2.2 Audio attach + transcribe-then-chat (1.2)

**Plan specification**: File + mic, transcribe via curated faster-whisper, label origin, redact secrets, zero outbound. Native audio tokens out of scope.

**What happened**: Composer accepts `audio/*` in Chat. Sidecar `audio.transcribe` uses `core/audio` + `runtimes/audio`. `prepareSttTranscript` redacts then labels `[origin:stt_transcript]`. Origin is always screened in `mustScreenOrigin`. CI uses `NEXUS_AUDIO_STUB=1`; live weights stay on the catalog path.

**Key files**: `core/audio/transcript.ts`, `runtimes/audio/engines.py`, `desktop/sidecar/src/handlers.ts`, `modules/coding/guardrails/toolResultOrigin.ts`

### 2.3 Voice loop (1.3)

**Plan specification**: PTT + VAD, capture indicator while mic is open, barge-in stops TTS, Kokoro TTS, fully offline.

**What happened**: Pure reducer in `voiceLoop.ts`. Chat bar is off by default. PTT is mousedown/mouseup. VAD is start/stop buttons (DF-3). TTS playback is abortable. Tests inject `MicRecorder` and `playAudio`.

**Key files**: `desktop/src/modules/chat/voiceLoop.ts`, `desktop/src/shared/chat/micRecorder.ts`, `desktop/src/modules/chat/ChatPage.tsx`

### 2.4 Tests and CI (1.4)

Desktop: gating, vision routing, audio bridge, voice loop, MediaComposer multimodal, sidecar audio handlers, mic recorder, IPC client. Root: `prepareSttTranscript`, in-memory + JSON-RPC runtime, SecurityPosture `stt_transcript`. Python: `tests/python/audio/test_audio_runtime.py` (unique basename so pytest does not collide with `ocr/test_main.py`). CI comment on `test-python-runtimes` names the audio stub; faster-whisper and Kokoro stay out of the wheel install.

## 3. Verification Gate

| Check | Result |
|---|---|
| Desktop Vitest + coverage | PASS (123 files before extra tests; new files also green). Overall ~91.9% lines |
| Root Vitest + coverage | PASS (471 passed, 3 skipped). Overall 88.2% lines / 83.96% branches / 90.85% functions |
| `npm run lint` (src modules) | PASS |
| desktop eslint + `tsc --noEmit` | PASS |
| `tsc -b` | PASS |
| `python -m pytest tests/python` | PASS (221) |

## 4. Known Issues

| Issue | Severity | Decision |
|---|---|---|
| Native audio tokens | P2 | Deferred (DF-1) |
| Raster OCR from Chat on text-only models | P2 | Deferred (DF-2) |
| Energy VAD | P2 | Deferred (DF-3) |
| Kokoro float32 WAV wrap | P3 | Deferred (DF-4) |
| Chat MemoryStore index | P2 | Deferred (DF-5) |
| ChildProcess timeout branches | P3 | Missing tests (MT-1) |

## 5. Plan Discrepancies

- VAD is an explicit start/stop control, not RMS silence detection.
- Chat RapidOCR of PNGs on text-only models is no longer reachable because the composer drops `image/*`.
- `createHandlerContext` takes optional `audio` after `workspacePath`; tests inject via object spread so positional OCR callers stay valid.

## 6. Assumptions Made

- Catalog `modalities` is the gate, not the older `isVisionCapableModel` helper (that helper still treats `gemma4:e4b` as vision).
- Transcribe-then-chat is available for every text model; `audio` in modalities only changes copy.
- Voice loop default off keeps existing ChatPage tests stable.

## 7. Testing Summary

Vision model: PNG reaches `sendMessage.images`. Text-only: PNG dropped. WAV: sidecar transcribe, origin chip, labelled prompt. PTT and VAD: capture indicator, mocked STT/TTS, spoken reply. Image Studio still has no mic. Python health/version need no engines.

## 8. TODO Tracker

- [x] 1.1 Vision routing
- [x] 1.2 Audio STT bridge
- [x] 1.3 Voice loop
- [x] 1.4 Tests + CI note
- [ ] Phase 2 browser tool surface

## 9. Summary and Next Steps

Phase 1 closes the multimodal Chat + local voice loop gate. Next: `/implement` Phase 2 (browser `DANGEROUS` tools, security design doc, Playwright, sanitized ARIA).

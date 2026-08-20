# Known Gaps - v2.0

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-19

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.0.0-adoption-governed-autonomy-multimodal.md](plans/v2.0.0-adoption-governed-autonomy-multimodal.md)

v1.20.0 in-progress items stay in [../../v1/v1.20/known-gaps.md](../../v1/v1.20/known-gaps.md). This file starts empty of carry-forward rows; Phase 5 reconciles v1.15+ gaps into v2.0.

## v2.0.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 7 | 0 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 1 | 0 |
| Quality-gate gaps (QG) | 0 | 0 |

### Open Items

#### Deferred

##### DF-1 - Native audio-token reasoning is not wired

- **Source phase**: Phase 1 - Audio attachment + transcribe-then-chat (1.2)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 1.2)
- **Reason**: The plan keeps native audio-token reasoning out of scope until a fitting local model exists. Transcribe-then-chat is the only audio path. Catalog `modalities` including `audio` only changes the composer tooltip.
- **Suggested next step**: When a local model that accepts audio tokens is catalogued, route clips as native audio instead of (or in addition to) labelled transcripts.

##### DF-2 - Chat RapidOCR of raster images is unreachable on text-only models

- **Source phase**: Phase 1 - Vision-chat routing (1.1)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 1.1)
- **Reason**: Image attach is gated on catalog `modalities` containing `image`. The composer drops `image/*` for text-only models so a PNG cannot reach the still-present OCR fallback path. PDFs and Office files still attach.
- **Suggested next step**: If product wants "parse this screenshot as text" on a text-only chat model, add an explicit Parse document action that does not reuse the vision attach affordance.

##### DF-3 - Voice-loop VAD is button-driven, not energy-based

- **Source phase**: Phase 1 - Local real-time voice loop (1.3)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 1.3)
- **Reason**: jsdom has no AnalyserNode energy path that is trustworthy in CI. VAD mode starts and stops capture from an explicit button. Silence events exist on the reducer for a later RMS hook.
- **Suggested next step**: Wire an AnalyserNode RMS threshold in the desktop renderer (not jsdom) and dispatch `silence` / `speech-start` from that measurement.

##### DF-4 - Live Kokoro PCM is wrapped as 16-bit WAV

- **Source phase**: Phase 1 - Local real-time voice loop (1.3)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 1.3)
- **Reason**: CI never loads Kokoro (`NEXUS_AUDIO_STUB=1`). The live `speak()` path concatenates float32 PCM and wraps it with a 16-bit WAV header. Playback on a host with weights may need an int16 conversion.
- **Suggested next step**: On a host with `kokoro-82m` installed, record one spoken reply and, if the WAV is noisy, convert float32 to int16 before `_wrap_wav`.

##### DF-5 - Chat STT transcripts are not written to MemoryStore

- **Source phase**: Phase 1 - Audio attachment + transcribe-then-chat (1.2)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 1.2)
- **Reason**: Local Chatbot Explorer has no MemoryStore. Sidecar coding hosts also have no store (v1.20 DF-1). Scrubbing happens on the transcribe path (`prepareSttTranscript` / `redactSecrets`) so a future index cannot ingest raw secrets.
- **Suggested next step**: When Chat gains a memory index, ingest the already-labelled, already-redacted transcript rather than the audio bytes.

##### DF-6 - Playwright is an optional local install, not a lockfile pin

- **Source phase**: Phase 2 - Browser tool family (2.2)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 2.2)
- **Reason**: Adding Playwright to `package.json` would make `npm ci` in CI download Chromium. Tests use `InMemoryBrowser` and a fake loader. The documented pin is Playwright 1.55.x via `npx playwright@1.55.0 install chromium`.
- **Suggested next step**: If a nightly job can cache browsers, add `playwright` as an optionalDependency with that pin and keep CI on InMemory.

##### DF-7 - VS Code prompt may trim all five `browser_*` tools under the 15-tool cap

- **Source phase**: Phase 2 - Browser tool family (2.2)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 2.2)
- **Reason**: `MAX_TOOL_COUNT` is 15. The five browser tools are `OPTIONAL_SPECIALTY_TOOLS`, so they trim before `codegraph_*`. A full catalog (core + specialty + codegraph) will often hide them from the VS Code system prompt. The desktop sidecar headless list always registers them when `browserEnabled` is true (sidecar default).
- **Suggested next step**: If desktop coding users need the tools in-prompt, either raise the cap with a measured Gemma-4 tool-call study or collapse the family to one `browser` tool with an `action` discriminator.

#### Missing Tests / Coverage Gaps

##### MT-1 - ChildProcessAudioRuntime timeout and malformed-line branches

- **Source phase**: Phase 1 - Testing and Stabilization (1.4)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 1.4)
- **Reason**: Unit tests cover in-memory runtime, factory `NEXUS_AUDIO_INMEMORY`, and one JSON-RPC stdio happy path. Timeout, child-exit, and non-JSON stdout lines remain uncovered. Folder branch coverage for `core/audio` is about 51%; global thresholds still pass.
- **Suggested next step**: Add a spawn fake that exits mid-request and one that writes a non-JSON line.

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| | | | |

(none yet)

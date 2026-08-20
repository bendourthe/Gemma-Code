# Known Gaps - v2.0

**Project**: Nexus AI Studio
**Status**: in-progress
**Last updated**: 2026-08-20

Per-version tracker of unfinished work, deferrals, and follow-ups. The next `/plan` ingests this file to decide what carries forward. Classifications: `NI` not-implemented, `DF` deferred, `BG` bug/known-issue, `MT` missing-tests/coverage, `WN` warning/suppressed, `QG` bypassed-gate/CI.

Plan: [plans/v2.0.0-adoption-governed-autonomy-multimodal.md](plans/v2.0.0-adoption-governed-autonomy-multimodal.md)

Phase 5 reconciliation: v1.15-v1.18 files are finalized and remain canonical. Still-open v1.19 and v1.20 rows stay in those files and are indexed below. This file owns v2.0.0 cycle gaps plus the named transfers from the Phase 5.2 prompt.

## v2.0.0

### Summary

| Category | Open | Resolved |
|---|---|---|
| Not implemented (NI) | 0 | 0 |
| Deferred (DF) | 13 | 2 |
| Bugs / regressions (BG) | 0 | 0 |
| Warnings (WN) | 0 | 0 |
| Missing tests / coverage gaps (MT) | 0 | 1 |
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

##### DF-8 - LongCat Avatar DiT inference is not vendored

- **Source phase**: Phase 3 - audio2video avatar mode (3.2)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 3.2)
- **Reason**: The required byte-level scan of an imported LongCat inference tree found no tree to import. Shipping un-scanned upstream `.py` would violate the precondition. CI and the adapter run the existing stub executor. Official INT8 shards are sha256-pinned in the catalog for a later scanned import.
- **Suggested next step**: Scan `meituan-longcat/LongCat-Video` (bucket-3 strip), then wire the INT8 loader behind `longcat_avatar.preflight` on a diffusion-pro host. Record GPU evidence; do not treat the stub as a live talking-head.

##### DF-9 - Continuation seam quality is unmeasured

- **Source phase**: Phase 3 - video continuation (3.1)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 3.1)
- **Reason**: Chaining UX and `continueFrom` payloads ship. No Wan 2.2 GPU run measured temporal seams between segments. Extra field `seamQuality` is `prototype-unmeasured`.
- **Suggested next step**: On a host with Wan 2.2 weights, generate a 3-segment clip and document visible seam artefacts before calling continuation production-quality.

##### DF-10 - Code-as-action sandbox and Query DSL are not built

- **Source phase**: Phase 4 - Code-as-action sandbox + Query DSL (4.3)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 4.3)
- **Reason**: Stretch item. Depends on 4.2's durable root (now shipped as a directory contract) plus PermissionTiers, ConfirmationGate, and GitSafetyNet. A locked-down worker, Query DSL, and opt-in script surface would expand the threat model in the same cycle as browser tools. JSON tool calls remain the default.
- **Suggested next step**: Opt-in per run, no network, no fs by default, hard timeout. Mutating operations must still pass PermissionTiers and ConfirmationGate. Direct fs/network from the worker must fail closed.

##### DF-11 - Fast small-model command router is not built

- **Source phase**: Phase 4 - Fast small-model command router (4.4)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 4.4)
- **Reason**: Stretch item. Needs a measured latency win versus the full AgentLoop and a Qwen-class local classifier. The router must never drop a permission tier (Atomic comparison Section 9). HarnessSelector already covers per-model profiles.
- **Suggested next step**: Classify short imperatives, abstain-and-escalate when uncertain, and send every proposed call through ConfirmationGate at its normal tier. Record a before/after latency number.

##### DF-12 - VRM Chat presence pane is not built

- **Source phase**: Phase 4 - VRM avatar presence layer (4.7)
- **Plan reference**: `docs/v2/v2.0/plans/v2.0.0-adoption-governed-autonomy-multimodal.md` (sub-task 4.7)
- **Reason**: The plan ships this only if Chat demand justifies it. No Chat demand was observed this cycle. Live2D stays rejected (proprietary Cubism Core). Depends on Phase 1.3 TTS timing for lip-sync.
- **Suggested next step**: If Chat users ask for a presence pane, add an optional three-vrm renderer, off by default, VRM only, local, with zero cost when disabled.

##### DF-13 - Inkling-Small GGUF stays text-only (v1.19.2 DF-2)

- **Source phase**: Phase 5 - Known-gaps reconciliation (5.2); origin v1.19.2 task 1.6
- **Plan reference**: `docs/v1/v1.19/plans/v1.19.2-adoption-catalog-and-model-expansion.md` (sub-task 1.6)
- **Reason**: Native Inkling-Small accepts text, image, and audio. The curated UD-IQ1_S GGUF has no verified llama.cpp multimodal projector. Catalog `modalities` is `["text"]`.
- **Suggested next step**: Add image/audio modalities only after a dated local load of an image and an audio clip on that GGUF. Keep the row out of `recommended.json`.

##### DF-14 - Kimi K3 is not a catalog LLM entry

- **Source phase**: Phase 5 - Known-gaps reconciliation (5.2); origin kimi-k3-in-c K4
- **Plan reference**: `docs/v2/v2.0/comparisons/v2.0.6-comparison-kimi-k3-in-c.md` (K4)
- **Reason**: v1.19.2 calibrated the patient tier. A Kimi K3 row waits on a GGUF in the Ollama-wrapped lineage. The C99 engine from kimi-k3-in-c stays rejected.
- **Suggested next step**: If an Ollama-served GGUF lands with a pin, add a patient-tier catalog row. Do not vendor the C engine or the 1.56 TB checkpoint.

### Carry-forward index (v1.15 through v1.20)

Canonical detail stays in the source file. v2.0 does not close these unless listed under Resolved.

| Source | Status of that file | What v2.0 does |
|---|---|---|
| [v1.15](../../v1/v1.15/known-gaps.md) | finalized | Installer mypy/NSIS/on-device QA rows stay there |
| [v1.16](../../v1/v1.16/known-gaps.md) | finalized | Gateway/OCR/MLX smokes stay there; parse_document composition moved to v1.20 then DF-1 here via v1.20 DF-1 |
| [v1.17](../../v1/v1.17/known-gaps.md) | finalized | Motion/Tailwind/installer-motion stay there. `asr-capture` orb mapping exists; Chat voice loop does not yet pass that activity |
| [v1.18](../../v1/v1.18/known-gaps.md) | finalized | 14 open DF (llama-server smoke, Hub CI, sidecar harness overlay, Windows sandbox partial, ...) stay there |
| [v1.19](../../v1/v1.19/known-gaps.md) | in-progress | v1.19.0 DF-2,3,6-11; v1.19.1 DF-1-5; v1.19.2 DF-1,3,4 stay there. Inkling multimodal is DF-13 here |
| [v1.20](../../v1/v1.20/known-gaps.md) | in-progress | Remaining: sidecar MemoryStore (DF-1), Docling defer (DF-5), ocr dir name (DF-6). Settings toggle and first-attachment/busy rules resolved in the v2.1 sweep. |

### Resolved

| ID | Title | Resolved in | Notes |
|---|---|---|---|
| OW-A2 scheduler | OpenWorker A2 local scheduler | v1.18.0 Phase 4 | `AgentRunScheduler` plus ask inbox. Morning-brief schedule remains off by default. Not re-opened in v2.0 |
| DF-5 | Chat STT transcripts indexed | v2.1.0 sweep | Chat-scoped `InMemoryMemoryHub` records redacted STT text (`chat-stt`). Sidecar coding MemoryStore remains v1.20 DF-1. |
| MT-1 | ChildProcessAudioRuntime timeout/malformed lines | v2.1.0 sweep | Spawn fakes cover timeout, child-exit, and a non-JSON stdout line. |

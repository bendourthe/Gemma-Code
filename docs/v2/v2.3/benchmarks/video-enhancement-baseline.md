# Video Enhancement Baseline

**Plan**: [Local Video Enhancement and Security Audit Intake](../plans/v2.3.0-adoption-qwen-video2x-openworker.md)
**Status**: candidate
**Captured at**: 2026-08-28
**Harness**: [scripts/bench-video-enhancement.mjs](../../../../scripts/bench-video-enhancement.mjs)
**Fixtures**: [tests/fixtures/video-enhancement/v1/](../../../../tests/fixtures/video-enhancement/v1/)
**Support contract**: [core/video/video-enhancement-support.json](../../../../core/video/video-enhancement-support.json)

This report records the v2.3.0 enhancement envelope. Observed rows come from the deterministic fake backend. Combinations that were not executed are labelled **not proven here**. This document does not invent a perceptual-quality score. Human artifact review belongs to Phase 6.

## Setup

Video enhancement is optional. Install Video2X 6.4.0 yourself, then set `NEXUS_VIDEO2X_PATH` or the typed setting `video.video2xPath` (Settings > Video > Video2X executable) to the absolute executable path. Nexus does not download, bundle, or search PATH for Video2X. FFmpeg remains the media probe and mux dependency.

Reproduce the CI contract:

```text
node scripts/bench-video-enhancement.mjs --backend fake --output-dir <isolated-dir>
```

Real hardware measurement requires an explicit `--backend real` invocation and a working Video2X 6.4.0 executable. That mode was not proven here.

## Support matrix

| Host | Classification | Evidence |
| ---- | ------------- | -------- |
| Windows x64 with AVX2 and a usable Vulkan GPU | candidate | Contract and installer/desktop copy agree. Packaged Video2X 6.4.0 field measurement is **not proven here**. |
| Linux x64 with AVX2 and a usable Vulkan GPU | candidate | Same contract. Nexus does not currently ship a Linux desktop package for this path. **not proven here**. |
| macOS | unsupported | Capability probe fails closed. Native adapter support is **not proven here**. |
| ARM64 | unsupported | Pinned upstream native release is x64. |
| CPU-only or non-AVX2 | unsupported | Preflight rejects these hosts. |
| Host without a usable Vulkan GPU | unsupported | Device preflight cannot establish an executable path. |

## Observed fake-backend contract (animation-upscale-2x)

Captured 2026-08-28 on the planning host with `--backend fake` (`fake-deterministic`). Wall-clock and RSS are informational Node-process values, never a GPU claim. Peak CPU, GPU, and VRAM are **not observed**.

| Fixture | Source | Output | Frames | Duration | Wall ms | Peak RSS KB | Validation |
| ------- | ------ | ------ | ------ | -------- | ------- | ----------- | ---------- |
| photoreal-480p | 854 x 480 @ 24/1 | 1708 x 960 @ 24/1 | 8 | 0.333333 s | 2.19 | 37172 | pass |
| photoreal-720p | 1280 x 720 @ 24/1 | 2560 x 1440 @ 24/1 | 8 | 0.333333 s | 2.92 | 37264 | pass |
| animation-480p | 854 x 480 @ 24/1 | 1708 x 960 @ 24/1 | 8 | 0.333333 s | 1.47 | 37336 | pass |
| animation-720p | 1280 x 720 @ 24/1 | 2560 x 1440 @ 24/1 | 8 | 0.333333 s | 1.64 | 37412 | pass |
| text-edges-480p | 854 x 480 @ 24/1 | 1708 x 960 @ 24/1 | 8 | 0.333333 s | 1.40 | 37416 | pass |
| text-edges-720p | 1280 x 720 @ 24/1 | 2560 x 1440 @ 24/1 | 8 | 0.333333 s | 2.07 | 37416 | pass |
| motion-occlusion-480p | 854 x 480 @ 24/1 | 1708 x 960 @ 24/1 | 8 | 0.333333 s | 1.67 | 37420 | pass |
| motion-occlusion-720p | 1280 x 720 @ 24/1 | 2560 x 1440 @ 24/1 | 8 | 0.333333 s | 1.61 | 38148 | pass |

Source bytes were unchanged after each fake run. Output files were readable, non-zero, and matched the expected 2x geometry. Disk cost of these fixtures is hundreds of bytes; that is not a Video2X working-set measurement.

## Not proven here

- Real Video2X 6.4.0 wall time, peak GPU, and VRAM on Windows or Linux.
- Packaged-app detection of a user-installed executable after the Windows installer.
- Perceptual quality of faces, text, animation edges, repeated texture, fast motion, or occlusion.
- 4x upscale, Smooth 2x, or combined upscale-plus-interpolation cost on real media.
- Automatic model download, PATH search, or bundled Video2X (rejected by contract).

Expected local resource cost for a real run remains **not proven here**. Operators should treat 4K/60 enhancement as potentially larger than generation in time and VRAM until a real-backend row exists.

## Troubleshooting

| Symptom | Honest result |
| ------- | ------------- |
| Missing configuration | Capability status `unavailable`, reason `missing_configuration`. Configure Settings > Video or `NEXUS_VIDEO2X_PATH`. |
| Relative or malformed path | `invalid_path`. The path must be absolute. |
| macOS, ARM64, CPU-only, no Vulkan | `unsupported` or the matching capability reason. Enhancement stays disabled. |
| Slow or hung probe | Capability probe times out. App startup does not wait on this probe. |
| Real `--backend real` without Video2X | Typed `missing_configuration` or `backend_unavailable`. The harness does not fabricate zeros. |

## Nexus-Hub security handoff

The OpenWorker-derived security-audit workflow remains an upstream Nexus-Hub v4.1.1 item. Current status: confirmed, implementation not started, not released. Nexus-AI did not consume an upstream Hub version in this phase and did not edit the sibling repository.

## Limitations

Enhancement synthesizes pixels and frames. It does not recover true detail. Combined upscale and interpolation is a two-stage Video2X workflow. Originals are preserved. Qwen3.8-Flash-Next is not in `core/registry/catalog.json`.

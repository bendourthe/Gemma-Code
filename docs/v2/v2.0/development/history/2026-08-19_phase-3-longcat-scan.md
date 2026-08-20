# LongCat-Video-Avatar-1.5 byte-level scan (v2.0.0 Phase 3)

**Date**: 2026-08-19
**Plan**: [v2.0.0-adoption-governed-autonomy-multimodal.md](../../plans/v2.0.0-adoption-governed-autonomy-multimodal.md) sub-task 3.2
**Verdict**: No upstream inference tree was copied into this repository. Weight files are identity-pinned. Community re-quantizations stay rejected.

## Code tree

The plan requires a byte-level scan of any LongCat inference tree **before** integration, then a strip per MCP Registry Policy bucket-3.

This cycle did **not** vendor `meituan-longcat/LongCat-Video` (no `run_demo_avatar_*.py`, no DiT loader, no third-party Python package under `runtimes/` or `desktop/sidecar/`).

What shipped instead is a Nexus-owned adapter:

- `runtimes/diffusion/pipelines/longcat_avatar.py` -- official-org / INT8 / confirmation / VRAM preflight. Zero outbound.
- `runtimes/diffusion/pipelines/video_audio2video.py` -- `diffusion.video.audio2video` handler. CI uses the existing stub executor.

A later patch that copies upstream `.py` must scan that tree first (secrets, phone-home URLs, `eval`/`exec`, hidden network, telemetry) and strip it before merge. Until then, live DiT inference is not in-tree (known gap DF-8).

## Official weights (inspected 2026-08-19)

Source: Hugging Face API `meituan-longcat/LongCat-Video-Avatar-1.5` / `base_model_int8/`. LFS `oid` values are SHA-256. Small JSON files were downloaded and hashed locally.

| Path | SHA-256 |
|---|---|
| `base_model_int8/config.json` | `cc2a21199db9a311b51e42b73f7921ea5d1d58b9fa0273563ab6edd7850adf76` |
| `base_model_int8/quantization_config.json` | `828eab210d88f7e8afdc6910c0467ccf83c9ccd445754f15afc5addd23dc3a5b` |
| `base_model_int8/quantized_model-00001-of-00004.safetensors` | `ccf575d8cdf8e762272e2d4e52ae1a7c0b5d1fa81e26dfa4592867de4dd9a4fd` |
| `base_model_int8/quantized_model-00002-of-00004.safetensors` | `af6ddb737ad66d12fd5892adee568c14314143ebd4388d3ab9cc6065754b3688` |
| `base_model_int8/quantized_model-00003-of-00004.safetensors` | `6a349b76592b4752c2967235af457824d8938e3514bad8e78cfa86009e8a9bf5` |
| `base_model_int8/quantized_model-00004-of-00004.safetensors` | `ab54b648a3f6a53946f07dd0a21441e2a8cb1aa8da17996b5f3f7f2e1370705b` |
| `base_model_int8/quantized_model.safetensors.index.json` | `480ca179ba2d53fa1c28b7c403ce4ba1f159bb708a584499d6645024bf12acff` |

These pins are the catalog `int8` variant for `longcat-video-avatar-1.5`. The installer puller verifies whichever variant is selected (`model_preflight.py` / `hf_weights_puller.py`). `official: true` is required; community FP8 re-uploads are rejected at catalog validate and again in `longcat_avatar.preflight`.

## Product gates

- Mode is `audio2video`, hidden unless `classifyDiffusionTier` is `diffusion-pro` and VRAM is at least 20 GB.
- User must tick the local-generation checkbox. Photo and audio never leave the device (no outbound in the adapter).
- Saved workflow JSON carries `provenance.neverLeftDevice`.

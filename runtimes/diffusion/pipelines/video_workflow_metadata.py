"""Workflow JSON builder for video outputs.

Mirrors `pipelines/workflow_metadata.py` for the video side -- the
payload differs (no PNG, the metadata lands in an MP4 `comment` tag via
the TS-side `core/video/WorkflowMetadata.ts`), but the JSON shape stays
compatible so downstream tools that already understand the image schema
can read the shared fields. Video-only fields: `durationSeconds`, `fps`,
`mode` (text2video / image2video), and an optional `sourceImageHash`.

The Python side stops at JSON building; it does *not* write the MP4
metadata itself because ffmpeg is bundled with the desktop installer
(Phase 9) and called from Node, not Python.
"""

from __future__ import annotations

import hashlib
from typing import Any, Dict

from . import video_params as video_params_mod


RUNTIME_TOOL_NAME = "nexus"
RUNTIME_TOOL_VERSION = "1.0.0"


def build_workflow(
    params: video_params_mod.VideoParams,
    timestamp: str,
) -> Dict[str, Any]:
    workflow: Dict[str, Any] = {
        "tool": RUNTIME_TOOL_NAME,
        "version": RUNTIME_TOOL_VERSION,
        "kind": "video",
        "mode": params.mode,
        "modelId": params.model_id,
        "prompt": params.prompt,
        "negativePrompt": params.negative_prompt,
        "width": params.width,
        "height": params.height,
        "durationSeconds": params.duration_seconds,
        "fps": params.fps,
        "frameCount": video_params_mod.frame_count(params),
        "steps": params.steps,
        "cfgScale": params.cfg_scale,
        "sampler": params.sampler,
        "seed": params.seed,
        "timestamp": timestamp,
    }
    if params.source_image is not None:
        workflow["sourceImageHash"] = _short_hash(params.source_image)
    if params.source_audio is not None:
        workflow["sourceAudioHash"] = _short_hash(params.source_audio)
    if params.mode == "audio2video":
        workflow["provenance"] = {
            "generatedBy": "nexus",
            "local": True,
            "neverLeftDevice": True,
            "weightRepo": params.weight_repo or "meituan-longcat/LongCat-Video-Avatar-1.5",
            "weightVariant": "int8",
            "modelId": params.model_id,
        }
    if params.continue_from:
        workflow["continueFrom"] = params.continue_from
        workflow["conditionedOnPriorEndingFrames"] = True
    return workflow


def _short_hash(payload: str) -> str:
    """Stable short identifier for an opaque base64 payload."""
    return hashlib.sha1(payload.encode("utf-8", errors="ignore")).hexdigest()[:16]

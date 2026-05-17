"""Tests for `runtimes.diffusion.pipelines.video_workflow_metadata`.

The Python side builds the JSON; the Node side writes / reads the MP4
metadata. We verify the JSON shape mirrors the image-side schema plus
the four video-specific fields, and that the source-image hash is a
stable short identifier (16 hex chars) rather than the full payload.
"""

from __future__ import annotations

import hashlib

from runtimes.diffusion.pipelines import video_params, video_workflow_metadata


def _params(mode: str = "text2video", **overrides):
    request = {
        "modelId": "ltx-video" if mode == "text2video" else "svd",
        "prompt": "a fox",
        "negativePrompt": "blurry",
        "width": 854,
        "height": 480,
        "durationSeconds": 4,
        "fps": 24,
        "steps": 30,
        "cfgScale": 3.5,
        "sampler": "euler_a",
        "seed": 17,
        "latentPreview": True,
    }
    if mode == "image2video":
        request["sourceImage"] = "data:image/png;base64,AAAA"
    request.update(overrides)
    return video_params.parse(mode, request)


def test_build_workflow_includes_all_fields_for_text2video():
    workflow = video_workflow_metadata.build_workflow(
        _params("text2video"),
        "2026-05-17T00:00:00Z",
    )
    assert workflow["tool"] == video_workflow_metadata.RUNTIME_TOOL_NAME
    assert workflow["version"] == video_workflow_metadata.RUNTIME_TOOL_VERSION
    assert workflow["kind"] == "video"
    assert workflow["mode"] == "text2video"
    assert workflow["modelId"] == "ltx-video"
    assert workflow["prompt"] == "a fox"
    assert workflow["negativePrompt"] == "blurry"
    assert workflow["durationSeconds"] == 4
    assert workflow["fps"] == 24
    assert workflow["frameCount"] == 96
    assert workflow["timestamp"] == "2026-05-17T00:00:00Z"
    assert "sourceImageHash" not in workflow


def test_build_workflow_for_image2video_includes_source_hash():
    workflow = video_workflow_metadata.build_workflow(
        _params("image2video"),
        "2026-05-17T00:00:00Z",
    )
    assert workflow["mode"] == "image2video"
    assert workflow["sourceImageHash"] == hashlib.sha1(
        b"data:image/png;base64,AAAA"
    ).hexdigest()[:16]


def test_short_hash_is_16_hex_chars():
    short = video_workflow_metadata._short_hash("anything")
    assert len(short) == 16
    int(short, 16)  # raises if not hex


def test_build_workflow_is_deterministic_for_same_input():
    a = video_workflow_metadata.build_workflow(_params(), "2026-05-17T00:00:00Z")
    b = video_workflow_metadata.build_workflow(_params(), "2026-05-17T00:00:00Z")
    assert a == b


def test_build_workflow_includes_resolution():
    workflow = video_workflow_metadata.build_workflow(
        _params("text2video", width=1280, height=720),
        "2026-05-17T00:00:00Z",
    )
    assert workflow["width"] == 1280
    assert workflow["height"] == 720


def test_build_workflow_carries_seed_and_sampler():
    workflow = video_workflow_metadata.build_workflow(
        _params("text2video", seed=42, sampler="dpmpp_2m"),
        "2026-05-17T00:00:00Z",
    )
    assert workflow["seed"] == 42
    assert workflow["sampler"] == "dpmpp_2m"

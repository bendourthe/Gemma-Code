"""Tests for video pipeline registration in `runtimes.diffusion.registry`.

The registry imports each pipeline module lazily and calls its
`register(handlers)` function. The two new video modules
(`video_text2video`, `video_image2video`) must each install a handler
keyed by the canonical method id.
"""

from __future__ import annotations

from runtimes.diffusion import registry
from runtimes.diffusion.pipelines import video_image2video, video_text2video


def test_register_installs_text2video_handler():
    handlers: dict = {}
    video_text2video.register(handlers)
    assert "diffusion.video.text2video" in handlers
    assert callable(handlers["diffusion.video.text2video"])


def test_register_installs_image2video_handler():
    handlers: dict = {}
    video_image2video.register(handlers)
    assert "diffusion.video.image2video" in handlers
    assert callable(handlers["diffusion.video.image2video"])


def test_registry_module_paths_include_video_pipelines():
    paths = registry._PIPELINE_MODULES
    assert "runtimes.diffusion.pipelines.video_text2video" in paths
    assert "runtimes.diffusion.pipelines.video_image2video" in paths


def test_register_pipeline_handlers_includes_video_methods():
    handlers: dict = {}
    registry.register_pipeline_handlers(handlers)
    assert "diffusion.video.text2video" in handlers
    assert "diffusion.video.image2video" in handlers


def test_video_handler_returns_ok_envelope_for_valid_request(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_VIDEO_OUTPUT_DIR", str(tmp_path))
    handlers: dict = {}
    video_text2video.register(handlers)
    handler = handlers["diffusion.video.text2video"]
    response = handler(
        {
            "jobId": "video-job-x",
            "mode": "text2video",
            "request": {
                "modelId": "ltx-video",
                "prompt": "snowy mountains",
                "width": 854,
                "height": 480,
                "durationSeconds": 2,
                "fps": 12,
                "steps": 10,
                "cfgScale": 3.5,
                "sampler": "euler_a",
                "seed": 9,
            },
        }
    )
    assert response["ok"] is True
    assert response["jobId"] == "video-job-x"
    assert response["mode"] == "text2video"
    assert response["workflow"]["modelId"] == "ltx-video"
    assert response["workflow"]["durationSeconds"] == 2


def test_video_handler_rejects_invalid_payload():
    handlers: dict = {}
    video_text2video.register(handlers)
    handler = handlers["diffusion.video.text2video"]
    response = handler({"jobId": "j", "mode": "text2video", "request": {}})
    assert response["ok"] is False
    assert response["error"] == "invalid-params"

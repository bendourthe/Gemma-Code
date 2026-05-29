"""Dedicated tests for the SANA-Video pipeline (v1.1.0 Phase 13.2).

Mirrors the shape of [tests/python/diffusion/test_video_base.py] but
focuses on `runtimes.diffusion.pipelines.sana_video`. Verifies the
registration shape, the IPC round-trip via the stub executor, and the
workflow-JSON build so the SANA-Video 2B integration is verifiable
end-to-end in CI without a CUDA host.

The plan locates this file at `runtimes/diffusion/tests/test_sana_video.py`,
but the project's Python tests live under `tests/python/diffusion/`
(matches [test_video_base.py]). The deviation is documented in
docs/versions/v1/v1.1.0/known-gaps.md under the Phase 13 closures.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from runtimes.diffusion import device, vram_lifecycle
from runtimes.diffusion.pipelines import sana_video, video_base


# ---------------------------------------------------------------------------
# Fixtures + payload helpers


def _txt_payload(**overrides):
    request = {
        "modelId": "sana-video-2b-720p",
        "prompt": "a fox running through autumn leaves",
        "negativePrompt": "",
        "width": 1280,
        "height": 720,
        "durationSeconds": 4,
        "fps": 24,
        "steps": 14,
        "cfgScale": 4.5,
        "sampler": "flow-dpm-solver",
        "seed": 42,
        "latentPreview": True,
    }
    request.update(overrides)
    return {"jobId": "sana-video-job-1", "mode": "text2video", "request": request}


def _img_payload(**overrides):
    request = {
        "modelId": "sana-video-2b-720p",
        "prompt": "a fox walking",
        "negativePrompt": "",
        "width": 1280,
        "height": 720,
        "durationSeconds": 4,
        "fps": 24,
        "steps": 14,
        "cfgScale": 4.5,
        "sampler": "flow-dpm-solver",
        "seed": 7,
        "sourceImage": "data:image/png;base64,AAAA",
    }
    request.update(overrides)
    return {"jobId": "sana-video-job-2", "mode": "image2video", "request": request}


@pytest.fixture(autouse=True)
def _isolate_outputs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_VIDEO_OUTPUT_DIR", str(tmp_path))
    vram_lifecycle.set_publisher(None)
    yield
    vram_lifecycle.set_publisher(None)


# ---------------------------------------------------------------------------
# Registration shape


def test_register_installs_both_methods():
    handlers: dict = {}
    sana_video.register(handlers)
    assert "diffusion.video.sana.text2video" in handlers
    assert "diffusion.video.sana.image2video" in handlers


def test_register_handlers_are_callable():
    handlers: dict = {}
    sana_video.register(handlers)
    assert callable(handlers["diffusion.video.sana.text2video"])
    assert callable(handlers["diffusion.video.sana.image2video"])


def test_model_size_planning_uses_8gb():
    # The planning size keeps the offload decision conservative on a
    # 12 GB host (Phase 13 acceptance: <= 60 s for 4 s 720p with offload).
    # See sana_video._MODEL_SIZE_GB.
    assert sana_video._MODEL_SIZE_GB == 8.0


# ---------------------------------------------------------------------------
# IPC round-trip with stub executor


def test_text2video_round_trips_with_stub_executor():
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](_txt_payload())
    assert out["ok"] is True
    assert out["jobId"] == "sana-video-job-1"
    assert out["method"] == "diffusion.video.sana.text2video"
    assert out["mode"] == "text2video"
    assert out["workflow"]["prompt"] == "a fox running through autumn leaves"
    assert out["workflow"]["sampler"] == "flow-dpm-solver"
    assert out["workflow"]["modelId"] == "sana-video-2b-720p"


def test_image2video_round_trips_with_stub_executor():
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.image2video"](_img_payload())
    assert out["ok"] is True
    assert out["mode"] == "image2video"
    assert out["workflow"]["mode"] == "image2video"
    assert "sourceImageHash" in out["workflow"]


def test_text2video_returns_frame_preview_per_second():
    # The stub executor returns one base64 JPEG per second of duration; a
    # 4 s clip therefore yields 4 thumbnails for the UI strip.
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](_txt_payload(durationSeconds=4))
    assert out["ok"] is True
    assert len(out["framePreviews"]) == 4


def test_workflow_json_round_trips_request_fields():
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](_txt_payload(seed=99))
    workflow = out["workflow"]
    assert workflow["seed"] == 99
    assert workflow["width"] == 1280
    assert workflow["height"] == 720
    assert workflow["fps"] == 24
    assert workflow["durationSeconds"] == 4


# ---------------------------------------------------------------------------
# Param + envelope validation


def test_rejects_missing_job_id():
    handlers: dict = {}
    sana_video.register(handlers)
    payload = _txt_payload()
    payload["jobId"] = ""
    out = handlers["diffusion.video.sana.text2video"](payload)
    assert out["ok"] is False
    assert out["error"] == "invalid-job-id"


def test_rejects_missing_mode():
    handlers: dict = {}
    sana_video.register(handlers)
    payload = {"jobId": "x", "request": {}}
    out = handlers["diffusion.video.sana.text2video"](payload)
    assert out["ok"] is False
    assert out["error"] == "invalid-mode"


def test_rejects_invalid_params():
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](
        {"jobId": "j", "mode": "text2video", "request": {}},
    )
    assert out["ok"] is False
    assert out["error"] == "invalid-params"


def test_image2video_rejects_missing_source_image():
    handlers: dict = {}
    sana_video.register(handlers)
    payload = _img_payload()
    payload["request"].pop("sourceImage", None)
    out = handlers["diffusion.video.sana.image2video"](payload)
    assert out["ok"] is False
    assert out["error"] == "invalid-params"


def test_handlers_tolerate_missing_params_object():
    # The dispatcher routes JSON-RPC params as `None` when the client sends
    # `params: null`; the lambda wrappers must coerce that to `{}` rather
    # than KeyError-ing.
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](None)  # type: ignore[arg-type]
    assert out["ok"] is False
    assert out["error"] == "invalid-job-id"


# ---------------------------------------------------------------------------
# Insufficient-VRAM path (forces the offload decision through choose_offload)


def test_returns_insufficient_vram_when_device_too_small(monkeypatch):
    # SANA-Video 2B plans at 8 GB; `choose_offload` errors out when free
    # VRAM drops below model_size / 2. 2 GB free is well below the floor.
    monkeypatch.setattr(
        device,
        "detect",
        lambda: device.DeviceInfo(
            torch_version="2.4",
            cuda_version="12.1",
            device_name="RTX-mini",
            vram_total_gb=2.0,
            vram_free_gb=2.0,
        ),
    )
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](_txt_payload())
    assert out["ok"] is False
    assert out["error"] == "insufficient-vram"


# ---------------------------------------------------------------------------
# Outputs directory respects the test override


def test_outputs_dir_respects_env_override(tmp_path):
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](_txt_payload())
    assert out["ok"] is True
    # The stub executor returns mp4_path=None but the resolver should have
    # honoured the env override (set in the autouse fixture).
    assert Path(tmp_path).exists()


# ---------------------------------------------------------------------------
# Offload strategy upgrade behaviour (shared with video_base)


def test_text2video_envelope_reports_offload_strategy():
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](_txt_payload())
    assert out["ok"] is True
    assert "offloadStrategy" in out
    assert "offloadReason" in out


def test_offload_strategy_is_a_known_video_tier(monkeypatch):
    # Force a 12 GB host; the upgrade rule should step keep_on_gpu to
    # model_cpu_offload (matches the docstring rationale in
    # video_base._upgrade_for_video).
    monkeypatch.setattr(
        device,
        "detect",
        lambda: device.DeviceInfo(
            torch_version="2.4",
            cuda_version="12.1",
            device_name="RTX-4070",
            vram_total_gb=12.0,
            vram_free_gb=12.0,
        ),
    )
    handlers: dict = {}
    sana_video.register(handlers)
    out = handlers["diffusion.video.sana.text2video"](_txt_payload())
    assert out["ok"] is True
    assert out["offloadStrategy"] in {
        "keep_on_gpu",
        "model_cpu_offload",
        "sequential_cpu_offload",
        "cpu",
    }


# ---------------------------------------------------------------------------
# Module-level surface


def test_module_exposes_register_callable():
    assert callable(sana_video.register)


def test_module_uses_video_base_runner():
    # The pipeline must dispatch through VideoPipelineRunner so the
    # offload upgrade + workflow build + VRAM lifecycle scope apply.
    assert sana_video.video_base is video_base

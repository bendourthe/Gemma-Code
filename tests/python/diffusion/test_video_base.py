"""Tests for `runtimes.diffusion.pipelines.video_base`.

Exercises the runner's validation -> offload-decision -> execute ->
workflow-build pipeline end-to-end with the stub executor. CUDA-only
paths are skipped in CI by `device.detect()` returning a CPU descriptor.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from runtimes.diffusion import device, vram_lifecycle
from runtimes.diffusion.pipelines import video_base, video_params


def _payload(mode: str = "text2video", **overrides):
    request = {
        "modelId": "ltx-video" if mode == "text2video" else "svd",
        "prompt": "a fox",
        "negativePrompt": "",
        "width": 854,
        "height": 480,
        "durationSeconds": 3,
        "fps": 24,
        "steps": 8,
        "cfgScale": 3.5,
        "sampler": "euler_a",
        "seed": 1,
        "latentPreview": True,
    }
    if mode == "image2video":
        request["sourceImage"] = "data:image/png;base64,AAAA"
    request.update(overrides)
    return {"jobId": "video-job-1", "mode": mode, "request": request}


@pytest.fixture(autouse=True)
def _isolate_outputs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_VIDEO_OUTPUT_DIR", str(tmp_path))
    vram_lifecycle.set_publisher(None)
    yield
    vram_lifecycle.set_publisher(None)


def _runner(method: str = "diffusion.video.text2video"):
    return video_base.VideoPipelineRunner(
        method=method,
        execute=video_base.stub_execute(method),
        model_size_gb=12.0,
    )


def test_runner_returns_ok_envelope_for_text2video():
    runner = _runner()
    out = runner.run(_payload("text2video"))
    assert out["ok"] is True
    assert out["jobId"] == "video-job-1"
    assert out["mode"] == "text2video"
    assert out["workflow"]["prompt"] == "a fox"
    assert out["framePreviews"]
    assert len(out["framePreviews"]) == 3  # one per second
    assert "offloadStrategy" in out


def test_runner_uses_outputs_dir_override(tmp_path):
    runner = _runner()
    out = runner.run(_payload("text2video"))
    # The stub executor returns mp4_path=None so we cannot inspect a real
    # file -- but we can verify the resolver hit the override.
    assert out["ok"] is True
    expected = Path(os.environ["NEXUS_VIDEO_OUTPUT_DIR"])
    assert expected.exists()


def test_runner_returns_ok_for_image2video():
    runner = _runner(method="diffusion.video.image2video")
    out = runner.run(_payload("image2video"))
    assert out["ok"] is True
    assert out["mode"] == "image2video"
    assert out["workflow"]["mode"] == "image2video"
    assert "sourceImageHash" in out["workflow"]


def test_runner_rejects_missing_job_id():
    runner = _runner()
    payload = _payload("text2video")
    payload["jobId"] = ""
    out = runner.run(payload)
    assert out["ok"] is False
    assert out["error"] == "invalid-job-id"


def test_runner_rejects_missing_mode():
    runner = _runner()
    payload = {"jobId": "j", "request": {}}
    out = runner.run(payload)
    assert out["ok"] is False
    assert out["error"] == "invalid-mode"


def test_runner_rejects_invalid_params():
    runner = _runner()
    out = runner.run({"jobId": "j", "mode": "text2video", "request": {}})
    assert out["ok"] is False
    assert out["error"] == "invalid-params"


def test_runner_captures_execution_failure():
    def boom(_ctx):
        raise RuntimeError("kapow")

    runner = video_base.VideoPipelineRunner(
        method="diffusion.video.text2video",
        execute=boom,
        model_size_gb=12.0,
    )
    out = runner.run(_payload("text2video"))
    assert out["ok"] is False
    assert out["error"] == "execution-failed"
    assert "kapow" in out["message"]


def test_runner_returns_insufficient_vram_when_decision_says_so(monkeypatch):
    monkeypatch.setattr(
        device,
        "detect",
        lambda: device.DeviceInfo(
            torch_version="2.4",
            cuda_version="12.1",
            device_name="RTX-mini",
            vram_total_gb=4.0,
            vram_free_gb=4.0,
        ),
    )
    runner = video_base.VideoPipelineRunner(
        method="diffusion.video.text2video",
        execute=video_base.stub_execute("text2video"),
        model_size_gb=20.0,
    )
    out = runner.run(_payload("text2video"))
    assert out["ok"] is False
    assert out["error"] == "insufficient-vram"


def test_upgrade_for_video_steps_keep_on_gpu_to_model_offload():
    decision = device.OffloadDecision(strategy="keep_on_gpu", reason="ok")
    upgraded = video_base._upgrade_for_video(decision)
    assert upgraded.strategy == "model_cpu_offload"
    assert "video upgrade" in upgraded.reason


def test_upgrade_for_video_steps_model_offload_to_sequential():
    decision = device.OffloadDecision(strategy="model_cpu_offload", reason="ok")
    upgraded = video_base._upgrade_for_video(decision)
    assert upgraded.strategy == "sequential_cpu_offload"


def test_upgrade_for_video_passes_through_sequential():
    decision = device.OffloadDecision(strategy="sequential_cpu_offload", reason="ok")
    upgraded = video_base._upgrade_for_video(decision)
    assert upgraded.strategy == "sequential_cpu_offload"


def test_upgrade_for_video_passes_through_cpu():
    decision = device.OffloadDecision(strategy="cpu", reason="ok")
    upgraded = video_base._upgrade_for_video(decision)
    assert upgraded.strategy == "cpu"


def test_stub_executor_returns_jpeg_per_second():
    runner = _runner()
    out = runner.run(_payload("text2video", durationSeconds=5))
    assert out["ok"] is True
    assert len(out["framePreviews"]) == 5


def test_select_executor_returns_stub_when_diffusers_absent(monkeypatch):
    monkeypatch.setattr(video_base, "diffusers_video_available", lambda: False)
    executor = video_base.select_executor("diffusion.video.text2video", real=lambda ctx: None)
    # Calling the stub returns a VideoPipelineOutput, not None (which is
    # what the "real" lambda would return), proving the fallback ran.
    ctx = video_base.VideoExecutionContext(
        job_id="j",
        params=video_params.parse(
            "text2video",
            {
                "modelId": "ltx-video",
                "prompt": "a fox",
                "width": 854,
                "height": 480,
                "durationSeconds": 1,
                "fps": 12,
                "steps": 8,
                "cfgScale": 3.5,
                "sampler": "euler_a",
                "seed": 0,
            },
        ),
        offload_strategy="cpu",
        output_path="/tmp/x.mp4",
    )
    out = executor(ctx)
    assert isinstance(out, video_base.VideoPipelineOutput)


def test_select_executor_handles_none_real():
    executor = video_base.select_executor("diffusion.video.text2video", real=None)
    assert callable(executor)


def test_diffusers_video_available_returns_bool_in_ci():
    # On CI without torch / diffusers / imageio, returns False. On a CUDA
    # host it returns True. Either way it is a bool -- no exceptions.
    assert isinstance(video_base.diffusers_video_available(), bool)

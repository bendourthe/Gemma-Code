"""Tests for the four pipeline runners.

Each pipeline ships a stub executor in CI; the runner orchestration
(validation -> offload decision -> execution -> workflow embed) is what
we exercise here. The real diffusers path is operator-driven.
"""

from __future__ import annotations

from runtimes.diffusion.pipelines import base


def _payload(mode: str, **overrides):
    request = {
        "modelId": "sdxl-turbo",
        "prompt": "a fox",
        "negativePrompt": "",
        "width": 1024,
        "height": 1024,
        "steps": 4,
        "cfgScale": 1.5,
        "sampler": "euler_a",
        "seed": 7,
        "batchSize": 1,
        "latentPreview": True,
        "loras": [],
    }
    request.update(overrides)
    return {"jobId": "job-abc", "mode": mode, "request": request}


def test_runner_returns_ok_envelope_for_txt2img():
    runner = base.PipelineRunner(mode="txt2img", execute=base.stub_execute("txt2img"))
    out = runner.run(_payload("txt2img"))
    assert out["ok"] is True
    assert out["jobId"] == "job-abc"
    assert out["mode"] == "txt2img"
    assert "pngBase64" in out
    assert out["workflow"]["prompt"] == "a fox"


def test_runner_rejects_invalid_params():
    runner = base.PipelineRunner(mode="txt2img", execute=base.stub_execute("txt2img"))
    out = runner.run({"jobId": "j", "mode": "txt2img", "request": {"prompt": "x"}})
    assert out["ok"] is False
    assert out["error"] == "invalid-params"


def test_runner_rejects_missing_job_id():
    runner = base.PipelineRunner(mode="txt2img", execute=base.stub_execute("txt2img"))
    out = runner.run({"jobId": "", "mode": "txt2img", "request": {}})
    assert out["ok"] is False
    assert out["error"] == "invalid-job-id"


def test_runner_captures_execution_failure():
    def boom(_ctx):
        raise RuntimeError("kapow")

    runner = base.PipelineRunner(mode="txt2img", execute=boom)
    out = runner.run(_payload("txt2img"))
    assert out["ok"] is False
    assert out["error"] == "execution-failed"
    assert "kapow" in out["message"]


def test_runner_includes_offload_strategy():
    runner = base.PipelineRunner(mode="txt2img", execute=base.stub_execute("txt2img"))
    out = runner.run(_payload("txt2img"))
    # When there is no CUDA, the strategy is "cpu" per `device.choose_offload`.
    assert out["offloadStrategy"] in {"cpu", "keep_on_gpu", "model_cpu_offload"}


def test_stub_execute_returns_minimal_png():
    runner = base.PipelineRunner(mode="img2img", execute=base.stub_execute("img2img"))
    out = runner.run(
        _payload(
            "img2img",
        )
    )
    # img2img requires sourceImage; the runner should reject missing field
    assert out["ok"] is False
    out_ok = runner.run(
        {
            "jobId": "j2",
            "mode": "img2img",
            "request": {
                "modelId": "sdxl-turbo",
                "prompt": "a fox",
                "width": 512,
                "height": 512,
                "steps": 8,
                "cfgScale": 4,
                "sampler": "euler_a",
                "seed": 1,
                "sourceImage": "data:image/png;base64,AAAA",
                "strength": 0.7,
            },
        }
    )
    assert out_ok["ok"] is True
    assert out_ok["mode"] == "img2img"


def test_layer_streaming_completes_previously_insufficient_vram(monkeypatch):
    from runtimes.diffusion import device as device_mod

    monkeypatch.setattr(
        device_mod,
        "detect",
        lambda: device_mod.DeviceInfo("t", "c", "gpu", 8.0, 1.0),
    )
    runner = base.PipelineRunner(
        mode="txt2img",
        execute=base.stub_execute("txt2img"),
        model_size_gb=8.0,
    )
    blocked = runner.run(_payload("txt2img"))
    assert blocked["ok"] is False
    assert blocked["error"] == "insufficient-vram"
    streamed = runner.run(_payload("txt2img", layerStreaming=True))
    assert streamed["ok"] is True
    assert streamed["offloadStrategy"] == "sequential_cpu_offload"

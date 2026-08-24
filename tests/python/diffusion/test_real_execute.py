"""Tests for the v2.2.5 fail-closed generate path (no GPU required)."""

from __future__ import annotations

from pathlib import Path

import pytest

from runtimes.diffusion.pipelines import base, real_execute, video_base, video_params


def test_resolve_weights_dir_returns_none_when_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    assert real_execute.resolve_weights_dir("sana-1.6b-int4") is None


def test_resolve_weights_dir_finds_safe_and_raw_ids(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    target = tmp_path / "weights" / "sana-1.6b-int4"
    target.mkdir(parents=True)
    (target / "model_index.json").write_text("{}", encoding="utf-8")
    assert real_execute.resolve_weights_dir("sana-1.6b-int4") == target


def test_image_execute_fails_closed_without_gpu(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: False)
    monkeypatch.setattr(real_execute, "allow_cpu", lambda: False)
    ctx = base.ExecutionContext(
        job_id="job-1",
        mode="txt2img",
        params=base.params.parse(
            "txt2img",
            {
                "modelId": "sana-1.6b-1024",
                "prompt": "a fox",
                "width": 64,
                "height": 64,
                "steps": 1,
                "cfgScale": 1.0,
                "sampler": "euler_a",
                "seed": 1,
            },
        ),
        offload_strategy="cpu",
    )
    with pytest.raises(base.RuntimeNotReady, match="GPU not available"):
        real_execute.image_execute(ctx)


def test_image_execute_fails_when_weights_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    ctx = base.ExecutionContext(
        job_id="job-1",
        mode="txt2img",
        params=base.params.parse(
            "txt2img",
            {
                "modelId": "sana-1.6b-1024",
                "prompt": "a fox",
                "width": 64,
                "height": 64,
                "steps": 1,
                "cfgScale": 1.0,
                "sampler": "euler_a",
                "seed": 1,
            },
        ),
        offload_strategy="keep_on_gpu",
    )
    with pytest.raises(base.RuntimeNotReady, match="weights not found"):
        real_execute.image_execute(ctx)


def test_fail_closed_executor_returns_runtime_not_ready_envelope():
    runner = base.PipelineRunner(mode="txt2img", execute=base.fail_closed_execute("txt2img"))
    out = runner.run(
        {
            "jobId": "job-closed",
            "mode": "txt2img",
            "request": {
                "modelId": "sana-1.6b-1024",
                "prompt": "a fox",
                "width": 64,
                "height": 64,
                "steps": 1,
                "cfgScale": 1.0,
                "sampler": "euler_a",
                "seed": 1,
            },
        }
    )
    assert out["ok"] is False
    assert out["error"] == "runtime-not-ready"
    assert "not ready" in out["message"]


def test_video_select_executor_fail_closes_when_stub_disallowed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(base, "allow_stub", lambda: False)
    monkeypatch.setattr(base, "can_run_real", lambda: False)
    fn = video_base.select_executor("text2video", real=None)
    ctx = video_base.VideoExecutionContext(
        job_id="j",
        params=video_params.parse(
            "text2video",
            {
                "modelId": "ltx-video",
                "prompt": "x",
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
    with pytest.raises(base.RuntimeNotReady, match="not ready"):
        fn(ctx)


def test_select_executor_fail_closes_when_stub_disallowed(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(base, "allow_stub", lambda: False)
    monkeypatch.setattr(base, "can_run_real", lambda: False)
    fn = base.select_executor("txt2img", real=None)
    with pytest.raises(base.RuntimeNotReady):
        fn(
            base.ExecutionContext(
                job_id="j",
                mode="txt2img",
                params=base.params.parse(
                    "txt2img",
                    {
                        "modelId": "sdxl-turbo",
                        "prompt": "x",
                        "width": 64,
                        "height": 64,
                        "steps": 1,
                        "cfgScale": 1.0,
                        "sampler": "euler_a",
                        "seed": 1,
                    },
                ),
                offload_strategy="cpu",
            )
        )

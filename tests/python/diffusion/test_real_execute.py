"""Tests for the v2.2.5 fail-closed generate path (no GPU required)."""

from __future__ import annotations

from pathlib import Path

import pytest

from runtimes.diffusion.pipelines import base, real_execute, video_base, video_params


def test_resolve_weights_dir_returns_none_when_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    assert real_execute.resolve_weights_dir("sana-1.6b-int4") is None


def test_resolve_weights_dir_finds_safe_and_raw_ids(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    target = tmp_path / "weights" / "sana-1.6b-int4"
    target.mkdir(parents=True)
    (target / "model_index.json").write_text("{}", encoding="utf-8")
    assert real_execute.resolve_weights_dir("sana-1.6b-int4") == target


def _image_ctx(model_id: str = "sana-1.6b-1024") -> base.ExecutionContext:
    return base.ExecutionContext(
        job_id="job-1",
        mode="txt2img",
        params=base.params.parse(
            "txt2img",
            {
                "modelId": model_id,
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


def _video_ctx(model_id: str = "ltx-video") -> video_base.VideoExecutionContext:
    return video_base.VideoExecutionContext(
        job_id="j",
        params=video_params.parse(
            "text2video",
            {
                "modelId": model_id,
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


def test_image_execute_fails_closed_without_gpu(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: False)
    monkeypatch.setattr(real_execute, "allow_cpu", lambda: False)
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "no-gpu")
    with pytest.raises(base.RuntimeNotReady, match="GPU not available"):
        real_execute.image_execute(_image_ctx())


def test_image_execute_fails_when_weights_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute.image_execute(_image_ctx())
    message = str(excinfo.value)
    assert "weights for model sana-1.6b-1024 not found at" in message
    assert str(tmp_path) in message
    assert excinfo.value.kind == "weights-missing"


def test_fail_closed_executor_returns_runtime_not_ready_envelope(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "no-cuda-torch")
    runner = base.PipelineRunner(
        mode="txt2img", execute=base.fail_closed_execute("txt2img")
    )
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


def test_video_select_executor_fail_closes_when_stub_disallowed(
    monkeypatch: pytest.MonkeyPatch,
):
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


def test_select_executor_fail_closes_when_stub_disallowed(
    monkeypatch: pytest.MonkeyPatch,
):
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


# ---------------------------------------------------------------------------
# v2.2.9 T009 -- typed runtime-not-ready reasons (image + video)
# ---------------------------------------------------------------------------


def test_fail_closed_image_reports_cuda_torch_missing(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "no-cuda-torch")
    fn = base.fail_closed_execute("txt2img")
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        fn(_image_ctx())
    message = str(excinfo.value)
    assert "no CUDA torch in the diffusion Python environment" in message
    assert "Ollama" in message
    assert message.startswith("image runtime is not ready")
    assert excinfo.value.kind == "cuda-torch-missing"
    assert "weights" not in message


def test_fail_closed_image_reports_weights_missing_with_id_and_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "ok")
    fn = base.fail_closed_execute("txt2img")
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        fn(_image_ctx("sdxl-turbo"))
    message = str(excinfo.value)
    assert "weights for model sdxl-turbo not found at" in message
    assert str(tmp_path) in message
    assert message.startswith("image runtime is not ready")
    assert excinfo.value.kind == "weights-missing"
    assert "CUDA torch" not in message


def test_fail_closed_image_reports_gpu_not_available(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "no-gpu")
    fn = base.fail_closed_execute("txt2img")
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        fn(_image_ctx())
    message = str(excinfo.value)
    assert "GPU not available" in message
    assert "no usable CUDA device" in message
    assert excinfo.value.kind == "gpu-not-available"


def test_probe_order_reports_cuda_before_weights(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """When BOTH CUDA torch and weights are missing, exactly one kind wins."""
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "no-cuda-torch")
    exc = base.classify_runtime_not_ready("image", "sdxl-turbo")
    assert exc.kind == "cuda-torch-missing"
    assert "weights" not in str(exc)


def test_fail_closed_video_reports_cuda_torch_missing(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "no-cuda-torch")
    fn = video_base.fail_closed_execute("text2video")
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        fn(_video_ctx())
    message = str(excinfo.value)
    assert message.startswith("video runtime is not ready")
    assert "no CUDA torch in the diffusion Python environment" in message
    assert "Ollama" in message
    assert excinfo.value.kind == "cuda-torch-missing"


def test_fail_closed_video_reports_weights_missing_with_id_and_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "ok")
    fn = video_base.fail_closed_execute("text2video")
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        fn(_video_ctx("ltx-video"))
    message = str(excinfo.value)
    assert message.startswith("video runtime is not ready")
    assert "weights for model ltx-video not found at" in message
    assert str(tmp_path) in message
    assert excinfo.value.kind == "weights-missing"


def test_fail_closed_video_reports_gpu_not_available(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "no-gpu")
    fn = video_base.fail_closed_execute("text2video")
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        fn(_video_ctx())
    message = str(excinfo.value)
    assert message.startswith("video runtime is not ready")
    assert "GPU not available" in message
    assert excinfo.value.kind == "gpu-not-available"


def test_video_weights_missing_in_real_execute_names_model(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute.video_execute(_video_ctx("ltx-video"))
    message = str(excinfo.value)
    assert "weights for model ltx-video not found at" in message
    assert excinfo.value.kind == "weights-missing"


def test_torch_cuda_state_classifies_fake_torch(monkeypatch: pytest.MonkeyPatch):
    import sys
    import types

    fake = types.ModuleType("torch")
    fake.version = types.SimpleNamespace(cuda=None)
    monkeypatch.setitem(sys.modules, "torch", fake)
    assert base.torch_cuda_state() == "no-cuda-torch"

    fake.version = types.SimpleNamespace(cuda="12.1")
    fake.cuda = types.SimpleNamespace(is_available=lambda: False)
    assert base.torch_cuda_state() == "no-gpu"

    fake.cuda = types.SimpleNamespace(is_available=lambda: True)
    assert base.torch_cuda_state() == "ok"


def test_stub_stays_pytest_gated(monkeypatch: pytest.MonkeyPatch):
    """Stub output is pytest-only: the env flag alone never enables it on a
    real host (v2.2.9 Goal-review fix: the flag used to be an OR-gate)."""
    monkeypatch.delenv("NEXUS_DIFFUSION_ALLOW_STUB", raising=False)
    assert base.allow_stub() is True  # pytest sets PYTEST_CURRENT_TEST
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    assert base.allow_stub() is False
    monkeypatch.setenv("NEXUS_DIFFUSION_ALLOW_STUB", "1")
    assert base.allow_stub() is False  # flag without pytest: still no stub


def test_typed_messages_are_ascii_only(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("NEXUS_MODELS_ROOT", "nexus-models-root")
    for kind in ("image", "video"):
        for message in (
            base.cuda_torch_missing_message(kind),
            base.weights_missing_message(kind, "sdxl-turbo"),
            base.gpu_unavailable_message(kind),
        ):
            message.encode("ascii")

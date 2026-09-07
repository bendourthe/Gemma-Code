"""Tests for the v2.2.5 fail-closed generate path (no GPU required)."""

from __future__ import annotations

import sys
import types
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


def test_sdxl_single_checkpoint_uses_from_single_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    checkpoint = tmp_path / "model.safetensors"
    checkpoint.write_bytes(b"weights")
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeSdxl:
        @staticmethod
        def from_single_file(path: str, **kwargs):
            calls.append((path, kwargs))
            return "pipe"

    fake = types.ModuleType("diffusers")
    fake.StableDiffusionXLPipeline = FakeSdxl
    monkeypatch.setitem(sys.modules, "diffusers", fake)
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: "bf16")

    assert real_execute._load_text_pipe(tmp_path, "realvisxl-v5") == "pipe"
    assert calls == [
        (
            str(checkpoint),
            {"torch_dtype": "bf16", "local_files_only": True},
        )
    ]


def test_sdxl_fp16_diffusers_layout_requests_variant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    (tmp_path / "model_index.json").write_text("{}", encoding="utf-8")
    unet = tmp_path / "unet"
    unet.mkdir()
    (unet / "diffusion_pytorch_model.fp16.safetensors").write_bytes(b"weights")
    calls: list[tuple[str, dict[str, object]]] = []

    class FakeAuto:
        @staticmethod
        def from_pretrained(path: str, **kwargs):
            calls.append((path, kwargs))
            return "pipe"

    fake = types.ModuleType("diffusers")
    fake.AutoPipelineForText2Image = FakeAuto
    monkeypatch.setitem(sys.modules, "diffusers", fake)
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: "bf16")

    assert real_execute._load_text_pipe(tmp_path, "realvisxl-v5") == "pipe"
    assert calls == [
        (
            str(tmp_path),
            {"torch_dtype": "bf16", "local_files_only": True, "variant": "fp16"},
        )
    ]


def test_partial_sana_layout_fails_before_model_load(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    (tmp_path / "transformer").mkdir()
    (tmp_path / "transformer" / "diffusion_pytorch_model.safetensors").write_bytes(
        b"partial"
    )
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: "bf16")
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute._load_text_pipe(tmp_path, "sana-1.6b-1024")
    assert excinfo.value.kind == "model-layout-invalid"


def test_clip_frames_for_export_does_not_boolean_test_numpy_batch():
    class AmbiguousArray(list):
        def __bool__(self):
            raise ValueError(
                "The truth value of an array with more than one element is ambiguous."
            )

    batch = AmbiguousArray([AmbiguousArray([object(), object()])])
    result = types.SimpleNamespace(frames=batch)
    frames = real_execute._clip_frames_for_export(result)
    assert len(frames) == 2


def test_align_spatial_makes_advertised_480p_legal_for_wan():
    assert real_execute._align_spatial(854) == 848
    assert real_execute._align_spatial(480) == 480
    assert real_execute._align_spatial(1280) == 1280
    assert real_execute._align_spatial(720) == 720
    assert real_execute._align_spatial(15) == 16


def test_wan_video_uses_complete_pipeline_and_atomically_finalizes_mp4(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    models = tmp_path / "models"
    weights = models / "weights" / "wan2.1-t2v-1.3b"
    weights.mkdir(parents=True)
    (weights / "model_index.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(models))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: "bf16")

    calls: dict[str, object] = {}

    class FakeGenerator:
        def __init__(self, device: str):
            calls["generator_device"] = device

        def manual_seed(self, seed: int):
            calls["seed"] = seed
            return self

    torch = types.ModuleType("torch")
    torch.Generator = FakeGenerator
    torch.cuda = types.SimpleNamespace(is_available=lambda: True)

    class FakePipe:
        def to(self, device: str):
            calls["device"] = device

        def __call__(self, **kwargs):
            calls["kwargs"] = kwargs
            return types.SimpleNamespace(frames=[[object(), object()]])

    class FakeWanPipeline:
        @staticmethod
        def from_pretrained(path: str, **kwargs):
            calls["load"] = (path, kwargs)
            return FakePipe()

    diffusers = types.ModuleType("diffusers")
    diffusers.WanPipeline = FakeWanPipeline
    utils = types.ModuleType("diffusers.utils")

    def export_to_video(_frames, path: str, fps: int):
        calls["fps"] = fps
        Path(path).write_bytes(b"\x00\x00\x00\x18ftypisomdata")

    utils.export_to_video = export_to_video
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "diffusers", diffusers)
    monkeypatch.setitem(sys.modules, "diffusers.utils", utils)

    output = tmp_path / "result.mp4"
    ctx = _video_ctx("wan2.1-t2v-1.3b")
    ctx = video_base.VideoExecutionContext(
        job_id=ctx.job_id,
        params=ctx.params,
        offload_strategy=ctx.offload_strategy,
        output_path=str(output),
    )
    result = real_execute.video_execute(ctx)

    assert result.mp4_path == str(output)
    assert output.read_bytes()[4:8] == b"ftyp"
    assert calls["kwargs"]["num_frames"] == 13
    assert calls["kwargs"]["width"] == 848
    assert calls["kwargs"]["height"] == 480
    assert calls["fps"] == 12
    assert not list(tmp_path.glob("*.partial.mp4"))
    assert result.extra["pipeline"] == "wan"


def test_wan_video_rejects_partial_raw_layout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    models = tmp_path / "models"
    weights = models / "weights" / "wan2.1-t2v-1.3b"
    weights.mkdir(parents=True)
    (weights / "diffusion_pytorch_model.safetensors").write_bytes(b"partial")
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(models))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute.video_execute(_video_ctx("wan2.1-t2v-1.3b"))
    assert excinfo.value.kind == "model-layout-invalid"
    assert "model_index.json" in str(excinfo.value)


def test_is_sana_video_model_does_not_match_image_sana():
    assert real_execute.is_sana_video_model("sana-video-2b-720p") is True
    assert real_execute.is_sana_video_model("sana-video") is True
    assert real_execute.is_sana_video_model("sana-1.6b-1024") is False
    assert real_execute.is_sana_video_model("wan2.1-t2v-1.3b") is False


def _write_sana_video_layout(weights: Path) -> None:
    for relative in (
        "model_index.json",
        "scheduler/scheduler_config.json",
        "text_encoder/config.json",
        "tokenizer/tokenizer_config.json",
        "transformer/config.json",
        "vae/config.json",
    ):
        target = weights / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("{}", encoding="utf-8")


def test_sana_video_incomplete_tree_names_model_index(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    models = tmp_path / "models"
    weights = models / "weights" / "sana-video-2b-720p"
    weights.mkdir(parents=True)
    transformer = weights / "transformer"
    transformer.mkdir()
    (transformer / "diffusion_pytorch_model-00001-of-00002.safetensors").write_bytes(
        b"partial"
    )
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(models))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute.video_execute(_video_ctx("sana-video-2b-720p"))
    message = str(excinfo.value)
    assert excinfo.value.kind == "model-layout-invalid"
    assert "model_index.json" in message
    assert "sana-video-2b-720p" in message
    assert "WanPipeline" not in message


def test_sana_video_names_later_missing_layout_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    models = tmp_path / "models"
    weights = models / "weights" / "sana-video-2b-720p"
    weights.mkdir(parents=True)
    for relative in (
        "model_index.json",
        "scheduler/scheduler_config.json",
        "text_encoder/config.json",
        "tokenizer/tokenizer_config.json",
        "transformer/config.json",
    ):
        target = weights / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(models))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute.video_execute(_video_ctx("sana-video-2b-720p"))
    message = str(excinfo.value)
    assert excinfo.value.kind == "model-layout-invalid"
    assert "config.json" in message
    assert "vae" in message.replace("\\", "/")


def test_sana_video_complete_fixture_does_not_call_wan_pipeline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    models = tmp_path / "models"
    weights = models / "weights" / "sana-video-2b-720p"
    weights.mkdir(parents=True)
    _write_sana_video_layout(weights)
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(models))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: "bf16")

    calls: dict[str, object] = {}

    class FakeGenerator:
        def __init__(self, device: str):
            calls["generator_device"] = device

        def manual_seed(self, seed: int):
            calls["seed"] = seed
            return self

    torch = types.ModuleType("torch")
    torch.Generator = FakeGenerator
    torch.cuda = types.SimpleNamespace(is_available=lambda: True)

    class FakePipe:
        def to(self, device: str):
            calls["device"] = device

        def __call__(self, **kwargs):
            calls["kwargs"] = kwargs
            return types.SimpleNamespace(frames=[[object(), object()]])

    class FakeSanaVideoPipeline:
        @staticmethod
        def from_pretrained(path: str, **kwargs):
            calls["load"] = (path, kwargs)
            return FakePipe()

    class FakeWanPipeline:
        @staticmethod
        def from_pretrained(path: str, **kwargs):
            raise AssertionError("WanPipeline must not load SANA-Video")

    diffusers = types.ModuleType("diffusers")
    diffusers.SanaVideoPipeline = FakeSanaVideoPipeline
    diffusers.WanPipeline = FakeWanPipeline
    utils = types.ModuleType("diffusers.utils")

    def export_to_video(_frames, path: str, fps: int):
        calls["fps"] = fps
        Path(path).write_bytes(b"\x00\x00\x00\x18ftypisomdata")

    utils.export_to_video = export_to_video
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "diffusers", diffusers)
    monkeypatch.setitem(sys.modules, "diffusers.utils", utils)

    output = tmp_path / "sana.mp4"
    ctx = _video_ctx("sana-video-2b-720p")
    ctx = video_base.VideoExecutionContext(
        job_id=ctx.job_id,
        params=ctx.params,
        offload_strategy=ctx.offload_strategy,
        output_path=str(output),
    )
    result = real_execute.video_execute(ctx)

    assert result.mp4_path == str(output)
    assert output.read_bytes()[4:8] == b"ftyp"
    assert calls["load"][0] == str(weights)
    assert calls["load"][1]["local_files_only"] is True
    assert result.extra["pipeline"] == "sana"
    assert not list(tmp_path.glob("*.partial.mp4"))


def test_sana_video_missing_class_is_runtime_not_ready(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    models = tmp_path / "models"
    weights = models / "weights" / "sana-video-2b-720p"
    weights.mkdir(parents=True)
    _write_sana_video_layout(weights)
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(models))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: True)
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: "bf16")

    torch = types.ModuleType("torch")
    torch.Generator = object
    torch.cuda = types.SimpleNamespace(is_available=lambda: True)
    diffusers = types.ModuleType("diffusers")
    utils = types.ModuleType("diffusers.utils")
    utils.export_to_video = lambda *_args, **_kwargs: None
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "diffusers", diffusers)
    monkeypatch.setitem(sys.modules, "diffusers.utils", utils)

    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute.sana_video_execute(_video_ctx("sana-video-2b-720p"))
    assert "SanaVideoPipeline" in str(excinfo.value)
    assert excinfo.value.kind == "diffusers-missing"


def test_decode_source_image_opens_an_existing_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    png = tmp_path / "fox.png"
    png.write_bytes(b"stub")
    opened: dict[str, object] = {}

    class FakeImg:
        def convert(self, mode: str) -> str:
            opened["mode"] = mode
            return "rgb"

    class FakeImage:
        @staticmethod
        def open(target: object) -> FakeImg:
            opened["target"] = str(target)
            return FakeImg()

    pil = types.ModuleType("PIL")
    pil.Image = FakeImage  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "PIL", pil)
    monkeypatch.setitem(sys.modules, "PIL.Image", FakeImage)
    assert real_execute.decode_source_image(str(png)) == "rgb"
    assert opened["mode"] == "RGB"
    assert opened["target"] == str(png)


# --- v2.4.4 Phase 3 (T012): restyle identity on the GPU path ----------------
#
# Field screenshot 3 showed "Make the puppy black" returning the tan puppy
# unchanged, twice. Three defects in `image_execute` could each cause it: a
# `strength or 0.75` that rewrote a caller's real value, a seed that was never
# forwarded so the generator was unseeded, and no check at all that the output
# differed from the input. These tests pin all three.


def _img2img_ctx(strength, tmp_path: Path) -> base.ExecutionContext:
    from PIL import Image  # type: ignore[import-not-found]
    import base64 as _b64
    import io as _io

    buf = _io.BytesIO()
    Image.new("RGB", (8, 8), (200, 170, 120)).save(buf, format="PNG")
    source = _b64.b64encode(buf.getvalue()).decode("ascii")
    request = {
        "modelId": "sana-1.6b-1024",
        "prompt": "Keep the same composition. Change the puppy's fur to black.",
        "width": 8,
        "height": 8,
        "steps": 1,
        "cfgScale": 1.0,
        "sampler": "euler_a",
        "seed": 4242,
        "sourceImage": source,
        "strength": strength,
    }
    return base.ExecutionContext(
        job_id="job-restyle",
        mode="img2img",
        params=base.params.parse("img2img", request),
        offload_strategy="cpu",
    )


class _RecordingPipe:
    """Stub pipeline that records kwargs and returns a chosen image."""

    def __init__(self, image):
        self._image = image
        self.kwargs = None

    def __call__(self, **kwargs):
        self.kwargs = kwargs
        return types.SimpleNamespace(images=[self._image])


class _FakeGenerator:
    def __init__(self, device: str):
        self.device = device
        self._seed = None

    def manual_seed(self, seed: int):
        self._seed = seed
        return self

    def initial_seed(self) -> int:
        return self._seed


def _install_fake_torch(monkeypatch: pytest.MonkeyPatch) -> None:
    """torch is not installed in the unit environment; the seed contract is."""
    fake = types.ModuleType("torch")
    fake.Generator = lambda device="cpu": _FakeGenerator(device)  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "torch", fake)


def _prepare(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, pipe) -> None:
    _install_fake_torch(monkeypatch)
    weights = tmp_path / "weights" / "sana-1.6b-1024"
    weights.mkdir(parents=True)
    (weights / "model_index.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: False)
    monkeypatch.setattr(real_execute, "allow_cpu", lambda: True)
    monkeypatch.setattr(real_execute, "_load_image_pipe", lambda *a, **k: pipe)
    monkeypatch.setattr(real_execute, "_move_pipe", lambda *a, **k: None)


def test_restyle_forwards_exact_strength_and_seeded_generator(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from PIL import Image  # type: ignore[import-not-found]

    pipe = _RecordingPipe(Image.new("RGB", (8, 8), (10, 10, 10)))
    _prepare(monkeypatch, tmp_path, pipe)

    out = real_execute.image_execute(_img2img_ctx(0.85, tmp_path))

    assert pipe.kwargs is not None
    assert pipe.kwargs["strength"] == 0.85
    # The seed must actually reach the pipeline; an unseeded generator makes a
    # restyle unreproducible and its failures undiagnosable.
    assert pipe.kwargs["generator"] is not None
    assert pipe.kwargs["generator"].initial_seed() == 4242
    assert out.extra["mode"] == "img2img"
    assert out.extra["strength"] == 0.85


def test_restyle_does_not_rewrite_a_deliberate_zero_strength(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from PIL import Image  # type: ignore[import-not-found]

    pipe = _RecordingPipe(Image.new("RGB", (8, 8), (10, 10, 10)))
    _prepare(monkeypatch, tmp_path, pipe)

    real_execute.image_execute(_img2img_ctx(0.0, tmp_path))

    # `strength or 0.75` silently turned a real 0 into 0.75, so the value the
    # UI chose was not the value the pipeline ran.
    assert pipe.kwargs["strength"] == 0.0


def test_restyle_fails_closed_when_the_pipeline_echoes_the_source(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from PIL import Image  # type: ignore[import-not-found]

    # A pipeline that returns the source unchanged is exactly the observed
    # field behavior. It must be an error, not a successful-looking turn.
    echo = Image.new("RGB", (8, 8), (200, 170, 120))
    pipe = _RecordingPipe(echo)
    _prepare(monkeypatch, tmp_path, pipe)

    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute.image_execute(_img2img_ctx(0.85, tmp_path))
    assert excinfo.value.kind == "unchanged-output"
    assert "unchanged" in str(excinfo.value)


def test_restyle_reports_source_and_output_digests(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from PIL import Image  # type: ignore[import-not-found]

    pipe = _RecordingPipe(Image.new("RGB", (8, 8), (10, 10, 10)))
    _prepare(monkeypatch, tmp_path, pipe)

    out = real_execute.image_execute(_img2img_ctx(0.85, tmp_path))

    assert out.extra["sourceDigest"]
    assert out.extra["outputDigest"]
    assert out.extra["outputDigest"] != out.extra["sourceDigest"]


def test_txt2img_reports_no_source_digest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    from PIL import Image  # type: ignore[import-not-found]

    pipe = _RecordingPipe(Image.new("RGB", (8, 8), (10, 10, 10)))
    weights = tmp_path / "weights" / "sana-1.6b-1024"
    weights.mkdir(parents=True)
    (weights / "model_index.json").write_text("{}", encoding="utf-8")
    monkeypatch.setenv("NEXUS_MODELS_ROOT", str(tmp_path))
    monkeypatch.setattr(real_execute, "gpu_ready", lambda: False)
    monkeypatch.setattr(real_execute, "allow_cpu", lambda: True)
    monkeypatch.setattr(real_execute, "_load_text_pipe", lambda *a, **k: pipe)
    monkeypatch.setattr(real_execute, "_move_pipe", lambda *a, **k: None)
    _install_fake_torch(monkeypatch)

    out = real_execute.image_execute(_image_ctx())

    assert out.extra["sourceDigest"] is None
    assert out.extra["outputDigest"]
    # A fresh generation has nothing to compare against, so the clone guard
    # must not fire on it.
    assert pipe.kwargs["generator"].initial_seed() == 1



# --- v2.4.4 Phase 4 (T016): honest missing-class errors -------------------
#
# Field screenshot 4 put a raw `ImportError: cannot import name
# 'SanaVideoPipeline' from 'diffusers'` straight into the chat bubble. A
# missing pipeline class means the media runtime was provisioned from a pin
# that does not carry it, so it is a typed `diffusers-missing` not-ready with
# a sentence naming the class and the installed version. Image SANA is probed
# the same way; before this phase it had no guard at all and leaked the raw
# error through the generic exception wrapper.


def _diffusers_without(monkeypatch: pytest.MonkeyPatch, *missing: str) -> None:
    fake = types.ModuleType("diffusers")
    fake.__version__ = "0.34.0"
    for name in ("SanaPipeline", "SanaVideoPipeline", "WanPipeline"):
        if name not in missing:
            setattr(fake, name, object())
    monkeypatch.setitem(sys.modules, "diffusers", fake)


def test_missing_sana_video_class_is_typed_not_a_traceback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    _diffusers_without(monkeypatch, "SanaVideoPipeline")
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: None)

    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute._load_video_pipeline("sana", tmp_path)

    assert excinfo.value.kind == "diffusers-missing"
    message = str(excinfo.value)
    assert "SanaVideoPipeline" in message
    # The installed version is the fact that separates a bad pin from a bad
    # model directory, so the sentence must carry it.
    assert "0.34.0" in message
    # No raw import traceback text in a user-visible sentence.
    assert "cannot import name" not in message


def test_missing_image_sana_class_is_typed_too(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    _diffusers_without(monkeypatch, "SanaPipeline")
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: None)
    (tmp_path / "model_index.json").write_text("{}", encoding="utf-8")

    with pytest.raises(base.RuntimeNotReady) as excinfo:
        real_execute._load_text_pipe(tmp_path, "sana-1.6b-1024")

    assert excinfo.value.kind == "diffusers-missing"
    assert "SanaPipeline" in str(excinfo.value)


def test_present_sana_video_class_is_used_and_never_wan(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    calls: list[str] = []

    class _Sana:
        @staticmethod
        def from_pretrained(path, **kwargs):
            calls.append("sana")
            return "sana-pipe"

    class _Wan:
        @staticmethod
        def from_pretrained(path, **kwargs):
            calls.append("wan")
            return "wan-pipe"

    fake = types.ModuleType("diffusers")
    fake.__version__ = "0.36.0"
    fake.SanaVideoPipeline = _Sana
    fake.WanPipeline = _Wan
    monkeypatch.setitem(sys.modules, "diffusers", fake)
    monkeypatch.setattr(real_execute, "_torch_dtype", lambda: None)

    assert real_execute._load_video_pipeline("sana", tmp_path) == "sana-pipe"
    assert calls == ["sana"]


def test_torch_too_old_is_a_typed_accelerator_failure(
    monkeypatch: pytest.MonkeyPatch,
):
    # v2.4.8 Phase 8: operator evidence 2026-09-07 -- torch 2.3.0+cu121 passed
    # every probe and the first video generate raised
    # "module 'torch.nn' has no attribute 'RMSNorm'".
    monkeypatch.setattr(base, "torch_cuda_state", lambda: "torch-too-old")
    failure = base.accelerator_not_ready("video")
    assert failure.kind == "torch-too-old"
    assert "older than 2.4" in str(failure)
    assert "Settings > Video" in str(failure)
    classified = base.classify_runtime_not_ready("video", None)
    assert classified.kind == "torch-too-old"
    assert base.torch_too_old("2.3.0+cu121") is True
    assert base.torch_too_old("2.4.0") is False
    assert base.torch_too_old("2.5.1+cu121") is False
    assert base.torch_too_old("") is False
    assert base.torch_too_old("nightly") is False


def test_emit_stage_forwards_through_the_installed_sink():
    seen: list[dict] = []
    base.set_progress_sink(seen.append)
    try:
        base.emit_stage("job-1", "loading")
        base.emit_stage("job-1", "generating")
        base.emit_stage("", "loading")  # no job id: nothing emitted
    finally:
        base.set_progress_sink(None)
    assert seen == [
        {"kind": "progress", "jobId": "job-1", "stage": "loading"},
        {"kind": "progress", "jobId": "job-1", "stage": "generating"},
    ]
    base.emit_stage("job-2", "loading")  # no sink: silently ignored

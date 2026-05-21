"""SANA pipeline tests (v1.1.0 Phase 12).

The real diffusers + nunchaku stack only runs on a CUDA host (operator
action OA-09); these tests exercise the registration shape + the
JSON-RPC envelope produced by the stub executor so the IPC round-trip
stays verifiable without a GPU.
"""

from __future__ import annotations

from runtimes.diffusion.pipelines import (
    sana,
    sana_int4,
    sana_sprint,
    sana_video,
)
from runtimes.diffusion.registry import register_pipeline_handlers


def _txt_payload(**overrides):
    request = {
        "modelId": "sana-1.6b-1024",
        "prompt": "a fox in moonlight",
        "negativePrompt": "",
        "width": 1024,
        "height": 1024,
        "steps": 14,
        "cfgScale": 4.5,
        "sampler": "flow-dpm-solver",
        "seed": 42,
        "batchSize": 1,
        "latentPreview": True,
        "loras": [],
    }
    request.update(overrides)
    return {"jobId": "job-sana-1", "mode": "txt2img", "request": request}


def test_sana_register_installs_txt2img_and_img2img_handlers():
    handlers: dict = {}
    sana.register(handlers)
    assert "sana.txt2img" in handlers
    assert "sana.img2img" in handlers


def test_sana_txt2img_round_trips_with_stub():
    handlers: dict = {}
    sana.register(handlers)
    out = handlers["sana.txt2img"](_txt_payload())
    assert out["ok"] is True
    assert out["mode"] == "txt2img"
    assert out["workflow"]["prompt"] == "a fox in moonlight"
    assert out["workflow"]["sampler"] == "flow-dpm-solver"


def test_sana_img2img_requires_source_image():
    handlers: dict = {}
    sana.register(handlers)
    out = handlers["sana.img2img"](
        {
            "jobId": "job-sana-img",
            "mode": "img2img",
            "request": {
                "modelId": "sana-1.6b-1024",
                "prompt": "a fox",
                "width": 1024,
                "height": 1024,
                "steps": 14,
                "cfgScale": 4.5,
                "sampler": "flow-dpm-solver",
                "seed": 7,
            },
        }
    )
    assert out["ok"] is False
    assert out["error"] == "invalid-params"


def test_sana_img2img_with_source_image_round_trips():
    handlers: dict = {}
    sana.register(handlers)
    out = handlers["sana.img2img"](
        {
            "jobId": "job-sana-img-ok",
            "mode": "img2img",
            "request": {
                "modelId": "sana-1.6b-1024",
                "prompt": "a fox",
                "width": 1024,
                "height": 1024,
                "steps": 14,
                "cfgScale": 4.5,
                "sampler": "flow-dpm-solver",
                "seed": 7,
                "sourceImage": "data:image/png;base64,AAAA",
                "strength": 0.7,
            },
        }
    )
    assert out["ok"] is True
    assert out["mode"] == "img2img"


def test_resolve_vae_returns_link_when_present():
    assert sana.resolve_vae("sana-1.6b-1024", "custom-vae") == "custom-vae"


def test_resolve_vae_falls_back_to_dc_ae_canonical():
    assert sana.resolve_vae("sana-1.6b-1024", None) == sana.DEFAULT_VAE_ID
    assert sana.resolve_vae("sana-1.6b-1024", "") == sana.DEFAULT_VAE_ID


def test_sana_controlnet_preprocessor_map_is_complete():
    # 12.1 acceptance: the three SANA-ControlNet catalog entries map
    # 1:1 onto the existing pose / depth / canny preprocessors.
    assert sana.preprocessor_for_controlnet("sana-controlnet-pose") == "pose"
    assert sana.preprocessor_for_controlnet("sana-controlnet-depth") == "depth"
    assert sana.preprocessor_for_controlnet("sana-controlnet-canny") == "canny"


def test_sana_controlnet_preprocessor_none_for_non_sana():
    assert sana.preprocessor_for_controlnet("sdxl-canny") is None
    assert sana.is_sana_controlnet("sana-controlnet-pose") is True
    assert sana.is_sana_controlnet("sdxl-canny") is False


def test_sana_txt2img_round_trips_with_controlnet_payload():
    handlers: dict = {}
    sana.register(handlers)
    request = {
        "modelId": "sana-1.6b-1024",
        "prompt": "a fox holding a sword",
        "negativePrompt": "",
        "width": 1024,
        "height": 1024,
        "steps": 14,
        "cfgScale": 4.5,
        "sampler": "flow-dpm-solver",
        "seed": 99,
        "batchSize": 1,
        "latentPreview": True,
        "loras": [],
        "controlNet": {
            "modelId": "sana-controlnet-pose",
            "conditionImage": "data:image/png;base64,AAA",
            "weight": 0.9,
            "preprocessor": "pose",
        },
    }
    out = handlers["sana.txt2img"](
        {"jobId": "job-sana-cn", "mode": "txt2img", "request": request}
    )
    assert out["ok"] is True
    assert out["workflow"]["controlNet"]["modelId"] == "sana-controlnet-pose"
    assert out["workflow"]["controlNet"]["preprocessor"] == "pose"


def test_is_sana_model_excludes_sprint_int4_and_video():
    assert sana.is_sana_model("sana-1.6b-1024") is True
    assert sana.is_sana_model("sana-1.6b-2k") is True
    assert sana.is_sana_model("sana-sprint-1024") is False
    assert sana.is_sana_model("sana-1.6b-int4") is False
    assert sana.is_sana_model("sana-video-2b-720p") is False
    assert sana.is_sana_model("sdxl-turbo") is False


def test_sprint_register_installs_only_txt2img():
    handlers: dict = {}
    sana_sprint.register(handlers)
    assert "sana_sprint.txt2img" in handlers
    assert "sana_sprint.img2img" not in handlers


def test_sprint_overrides_force_one_step_and_flow_dpm():
    patched = sana_sprint.overrides_for_sprint(
        {"steps": 14, "sampler": "euler_a", "prompt": "x"},
    )
    assert patched["steps"] == 1
    assert patched["sampler"] == "flow-dpm-solver"
    # Caller's other fields are preserved.
    assert patched["prompt"] == "x"


def test_int4_register_installs_txt2img_only():
    handlers: dict = {}
    sana_int4.register(handlers)
    assert "sana_int4.txt2img" in handlers
    assert "sana_int4.img2img" not in handlers


def test_int4_required_runtime_dep_is_nunchaku():
    assert sana_int4.REQUIRED_RUNTIME_DEP == "nunchaku"


def test_int4_has_nunchaku_returns_bool_without_crash():
    # In CI nunchaku is absent; the probe must return False, never
    # raise. On a CUDA host with the dep installed, the probe returns
    # True. Either is acceptable; what matters is no exception leaks.
    assert isinstance(sana_int4.has_nunchaku(), bool)


def test_sana_video_register_installs_both_methods():
    handlers: dict = {}
    sana_video.register(handlers)
    assert "diffusion.video.sana.text2video" in handlers
    assert "diffusion.video.sana.image2video" in handlers


def test_full_registry_picks_up_sana_modules():
    handlers: dict = {}
    register_pipeline_handlers(handlers)
    assert "sana.txt2img" in handlers
    assert "sana.img2img" in handlers
    assert "sana_sprint.txt2img" in handlers
    assert "sana_int4.txt2img" in handlers
    assert "diffusion.video.sana.text2video" in handlers
    assert "diffusion.video.sana.image2video" in handlers

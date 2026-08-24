"""audio2video pipeline + LongCat adapter preflight (no GPU)."""

from __future__ import annotations

from runtimes.diffusion.pipelines import longcat_avatar, video_audio2video, video_params


def _request(**overrides):
    request = {
        "modelId": "longcat-video-avatar-1.5",
        "prompt": "a person speaking",
        "negativePrompt": "",
        "width": 854,
        "height": 480,
        "durationSeconds": 4,
        "fps": 24,
        "steps": 8,
        "cfgScale": 3.5,
        "sampler": "euler_a",
        "seed": 1,
        "sourceImage": "data:image/png;base64,AAAA",
        "sourceAudio": "data:audio/wav;base64,BBBB",
        "confirmLocalAvatar": True,
        "diffusionTier": "diffusion-pro",
        "vramGB": 24,
        "weightRepo": "meituan-longcat/LongCat-Video-Avatar-1.5",
    }
    request.update(overrides)
    return request


def test_register_installs_audio2video_handler():
    handlers: dict = {}
    video_audio2video.register(handlers)
    assert "diffusion.video.audio2video" in handlers


def test_audio2video_stub_embeds_local_provenance(tmp_path, monkeypatch):
    monkeypatch.setenv("NEXUS_VIDEO_OUTPUT_DIR", str(tmp_path))
    handlers: dict = {}
    video_audio2video.register(handlers)
    out = handlers["diffusion.video.audio2video"](
        {"jobId": "avatar-1", "mode": "audio2video", "request": _request()}
    )
    assert out["ok"] is True
    assert out["workflow"]["mode"] == "audio2video"
    assert out["workflow"]["provenance"]["neverLeftDevice"] is True
    assert out["workflow"]["provenance"]["local"] is True
    assert out["extra"]["neverLeftDevice"] is True


def test_preflight_rejects_unofficial_repo():
    parsed = video_params.parse(
        "audio2video",
        _request(weightRepo="community/LongCat-FP8"),
    )
    err = longcat_avatar.preflight(parsed)
    assert err is not None
    assert "unofficial" in err


def test_preflight_rejects_missing_confirmation():
    request = _request()
    del request["confirmLocalAvatar"]
    try:
        video_params.parse("audio2video", request)
        raise AssertionError("expected VideoParamsError")
    except video_params.VideoParamsError as exc:
        assert "confirmLocalAvatar" in str(exc)


def test_preflight_rejects_below_vram_floor():
    parsed = video_params.parse("audio2video", _request(vramGB=12))
    err = longcat_avatar.preflight(parsed)
    assert err is not None
    assert "avatar-vram" in err


def test_audio2video_allows_duration_above_ten():
    parsed = video_params.parse("audio2video", _request(durationSeconds=20))
    assert parsed.duration_seconds == 20

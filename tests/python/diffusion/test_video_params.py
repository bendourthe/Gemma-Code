"""Tests for `runtimes.diffusion.pipelines.video_params`.

Each video request must validate strictly: bad resolution / fps / mode /
duration / sampler / missing fields all surface as `VideoParamsError`
with a precise message. The frame_count helper is also covered so the
dispatcher's thumbnail bucketing math is regression-tested.
"""

from __future__ import annotations

import pytest

from runtimes.diffusion.pipelines import video_params


def _base_request(**overrides):
    request = {
        "modelId": "ltx-video",
        "prompt": "an autumn forest",
        "negativePrompt": "",
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
    request.update(overrides)
    return request


def test_parse_returns_video_params_for_text2video():
    parsed = video_params.parse("text2video", _base_request())
    assert parsed.mode == "text2video"
    assert parsed.model_id == "ltx-video"
    assert parsed.duration_seconds == 4
    assert parsed.fps == 24


def test_parse_requires_source_image_for_image2video():
    with pytest.raises(video_params.VideoParamsError, match="sourceImage"):
        video_params.parse("image2video", _base_request())


def test_parse_accepts_image2video_with_source_image():
    parsed = video_params.parse(
        "image2video",
        _base_request(sourceImage="data:image/png;base64,AAAA"),
    )
    assert parsed.mode == "image2video"
    assert parsed.source_image == "data:image/png;base64,AAAA"


def test_parse_rejects_invalid_mode():
    with pytest.raises(video_params.VideoParamsError, match="invalid video mode"):
        video_params.parse("text2anim", _base_request())


def test_parse_rejects_invalid_fps():
    with pytest.raises(video_params.VideoParamsError, match="invalid fps"):
        video_params.parse("text2video", _base_request(fps=30))


def test_parse_rejects_invalid_resolution():
    with pytest.raises(video_params.VideoParamsError, match="invalid resolution"):
        video_params.parse("text2video", _base_request(width=1024, height=1024))


def test_parse_rejects_duration_out_of_range():
    with pytest.raises(video_params.VideoParamsError, match="durationSeconds"):
        video_params.parse("text2video", _base_request(durationSeconds=0))
    with pytest.raises(video_params.VideoParamsError, match="durationSeconds"):
        video_params.parse("text2video", _base_request(durationSeconds=11))


def test_parse_rejects_invalid_sampler():
    with pytest.raises(video_params.VideoParamsError, match="invalid sampler"):
        video_params.parse("text2video", _base_request(sampler="xyz"))


def test_parse_rejects_missing_model_id():
    with pytest.raises(video_params.VideoParamsError, match="modelId"):
        video_params.parse(
            "text2video",
            {k: v for k, v in _base_request().items() if k != "modelId"},
        )


def test_parse_rejects_non_int_duration():
    with pytest.raises(video_params.VideoParamsError, match="durationSeconds"):
        video_params.parse("text2video", _base_request(durationSeconds="4"))


def test_parse_rejects_steps_out_of_range():
    with pytest.raises(video_params.VideoParamsError, match="steps"):
        video_params.parse("text2video", _base_request(steps=0))
    with pytest.raises(video_params.VideoParamsError, match="steps"):
        video_params.parse("text2video", _base_request(steps=200))


def test_parse_defaults_negative_prompt_to_empty():
    req = _base_request()
    del req["negativePrompt"]
    parsed = video_params.parse("text2video", req)
    assert parsed.negative_prompt == ""


def test_frame_count_derives_total_frames():
    parsed = video_params.parse("text2video", _base_request())
    assert video_params.frame_count(parsed) == 96  # 4s * 24fps


def test_frame_count_for_minimum_clip():
    parsed = video_params.parse(
        "text2video",
        _base_request(durationSeconds=1, fps=12),
    )
    assert video_params.frame_count(parsed) == 12


def test_parse_resolution_720p_accepted():
    parsed = video_params.parse(
        "text2video",
        _base_request(width=1280, height=720),
    )
    assert parsed.width == 1280
    assert parsed.height == 720


def test_parse_cfg_must_be_numeric():
    with pytest.raises(video_params.VideoParamsError, match="cfgScale"):
        video_params.parse("text2video", _base_request(cfgScale=True))


def test_parse_seed_must_be_int():
    with pytest.raises(video_params.VideoParamsError, match="seed"):
        video_params.parse("text2video", _base_request(seed=True))


def test_parse_prompt_required():
    req = _base_request()
    del req["prompt"]
    with pytest.raises(video_params.VideoParamsError, match="prompt"):
        video_params.parse("text2video", req)

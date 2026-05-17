"""Tests for the parameter parser."""

from __future__ import annotations

import pytest

from runtimes.diffusion.pipelines import params


def base_request(**overrides):
    body = {
        "modelId": "sdxl-turbo",
        "prompt": "a fox",
        "negativePrompt": "blurry",
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
    body.update(overrides)
    return body


def test_parses_txt2img_request():
    parsed = params.parse("txt2img", base_request())
    assert parsed.prompt == "a fox"
    assert parsed.seed == 7
    assert parsed.batch_size == 1
    assert parsed.loras == []


def test_parses_img2img_with_strength():
    parsed = params.parse(
        "img2img", base_request(sourceImage="data:image/png;base64,AAA", strength=0.6)
    )
    assert parsed.source_image == "data:image/png;base64,AAA"
    assert parsed.strength == 0.6


def test_parses_inpaint_requires_mask():
    with pytest.raises(params.ParamsError):
        params.parse("inpaint", base_request(sourceImage="x"))
    parsed = params.parse(
        "inpaint", base_request(sourceImage="x", mask="y", strength=0.9)
    )
    assert parsed.mask == "y"
    assert parsed.strength == 0.9


def test_parses_outpaint_requires_direction_and_pixels():
    parsed = params.parse(
        "outpaint",
        base_request(sourceImage="x", direction="left", pixels=64),
    )
    assert parsed.direction == "left"
    assert parsed.pixels == 64


def test_invalid_mode_rejected():
    with pytest.raises(params.ParamsError):
        params.parse("weird", base_request())


def test_invalid_sampler_rejected():
    with pytest.raises(params.ParamsError):
        params.parse("txt2img", base_request(sampler="bogus"))


def test_invalid_direction_rejected():
    with pytest.raises(params.ParamsError):
        params.parse(
            "outpaint",
            base_request(sourceImage="x", direction="upwards", pixels=64),
        )


def test_lora_entries_validated():
    parsed = params.parse(
        "txt2img",
        base_request(loras=[{"id": "lora:a", "weight": 0.5}]),
    )
    assert parsed.loras[0].id == "lora:a"
    assert parsed.loras[0].weight == 0.5


def test_lora_entries_must_be_objects():
    with pytest.raises(params.ParamsError):
        params.parse("txt2img", base_request(loras=["lora:a"]))


def test_control_net_optional():
    parsed = params.parse(
        "txt2img",
        base_request(
            controlNet={
                "modelId": "cn:a",
                "conditionImage": "data:image/png;base64,AAA",
                "weight": 0.7,
                "preprocessor": "canny",
            }
        ),
    )
    assert parsed.control_net is not None
    assert parsed.control_net.preprocessor == "canny"


def test_control_net_invalid_preprocessor():
    with pytest.raises(params.ParamsError):
        params.parse(
            "txt2img",
            base_request(
                controlNet={
                    "modelId": "cn:a",
                    "conditionImage": "data:image/png;base64,AAA",
                    "weight": 0.7,
                    "preprocessor": "magick",
                }
            ),
        )

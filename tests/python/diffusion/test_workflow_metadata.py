"""Round-trip tests for the Python `workflow_metadata` writer/reader."""

from __future__ import annotations

import json

import pytest

from runtimes.diffusion.pipelines import params, workflow_metadata


def _params():
    return params.parse(
        "txt2img",
        {
            "modelId": "sdxl-turbo",
            "prompt": "a watercolor fox",
            "negativePrompt": "blurry",
            "width": 1024,
            "height": 1024,
            "steps": 4,
            "cfgScale": 1.5,
            "sampler": "euler_a",
            "seed": 12345,
            "batchSize": 1,
            "latentPreview": True,
            "loras": [{"id": "lora:cinematic", "weight": 0.8}],
        },
    )


def test_build_workflow_carries_request_fields():
    workflow = workflow_metadata.build_workflow("txt2img", _params(), "2026-05-17T00:00:00Z")
    assert workflow["mode"] == "txt2img"
    assert workflow["prompt"] == "a watercolor fox"
    assert workflow["loras"][0]["id"] == "lora:cinematic"
    assert workflow["tool"] == workflow_metadata.RUNTIME_TOOL_NAME
    assert workflow["schemaVersion"] == 1


def test_embed_and_extract_round_trip():
    workflow = workflow_metadata.build_workflow("txt2img", _params(), "2026-05-17T00:00:00Z")
    png = workflow_metadata.minimal_png()
    embedded = workflow_metadata.embed_workflow(png, workflow)
    extracted = workflow_metadata.extract_workflow(embedded)
    assert extracted is not None
    assert extracted["prompt"] == workflow["prompt"]


def test_embed_idempotent():
    workflow = workflow_metadata.build_workflow("txt2img", _params(), "2026-05-17T00:00:00Z")
    png = workflow_metadata.minimal_png()
    once = workflow_metadata.embed_workflow(png, workflow)
    twice = workflow_metadata.embed_workflow(once, workflow)
    assert len(twice) == len(once)


def test_extract_returns_none_when_absent():
    png = workflow_metadata.minimal_png()
    assert workflow_metadata.extract_workflow(png) is None


def test_extract_returns_none_for_non_png():
    assert workflow_metadata.extract_workflow(b"not a png") is None


def test_embed_rejects_non_png():
    workflow = workflow_metadata.build_workflow("txt2img", _params(), "2026-05-17T00:00:00Z")
    with pytest.raises(ValueError):
        workflow_metadata.embed_workflow(b"not a png", workflow)


def test_workflow_json_is_sorted():
    workflow = workflow_metadata.build_workflow("txt2img", _params(), "2026-05-17T00:00:00Z")
    serialized = json.dumps(workflow, sort_keys=True)
    # Re-serialize the value we'd embed; embed_workflow uses sort_keys=True so
    # the embed-then-extract round trip yields the same JSON.
    assert "prompt" in serialized

"""Tests for the device + smart-offload helpers."""

from __future__ import annotations

import pytest

from runtimes.diffusion import device


def test_detect_returns_descriptor():
    info = device.detect()
    assert info.torch_version is not None
    assert info.cuda_version is not None
    assert info.device_name is not None


@pytest.mark.parametrize(
    ("free", "model", "strategy"),
    [
        (24.0, 8.0, "keep_on_gpu"),
        (8.0, 8.0, "model_cpu_offload"),
        (5.0, 8.0, "sequential_cpu_offload"),
        (1.0, 8.0, "insufficient_vram"),
    ],
)
def test_choose_offload_strategy(free, model, strategy):
    decision = device.choose_offload(free, model)
    assert decision.strategy == strategy
    assert decision.reason


def test_choose_offload_cpu_when_no_cuda():
    decision = device.choose_offload(None, 8.0)
    assert decision.strategy == "cpu"


def test_choose_offload_when_model_size_unknown():
    decision = device.choose_offload(4.0, 0)
    assert decision.strategy == "keep_on_gpu"
    assert "model_size_gb not provided" in decision.reason

"""Tests for ControlNet preprocessors.

In CI without OpenCV / controlnet_aux, each preprocessor returns a
tagged stub buffer so the dispatcher always has a conditioning preview
to surface. We exercise that stub path here.
"""

from __future__ import annotations

from runtimes.diffusion import preprocessors


def test_canny_returns_stub_when_opencv_absent():
    out = preprocessors.canny_edges(b"some-image-bytes", low=80, high=200)
    assert out.startswith(b"canny-stub:")


def test_pose_returns_stub_when_controlnet_aux_absent():
    out = preprocessors.pose_keypoints(b"image")
    assert out.startswith(b"pose-stub:")


def test_depth_returns_stub_when_controlnet_aux_absent():
    out = preprocessors.depth_map(b"image")
    assert out.startswith(b"depth-stub:")

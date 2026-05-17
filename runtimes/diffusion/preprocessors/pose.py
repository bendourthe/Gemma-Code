"""OpenPose keypoint preprocessor.

Loads `controlnet_aux.OpenposeDetector` lazily; in CI a stub returns a
tagged buffer so the JSON-RPC contract still has a conditioning preview
to surface.
"""

from __future__ import annotations


def pose_keypoints(image_bytes: bytes) -> bytes:
    try:  # pragma: no cover - exercised on hosts with controlnet_aux installed
        from controlnet_aux import OpenposeDetector  # type: ignore[import-not-found]

        detector = OpenposeDetector.from_pretrained("lllyasviel/Annotators")
        result = detector(image_bytes)
        return bytes(result)
    except Exception:
        return b"pose-stub:" + image_bytes[:32]

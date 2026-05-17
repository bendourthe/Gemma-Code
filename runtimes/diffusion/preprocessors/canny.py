"""Canny edge preprocessor.

Returns a deterministic tagged byte string when OpenCV is unavailable so
the dispatcher always has a conditioning preview to forward to the UI.
"""

from __future__ import annotations

from typing import Optional


def canny_edges(image_bytes: bytes, low: int = 100, high: int = 200) -> bytes:
    cv2: Optional[object] = None
    np: Optional[object] = None
    try:  # pragma: no cover - exercised on hosts with OpenCV installed
        import cv2 as _cv2  # type: ignore[import-not-found]
        import numpy as _np  # type: ignore[import-not-found]

        cv2 = _cv2
        np = _np
    except Exception:
        cv2 = None
        np = None
    if cv2 is None or np is None:
        return b"canny-stub:" + image_bytes[:32]
    # pragma: no cover begin
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    decoded = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if decoded is None:
        return b"canny-stub:invalid-image"
    edges = cv2.Canny(decoded, low, high)
    success, encoded = cv2.imencode(".png", edges)
    if not success:
        return b"canny-stub:encode-failed"
    return bytes(encoded.tobytes())
    # pragma: no cover end

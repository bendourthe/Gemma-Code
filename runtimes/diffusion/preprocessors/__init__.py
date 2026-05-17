"""ControlNet preprocessors.

Each preprocessor reduces an arbitrary RGB image to the conditioning
representation expected by the matching ControlNet checkpoint:

    - `pose`  -> OpenPose keypoints (via `controlnet_aux.OpenposeDetector`)
    - `depth` -> midas depth map (via `controlnet_aux.MidasDetector`)
    - `canny` -> Canny edge map (via OpenCV's Canny)

The real preprocessors are imported lazily on first use so the runtime
can boot without `controlnet_aux` / `cv2` available. CI verifies the
parameter wiring with stub preprocessors that simply tag the output
buffer.
"""

from .canny import canny_edges
from .pose import pose_keypoints
from .depth import depth_map

__all__ = ["canny_edges", "pose_keypoints", "depth_map"]

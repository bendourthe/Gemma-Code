"""Human-facing GPU VRAM labels.

Tier selection and Unsloth compatibility keep fractional / floored GiB math.
This helper is display-only.
"""

from __future__ import annotations

import math

_SIXTEEN_GB_CLASS_MIN_MB = 15 * 1024
_SIXTEEN_GB_CLASS_MAX_MB = 16 * 1024


def display_vram_gb(vram_mb: int) -> int:
    """Round detected VRAM up to a whole GB for installer copy.

    8.1 GB displays as 9 GB. A 16 GB-class part that reports 15360 MiB
    (15.0 GiB) still displays 16 GB so the line matches model badges.
    """
    if vram_mb <= 0:
        return 0
    if _SIXTEEN_GB_CLASS_MIN_MB <= vram_mb < _SIXTEEN_GB_CLASS_MAX_MB:
        return 16
    return int(math.ceil(vram_mb / 1024.0))

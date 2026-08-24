"""Official LongCat-Video-Avatar-1.5 INT8 adapter.

Nexus does not vendor the upstream Meituan inference tree this cycle
(see docs/v2/v2.0/development/history/2026-08-19_phase-3-longcat-scan.md).
This module is Nexus-owned: it refuses unofficial orgs, community
re-quantizations, and any request that did not carry an explicit local
confirmation. Runtime generation stays on the stub executor unless a
host-local install is later wired behind the same preflight.

Zero outbound: this file never opens a socket.
"""

from __future__ import annotations

from typing import Optional

from . import video_params

OFFICIAL_ORG = "meituan-longcat"
OFFICIAL_REPO = "meituan-longcat/LongCat-Video-Avatar-1.5"
ALLOWED_MODEL_IDS = frozenset({"longcat-video-avatar-1.5"})
AVATAR_MIN_VRAM_GB = 20.0


def preflight(params: video_params.VideoParams) -> Optional[str]:
    """Return an error string when the avatar request must not run."""
    if params.mode != "audio2video":
        return None
    if not params.confirm_local_avatar:
        return "avatar-unconfirmed: explicit local confirmation required"
    if params.model_id not in ALLOWED_MODEL_IDS:
        return (
            "avatar-model: only the official longcat-video-avatar-1.5 catalog "
            "entry is eligible"
        )
    repo = params.weight_repo or OFFICIAL_REPO
    repo_l = repo.lower()
    if not repo.startswith(f"{OFFICIAL_ORG}/"):
        return "avatar-unofficial: only meituan-longcat weights are eligible"
    if "community" in repo_l or "/fp8" in repo_l or repo_l.endswith("-fp8"):
        return "avatar-unofficial: community re-quantizations are rejected"
    if not params.source_image or not params.source_audio:
        return "avatar-inputs: photo and audio are required and must stay on-device"
    if params.diffusion_tier is not None and params.diffusion_tier != "diffusion-pro":
        return "avatar-tier: gated to diffusion-pro"
    if params.vram_gb is not None and params.vram_gb < AVATAR_MIN_VRAM_GB:
        return f"avatar-vram: needs at least {int(AVATAR_MIN_VRAM_GB)} GB"
    return None

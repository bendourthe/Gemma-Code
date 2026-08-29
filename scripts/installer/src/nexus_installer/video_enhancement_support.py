"""Optional Video2X setup copy shared with the desktop support contract."""

from __future__ import annotations

from pathlib import Path

ENV_KEY = "NEXUS_VIDEO2X_PATH"
SETTING_KEY = "video.video2xPath"
PINNED_VERSION = "6.4.0"
INSTALLER_NOTE = (
    "Video2X is optional and never installed by this wizard. After setup, "
    "set NEXUS_VIDEO2X_PATH or Settings > Video > Video2X executable to an "
    "absolute Video2X 6.4.0 path."
)
SETUP_COPY = (
    "Video enhancement is optional. Install Video2X 6.4.0 yourself, then set "
    "NEXUS_VIDEO2X_PATH or Settings > Video > Video2X executable to the "
    "absolute executable path. Nexus does not download, bundle, or search "
    "PATH for Video2X. FFmpeg remains the media probe and mux dependency."
)


def support_contract_path() -> Path:
    return (
        Path(__file__).resolve().parents[4]
        / "core"
        / "video"
        / "video-enhancement-support.json"
    )

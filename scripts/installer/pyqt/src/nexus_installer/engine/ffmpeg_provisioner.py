"""v1.1.0 Phase 14.3/14.4 -- Cross-platform ffmpeg + ffprobe provisioner.

Copies the bundled `ffmpeg` and `ffprobe` binaries from `payload/ffmpeg-<os>/`
into the per-user runtime tree. The Video Lab reads `NEXUS_FFMPEG_PATH` to
find them; the cross-OS launch shim sets that env var at startup based on the
runtime root chosen here.
"""

from __future__ import annotations

import os
import shutil
import stat
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import is_macos, is_windows

LogFn = Callable[[str, str], None]


def runtime_ffmpeg_root() -> Path:
    """Per-OS runtime location for the bundled ffmpeg binaries."""
    if is_windows():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "Nexus" / "runtime" / "ffmpeg"
    if is_macos():
        return (
            Path.home()
            / "Library"
            / "Application Support"
            / "Nexus"
            / "runtime"
            / "ffmpeg"
        )
    return Path.home() / ".local" / "share" / "nexus" / "runtime" / "ffmpeg"


def _payload_subdir(payload_dir: Path) -> Path:
    if is_windows():
        return payload_dir / "ffmpeg-windows"
    if is_macos():
        return payload_dir / "ffmpeg-mac"
    return payload_dir / "ffmpeg-linux"


def _binary_names() -> tuple[str, str]:
    if is_windows():
        return "ffmpeg.exe", "ffprobe.exe"
    return "ffmpeg", "ffprobe"


class FfmpegProvisioner:
    """Copy ffmpeg + ffprobe into the per-user runtime tree."""

    name = "ffmpeg"
    estimated_time_s = 10

    def __init__(self, payload_dir: Path) -> None:
        self._payload = _payload_subdir(payload_dir)

    @property
    def target_dir(self) -> Path:
        return runtime_ffmpeg_root()

    def payload_exists(self) -> bool:
        if not self._payload.is_dir():
            return False
        ffmpeg, ffprobe = _binary_names()
        return (self._payload / ffmpeg).exists() and (self._payload / ffprobe).exists()

    def install(self, log: LogFn) -> bool:
        if not self.payload_exists():
            log(f"ffmpeg payload missing at {self._payload}", "warn")
            return False
        target = self.target_dir
        ffmpeg, ffprobe = _binary_names()
        try:
            target.mkdir(parents=True, exist_ok=True)
            for name in (ffmpeg, ffprobe):
                src = self._payload / name
                dst = target / name
                shutil.copy2(src, dst)
                if not is_windows():
                    mode = dst.stat().st_mode
                    dst.chmod(mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
        except OSError as exc:
            log(f"ffmpeg copy failed: {exc}", "error")
            return False
        log(f"ffmpeg + ffprobe installed at {target}", "success")
        return True

    def verify(self, log: LogFn) -> bool:
        ffmpeg, ffprobe = _binary_names()
        for name in (ffmpeg, ffprobe):
            if not (self.target_dir / name).exists():
                log(f"ffmpeg verify failed: missing {name}", "error")
                return False
        return True

    @staticmethod
    def env_var_value() -> str:
        return str(runtime_ffmpeg_root())


__all__ = ["FfmpegProvisioner", "runtime_ffmpeg_root"]

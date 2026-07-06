"""v1.1.0 Phase 14.3/14.4 -- tests for the new Metal / ROCm / CPU / ffmpeg /
linux-ollama / macos-ollama / linux-cuda provisioners."""

from __future__ import annotations

import sys
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

import pytest

from nexus_installer.engine.cpu_only_provisioner import (
    CpuOnlyProvisioner,
    cpu_fallback_message,
)
from nexus_installer.engine.cuda_linux_provisioner import (
    CudaLinuxProvisioner,
)
from nexus_installer.engine.ffmpeg_provisioner import (
    FfmpegProvisioner,
)
from nexus_installer.engine.metal_provisioner import MetalProvisioner
from nexus_installer.engine.ollama_linux_provisioner import OllamaLinuxProvisioner
from nexus_installer.engine.ollama_macos_provisioner import OllamaMacosProvisioner
from nexus_installer.engine.rocm_provisioner import RocmProvisioner


def _log() -> tuple[list[tuple[str, str]], Callable[[str, str], None]]:
    msgs: list[tuple[str, str]] = []

    def fn(msg: str, level: str = "info") -> None:
        msgs.append((msg, level))

    return msgs, fn


_METAL_IS_MACOS = "nexus_installer.engine.metal_provisioner.is_macos"


class TestMetalProvisioner:
    def test_skip_on_non_macos(self, tmp_path: Path) -> None:
        msgs, log = _log()
        with patch(_METAL_IS_MACOS, return_value=False):
            p = MetalProvisioner(tmp_path)
            assert p.install(log) is True

    def test_missing_payload(self, tmp_path: Path) -> None:
        msgs, log = _log()
        with patch(_METAL_IS_MACOS, return_value=True):
            p = MetalProvisioner(tmp_path)
            assert p.install(log) is False
            assert any("Metal payload missing" in m for m, _ in msgs)


class TestOllamaMacosProvisioner:
    def test_skip_on_non_macos(self, tmp_path: Path) -> None:
        msgs, log = _log()
        install_root = tmp_path / "Applications"
        with patch(
            "nexus_installer.engine.ollama_macos_provisioner.is_macos",
            return_value=False,
        ):
            p = OllamaMacosProvisioner(tmp_path, install_root=install_root)
            assert p.install(log) is True

    def test_copies_app(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        (payload / "ollama" / "Ollama.app").mkdir(parents=True)
        (payload / "ollama" / "Ollama.app" / "Info.plist").write_text("<plist/>")
        msgs, log = _log()
        install_root = tmp_path / "Applications"
        with (
            patch(
                "nexus_installer.engine.ollama_macos_provisioner.is_macos",
                return_value=True,
            ),
            patch(
                "nexus_installer.engine.ollama_macos_provisioner.subprocess.run",
                return_value=None,
            ),
        ):
            p = OllamaMacosProvisioner(payload, install_root=install_root)
            assert p.install(log) is True
        assert (install_root / "Ollama.app" / "Info.plist").exists()


class TestFfmpegProvisioner:
    def test_payload_missing(self, tmp_path: Path) -> None:
        msgs, log = _log()
        p = FfmpegProvisioner(tmp_path)
        assert p.install(log) is False
        assert any("ffmpeg payload missing" in m for m, _ in msgs)

    def test_copies_binaries(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = tmp_path / "payload"
        os_subdir = (
            "ffmpeg-windows"
            if sys.platform == "win32"
            else ("ffmpeg-mac" if sys.platform == "darwin" else "ffmpeg-linux")
        )
        (payload / os_subdir).mkdir(parents=True)
        ffmpeg = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
        ffprobe = "ffprobe.exe" if sys.platform == "win32" else "ffprobe"
        (payload / os_subdir / ffmpeg).write_text("ELF")
        (payload / os_subdir / ffprobe).write_text("ELF")

        target = tmp_path / "runtime" / "ffmpeg"
        monkeypatch.setattr(
            "nexus_installer.engine.ffmpeg_provisioner.runtime_ffmpeg_root",
            lambda: target,
        )
        msgs, log = _log()
        p = FfmpegProvisioner(payload)
        assert p.install(log) is True
        assert (target / ffmpeg).exists()
        assert (target / ffprobe).exists()
        assert p.verify(log) is True


class TestCudaLinuxProvisioner:
    def test_skip_on_non_linux(self, tmp_path: Path) -> None:
        msgs, log = _log()
        with patch(
            "nexus_installer.engine.cuda_linux_provisioner.is_linux", return_value=False
        ):
            p = CudaLinuxProvisioner(tmp_path)
            assert p.install(log) is True

    def test_copies_runtime(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = tmp_path / "payload"
        (payload / "cuda-12.1-runtime-linux" / "lib").mkdir(parents=True)
        (payload / "cuda-12.1-runtime-linux" / "lib" / "libcudart.so").write_text("ELF")
        target = tmp_path / "user" / "cuda"
        monkeypatch.setattr(
            "nexus_installer.engine.cuda_linux_provisioner.linux_cuda_root",
            lambda: target,
        )
        msgs, log = _log()
        with patch(
            "nexus_installer.engine.cuda_linux_provisioner.is_linux", return_value=True
        ):
            p = CudaLinuxProvisioner(payload)
            assert p.install(log) is True
        assert (target / "lib" / "libcudart.so").exists()

    def test_shell_env_hint(self) -> None:
        hint = CudaLinuxProvisioner.shell_env_update_hint()
        assert "LD_LIBRARY_PATH" in hint


_ROCM_IS_LINUX = "nexus_installer.engine.rocm_provisioner.is_linux"


class TestRocmProvisioner:
    def test_skip_on_non_linux(self, tmp_path: Path) -> None:
        msgs, log = _log()
        with patch(_ROCM_IS_LINUX, return_value=False):
            assert RocmProvisioner(tmp_path).install(log) is True

    def test_missing_rocm_smi(self, tmp_path: Path) -> None:
        msgs, log = _log()
        with patch(_ROCM_IS_LINUX, return_value=True):
            p = RocmProvisioner(tmp_path)
            with patch.object(p, "rocm_runtime_present", return_value=False):
                assert p.install(log) is False
        assert any("rocm-smi" in m for m, _ in msgs)


class TestCpuOnlyProvisioner:
    def test_message(self) -> None:
        assert "no GPU detected" in cpu_fallback_message()

    def test_missing_payload(self, tmp_path: Path) -> None:
        msgs, log = _log()
        p = CpuOnlyProvisioner(tmp_path)
        assert p.install(log) is False


class TestOllamaLinuxProvisioner:
    def test_skip_on_non_linux(self, tmp_path: Path) -> None:
        msgs, log = _log()
        with patch(
            "nexus_installer.engine.ollama_linux_provisioner.is_linux",
            return_value=False,
        ):
            p = OllamaLinuxProvisioner(tmp_path)
            assert p.install(log) is True

    def test_offline_payload_detected(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        (payload / "ollama").mkdir(parents=True)
        (payload / "ollama" / "ollama-linux-amd64.tgz").write_bytes(b"fake")
        p = OllamaLinuxProvisioner(payload)
        assert p.offline_payload_exists() is True

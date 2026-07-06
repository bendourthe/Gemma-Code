"""v1.1.0 Phase 14.1 -- tests for host detection."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from nexus_installer.engine import host_detect


def _stub_run(mapping: dict[tuple[str, ...], str | None]):
    def fake_run(cmd, timeout=host_detect.DETECTION_TIMEOUT_S):
        return mapping.get(tuple(cmd))

    return fake_run


class TestNormalize:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("x86_64", "x86_64"),
            ("AMD64", "x86_64"),
            ("x64", "x86_64"),
            ("arm64", "arm64"),
            ("aarch64", "arm64"),
            ("riscv", "riscv"),
            ("", "unknown"),
        ],
    )
    def test_normalize_arch(self, raw: str, expected: str) -> None:
        assert host_detect._normalize_arch(raw) == expected

    def test_normalize_os_family_branches(self) -> None:
        with patch.object(host_detect, "is_windows", return_value=True):
            assert host_detect._normalize_os_family() == "windows"
        with (
            patch.object(host_detect, "is_windows", return_value=False),
            patch.object(host_detect, "is_macos", return_value=True),
        ):
            assert host_detect._normalize_os_family() == "macos"
        with (
            patch.object(host_detect, "is_windows", return_value=False),
            patch.object(host_detect, "is_macos", return_value=False),
            patch.object(host_detect, "is_linux", return_value=True),
        ):
            assert host_detect._normalize_os_family() == "linux"


class TestCapabilityGates:
    @pytest.mark.parametrize(
        ("vendor", "driver", "expected"),
        [
            ("nvidia", "535.86", True),
            ("nvidia", "530.30.02", True),
            ("nvidia", "470.82", False),
            ("nvidia", "", False),
            ("amd", "560.00", False),
            ("none", "", False),
        ],
    )
    def test_cuda_compatible(self, vendor: str, driver: str, expected: bool) -> None:
        assert host_detect._is_cuda_compatible(vendor, driver) is expected

    @pytest.mark.parametrize(
        ("os_family", "arch", "expected"),
        [
            ("macos", "arm64", True),
            ("macos", "x86_64", False),
            ("linux", "arm64", False),
            ("windows", "arm64", False),
        ],
    )
    def test_metal_compatible(self, os_family: str, arch: str, expected: bool) -> None:
        assert host_detect._is_metal_compatible(os_family, arch) is expected

    def test_rocm_compatible_requires_smi(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            host_detect.shutil, "which", lambda _name: "/usr/bin/rocm-smi"
        )
        assert host_detect._is_rocm_compatible("linux", "amd") is True
        monkeypatch.setattr(host_detect.shutil, "which", lambda _name: None)
        assert host_detect._is_rocm_compatible("linux", "amd") is False
        assert host_detect._is_rocm_compatible("macos", "amd") is False
        assert host_detect._is_rocm_compatible("linux", "nvidia") is False


class TestDefaultInstallPath:
    def test_windows(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\test\AppData\Local")
        path = host_detect.default_install_path("windows")
        assert path.endswith("Nexus")

    def test_macos(self) -> None:
        path = host_detect.default_install_path("macos")
        assert path.endswith("Nexus.app")

    def test_linux(self) -> None:
        path = host_detect.default_install_path("linux")
        assert path.endswith("nexus")


class TestDriverMajor:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("530.30.02", 530),
            ("535.86", 535),
            ("470", 470),
            ("not-a-version", 0),
            ("", 0),
        ],
    )
    def test_driver_major(self, raw: str, expected: int) -> None:
        assert host_detect._driver_major(raw) == expected


class TestDetectGpu:
    def test_nvidia_first(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            host_detect, "_probe_nvidia", lambda: ("RTX 4070", 12, "535.86")
        )
        vendor, model, vram, driver = host_detect.detect_gpu()
        assert vendor == "nvidia"
        assert model == "RTX 4070"
        assert vram == 12
        assert driver == "535.86"

    def test_apple_when_no_nvidia(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(host_detect, "_probe_nvidia", lambda: None)
        monkeypatch.setattr(host_detect, "is_macos", lambda: True)
        monkeypatch.setattr(
            host_detect, "_probe_apple_gpu", lambda: ("Apple M2", 48, "Metal 3")
        )
        vendor, model, vram, driver = host_detect.detect_gpu()
        assert vendor == "apple"
        assert vram == 48

    def test_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(host_detect, "_probe_nvidia", lambda: None)
        monkeypatch.setattr(host_detect, "is_macos", lambda: False)
        monkeypatch.setattr(host_detect, "is_linux", lambda: False)
        monkeypatch.setattr(host_detect, "is_windows", lambda: False)
        monkeypatch.setattr(host_detect, "_probe_intel_gpu", lambda: None)
        vendor, model, vram, driver = host_detect.detect_gpu()
        assert vendor == "none"
        assert vram == 0


def _stub_os(monkeypatch: pytest.MonkeyPatch, family: str) -> None:
    monkeypatch.setattr(host_detect, "is_windows", lambda: family == "windows")
    monkeypatch.setattr(host_detect, "is_macos", lambda: family == "macos")
    monkeypatch.setattr(host_detect, "is_linux", lambda: family == "linux")


class TestDetectHostIntegration:
    def test_windows_with_rtx_4070(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _stub_os(monkeypatch, "windows")
        monkeypatch.setattr(
            host_detect,
            "_detect_windows_os_version",
            lambda: "Windows 11 23H2",
        )
        monkeypatch.setattr(
            host_detect, "_detect_windows_cpu_model", lambda: "Intel i9"
        )
        monkeypatch.setattr(host_detect, "_detect_windows_total_ram_gb", lambda: 32)
        monkeypatch.setattr(
            host_detect,
            "detect_gpu",
            lambda: ("nvidia", "RTX 4070", 12, "535.86"),
        )
        monkeypatch.setattr(host_detect.platform, "machine", lambda: "AMD64")
        profile = host_detect.detect_host(
            install_path_override=r"C:\Nexus",
            free_disk_probe=lambda _p: 250,
        )
        assert profile.os_family == "windows"
        assert profile.gpu_vendor == "nvidia"
        assert profile.cuda_compatible is True
        assert profile.free_disk_gb == 250

    def test_macos_m2(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _stub_os(monkeypatch, "macos")
        monkeypatch.setattr(
            host_detect, "_detect_macos_os_version", lambda: "macOS 14.5"
        )
        monkeypatch.setattr(
            host_detect, "_detect_macos_cpu_model", lambda: "Apple M2 Pro"
        )
        monkeypatch.setattr(host_detect, "_detect_macos_total_ram_gb", lambda: 16)
        monkeypatch.setattr(
            host_detect,
            "detect_gpu",
            lambda: ("apple", "Apple M2 Pro", 12, "Metal 3"),
        )
        monkeypatch.setattr(host_detect.platform, "machine", lambda: "arm64")
        profile = host_detect.detect_host(free_disk_probe=lambda _p: 200)
        assert profile.os_family == "macos"
        assert profile.metal_compatible is True
        assert profile.cuda_compatible is False

    def test_linux_amd_rocm(self, monkeypatch: pytest.MonkeyPatch) -> None:
        _stub_os(monkeypatch, "linux")
        monkeypatch.setattr(
            host_detect, "_detect_linux_os_version", lambda: "Ubuntu 24.04"
        )
        monkeypatch.setattr(host_detect, "_detect_linux_cpu_model", lambda: "AMD Ryzen")
        monkeypatch.setattr(host_detect, "_detect_linux_total_ram_gb", lambda: 32)
        monkeypatch.setattr(
            host_detect, "detect_gpu", lambda: ("amd", "RX 7600", 8, "6.1.0")
        )
        monkeypatch.setattr(host_detect.shutil, "which", lambda _n: "/usr/bin/rocm-smi")
        monkeypatch.setattr(host_detect.platform, "machine", lambda: "x86_64")
        profile = host_detect.detect_host(free_disk_probe=lambda _p: 500)
        assert profile.rocm_compatible is True
        assert profile.cuda_compatible is False
        assert profile.gpu_vendor == "amd"

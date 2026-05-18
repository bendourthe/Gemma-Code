"""Tests for the CUDA provisioner (Phase 9.2)."""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

from nexus_installer.engine import cuda_provisioner
from nexus_installer.engine.cuda_provisioner import (
    CudaProvisioner,
    cpu_fallback_dialog_text,
    decide_install_mode,
    detect_driver_version,
    is_cuda_12_1_supported,
)


def _logs() -> tuple[list[tuple[str, str]], "callable"]:
    log: list[tuple[str, str]] = []

    def fn(msg: str, level: str) -> None:
        log.append((level, msg))

    return log, fn


class TestDriverVersionDetection:
    def test_returns_zeros_when_nvidia_smi_missing(self) -> None:
        with patch(
            "nexus_installer.engine.cuda_provisioner.run_command",
            return_value=(-1, "", "no such file"),
        ):
            major, minor, raw = detect_driver_version()
        assert major == 0
        assert minor == 0
        assert raw == ""

    def test_parses_two_part_version(self) -> None:
        with patch(
            "nexus_installer.engine.cuda_provisioner.run_command",
            return_value=(0, "551.86\n", ""),
        ):
            major, minor, raw = detect_driver_version()
        assert major == 551
        assert minor == 86
        assert raw == "551.86"

    def test_takes_first_gpu_when_multiple_returned(self) -> None:
        with patch(
            "nexus_installer.engine.cuda_provisioner.run_command",
            return_value=(0, "551.86\n550.40\n", ""),
        ):
            major, minor, _ = detect_driver_version()
        assert major == 551
        assert minor == 86


class TestCudaCompatibility:
    @pytest.mark.parametrize(
        ("driver_major", "expected"),
        [(0, False), (525, False), (530, True), (550, True), (560, True)],
    )
    def test_minimum_driver(self, driver_major: int, expected: bool) -> None:
        assert is_cuda_12_1_supported(driver_major) is expected


class TestInstallModeDecision:
    def test_missing_payload_short_circuits(self) -> None:
        assert decide_install_mode(driver_major=560, has_payload=False) == "missing-payload"

    def test_old_driver_returns_cpu_fallback(self) -> None:
        assert decide_install_mode(driver_major=520, has_payload=True) == "cpu-fallback"

    def test_modern_driver_returns_gpu(self) -> None:
        assert decide_install_mode(driver_major=560, has_payload=True) == "gpu"


class TestCpuFallbackCopy:
    def test_dialog_mentions_cpu_only(self) -> None:
        assert "CPU" in cpu_fallback_dialog_text()
        assert "GPU" in cpu_fallback_dialog_text()


class TestProvisionerCopy:
    def test_install_with_no_payload_fails_gracefully(
        self, tmp_path: Path
    ) -> None:
        payload = tmp_path / "payload"
        payload.mkdir()
        provisioner = CudaProvisioner(payload)
        log, fn = _logs()
        assert provisioner.payload_exists() is False
        assert provisioner.install(fn) is False
        assert any("not found" in msg.lower() for _, msg in log)

    def test_install_copies_payload_to_target(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = tmp_path / "payload"
        cuda_src = payload / "cuda-12.1-runtime"
        cuda_src.mkdir(parents=True)
        (cuda_src / "cudart64_12.dll").write_bytes(b"\x00" * 16)
        (cuda_src / "cudnn64_8.dll").write_bytes(b"\x00" * 16)

        target = tmp_path / "runtime"
        monkeypatch.setattr(
            cuda_provisioner,
            "_runtime_root",
            lambda: target,
        )

        provisioner = CudaProvisioner(payload)
        log, fn = _logs()
        assert provisioner.install(fn) is True
        assert (target / "cudart64_12.dll").exists()
        assert (target / "cudnn64_8.dll").exists()
        assert any("installed" in msg.lower() for _, msg in log)

    def test_install_replaces_existing_target(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = tmp_path / "payload"
        cuda_src = payload / "cuda-12.1-runtime"
        cuda_src.mkdir(parents=True)
        (cuda_src / "new.dll").write_bytes(b"new")

        target = tmp_path / "runtime"
        target.mkdir()
        (target / "stale.dll").write_bytes(b"stale")

        monkeypatch.setattr(
            cuda_provisioner,
            "_runtime_root",
            lambda: target,
        )

        provisioner = CudaProvisioner(payload)
        _, fn = _logs()
        assert provisioner.install(fn) is True
        assert (target / "new.dll").exists()
        assert not (target / "stale.dll").exists()

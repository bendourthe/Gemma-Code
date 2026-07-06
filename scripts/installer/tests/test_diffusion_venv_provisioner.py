"""Tests for the diffusion venv provisioner (Phase 9.3)."""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from nexus_installer.engine import diffusion_venv_provisioner as venv_mod
from nexus_installer.engine.diffusion_venv_provisioner import (
    DiffusionVenvProvisioner,
    REQUIRED_WHEEL_PREFIXES,
    cuda_smoke_test_command,
    find_missing_wheels,
)


def _logs() -> tuple[list[tuple[str, str]], "callable"]:
    log: list[tuple[str, str]] = []

    def fn(msg: str, level: str) -> None:
        log.append((level, msg))

    return log, fn


def _hydrate_wheel_dir(directory: Path) -> None:
    """Place a stub wheel for each required prefix so find_missing_wheels passes."""
    directory.mkdir(parents=True, exist_ok=True)
    for prefix in REQUIRED_WHEEL_PREFIXES:
        normalized = prefix.replace("-", "_")
        (directory / f"{normalized}-1.0.0-py3-none-any.whl").write_bytes(b"\x00")


class TestFindMissingWheels:
    def test_empty_directory_reports_all_missing(self, tmp_path: Path) -> None:
        missing = find_missing_wheels(tmp_path / "wheels")
        assert set(missing) == set(REQUIRED_WHEEL_PREFIXES)

    def test_no_missing_when_all_present(self, tmp_path: Path) -> None:
        wheels = tmp_path / "wheels"
        _hydrate_wheel_dir(wheels)
        assert find_missing_wheels(wheels) == []

    def test_reports_specific_missing(self, tmp_path: Path) -> None:
        wheels = tmp_path / "wheels"
        _hydrate_wheel_dir(wheels)
        # Remove the torch wheel.
        for path in wheels.glob("torch-*.whl"):
            path.unlink()
        missing = find_missing_wheels(wheels)
        assert missing == ["torch"]


class TestPreflight:
    def test_fails_when_wheels_missing(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        (payload / "python").mkdir(parents=True)
        provisioner = DiffusionVenvProvisioner(payload)
        ok, msg = provisioner.preflight()
        assert ok is False
        assert "missing" in msg.lower()

    def test_passes_with_wheels_and_requirements(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        wheels = payload / "python" / "wheels"
        _hydrate_wheel_dir(wheels)
        requirements = payload / "python" / "requirements.txt"
        requirements.write_text("# stub\n", encoding="utf-8")
        provisioner = DiffusionVenvProvisioner(payload)
        ok, msg = provisioner.preflight()
        assert ok is True
        assert msg == "ok"


class TestCreateVenv:
    def test_handles_subprocess_failure(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        (payload / "python").mkdir(parents=True)
        provisioner = DiffusionVenvProvisioner(payload)
        log, fn = _logs()

        class FailingResult:
            returncode = 1
            stderr = "boom"

        with patch.object(venv_mod.subprocess, "run", return_value=FailingResult()):
            assert provisioner.create_venv(fn) is False
        assert any(level == "error" for level, _ in log)

    def test_records_success(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        (payload / "python").mkdir(parents=True)
        provisioner = DiffusionVenvProvisioner(payload)
        log, fn = _logs()

        class OkResult:
            returncode = 0
            stderr = ""

        with patch.object(venv_mod.subprocess, "run", return_value=OkResult()):
            assert provisioner.create_venv(fn) is True
        assert any(level == "success" for level, _ in log)


class TestInstallWheels:
    def test_fails_when_venv_python_missing(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        wheels = payload / "python" / "wheels"
        _hydrate_wheel_dir(wheels)
        (payload / "python" / "requirements.txt").write_text("torch\n", encoding="utf-8")
        provisioner = DiffusionVenvProvisioner(payload)
        log, fn = _logs()
        assert provisioner.install_wheels(fn) is False
        assert any(level == "error" for level, _ in log)


class TestSmokeTestCommand:
    def test_returns_torch_cuda_check(self, tmp_path: Path) -> None:
        cmd = cuda_smoke_test_command(tmp_path)
        assert "torch.cuda.is_available()" in cmd[-1]
        assert cmd[-2] == "-c"

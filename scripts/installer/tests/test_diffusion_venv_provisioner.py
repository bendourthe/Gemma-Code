"""Tests for the diffusion venv provisioner (Phase 9.3)."""

from __future__ import annotations

import hashlib
import json
import subprocess
from collections.abc import Callable
from pathlib import Path
from unittest.mock import patch

import pytest

from nexus_installer.engine import diffusion_venv_provisioner as venv_mod
from nexus_installer.engine.diffusion_venv_provisioner import (
    REQUIRED_WHEEL_PREFIXES,
    DiffusionVenvProvisioner,
    cuda_smoke_test_command,
    find_missing_wheels,
    load_diffusion_manifest,
)


def _logs() -> tuple[list[tuple[str, str]], Callable[[str, str], None]]:
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
        (payload / "python" / "requirements.txt").write_text(
            "torch\n", encoding="utf-8"
        )
        provisioner = DiffusionVenvProvisioner(payload)
        log, fn = _logs()
        assert provisioner.install_wheels(fn) is False
        assert any(level == "error" for level, _ in log)


class TestSmokeTestCommand:
    def test_returns_torch_cuda_check(self, tmp_path: Path) -> None:
        cmd = cuda_smoke_test_command(tmp_path)
        assert "torch.cuda.is_available()" in cmd[-1]
        assert cmd[-2] == "-c"


class TestVerifiedProvisioning:
    @staticmethod
    def _artifact(payload: bytes) -> dict[str, object]:
        return {
            "filename": "torch.whl",
            "url": "https://download-r2.pytorch.org/whl/cu121/torch.whl",
            "size": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }

    @staticmethod
    def _response(
        chunks: list[bytes], status_code: int = 200
    ) -> object:
        class Response:
            def __init__(self) -> None:
                self.status_code = status_code

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def raise_for_status(self) -> None:
                return None

            def iter_bytes(self, _chunk_size: int):
                yield from chunks

        return Response()

    def test_manifest_has_real_cuda_artifact_pins(self) -> None:
        manifest, fingerprint = load_diffusion_manifest()
        assert len(fingerprint) == 64
        for key, target in manifest["targets"].items():
            if target["backend"] != "cuda":
                continue
            assert target["referenceArtifacts"], key
            for artifact in target["referenceArtifacts"]:
                assert artifact["size"] > 0
                assert artifact["sha256"] != "0" * 64

    def test_manifest_rejects_placeholder_artifact_hash(self, tmp_path: Path) -> None:
        lock = {
            "diffusion": {
                "targets": {
                    "win-x64-nvidia": {
                        "backend": "cuda",
                        "referenceArtifacts": [
                            {
                                "url": "https://download-r2.pytorch.org/whl/cu121/torch.whl",
                                "sha256": "0" * 64,
                                "size": 1,
                            }
                        ],
                    }
                }
            }
        }
        path = tmp_path / "versions.lock.json"
        path.write_text(json.dumps(lock), encoding="utf-8")
        with pytest.raises(ValueError, match="unverified artifact"):
            load_diffusion_manifest(path)

    def test_verified_artifact_is_cached_and_reused_offline(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = b"verified-wheel"
        provisioner = DiffusionVenvProvisioner(tmp_path)
        monkeypatch.setattr(
            venv_mod.httpx, "stream", lambda *_a, **_k: self._response([payload])
        )
        cached, failure = provisioner._fetch_verified_artifact(
            self._artifact(payload), tmp_path / "cache", lambda *_: None, lambda _: None
        )
        assert failure == ""
        assert cached is not None and cached.read_bytes() == payload
        monkeypatch.setattr(
            venv_mod.httpx,
            "stream",
            lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("network used")),
        )
        reused, failure = provisioner._fetch_verified_artifact(
            self._artifact(payload), tmp_path / "cache", lambda *_: None, lambda _: None
        )
        assert failure == ""
        assert reused == cached

    def test_artifact_resume_appends_and_verifies(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = b"abcdef"
        artifact = self._artifact(payload)
        partial = (
            tmp_path
            / "cache"
            / str(artifact["sha256"])
            / "torch.whl.partial"
        )
        partial.parent.mkdir(parents=True)
        partial.write_bytes(b"abc")
        monkeypatch.setattr(
            venv_mod.httpx,
            "stream",
            lambda *_a, **_k: self._response([b"def"], status_code=206),
        )
        cached, failure = DiffusionVenvProvisioner(
            tmp_path
        )._fetch_verified_artifact(
            artifact, tmp_path / "cache", lambda *_: None, lambda _: None
        )
        assert failure == ""
        assert cached is not None and cached.read_bytes() == payload

    def test_artifact_checksum_mismatch_is_deleted(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        expected = b"expected"
        monkeypatch.setattr(
            venv_mod.httpx,
            "stream",
            lambda *_a, **_k: self._response([b"tampered"]),
        )
        cached, failure = DiffusionVenvProvisioner(
            tmp_path
        )._fetch_verified_artifact(
            self._artifact(expected),
            tmp_path / "cache",
            lambda *_: None,
            lambda _: None,
        )
        assert cached is None
        assert failure == "ARTIFACT_CHECKSUM_MISMATCH"
        assert not list((tmp_path / "cache").rglob("*.whl"))

    def test_offline_without_cache_returns_retryable_download_failure(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            venv_mod.httpx,
            "stream",
            lambda *_a, **_k: (_ for _ in ()).throw(
                venv_mod.httpx.ConnectError("offline")
            ),
        )
        cached, failure = DiffusionVenvProvisioner(
            tmp_path
        )._fetch_verified_artifact(
            self._artifact(b"missing"),
            tmp_path / "cache",
            lambda *_: None,
            lambda _: None,
        )
        assert cached is None
        assert failure == "ARTIFACT_DOWNLOAD_FAILED"

    def test_cancel_keeps_partial_artifact_for_resume(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = b"partial-data"
        provisioner = DiffusionVenvProvisioner(tmp_path)
        provisioner.cancel()
        monkeypatch.setattr(
            venv_mod.httpx, "stream", lambda *_a, **_k: self._response([payload])
        )
        cached, failure = provisioner._fetch_verified_artifact(
            self._artifact(payload), tmp_path / "cache", lambda *_: None, lambda _: None
        )
        assert cached is None
        assert failure == "DOWNLOAD_CANCELLED"
        assert list((tmp_path / "cache").rglob("*.partial"))

    def test_cuda_smoke_success_is_typed(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        result = subprocess.CompletedProcess(
            [],
            0,
            stdout=json.dumps(
                {
                    "pythonVersion": "3.11.9",
                    "torchVersion": "2.3.0+cu121",
                    "cudaVersion": "12.1",
                    "cudaAvailable": True,
                    "gpuName": "Test GPU",
                }
            ),
            stderr="",
        )
        monkeypatch.setattr(venv_mod.subprocess, "run", lambda *a, **k: result)
        readiness = DiffusionVenvProvisioner._smoke(tmp_path, "cuda", lambda *_: None)
        assert readiness.status == "ready"
        assert readiness.cuda_available is True
        assert readiness.torch_version == "2.3.0+cu121"

    def test_cpu_only_torch_fails_cuda_readiness(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        result = subprocess.CompletedProcess(
            [],
            0,
            stdout=json.dumps(
                {
                    "pythonVersion": "3.11.9",
                    "torchVersion": "2.3.0+cpu",
                    "cudaVersion": "",
                    "cudaAvailable": False,
                    "gpuName": "",
                }
            ),
            stderr="",
        )
        monkeypatch.setattr(venv_mod.subprocess, "run", lambda *a, **k: result)
        readiness = DiffusionVenvProvisioner._smoke(tmp_path, "cuda", lambda *_: None)
        assert readiness.status == "failed"
        assert readiness.failure_code == "CUDA_UNAVAILABLE"

    def test_smoke_timeout_is_retryable(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def timeout(*_args, **_kwargs):
            raise subprocess.TimeoutExpired(["python"], 45)

        monkeypatch.setattr(venv_mod.subprocess, "run", timeout)
        readiness = DiffusionVenvProvisioner._smoke(tmp_path, "cuda", lambda *_: None)
        assert readiness.status == "failed"
        assert readiness.failure_code == "SMOKE_TIMEOUT"
        assert readiness.retryable is True

    def test_failed_repair_preserves_existing_environment(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        final = tmp_path / "venv"
        final.mkdir()
        sentinel = final / "healthy.txt"
        sentinel.write_text("keep", encoding="utf-8")
        monkeypatch.setattr(venv_mod, "venv_dir", lambda: final)
        monkeypatch.setattr(
            venv_mod, "diffusion_target_key", lambda _vendor: "win-x64-nvidia"
        )
        monkeypatch.setattr(
            DiffusionVenvProvisioner, "_run_checked", lambda *a, **k: True
        )
        monkeypatch.setattr(
            DiffusionVenvProvisioner,
            "_fetch_verified_artifact",
            lambda self, artifact, cache, log, progress: (
                tmp_path / str(artifact["filename"]),
                "",
            ),
        )
        monkeypatch.setattr(
            DiffusionVenvProvisioner,
            "_smoke",
            lambda *a, **k: venv_mod.DiffusionProvisionResult(
                status="failed", backend="cuda", failure_code="CUDA_UNAVAILABLE"
            ),
        )
        result = DiffusionVenvProvisioner(tmp_path).provision_verified(
            lambda *_: None,
            gpu_vendor="nvidia",
        )
        assert result.failure_code == "CUDA_UNAVAILABLE"
        assert sentinel.read_text(encoding="utf-8") == "keep"

    def test_stale_environment_is_replaced_after_successful_smoke(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        final = tmp_path / "venv"
        final.mkdir()
        (final / venv_mod.ENVIRONMENT_MARKER).write_text(
            json.dumps({"manifestFingerprint": "stale"}), encoding="utf-8"
        )
        (final / "old.txt").write_text("old", encoding="utf-8")
        monkeypatch.setattr(venv_mod, "venv_dir", lambda: final)
        monkeypatch.setattr(
            venv_mod, "diffusion_target_key", lambda _vendor: "win-x64-nvidia"
        )

        def run_checked(command, *_args, **_kwargs):
            if command[1:3] == ["-m", "venv"]:
                Path(command[-1]).mkdir(parents=True)
            return True

        monkeypatch.setattr(
            DiffusionVenvProvisioner, "_run_checked", staticmethod(run_checked)
        )
        monkeypatch.setattr(
            DiffusionVenvProvisioner, "_source_python_abi", lambda *_: "cp311"
        )
        monkeypatch.setattr(
            DiffusionVenvProvisioner,
            "_fetch_verified_artifact",
            lambda self, artifact, cache, log, progress: (
                tmp_path / str(artifact["filename"]),
                "",
            ),
        )
        monkeypatch.setattr(
            DiffusionVenvProvisioner,
            "_smoke",
            lambda *a, **k: venv_mod.DiffusionProvisionResult(
                status="ready",
                backend="cuda",
                cuda_available=True,
                smoke_at="2026-08-29T00:00:00Z",
            ),
        )
        result = DiffusionVenvProvisioner(tmp_path).provision_verified(
            lambda *_: None,
            gpu_vendor="nvidia",
        )
        assert result.status == "ready"
        assert result.manifest_fingerprint != "stale"
        assert not (final / "old.txt").exists()
        marker = json.loads(
            (final / venv_mod.ENVIRONMENT_MARKER).read_text(encoding="utf-8")
        )
        assert marker["manifestFingerprint"] == result.manifest_fingerprint

    def test_busy_repair_returns_retryable_status(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        final = tmp_path / "venv"
        monkeypatch.setattr(venv_mod, "venv_dir", lambda: final)
        monkeypatch.setattr(
            venv_mod, "diffusion_target_key", lambda _vendor: "win-x64-nvidia"
        )

        def busy(*_args, **_kwargs):
            raise TimeoutError

        monkeypatch.setattr(venv_mod, "environment_lock", busy)
        result = DiffusionVenvProvisioner(tmp_path).provision_verified(
            lambda *_: None,
            gpu_vendor="nvidia",
        )
        assert result.status == "repairing"
        assert result.failure_code == "REPAIR_BUSY"
        assert result.retryable is True

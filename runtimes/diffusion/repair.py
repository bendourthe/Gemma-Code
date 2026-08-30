"""Bounded in-place repair for the installed diffusion environment.

The desktop launches this module only through the interpreter recorded in
``~/.nexus/runtime.json``. It reuses the installer lock, verifies every pinned
PyTorch wheel before invoking pip, runs an import/backend smoke test, and marks
the runtime ready only after that smoke succeeds.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import tempfile
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

LOCK_FILE = Path(__file__).with_name("runtime-lock.json")
CHUNK_SIZE = 1024 * 1024


def emit(kind: str, **payload: object) -> None:
    print(json.dumps({"kind": kind, **payload}), flush=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        prefix=f"{path.stem}-", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
        os.replace(temp_name, path)
    finally:
        Path(temp_name).unlink(missing_ok=True)


def _target_key(backend: str) -> str:
    machine = platform.machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    if sys.platform == "win32":
        return f"win-{arch}-nvidia" if backend == "cuda" else f"win-{arch}-none"
    if sys.platform == "darwin":
        return f"mac-{arch}-apple" if backend == "mps" else f"mac-{arch}-none"
    return f"linux-{arch}-nvidia" if backend == "cuda" else f"linux-{arch}-none"


def _download_verified(
    artifact: dict[str, Any], cache_root: Path, ordinal: int, total: int
) -> Path:
    expected_size = int(artifact["size"])
    expected_sha = str(artifact["sha256"])
    destination = cache_root / expected_sha / str(artifact["filename"])
    destination.parent.mkdir(parents=True, exist_ok=True)
    if (
        destination.is_file()
        and destination.stat().st_size == expected_size
        and _sha256(destination) == expected_sha
    ):
        return destination
    partial = destination.with_suffix(destination.suffix + ".partial")
    partial.unlink(missing_ok=True)
    request = urllib.request.Request(
        str(artifact["url"]), headers={"User-Agent": "Nexus/2.4.1 media-repair"}
    )
    with (
        urllib.request.urlopen(request, timeout=300) as response,
        partial.open("wb") as handle,
    ):
        received = 0
        while True:
            chunk = response.read(CHUNK_SIZE)
            if not chunk:
                break
            handle.write(chunk)
            received += len(chunk)
            fraction = min(received / expected_size, 1.0)
            emit(
                "progress",
                progress=0.08 + ((ordinal + fraction) / max(total, 1)) * 0.42,
                message="Downloading verified GPU runtime",
            )
    if partial.stat().st_size != expected_size or _sha256(partial) != expected_sha:
        partial.unlink(missing_ok=True)
        raise RuntimeError("ARTIFACT_INTEGRITY_FAILED")
    os.replace(partial, destination)
    return destination


def _run_pip(args: list[str], label: str) -> None:
    emit("progress", progress=0.55 if "PyTorch" in label else 0.72, message=label)
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", *args, "--disable-pip-version-check"],
        capture_output=True,
        text=True,
        timeout=1800,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "pip failed").strip()[-600:]
        raise RuntimeError(f"PACKAGE_INSTALL_FAILED: {detail}")


def _smoke(backend: str) -> dict[str, Any]:
    emit("progress", progress=0.92, message="Validating media runtime")
    import diffusers  # type: ignore[import-not-found]
    import imageio_ffmpeg  # type: ignore[import-not-found]
    import torch  # type: ignore[import-not-found]
    from PIL import Image  # type: ignore[import-not-found]

    del diffusers, Image
    cuda = bool(torch.cuda.is_available())
    mps = bool(
        getattr(torch.backends, "mps", None) and torch.backends.mps.is_available()
    )
    if backend == "cuda" and not cuda:
        raise RuntimeError("CUDA_UNAVAILABLE")
    if backend == "mps" and not mps:
        raise RuntimeError("MPS_UNAVAILABLE")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    if not ffmpeg or not Path(ffmpeg).is_file():
        raise RuntimeError("ENCODER_UNAVAILABLE")
    return {
        "python_version": platform.python_version(),
        "torch_version": str(torch.__version__),
        "cuda_version": str(torch.version.cuda or ""),
        "cuda_available": cuda,
        "mps_available": mps,
        "gpu_name": torch.cuda.get_device_name(0) if cuda else "",
        "smoke_at": datetime.now(UTC).isoformat(),
    }


def _update_contract(
    path: Path,
    *,
    status: str,
    attempt_id: str,
    failure_code: str = "",
    evidence: dict[str, Any] | None = None,
    fingerprint: str = "",
) -> None:
    config = json.loads(path.read_text(encoding="utf-8"))
    existing = (
        config.get("diffusion") if isinstance(config.get("diffusion"), dict) else {}
    )
    backend = str(existing.get("backend") or "unknown")
    now = datetime.now(UTC).isoformat()
    config["diffusion"] = {
        **existing,
        **(evidence or {}),
        "status": status,
        "backend": backend,
        "failure_code": failure_code,
        "retryable": status != "ready",
        "manifest_fingerprint": fingerprint
        or str(existing.get("manifest_fingerprint") or ""),
        "provisioner_version": "2.4.1",
        "attempt_id": attempt_id,
        "repair_started_at": config.get("repairAttempt", {}).get("startedAt")
        if isinstance(config.get("repairAttempt"), dict)
        else None,
        "repair_owner_pid": os.getpid(),
    }
    config["repairAttempt"] = {
        "attemptId": attempt_id,
        "status": status,
        "failureCode": failure_code or None,
        "ownerPid": os.getpid(),
        "startedAt": config.get("repairAttempt", {}).get("startedAt")
        if isinstance(config.get("repairAttempt"), dict)
        else now,
        "finishedAt": now,
    }
    _atomic_json(path, config)


def repair(runtime_config: Path) -> int:
    attempt_id = uuid.uuid4().hex
    started = datetime.now(UTC).isoformat()
    config = json.loads(runtime_config.read_text(encoding="utf-8"))
    diffusion = (
        config.get("diffusion") if isinstance(config.get("diffusion"), dict) else {}
    )
    backend = str(diffusion.get("backend") or "unknown")
    config["repairAttempt"] = {
        "attemptId": attempt_id,
        "status": "repairing",
        "failureCode": None,
        "ownerPid": os.getpid(),
        "startedAt": started,
        "finishedAt": None,
    }
    _atomic_json(runtime_config, config)
    emit(
        "progress",
        progress=0.02,
        message="Preparing media runtime repair",
        attemptId=attempt_id,
    )
    try:
        raw = LOCK_FILE.read_bytes()
        lock = json.loads(raw)
        fingerprint = hashlib.sha256(
            json.dumps(lock, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        target = lock["targets"].get(_target_key(backend))
        if not isinstance(target, dict):
            raise RuntimeError("UNSUPPORTED_GPU")
        abi = f"cp{sys.version_info.major}{sys.version_info.minor}"
        artifacts = [
            item
            for item in target.get("referenceArtifacts", [])
            if item.get("pythonAbi") == abi
        ]
        if backend == "cuda" and len(artifacts) != 3:
            raise RuntimeError("PYTHON_ABI_UNSUPPORTED")
        cache = Path.home() / ".nexus" / "python" / "artifact-cache"
        local = [
            _download_verified(item, cache, index, len(artifacts))
            for index, item in enumerate(artifacts)
        ]
        _run_pip(
            [
                *(str(path) for path in local),
                "--extra-index-url",
                str(target["torchIndexUrl"]),
            ],
            "Installing verified PyTorch runtime",
        )
        _run_pip(
            [
                *map(str, lock["runtimeRequirements"]),
                "--index-url",
                str(lock["runtimeIndexUrl"]),
            ],
            "Installing pinned media packages",
        )
        evidence = _smoke(backend)
        _update_contract(
            runtime_config,
            status="ready",
            attempt_id=attempt_id,
            evidence=evidence,
            fingerprint=fingerprint,
        )
        emit(
            "complete",
            progress=1.0,
            message="Media runtime repaired",
            attemptId=attempt_id,
        )
        return 0
    except Exception as exc:  # noqa: BLE001 - command boundary emits typed failure
        code = str(exc).split(":", 1)[0].strip() or type(exc).__name__
        _update_contract(
            runtime_config, status="failed", attempt_id=attempt_id, failure_code=code
        )
        emit("error", progress=1.0, code=code, message=str(exc), attemptId=attempt_id)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-config", type=Path, required=True)
    args = parser.parse_args()
    return repair(args.runtime_config)


if __name__ == "__main__":
    raise SystemExit(main())

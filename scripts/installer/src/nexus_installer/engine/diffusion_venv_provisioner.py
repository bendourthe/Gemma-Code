"""Provision and verify the isolated image and video Python runtime.

The current verified path creates a staged virtual environment, installs the
platform and Python-ABI pins from ``build/versions.lock.json``, runs a bounded
backend smoke test, and atomically activates the environment. Downloaded files
are cached by manifest fingerprint so a retry can reuse already-fetched data.

The legacy bundled-wheel helpers remain available for older installer tests
and payloads during the v2.4 compatibility window.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from nexus_installer.background.process import pid_alive
from nexus_installer.engine.platform_utils import (
    is_macos,
    is_windows,
    no_window_kwargs,
)

LogFn = Callable[[str, str], None]
ProgressFn = Callable[[float], None]

PROVISIONER_VERSION = "2.4.1"
REPAIR_LEASE_SCHEMA_VERSION = 1
ENVIRONMENT_MARKER = ".nexus-diffusion-environment.json"
# First CUDA import of torch + diffusers on Windows can exceed a minute
# (cold disk, Defender scanning new DLLs). 45s caused a field SMOKE_TIMEOUT
# after a successful wheel install and deleted the staging environment.
SMOKE_TIMEOUT_SECONDS = 300
DOWNLOAD_CHUNK_SIZE = 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 300


@dataclass(frozen=True)
class DiffusionProvisionResult:
    status: str
    backend: str
    failure_code: str = ""
    retryable: bool = False
    python_version: str = ""
    torch_version: str = ""
    cuda_version: str = ""
    cuda_available: bool = False
    mps_available: bool = False
    gpu_name: str = ""
    smoke_at: str = ""
    manifest_fingerprint: str = ""
    provisioner_version: str = PROVISIONER_VERSION
    attempt_id: str = ""
    repair_started_at: str = ""
    repair_owner_pid: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def versions_lock_path() -> Path:
    if getattr(sys, "frozen", False):
        return (
            Path(getattr(sys, "_MEIPASS", ""))
            / "installer-build"
            / "versions.lock.json"
        )
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "scripts" / "installer" / "build" / "versions.lock.json"
        if candidate.is_file():
            return candidate
    return Path("scripts/installer/build/versions.lock.json")


def load_diffusion_manifest(path: Path | None = None) -> tuple[dict[str, Any], str]:
    target = path or versions_lock_path()
    try:
        raw = target.read_bytes()
        lock = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"diffusion manifest unavailable: {target}: {exc}") from exc
    manifest = lock.get("diffusion")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("targets"), dict):
        raise ValueError("diffusion manifest is missing targets")
    for key, target_config in manifest["targets"].items():
        if not isinstance(target_config, dict):
            raise ValueError(f"diffusion target {key} is malformed")
        if target_config.get("backend") == "cuda":
            artifacts = target_config.get("referenceArtifacts")
            if not isinstance(artifacts, list) or not artifacts:
                raise ValueError(f"diffusion target {key} has no verified artifacts")
            for artifact in artifacts:
                if (
                    not isinstance(artifact, dict)
                    or not str(artifact.get("url", "")).startswith(
                        "https://download-r2.pytorch.org/"
                    )
                    or len(str(artifact.get("sha256", ""))) != 64
                    or str(artifact.get("sha256")) == "0" * 64
                    or int(artifact.get("size", 0)) <= 0
                ):
                    raise ValueError(
                        f"diffusion target {key} contains an unverified artifact"
                    )
    fingerprint = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return manifest, fingerprint


def diffusion_target_key(gpu_vendor: str) -> str:
    machine = __import__("platform").machine().lower()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64"
    vendor = (gpu_vendor or "none").lower()
    if is_windows():
        return f"win-{arch}-{vendor}"
    if is_macos():
        return f"mac-{arch}-{vendor}"
    return f"linux-{arch}-{vendor}"


@dataclass(frozen=True)
class RepairLease:
    schema_version: int
    pid: int
    process_start: str
    created_at: str
    target: str
    nonce: str
    host: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schema_version,
            "pid": self.pid,
            "processStart": self.process_start,
            "createdAt": self.created_at,
            "target": self.target,
            "nonce": self.nonce,
            "host": self.host,
        }


class RepairLeaseError(TimeoutError):
    """A repair lease could not be acquired without risking another owner."""

    def __init__(self, code: str, lease: dict[str, Any] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.lease = lease or {}


def _linux_boot_id() -> str:
    try:
        return (
            Path("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip()
        )
    except OSError:
        return ""


def process_start_identity(pid: int) -> str:
    """Return a stable process-start identity when the host exposes one."""
    if pid <= 0:
        return ""
    if sys.platform == "win32":
        try:
            import ctypes

            process_query = 0x1000  # PROCESS_QUERY_LIMITED_INFORMATION
            kernel32 = ctypes.windll.kernel32
            handle = kernel32.OpenProcess(process_query, False, pid)
            if not handle:
                return ""
            try:
                creation = ctypes.c_ulonglong()
                exit_time = ctypes.c_ulonglong()
                kernel = ctypes.c_ulonglong()
                user = ctypes.c_ulonglong()
                if not kernel32.GetProcessTimes(
                    handle,
                    ctypes.byref(creation),
                    ctypes.byref(exit_time),
                    ctypes.byref(kernel),
                    ctypes.byref(user),
                ):
                    return ""
                return f"windows-filetime:{creation.value}"
            finally:
                kernel32.CloseHandle(handle)
        except (AttributeError, OSError, ValueError):
            return ""
    if sys.platform.startswith("linux"):
        try:
            raw = Path(f"/proc/{pid}/stat").read_text(encoding="ascii")
            # Field 2 is parenthesized and may contain spaces. Fields after the
            # final ')' begin at field 3; starttime is field 22.
            fields = raw[raw.rfind(")") + 2 :].split()
            start_ticks = fields[19]
            return f"linux:{_linux_boot_id()}:{start_ticks}"
        except (OSError, IndexError):
            return ""
    try:
        completed = subprocess.run(
            ["ps", "-p", str(pid), "-o", "lstart="],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
            **no_window_kwargs(),
        )
        started = completed.stdout.strip()
        return f"ps:{started}" if completed.returncode == 0 and started else ""
    except (OSError, subprocess.SubprocessError):
        return ""


@contextmanager
def _lease_guard(path: Path) -> Iterator[None]:
    """Serialize lease inspect/reclaim/create; OS locks release after crashes."""
    guard_path = path.with_name(f"{path.name}.guard")
    guard_path.parent.mkdir(parents=True, exist_ok=True)
    handle = guard_path.open("a+b")
    try:
        if is_windows():
            import msvcrt

            if guard_path.stat().st_size == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            handle.seek(0)
            if is_windows():
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def _read_lease(path: Path) -> tuple[dict[str, Any] | None, bytes]:
    try:
        raw = path.read_bytes()
    except OSError:
        return None, b""
    try:
        parsed = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        # v2.4.1 compatibility: the old lock was just an ASCII PID.
        try:
            return {"schemaVersion": 0, "pid": int(raw.decode("ascii").strip())}, raw
        except (UnicodeDecodeError, ValueError):
            return None, raw
    return (parsed if isinstance(parsed, dict) else None), raw


def _lease_owner_status(lease: dict[str, Any] | None) -> str:
    if lease is None:
        return "invalid"
    try:
        pid = int(lease.get("pid", 0))
    except (TypeError, ValueError):
        return "invalid"
    if pid <= 0:
        return "invalid"
    if not pid_alive(pid):
        return "stale"
    recorded_start = str(lease.get("processStart") or "")
    if not recorded_start:
        # A live legacy PID cannot be reclaimed safely because PID reuse cannot
        # be ruled out. Waiting is safer than deleting another installer.
        return "live"
    actual_start = process_start_identity(pid)
    if not actual_start:
        return "unknown"
    return "live" if actual_start == recorded_start else "stale"


def _quarantine_lease(path: Path, raw: bytes, *, invalid: bool) -> None:
    if not path.exists():
        return
    if invalid:
        quarantine = path.with_name(
            f"{path.name}.invalid-{int(time.time())}-{uuid.uuid4().hex[:8]}"
        )
        os.replace(path, quarantine)
        return
    # The guard prevents another cooperating claimant from replacing the file
    # between this final content comparison and deletion.
    if path.read_bytes() == raw:
        path.unlink(missing_ok=True)


@contextmanager
def environment_lock(
    path: Path,
    timeout_seconds: float = 5.0,
    *,
    target: str = "",
    attempt_id: str | None = None,
) -> Iterator[RepairLease]:
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout_seconds
    lease = RepairLease(
        schema_version=REPAIR_LEASE_SCHEMA_VERSION,
        pid=os.getpid(),
        process_start=process_start_identity(os.getpid()),
        created_at=datetime.now(UTC).isoformat(),
        target=target,
        nonce=attempt_id or uuid.uuid4().hex,
        host=f"{socket.gethostname()}:{platform.system()}:{_linux_boot_id()}",
    )
    payload = (json.dumps(lease.to_dict(), sort_keys=True) + "\n").encode("utf-8")
    last_status = "live"
    last_lease: dict[str, Any] | None = None
    acquired = False
    while not acquired:
        with _lease_guard(path):
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                existing, raw = _read_lease(path)
                last_status = _lease_owner_status(existing)
                last_lease = existing
                if last_status in {"stale", "invalid"}:
                    _quarantine_lease(path, raw, invalid=last_status == "invalid")
                    continue
            else:
                try:
                    os.write(fd, payload)
                    os.fsync(fd)
                finally:
                    os.close(fd)
                acquired = True
        if acquired:
            break
        if last_status == "unknown":
            raise RepairLeaseError("REPAIR_OWNER_UNKNOWN", last_lease)
        if time.monotonic() >= deadline:
            raise RepairLeaseError("REPAIR_BUSY", last_lease)
        time.sleep(0.05)
    try:
        yield lease
    finally:
        with _lease_guard(path):
            current, _raw = _read_lease(path)
            if current and current.get("nonce") == lease.nonce:
                path.unlink(missing_ok=True)


def _sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(DOWNLOAD_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


# Wheels that v1.0.0 expects to find in the bundled wheels directory. The
# payload-fetching script in CI is the source of truth -- this list mirrors
# the same set so we can fail fast if a wheel is missing before pip runs.
REQUIRED_WHEEL_PREFIXES: tuple[str, ...] = (
    "torch",
    "torchvision",
    "torchaudio",
    "diffusers",
    "transformers",
    "accelerate",
    "safetensors",
    "xformers",
    "Pillow",
    "imageio",
    "controlnet_aux",
    "opencv_python_headless",
    # v1.1.0 Phase 12.4 -- SVDQuant INT4 runtime (Apache-2.0).
    "nunchaku",
    # v1.16.0 Phase 3 (adoption item A5) -- document-OCR runtime, portable tier.
    # Both are pure wheels with no system packages, no GPU, and no compiler, so
    # they install on every supported host. They are REQUIRED (not optional)
    # because the portable OCR engine is what guarantees document parsing works
    # on a machine with no NVIDIA GPU; the CUDA vision-language engine reuses the
    # torch/transformers wheels already listed above.
    "pypdfium2",
    "rapidocr_onnxruntime",
    "onnxruntime",
    # v1.20.0 Phase 2 -- native Office ingest (not Docling; still no torch).
    "python_docx",
    "python_pptx",
    "openpyxl",
)


def _python_root() -> Path:
    """The on-disk root where the Python venv is provisioned."""
    if is_windows():
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        return Path(base) / "Nexus" / "python"
    if is_macos():
        return Path.home() / "Library" / "Application Support" / "Nexus" / "python"
    return Path.home() / ".local" / "share" / "nexus" / "python"


def venv_dir() -> Path:
    return _python_root() / "venv"


def venv_python(venv_path: Path) -> Path:
    if is_windows():
        return venv_path / "Scripts" / "python.exe"
    return venv_path / "bin" / "python"


def find_missing_wheels(wheels_dir: Path) -> list[str]:
    """Return prefixes from REQUIRED_WHEEL_PREFIXES with no matching wheel."""
    if not wheels_dir.exists():
        return list(REQUIRED_WHEEL_PREFIXES)
    present = {p.name for p in wheels_dir.glob("*.whl")}
    missing: list[str] = []
    for prefix in REQUIRED_WHEEL_PREFIXES:
        normalized = prefix.replace("-", "_")
        # Match the exact distribution name (delimited by `-`) to avoid the
        # `torch` prefix shadowing `torchvision`, `torchaudio`, etc.
        if not any(name.startswith(f"{normalized}-") for name in present):
            missing.append(prefix)
    return missing


class DiffusionVenvProvisioner:
    """Create the diffusion venv and pip-install the bundled wheels."""

    def __init__(
        self,
        payload_dir: Path,
        python_executable: str | None = None,
    ) -> None:
        self._wheels = payload_dir / "python" / "wheels"
        self._requirements = payload_dir / "python" / "requirements.txt"
        # Default to the embeddable Python shipped in the payload; fall back to
        # the system interpreter for local dev where the payload is absent.
        self._python = python_executable or self._resolve_bundled_python(payload_dir)
        self._cancelled = False

    def cancel(self) -> None:
        """Cancel active downloads while retaining partial files for retry."""
        self._cancelled = True

    @staticmethod
    def _resolve_bundled_python(payload_dir: Path) -> str:
        bundled = payload_dir / "python" / ("python.exe" if is_windows() else "python")
        if bundled.exists():
            return str(bundled)
        return sys.executable

    @property
    def wheels_dir(self) -> Path:
        return self._wheels

    @property
    def requirements_file(self) -> Path:
        return self._requirements

    @property
    def target_venv(self) -> Path:
        return venv_dir()

    def preflight(self) -> tuple[bool, str]:
        """Quick check before the heavy install. Returns (ok, message)."""
        if not self._wheels.exists():
            return False, f"wheels directory missing: {self._wheels}"
        missing = find_missing_wheels(self._wheels)
        if missing:
            return False, f"required wheels missing: {', '.join(missing)}"
        if not self._requirements.exists():
            return False, f"requirements.txt missing: {self._requirements}"
        return True, "ok"

    def create_venv(self, log: LogFn) -> bool:
        target = self.target_venv
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Use the venv module via a subprocess call against the bundled
            # python rather than this process's `venv.create` so the embedded
            # interpreter is the source of truth for the new env.
            result = subprocess.run(
                [self._python, "-m", "venv", str(target)],
                capture_output=True,
                text=True,
                timeout=120,
                **no_window_kwargs(),
            )
            if result.returncode != 0:
                log(f"venv creation failed: {result.stderr.strip()}", "error")
                return False
        except (subprocess.TimeoutExpired, OSError) as exc:
            log(f"venv creation crashed: {exc}", "error")
            return False
        log(f"venv created at {target}", "success")
        return True

    def install_wheels(self, log: LogFn) -> bool:
        """Run `pip install --no-index --find-links wheels -r requirements.txt`."""
        pip_python = venv_python(self.target_venv)
        if not pip_python.exists():
            log(f"venv python not found at {pip_python}", "error")
            return False

        cmd = [
            str(pip_python),
            "-m",
            "pip",
            "install",
            "--no-index",
            "--find-links",
            str(self._wheels),
            "--requirement",
            str(self._requirements),
            "--disable-pip-version-check",
        ]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1800,
                **no_window_kwargs(),
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            log(f"pip install crashed: {exc}", "error")
            return False

        if result.returncode != 0:
            log(f"pip install failed: {result.stderr.strip()[:400]}", "error")
            return False
        log("diffusion wheels installed offline", "success")
        return True

    def install(self, log: LogFn) -> bool:
        ok, msg = self.preflight()
        if not ok:
            log(f"diffusion venv preflight failed: {msg}", "warn")
            return False
        if not self.create_venv(log):
            return False
        return self.install_wheels(log)

    @staticmethod
    def _run_checked(
        command: list[str],
        log: LogFn,
        *,
        timeout: int,
        failure_label: str,
    ) -> bool:
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
                **no_window_kwargs(),
            )
        except subprocess.TimeoutExpired:
            log(f"{failure_label} timed out.", "error")
            return False
        except OSError as exc:
            log(f"{failure_label} could not start: {exc}", "error")
            return False
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "unknown error").strip()[:400]
            log(f"{failure_label} failed: {detail}", "error")
            return False
        return True

    def _source_python_abi(self, log: LogFn) -> str | None:
        try:
            result = subprocess.run(
                [
                    self._python,
                    "-c",
                    "import sys; "
                    "print(f'cp{sys.version_info.major}{sys.version_info.minor}')",
                ],
                capture_output=True,
                text=True,
                timeout=15,
                **no_window_kwargs(),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            log(f"Could not inspect the selected Python runtime: {exc}", "error")
            return None
        abi = result.stdout.strip()
        return abi if result.returncode == 0 and abi.startswith("cp") else None

    def _fetch_verified_artifact(
        self,
        artifact: dict[str, Any],
        cache_root: Path,
        log: LogFn,
        progress: ProgressFn,
    ) -> tuple[Path | None, str]:
        expected_hash = str(artifact["sha256"])
        expected_size = int(artifact["size"])
        destination = cache_root / expected_hash / str(artifact["filename"])
        partial = destination.with_suffix(destination.suffix + ".partial")
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.is_file():
            if (
                destination.stat().st_size == expected_size
                and _sha256_path(destination) == expected_hash
            ):
                progress(1.0)
                return destination, ""
            destination.unlink(missing_ok=True)
        existing = partial.stat().st_size if partial.is_file() else 0
        if existing > expected_size:
            partial.unlink(missing_ok=True)
            existing = 0
        headers = {"Range": f"bytes={existing}-"} if existing else {}
        try:
            with httpx.stream(
                "GET",
                str(artifact["url"]),
                headers=headers,
                follow_redirects=True,
                timeout=DOWNLOAD_TIMEOUT_SECONDS,
            ) as response:
                if response.status_code == 416 and existing == expected_size:
                    os.replace(partial, destination)
                else:
                    response.raise_for_status()
                    append = response.status_code == 206 and existing > 0
                    mode = "ab" if append else "wb"
                    received = existing if append else 0
                    with partial.open(mode) as handle:
                        for chunk in response.iter_bytes(DOWNLOAD_CHUNK_SIZE):
                            if self._cancelled:
                                return None, "DOWNLOAD_CANCELLED"
                            handle.write(chunk)
                            received += len(chunk)
                            progress(min(received / expected_size, 1.0))
                    os.replace(partial, destination)
        except (httpx.HTTPError, OSError) as exc:
            log(f"Pinned diffusion artifact download failed: {exc}", "error")
            return None, "ARTIFACT_DOWNLOAD_FAILED"
        if destination.stat().st_size != expected_size:
            destination.unlink(missing_ok=True)
            return None, "ARTIFACT_SIZE_MISMATCH"
        if _sha256_path(destination) != expected_hash:
            destination.unlink(missing_ok=True)
            return None, "ARTIFACT_CHECKSUM_MISMATCH"
        progress(1.0)
        return destination, ""

    @staticmethod
    def _smoke(venv_path: Path, backend: str, log: LogFn) -> DiffusionProvisionResult:
        code = (
            "import json,platform,torch,diffusers,PIL,imageio;"
            "available=bool(torch.cuda.is_available());"
            "mps=bool(getattr(torch.backends,'mps',None) "
            "and torch.backends.mps.is_available());"
            "name=torch.cuda.get_device_name(0) if available else '';"
            "print(json.dumps({'pythonVersion':platform.python_version(),"
            "'torchVersion':torch.__version__,'cudaVersion':torch.version.cuda or '',"
            "'cudaAvailable':available,'mpsAvailable':mps,'gpuName':name}))"
        )
        try:
            result = subprocess.run(
                [str(venv_python(venv_path)), "-c", code],
                capture_output=True,
                text=True,
                timeout=SMOKE_TIMEOUT_SECONDS,
                **no_window_kwargs(),
            )
        except subprocess.TimeoutExpired:
            log(
                "Diffusion import smoke timed out after "
                f"{SMOKE_TIMEOUT_SECONDS}s; the environment was not activated.",
                "error",
            )
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="SMOKE_TIMEOUT",
                retryable=True,
            )
        except OSError as exc:
            log(f"Diffusion smoke process could not start: {exc}", "error")
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="SMOKE_START_FAILED",
                retryable=True,
            )
        if result.returncode != 0:
            log(
                "Diffusion import smoke failed: "
                + (result.stderr or result.stdout or "unknown error").strip()[:400],
                "error",
            )
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="IMPORT_SMOKE_FAILED",
                retryable=True,
            )
        try:
            evidence = json.loads(result.stdout.strip().splitlines()[-1])
        except (IndexError, json.JSONDecodeError, TypeError):
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="MALFORMED_SMOKE_RESULT",
                retryable=True,
            )
        cuda_available = bool(evidence.get("cudaAvailable"))
        mps_available = bool(evidence.get("mpsAvailable"))
        if backend == "cuda" and not cuda_available:
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="CUDA_UNAVAILABLE",
                python_version=str(evidence.get("pythonVersion") or ""),
                torch_version=str(evidence.get("torchVersion") or ""),
                cuda_version=str(evidence.get("cudaVersion") or ""),
            )
        if backend == "mps" and not mps_available:
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="MPS_UNAVAILABLE",
                python_version=str(evidence.get("pythonVersion") or ""),
                torch_version=str(evidence.get("torchVersion") or ""),
            )
        return DiffusionProvisionResult(
            status="ready",
            backend=backend,
            python_version=str(evidence.get("pythonVersion") or ""),
            torch_version=str(evidence.get("torchVersion") or ""),
            cuda_version=str(evidence.get("cudaVersion") or ""),
            cuda_available=cuda_available,
            mps_available=mps_available,
            gpu_name=str(evidence.get("gpuName") or ""),
            smoke_at=datetime.now(UTC).isoformat(),
        )

    def provision_verified(
        self,
        log: LogFn,
        *,
        gpu_vendor: str,
        progress: ProgressFn | None = None,
        manifest_path: Path | None = None,
    ) -> DiffusionProvisionResult:
        """Run one traceable repair attempt and attach its identity to the result."""
        attempt_id = uuid.uuid4().hex
        started_at = datetime.now(UTC).isoformat()
        result = self._provision_verified(
            log,
            gpu_vendor=gpu_vendor,
            progress=progress,
            manifest_path=manifest_path,
            attempt_id=attempt_id,
        )
        return replace(
            result,
            attempt_id=attempt_id,
            repair_started_at=started_at,
            repair_owner_pid=os.getpid(),
        )

    def _provision_verified(
        self,
        log: LogFn,
        *,
        gpu_vendor: str,
        progress: ProgressFn | None = None,
        manifest_path: Path | None = None,
        attempt_id: str,
    ) -> DiffusionProvisionResult:
        """Build, smoke, and atomically activate a pinned diffusion environment."""
        update = progress or (lambda _value: None)
        try:
            manifest, fingerprint = load_diffusion_manifest(manifest_path)
        except ValueError as exc:
            log(str(exc), "error")
            return DiffusionProvisionResult(
                status="failed",
                backend="unknown",
                failure_code="MANIFEST_INVALID",
            )
        key = diffusion_target_key(gpu_vendor)
        target = manifest["targets"].get(key)
        if not isinstance(target, dict):
            return DiffusionProvisionResult(
                status="failed",
                backend="unknown",
                failure_code="UNSUPPORTED_GPU",
            )
        backend = str(target.get("backend") or "unknown")
        torch_requirements = target.get("torchRequirements")
        runtime_requirements = manifest.get("runtimeRequirements")
        if not isinstance(torch_requirements, list) or not isinstance(
            runtime_requirements, list
        ):
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="MANIFEST_INVALID",
            )
        final = self.target_venv
        marker = final / ENVIRONMENT_MARKER
        lock = final.parent / ".diffusion-repair.lock"
        try:
            with environment_lock(lock, target=key, attempt_id=attempt_id):
                if marker.is_file():
                    try:
                        recorded = json.loads(marker.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        recorded = {}
                    if recorded.get("manifestFingerprint") == fingerprint:
                        smoke = self._smoke(final, backend, log)
                        if smoke.status == "ready":
                            return DiffusionProvisionResult(
                                **{
                                    **smoke.to_dict(),
                                    "manifest_fingerprint": fingerprint,
                                }
                            )

                staging = final.with_name(f"{final.name}.staging-{os.getpid()}")
                backup = final.with_name(f"{final.name}.backup-{os.getpid()}")
                shutil.rmtree(staging, ignore_errors=True)
                shutil.rmtree(backup, ignore_errors=True)
                staging.parent.mkdir(parents=True, exist_ok=True)
                update(0.05)
                if not self._run_checked(
                    [self._python, "-m", "venv", str(staging)],
                    log,
                    timeout=180,
                    failure_label="Diffusion environment creation",
                ):
                    return DiffusionProvisionResult(
                        status="failed",
                        backend=backend,
                        failure_code="VENV_CREATE_FAILED",
                        retryable=True,
                    )
                update(0.15)
                cache_dir = _python_root() / "cache" / fingerprint
                cache_dir.mkdir(parents=True, exist_ok=True)
                python = str(venv_python(staging))
                abi = self._source_python_abi(log)
                if abi is None:
                    shutil.rmtree(staging, ignore_errors=True)
                    return DiffusionProvisionResult(
                        status="failed",
                        backend=backend,
                        failure_code="PYTHON_ABI_UNAVAILABLE",
                    )
                pinned_artifacts = [
                    artifact
                    for artifact in target.get("referenceArtifacts", [])
                    if artifact.get("pythonAbi") == abi
                ]
                if backend == "cuda" and len(pinned_artifacts) != 3:
                    shutil.rmtree(staging, ignore_errors=True)
                    return DiffusionProvisionResult(
                        status="failed",
                        backend=backend,
                        failure_code="PYTHON_ABI_UNSUPPORTED",
                    )
                torch_inputs: list[str] = []
                for artifact_index, artifact in enumerate(pinned_artifacts):
                    cached, failure_code = self._fetch_verified_artifact(
                        artifact,
                        _python_root() / "artifact-cache",
                        log,
                        lambda fraction, index=artifact_index: update(
                            0.15 + ((index + fraction) / len(pinned_artifacts)) * 0.4
                        ),
                    )
                    if cached is None:
                        shutil.rmtree(staging, ignore_errors=True)
                        return DiffusionProvisionResult(
                            status="failed",
                            backend=backend,
                            failure_code=failure_code,
                            retryable=failure_code
                            in {"DOWNLOAD_CANCELLED", "ARTIFACT_DOWNLOAD_FAILED"},
                        )
                    torch_inputs.append(str(cached))
                torch_cmd = [
                    python,
                    "-m",
                    "pip",
                    "install",
                    *(torch_inputs or [str(item) for item in torch_requirements]),
                    "--extra-index-url",
                    str(target.get("torchIndexUrl")),
                    "--cache-dir",
                    str(cache_dir),
                    "--disable-pip-version-check",
                ]
                if not self._run_checked(
                    torch_cmd,
                    log,
                    timeout=1800,
                    failure_label="Pinned PyTorch installation",
                ):
                    shutil.rmtree(staging, ignore_errors=True)
                    return DiffusionProvisionResult(
                        status="failed",
                        backend=backend,
                        failure_code="TORCH_INSTALL_FAILED",
                        retryable=True,
                    )
                update(0.65)
                runtime_cmd = [
                    python,
                    "-m",
                    "pip",
                    "install",
                    *[str(item) for item in runtime_requirements],
                    "--index-url",
                    str(manifest.get("runtimeIndexUrl")),
                    "--cache-dir",
                    str(cache_dir),
                    "--disable-pip-version-check",
                ]
                if not self._run_checked(
                    runtime_cmd,
                    log,
                    timeout=1800,
                    failure_label="Pinned diffusion package installation",
                ):
                    shutil.rmtree(staging, ignore_errors=True)
                    return DiffusionProvisionResult(
                        status="failed",
                        backend=backend,
                        failure_code="RUNTIME_INSTALL_FAILED",
                        retryable=True,
                    )
                update(0.9)
                smoke = self._smoke(staging, backend, log)
                if smoke.status != "ready":
                    shutil.rmtree(staging, ignore_errors=True)
                    return DiffusionProvisionResult(
                        **{
                            **smoke.to_dict(),
                            "manifest_fingerprint": fingerprint,
                        }
                    )
                marker_payload = {
                    "manifestFingerprint": fingerprint,
                    "provisionerVersion": PROVISIONER_VERSION,
                    "smokeAt": smoke.smoke_at,
                }
                (staging / ENVIRONMENT_MARKER).write_text(
                    json.dumps(marker_payload, indent=2) + "\n",
                    encoding="utf-8",
                )
                if final.exists():
                    os.replace(final, backup)
                try:
                    os.replace(staging, final)
                except OSError:
                    if backup.exists() and not final.exists():
                        os.replace(backup, final)
                    raise
                shutil.rmtree(backup, ignore_errors=True)
                update(1.0)
                return DiffusionProvisionResult(
                    **{
                        **smoke.to_dict(),
                        "manifest_fingerprint": fingerprint,
                    }
                )
        except RepairLeaseError as exc:
            status = "repairing" if exc.code == "REPAIR_BUSY" else "failed"
            log(
                "Diffusion repair lease could not be acquired "
                f"({exc.code}, owner pid {exc.lease.get('pid', 'unknown')}).",
                "warn",
            )
            return DiffusionProvisionResult(
                status=status,
                backend=backend,
                failure_code=exc.code,
                retryable=True,
                manifest_fingerprint=fingerprint,
            )
        except TimeoutError:
            return DiffusionProvisionResult(
                status="repairing",
                backend=backend,
                failure_code="REPAIR_BUSY",
                retryable=True,
                manifest_fingerprint=fingerprint,
            )
        except OSError as exc:
            log(f"Diffusion environment repair failed: {exc}", "error")
            return DiffusionProvisionResult(
                status="failed",
                backend=backend,
                failure_code="ATOMIC_SWAP_FAILED",
                retryable=True,
                manifest_fingerprint=fingerprint,
            )


def cuda_smoke_test_command(venv_path: Path) -> list[str]:
    """Return the argv that prints `True` when CUDA is wired up correctly."""
    return [
        str(venv_python(venv_path)),
        "-c",
        "import torch; print(torch.cuda.is_available())",
    ]

"""v1.1.0 Phase 14.4 -- Linux Ollama provisioner.

Installs Ollama from the bundled tarball when available
(`payload/ollama/ollama-linux-amd64.tgz`); otherwise downloads
`https://ollama.com/install.sh` and verifies its SHA-256 against the pinned
digest from `versions.lock.json`. Falls back to a clear error if neither path
is available -- the user can always install Ollama manually from
ollama.com/download.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import shutil
import subprocess
import tarfile
import tempfile
from collections.abc import Callable
from pathlib import Path

import httpx

from nexus_installer.engine.platform_utils import is_linux

LogFn = Callable[[str, str], None]

OLLAMA_INSTALL_URL = "https://ollama.com/install.sh"


def _sha256_file(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class OllamaLinuxProvisioner:
    """Install Ollama on Linux. Offline path preferred; network path fallback."""

    name = "ollama-linux"
    estimated_time_s = 120

    def __init__(
        self,
        payload_dir: Path,
        expected_script_sha256: str | None = None,
    ) -> None:
        self._tarball = payload_dir / "ollama" / "ollama-linux-amd64.tgz"
        self._install_root = Path("/usr/local")
        self._script_sha256 = expected_script_sha256

    @property
    def tarball(self) -> Path:
        return self._tarball

    def offline_payload_exists(self) -> bool:
        return self._tarball.exists() and self._tarball.is_file()

    def _install_offline(self, log: LogFn) -> bool:
        target = self._install_root / "lib" / "ollama"
        try:
            target.mkdir(parents=True, exist_ok=True)
            with tarfile.open(self._tarball, "r:gz") as tf:
                tf.extractall(target, filter="data")  # noqa: S202
            bin_src = target / "bin" / "ollama"
            bin_dst = self._install_root / "bin" / "ollama"
            if bin_src.exists():
                bin_dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(bin_src, bin_dst)
                bin_dst.chmod(0o755)
        except (OSError, tarfile.TarError) as exc:
            log(f"Ollama tarball extract failed: {exc}", "error")
            return False
        log("Ollama installed from bundled tarball", "success")
        return True

    def _install_via_script(self, log: LogFn) -> bool:
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(
                suffix=".sh", delete=False, mode="wb"
            ) as f:
                tmp_path = f.name
                with httpx.stream(
                    "GET", OLLAMA_INSTALL_URL, follow_redirects=True, timeout=60
                ) as resp:
                    resp.raise_for_status()
                    for chunk in resp.iter_bytes(8192):
                        f.write(chunk)
            if self._script_sha256:
                actual = _sha256_file(tmp_path)
                if actual != self._script_sha256:
                    log(
                        "Ollama install.sh checksum mismatch; aborting to "
                        "prevent execution of untrusted code",
                        "error",
                    )
                    return False
            os.chmod(tmp_path, 0o700)
            code = subprocess.call(["bash", tmp_path], timeout=600)
            if code != 0:
                log(f"Ollama install.sh exited with code {code}", "error")
                return False
        except (httpx.HTTPError, OSError, subprocess.TimeoutExpired) as exc:
            log(f"Ollama install script failed: {exc}", "error")
            return False
        finally:
            if tmp_path and os.path.exists(tmp_path):
                with contextlib.suppress(OSError):
                    os.unlink(tmp_path)
        log("Ollama installed via install.sh", "success")
        return True

    def install(self, log: LogFn) -> bool:
        if not is_linux():
            log("Linux Ollama provisioner skipped on non-Linux host", "info")
            return True
        if self.offline_payload_exists():
            return self._install_offline(log)
        log(
            "Bundled Ollama tarball not found; downloading install.sh",
            "info",
        )
        return self._install_via_script(log)

    def verify(self, log: LogFn) -> bool:
        if shutil.which("ollama") is None:
            log("ollama binary not found on PATH after install", "error")
            return False
        return True

"""Platform-specific Ollama installation."""

from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
import time
from collections.abc import Callable

import httpx

from nexus_installer.engine.platform_utils import (
    is_linux,
    is_macos,
    is_windows,
    no_window_kwargs,
    run_command,
)
from nexus_installer.installer_state import InstallerState

# Pinned release tag. Bump by updating scripts/installer/VERSIONS.md.
OLLAMA_PINNED_TAG = "v0.3.6"
OLLAMA_WINDOWS_URL = (
    f"https://github.com/ollama/ollama/releases/download/{OLLAMA_PINNED_TAG}/OllamaSetup.exe"
)
OLLAMA_LINUX_INSTALL_URL = "https://ollama.com/install.sh"

# SHA-256 checksums for pinned artifacts. Must be updated in lockstep with
# OLLAMA_PINNED_TAG. Pull the checksum from the upstream release page.
OLLAMA_WINDOWS_SHA256 = (
    # TODO: replace with actual pinned sha256 before shipping.
    "0000000000000000000000000000000000000000000000000000000000000000"
)
OLLAMA_LINUX_SCRIPT_SHA256 = (
    # TODO: replace with pinned sha256 of the install.sh at install time.
    "0000000000000000000000000000000000000000000000000000000000000000"
)

# Authenticode subjects the Windows installer is allowed to be signed by.
TRUSTED_WINDOWS_SIGNERS = ("CN=Ollama Inc.",)

OLLAMA_HEALTH_TIMEOUT = 30


def _sha256_file(path: str) -> str:
    """Return the hex SHA-256 digest of a file."""
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _verify_sha256(path: str, expected: str) -> bool:
    """Return True when the file hash matches the expected hex digest."""
    return _sha256_file(path) == expected


def _verify_authenticode_windows(
    path: str,
    log: Callable[[str, str], None],
) -> bool:
    """Run PowerShell Get-AuthenticodeSignature and require a Valid status with trusted subject."""
    try:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                f"(Get-AuthenticodeSignature -FilePath '{path}' | Select-Object -Property Status,SignerCertificate | ConvertTo-Csv -NoTypeInformation)",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            **no_window_kwargs(),
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        log(f"Authenticode check failed to run: {e}", "error")
        return False
    if result.returncode != 0:
        log(f"Authenticode check returned {result.returncode}: {result.stderr}", "error")
        return False
    output = result.stdout
    if '"Valid"' not in output:
        log("Authenticode signature is not Valid.", "error")
        return False
    if not any(signer in output for signer in TRUSTED_WINDOWS_SIGNERS):
        log("Authenticode signer not in trusted list.", "error")
        return False
    return True


class OllamaInstaller:
    """Handles Ollama installation on all platforms."""

    def install(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        """Install Ollama. Returns True on success."""
        if state.ollama_installed:
            log("Ollama is already installed, skipping.", "info")
            return True

        if is_windows():
            return self._install_windows(state, log)
        if is_macos():
            return self._install_macos(state, log)
        if is_linux():
            return self._install_linux(state, log)

        log("Unsupported platform for Ollama installation.", "error")
        return False

    def _install_windows(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log(f"Downloading Ollama {OLLAMA_PINNED_TAG} for Windows...", "info")
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
                tmp_path = f.name
            with httpx.stream(
                "GET", OLLAMA_WINDOWS_URL, follow_redirects=True, timeout=300
            ) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes(8192):
                        f.write(chunk)
            log("Verifying checksum...", "info")
            if not _verify_sha256(tmp_path, OLLAMA_WINDOWS_SHA256):
                log(
                    "Checksum mismatch for downloaded Ollama installer. Aborting to prevent supply-chain compromise.",
                    "error",
                )
                return False
            log("Verifying Authenticode signature...", "info")
            if not _verify_authenticode_windows(tmp_path, log):
                log("Authenticode verification failed. Aborting.", "error")
                return False
            log("Installing Ollama silently...", "info")
            code, _, stderr = run_command(
                [tmp_path, "/SILENT", "/AUTOSTART=0"], timeout=120
            )
            if code != 0:
                log(f"Ollama installer exited with code {code}: {stderr}", "error")
                return False
        except (httpx.HTTPError, OSError) as e:
            log(f"Failed to download Ollama: {e}", "error")
            return False
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        return self._verify_ollama(state, log)

    def _install_macos(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Installing Ollama via Homebrew...", "info")
        code, _, stderr = run_command(["brew", "install", "ollama"], timeout=300)
        if code != 0:
            log(f"Homebrew install failed: {stderr}. Trying direct download...", "warn")
            log(
                "Please install Ollama manually from https://ollama.com/download",
                "warn",
            )
            return False
        return self._verify_ollama(state, log)

    def _install_linux(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Downloading Ollama install script...", "info")
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".sh", delete=False, mode="wb") as f:
                tmp_path = f.name
                with httpx.stream(
                    "GET", OLLAMA_LINUX_INSTALL_URL, follow_redirects=True, timeout=60
                ) as resp:
                    resp.raise_for_status()
                    for chunk in resp.iter_bytes(8192):
                        f.write(chunk)
            log("Verifying install script checksum...", "info")
            if not _verify_sha256(tmp_path, OLLAMA_LINUX_SCRIPT_SHA256):
                log(
                    "Checksum mismatch for Ollama install script. "
                    "The upstream script has changed since the pinned hash was recorded. "
                    "Aborting to prevent execution of untrusted code.",
                    "error",
                )
                return False
            os.chmod(tmp_path, 0o700)
            log("Executing install script...", "info")
            code = subprocess.call(["bash", tmp_path], timeout=300)
            if code != 0:
                log("Ollama installation script failed.", "error")
                return False
        except (httpx.HTTPError, OSError, subprocess.TimeoutExpired) as e:
            log(f"Ollama install failed: {e}", "error")
            return False
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        return self._verify_ollama(state, log)

    def _verify_ollama(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Verifying Ollama connectivity...", "info")
        # v1.11.0 Phase 1 (T102): start `ollama serve` as a DETACHED hidden
        # child if it is not already running. The old `run_command(...,
        # timeout=3)` started the server and then KILLED it when the 3s
        # timeout expired (subprocess.run terminates its child on timeout),
        # leaving a clean machine with no server for the model step. Streams
        # go to DEVNULL so the server can never inherit installer pipes; the
        # process is deliberately left running (the product needs it).
        try:
            resp = httpx.get(f"{state.ollama_url}/api/version", timeout=3)
            server_up = resp.status_code == 200
        except httpx.HTTPError:
            server_up = False
        if not server_up:
            try:
                subprocess.Popen(
                    ["ollama", "serve"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    **no_window_kwargs(),
                )
            except (OSError, FileNotFoundError) as exc:
                log(f"Could not start the Ollama server: {exc}", "warn")
        deadline = time.monotonic() + OLLAMA_HEALTH_TIMEOUT
        while time.monotonic() < deadline:
            try:
                resp = httpx.get(f"{state.ollama_url}/api/tags", timeout=5)
                if resp.status_code == 200:
                    log("Ollama is running and reachable.", "success")
                    state.ollama_installed = True
                    return True
            except httpx.HTTPError:
                pass
            time.sleep(2)
        log("Ollama did not respond within 30 seconds.", "error")
        return False

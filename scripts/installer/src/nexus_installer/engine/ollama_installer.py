"""Platform-specific Ollama installation.

v1.11.0 Phase 3 (T302, closes IO.P1.B): the pins are REAL. The previous
`v0.3.6` tag shipped with an all-zero SHA-256 placeholder, so `_verify_sha256`
could never match and a clean machine always aborted at "Checksum mismatch"
(it only ever worked where Ollama pre-existed). Both platforms now pin the
same release tag with the GitHub-published asset digests, and the Linux path
installs the deterministic `ollama-linux-amd64.tar.zst` release asset
user-locally (no sudo; we manage `ollama serve` ourselves since Phase 1)
instead of executing the undeterministic, unpinnable `install.sh`.

Pin freshness is advisory-checked at build time by
`scripts/installer/build/check-ollama-pin.py`.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import subprocess
import tarfile
import tempfile
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from nexus_installer.engine.platform_utils import (
    is_linux,
    is_macos,
    is_windows,
    no_window_kwargs,
    run_command,
)
from nexus_installer.installer_state import InstallerState

# Pinned release tag + the GitHub-published sha256 digests of its assets
# (`gh api /repos/ollama/ollama/releases` -> assets[].digest). Update all
# three together; `check-ollama-pin.py` warns when the pin falls behind.
OLLAMA_PINNED_TAG = "v0.32.0"
OLLAMA_WINDOWS_URL = f"https://github.com/ollama/ollama/releases/download/{OLLAMA_PINNED_TAG}/OllamaSetup.exe"
OLLAMA_WINDOWS_SHA256 = (
    "07846c9074875e4d47518d41636880a9d9a40a7e1483659ac00be7aec082de06"
)
OLLAMA_LINUX_ASSET = "ollama-linux-amd64.tar.zst"
OLLAMA_LINUX_URL = f"https://github.com/ollama/ollama/releases/download/{OLLAMA_PINNED_TAG}/{OLLAMA_LINUX_ASSET}"
OLLAMA_LINUX_SHA256 = "56362d7609dfa9e35aaebb7c9cab25605d8f0528ec3d5d585dc83d6642002bab"

# Minimum Ollama version that can both pull AND load the Gemma 4 architecture:
# support landed in 0.20.0, and 0.21.0-0.21.2 had a Flash-Attention
# misreporting bug fixed in 0.22.0. The entire recommended chat/agentic default
# line is Gemma 4, so a too-old pre-existing Ollama would leave a fresh install
# with no working chat model. The bundled pin (OLLAMA_PINNED_TAG) is newer than
# this floor; the floor is what a PRE-EXISTING Ollama must meet or be upgraded.
MIN_OLLAMA_VERSION = "0.22.0"

MANUAL_INSTALL_SUGGESTION = (
    "Re-run the installer to retry; if it keeps failing, install Ollama "
    "manually from ollama.com/download and run this installer again."
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


def _version_tuple(version: str) -> tuple[int, ...]:
    """Parse a dotted version string into an int tuple for comparison."""
    parts: list[int] = []
    for segment in version.strip().lstrip("v").split("."):
        match = re.match(r"\d+", segment)
        parts.append(int(match.group()) if match else 0)
    return tuple(parts)


def _meets_min_version(current: str, minimum: str) -> bool:
    """True when `current` >= `minimum` by dotted-version ordering."""
    return _version_tuple(current) >= _version_tuple(minimum)


def linux_install_root() -> Path:
    """User-local Ollama install root on Linux (no sudo required)."""
    return Path.home() / ".local" / "share" / "nexus" / "ollama"


def _extract_tar_zst(archive: Path, dest: Path) -> None:
    """Extract a .tar.zst archive into `dest` with path-traversal filtering."""
    import zstandard  # local import: only the Linux install path needs it

    dest.mkdir(parents=True, exist_ok=True)
    dctx = zstandard.ZstdDecompressor()
    with (
        archive.open("rb") as fh,
        dctx.stream_reader(fh) as reader,
        tarfile.open(fileobj=reader, mode="r|") as tar,
    ):
        tar.extractall(dest, filter="data")


def _verify_authenticode_windows(
    path: str,
    log: Callable[[str, str], None],
) -> bool:
    """Require a Valid Authenticode status from a trusted signer (PowerShell)."""
    command = (
        f"(Get-AuthenticodeSignature -FilePath '{path}' | "
        "Select-Object -Property Status,SignerCertificate | "
        "ConvertTo-Csv -NoTypeInformation)"
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", command],
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
        log(
            f"Authenticode check returned {result.returncode}: {result.stderr}",
            "error",
        )
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
        if state.ollama_installed and self._existing_meets_min_version(state, log):
            return True

        if is_windows():
            return self._install_windows(state, log)
        if is_macos():
            return self._install_macos(state, log)
        if is_linux():
            return self._install_linux(state, log)

        state.record_step_failure(
            "ollama",
            "This operating system is not supported for automatic Ollama installation.",
            "Install Ollama manually from ollama.com/download, then re-run "
            "the installer.",
        )
        log("Unsupported platform for Ollama installation.", "error")
        return False

    def _install_windows(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log(f"Downloading Ollama {OLLAMA_PINNED_TAG} for Windows (~1.4 GB)...", "info")
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".exe", delete=False) as f:
                tmp_path = f.name
            with httpx.stream(
                "GET", OLLAMA_WINDOWS_URL, follow_redirects=True, timeout=1800
            ) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes(65536):
                        f.write(chunk)
            log("Verifying checksum...", "info")
            if not _verify_sha256(tmp_path, OLLAMA_WINDOWS_SHA256):
                state.record_step_failure(
                    "ollama",
                    "The downloaded Ollama installer did not match its "
                    "security checksum.",
                    MANUAL_INSTALL_SUGGESTION,
                )
                log(
                    "Checksum mismatch for downloaded Ollama installer. "
                    "Aborting to prevent supply-chain compromise.",
                    "error",
                )
                return False
            log("Verifying Authenticode signature...", "info")
            if not _verify_authenticode_windows(tmp_path, log):
                state.record_step_failure(
                    "ollama",
                    "The Ollama installer's publisher signature could not be verified.",
                    MANUAL_INSTALL_SUGGESTION,
                )
                log("Authenticode verification failed. Aborting.", "error")
                return False
            log("Installing Ollama silently...", "info")
            code, _, stderr = run_command(
                [tmp_path, "/SILENT", "/AUTOSTART=0"], timeout=600
            )
            if code != 0:
                state.record_step_failure(
                    "ollama",
                    f"The Ollama setup program reported an error (code {code}).",
                    MANUAL_INSTALL_SUGGESTION,
                )
                log(f"Ollama installer exited with code {code}: {stderr}", "error")
                return False
        except (httpx.HTTPError, OSError) as e:
            state.record_step_failure(
                "ollama",
                "Ollama could not be downloaded (a network problem interrupted it).",
                "Check the internet connection and re-run the installer.",
            )
            log(f"Failed to download Ollama: {e}", "error")
            return False
        finally:
            if tmp_path and os.path.exists(tmp_path):
                with contextlib.suppress(OSError):
                    os.unlink(tmp_path)
        return self._verify_ollama(state, log)

    def _install_macos(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Installing Ollama via Homebrew...", "info")
        code, _, stderr = run_command(["brew", "install", "ollama"], timeout=300)
        if code != 0:
            state.record_step_failure(
                "ollama",
                "Ollama could not be installed via Homebrew.",
                "Install Ollama from ollama.com/download, then re-run the installer.",
            )
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
        """Install the pinned release archive user-locally (no sudo).

        Replaces the `install.sh` flow: the script at ollama.com/install.sh
        changes with every upstream release, so a hash pin of it rots within
        weeks (and the old all-zero pin never matched at all). The versioned
        release asset is immutable, so its digest is pinnable forever.
        """
        dest_root = linux_install_root()
        log(
            f"Downloading Ollama {OLLAMA_PINNED_TAG} for Linux (~1.4 GB)...",
            "info",
        )
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(suffix=".tar.zst", delete=False) as f:
                tmp_path = f.name
            with httpx.stream(
                "GET", OLLAMA_LINUX_URL, follow_redirects=True, timeout=1800
            ) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes(65536):
                        f.write(chunk)
            log("Verifying checksum...", "info")
            if not _verify_sha256(tmp_path, OLLAMA_LINUX_SHA256):
                state.record_step_failure(
                    "ollama",
                    "The downloaded Ollama package did not match its "
                    "security checksum.",
                    MANUAL_INSTALL_SUGGESTION,
                )
                log(
                    "Checksum mismatch for the Ollama Linux archive. "
                    "Aborting to prevent supply-chain compromise.",
                    "error",
                )
                return False
            log(f"Extracting Ollama to {dest_root}...", "info")
            _extract_tar_zst(Path(tmp_path), dest_root)
        except (httpx.HTTPError, OSError, tarfile.TarError) as e:
            state.record_step_failure(
                "ollama",
                "Ollama could not be downloaded or unpacked.",
                "Check the internet connection and free disk space, then "
                "re-run the installer.",
            )
            log(f"Ollama install failed: {e}", "error")
            return False
        finally:
            if tmp_path and os.path.exists(tmp_path):
                with contextlib.suppress(OSError):
                    os.unlink(tmp_path)

        # The release archive lays out bin/ollama (+ lib/); tolerate a
        # root-level binary for older layouts.
        bin_dir = dest_root / "bin"
        ollama_bin = bin_dir / "ollama"
        if not ollama_bin.exists():
            alt = dest_root / "ollama"
            if alt.exists():
                bin_dir, ollama_bin = dest_root, alt
        if not ollama_bin.exists():
            state.record_step_failure(
                "ollama",
                "The Ollama package unpacked but its program file was not found.",
                MANUAL_INSTALL_SUGGESTION,
            )
            log(f"ollama binary not found under {dest_root} after extraction.", "error")
            return False
        with contextlib.suppress(OSError):
            os.chmod(ollama_bin, 0o755)
        # Make `ollama` resolvable for this process and every child it spawns
        # (the model step, the managed `ollama serve`).
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"
        log(f"Ollama installed at {dest_root} (user-local).", "success")
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
        state.record_step_failure(
            "ollama",
            "Ollama installed but its background service did not respond.",
            "Restart the computer and re-run the installer, or start Ollama "
            "manually and try again.",
        )
        log("Ollama did not respond within 30 seconds.", "error")
        return False

    def _existing_meets_min_version(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        """True when a pre-existing Ollama already satisfies the Gemma 4 floor.

        Returns False (so `install` proceeds to lay down the pinned build) when
        the installed Ollama is older than `MIN_OLLAMA_VERSION`. When the
        version cannot be determined, treat it as acceptable -- best-effort, do
        not block a working install on an unknowable version.
        """
        current = self._ollama_version(state)
        if current is None:
            log(
                "Ollama is already installed (version undetermined); skipping install.",
                "info",
            )
            return True
        if _meets_min_version(current, MIN_OLLAMA_VERSION):
            log(
                f"Ollama {current} is already installed and supports Gemma 4; "
                "skipping install.",
                "info",
            )
            return True
        log(
            f"Installed Ollama {current} is older than {MIN_OLLAMA_VERSION}, "
            f"which the Gemma 4 default models require; installing the pinned "
            f"{OLLAMA_PINNED_TAG}.",
            "warn",
        )
        return False

    def _ollama_version(self, state: InstallerState) -> str | None:
        """Best-effort detection of the installed Ollama version (API, then CLI)."""
        try:
            resp = httpx.get(f"{state.ollama_url}/api/version", timeout=3)
            if resp.status_code == 200:
                version = resp.json().get("version")
                if isinstance(version, str) and version.strip():
                    return version.strip()
        except (httpx.HTTPError, ValueError):
            pass
        try:
            result = subprocess.run(
                ["ollama", "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
                **no_window_kwargs(),
            )
        except (OSError, subprocess.SubprocessError):
            return None
        combined = f"{result.stdout or ''}{result.stderr or ''}"
        match = re.search(r"\d+\.\d+\.\d+", combined)
        return match.group() if match else None

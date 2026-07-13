"""v1.8.0 Phase 2 -- Nexus desktop app provisioner.

Fetches the platform's desktop bundle from the pinned GitHub release
(SHA-256-verified against the release's SHA256SUMS.txt, fail closed),
installs it per-OS, and runs a first-run health check. Follows the
download / verify / install structure of `ollama_installer.py`.

The desktop app is fetched at install time rather than bundled inside
the installer executable (operator decision, 2026-07-03). While the
release that carries the bundles has not shipped yet (Actions freeze),
`InstallerState.desktop_bundle_override` installs a locally-built
bundle instead -- the T104 fixture path used by the integration test.
"""

from __future__ import annotations

import contextlib
import glob
import hashlib
import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
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

# Pinned release tag carrying the desktop bundles. Bump by updating
# scripts/installer/VERSIONS.md in lockstep (semantic-release owns
# the tag; the bundle version is the tag without the leading "v").
NEXUS_DESKTOP_PINNED_TAG = "v2.1.0"
NEXUS_DESKTOP_VERSION = NEXUS_DESKTOP_PINNED_TAG.lstrip("v")

RELEASE_DOWNLOAD_URL = (
    "https://github.com/bendourthe/Nexus-AI/releases/download/{tag}/{asset}"
)
SHA256SUMS_ASSET = "SHA256SUMS.txt"

# Grace period for the first-run health check: a GUI app that is still
# alive after this many seconds launched successfully.
HEALTH_CHECK_GRACE_SECONDS = 5
DOWNLOAD_CHUNK_SIZE = 65536


def resolve_asset_name(
    platform_str: str | None = None,
    machine: str | None = None,
    version: str = NEXUS_DESKTOP_VERSION,
) -> str | None:
    """Return the release asset name for the OS/arch, or None if unsupported.

    Mirrors the asset names staged by release.yml's desktop-bundle jobs:
    Windows x64 NSIS, macOS universal DMG, Linux amd64 AppImage.
    """
    plat = platform_str if platform_str is not None else sys.platform
    arch = (machine if machine is not None else platform.machine()).lower()

    if plat == "win32":
        if arch in ("amd64", "x86_64"):
            return f"Nexus-Desktop_{version}_x64-setup.exe"
        return None
    if plat == "darwin":
        # The DMG is a universal binary: both arm64 and x86_64 are served.
        return f"Nexus-Desktop_{version}_universal.dmg"
    if plat.startswith("linux"):
        if arch in ("amd64", "x86_64"):
            return f"Nexus-Desktop_{version}_amd64.AppImage"
        return None
    return None


def parse_sha256sums(text: str) -> dict[str, str]:
    """Parse `sha256sum` output lines into {filename: hex_digest}.

    Accepts both text-mode ("hash  name") and binary-mode ("hash *name")
    separators. Malformed lines are skipped.
    """
    entries: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        digest, name = parts
        if len(digest) != 64:
            continue
        try:
            int(digest, 16)
        except ValueError:
            continue
        entries[name.lstrip("*").strip()] = digest.lower()
    return entries


def _sha256_file(path: str) -> str:
    """Return the hex SHA-256 digest of a file."""
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(DOWNLOAD_CHUNK_SIZE), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _download_dir() -> str:
    """Return the persistent download directory (partial files survive reruns)."""
    path = os.path.join(tempfile.gettempdir(), "nexus-installer-downloads")
    os.makedirs(path, exist_ok=True)
    return path


class DesktopProvisioner:
    """Downloads, verifies, and installs the Nexus desktop app."""

    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        """Request cancellation of an in-flight download."""
        self._cancelled = True

    def install(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
        progress: Callable[[float], None] | None = None,
    ) -> bool:
        """Provision the desktop app. Returns True on install success.

        The first-run health check result is surfaced separately via
        `state.desktop_health_ok` and does not fail the step.
        """
        progress = progress or (lambda _pct: None)

        if state.desktop_bundle_override:
            bundle_path = state.desktop_bundle_override
            if not os.path.isfile(bundle_path):
                log(f"Local desktop bundle not found: {bundle_path}", "error")
                return False
            log(
                f"Using local desktop bundle override: {bundle_path} "
                "(release download and checksum verification skipped).",
                "warn",
            )
        else:
            bundle_path = self._download_and_verify(state, log, progress)
            if not bundle_path:
                return False

        if not self._dispatch_install(bundle_path, state, log):
            return False

        state.desktop_installed = True
        progress(1.0)
        log("Nexus desktop installed.", "success")

        if not first_run_health_check(state, log):
            log(
                "Nexus desktop installed, but the first-run health check "
                "did not pass. You can still launch it from the OS menu.",
                "warn",
            )
        return True

    # -- download + verify ------------------------------------------------

    def _download_and_verify(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
        progress: Callable[[float], None],
    ) -> str | None:
        """Download the platform bundle and verify it. Returns its path or None."""
        asset = resolve_asset_name()
        if not asset:
            log(
                "No Nexus desktop bundle is published for this OS/architecture "
                f"({platform.machine()}). Skipping desktop installation.",
                "error",
            )
            return None

        tag = NEXUS_DESKTOP_PINNED_TAG
        sums_url = RELEASE_DOWNLOAD_URL.format(tag=tag, asset=SHA256SUMS_ASSET)
        log(f"Fetching checksum manifest for Nexus desktop {tag}...", "info")
        try:
            resp = httpx.get(sums_url, follow_redirects=True, timeout=60)
            resp.raise_for_status()
        except httpx.HTTPError as e:
            log(f"Failed to fetch {SHA256SUMS_ASSET}: {e}", "error")
            return None

        expected = parse_sha256sums(resp.text).get(asset)
        if not expected:
            log(
                f"{SHA256SUMS_ASSET} has no entry for {asset}. "
                "Aborting to prevent installing an unverified bundle.",
                "error",
            )
            return None

        dest = os.path.join(_download_dir(), asset)
        url = RELEASE_DOWNLOAD_URL.format(tag=tag, asset=asset)
        log(f"Downloading {asset}...", "info")
        if not self._download_with_resume(url, dest, log, progress):
            return None

        log("Verifying checksum...", "info")
        if _sha256_file(dest) != expected:
            log(
                f"Checksum mismatch for {asset}. Aborting to prevent "
                "supply-chain compromise.",
                "error",
            )
            with contextlib.suppress(OSError):
                os.unlink(dest)
            return None
        log("Checksum verified.", "success")
        return dest

    def _download_with_resume(
        self,
        url: str,
        dest: str,
        log: Callable[[str, str], None],
        progress: Callable[[float], None],
    ) -> bool:
        """Download `url` to `dest` via a resumable .partial file."""
        partial = dest + ".partial"
        existing = os.path.getsize(partial) if os.path.exists(partial) else 0
        headers = {"Range": f"bytes={existing}-"} if existing else {}
        if existing:
            log(f"Resuming download from byte {existing}...", "info")

        try:
            with httpx.stream(
                "GET", url, headers=headers, follow_redirects=True, timeout=300
            ) as resp:
                if resp.status_code == 416:
                    # The partial file already covers the full asset.
                    os.replace(partial, dest)
                    progress(1.0)
                    return True
                resp.raise_for_status()

                if resp.status_code == 206:
                    mode = "ab"
                    total = existing + int(resp.headers.get("content-length", 0) or 0)
                else:
                    # Server ignored the Range header: restart from scratch.
                    mode = "wb"
                    existing = 0
                    total = int(resp.headers.get("content-length", 0) or 0)

                received = existing
                with open(partial, mode) as f:
                    for chunk in resp.iter_bytes(DOWNLOAD_CHUNK_SIZE):
                        if self._cancelled:
                            log(
                                "Desktop download cancelled; partial file kept "
                                "for resume.",
                                "warn",
                            )
                            return False
                        f.write(chunk)
                        received += len(chunk)
                        if total > 0:
                            # Reserve the last 5% of the band for install.
                            progress(min(received / total, 1.0) * 0.95)
        except (httpx.HTTPError, OSError) as e:
            log(f"Failed to download Nexus desktop bundle: {e}", "error")
            return False

        os.replace(partial, dest)
        return True

    # -- per-OS install ----------------------------------------------------

    def _dispatch_install(
        self,
        bundle_path: str,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        if is_windows():
            return self._install_windows(bundle_path, state, log)
        if is_macos():
            return self._install_macos(bundle_path, state, log)
        if is_linux():
            return self._install_linux(bundle_path, state, log)
        log("Unsupported platform for Nexus desktop installation.", "error")
        return False

    def _install_windows(
        self,
        bundle_path: str,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Installing Nexus desktop silently (NSIS)...", "info")
        cmd = [bundle_path, "/S"]
        if state.desktop_install_dir:
            # NSIS: /D must be the last argument and must not be quoted.
            cmd.append(f"/D={state.desktop_install_dir}")
        code, _, stderr = run_command(cmd, timeout=600)
        if code != 0:
            log(f"Desktop installer exited with code {code}: {stderr}", "error")
            return False
        install_dir = state.desktop_install_dir or os.path.join(
            os.environ.get("LOCALAPPDATA", ""), "Nexus"
        )
        state.desktop_exe_path = _resolve_windows_exe(install_dir)
        return True

    def _install_macos(
        self,
        bundle_path: str,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Mounting the Nexus desktop disk image...", "info")
        mount_point = tempfile.mkdtemp(prefix="nexus-dmg-")
        code, _, stderr = run_command(
            [
                "hdiutil",
                "attach",
                bundle_path,
                "-nobrowse",
                "-readonly",
                "-mountpoint",
                mount_point,
            ],
            timeout=120,
        )
        if code != 0:
            log(f"hdiutil attach failed (code {code}): {stderr}", "error")
            return False
        try:
            apps = glob.glob(os.path.join(mount_point, "*.app"))
            if not apps:
                log("No .app bundle found inside the DMG.", "error")
                return False
            target = "/Applications/Nexus.app"
            log(f"Copying {os.path.basename(apps[0])} to /Applications...", "info")
            code, _, stderr = run_command(["ditto", apps[0], target], timeout=300)
            if code != 0:
                log(f"Copy to /Applications failed (code {code}): {stderr}", "error")
                return False
            binaries = glob.glob(os.path.join(target, "Contents", "MacOS", "*"))
            state.desktop_exe_path = binaries[0] if binaries else target
            return True
        finally:
            run_command(["hdiutil", "detach", mount_point], timeout=60)

    def _install_linux(
        self,
        bundle_path: str,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        log("Installing the Nexus desktop AppImage...", "info")
        bin_dir = os.path.expanduser("~/.local/bin")
        os.makedirs(bin_dir, exist_ok=True)
        appimage = os.path.join(bin_dir, "nexus-desktop.AppImage")
        try:
            shutil.copyfile(bundle_path, appimage)
            executable_mode = (
                stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH
            )
            os.chmod(appimage, executable_mode)
        except OSError as e:
            log(f"Failed to install the AppImage: {e}", "error")
            return False

        icon_line = "Icon=nexus-desktop"
        icon_source = _find_installer_icon()
        if icon_source:
            icon_dir = os.path.expanduser("~/.local/share/icons")
            try:
                os.makedirs(icon_dir, exist_ok=True)
                icon_dest = os.path.join(icon_dir, "nexus-desktop.png")
                shutil.copyfile(icon_source, icon_dest)
                icon_line = f"Icon={icon_dest}"
            except OSError:
                log("Could not stage the launcher icon; using the default.", "warn")

        desktop_dir = os.path.expanduser("~/.local/share/applications")
        try:
            os.makedirs(desktop_dir, exist_ok=True)
            entry = os.path.join(desktop_dir, "nexus-desktop.desktop")
            with open(entry, "w", encoding="utf-8") as f:
                f.write(
                    "[Desktop Entry]\n"
                    "Type=Application\n"
                    "Name=Nexus\n"
                    "Comment=Local-first AI workbench\n"
                    f"Exec={appimage}\n"
                    f"{icon_line}\n"
                    "Terminal=false\n"
                    "Categories=Development;Utility;\n"
                )
        except OSError as e:
            log(f"Failed to write the .desktop entry: {e}", "error")
            return False

        state.desktop_exe_path = appimage
        return True


def _resolve_windows_exe(install_dir: str) -> str:
    """Return the installed main binary path inside `install_dir`.

    The Tauri bundle currently ships `nexus-shell.exe` (the crate's binary
    name, verified against the T104 fixture); prefer a product-named
    `Nexus.exe` if a later bundle renames it.
    """
    for name in ("Nexus.exe", "nexus-shell.exe"):
        candidate = os.path.join(install_dir, name)
        if os.path.isfile(candidate):
            return candidate
    others = [
        path
        for path in glob.glob(os.path.join(install_dir, "*.exe"))
        if os.path.basename(path).lower() != "uninstall.exe"
    ]
    return others[0] if others else os.path.join(install_dir, "Nexus.exe")


def _find_installer_icon() -> str | None:
    """Best-effort lookup of the repo icon shipped next to the installer."""
    base = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.normpath(
        os.path.join(base, "..", "..", "..", "..", "..", "assets", "icon.png")
    )
    return candidate if os.path.isfile(candidate) else None


def first_run_health_check(
    state: InstallerState,
    log: Callable[[str, str], None],
    grace_seconds: int = HEALTH_CHECK_GRACE_SECONDS,
) -> bool:
    """Launch the installed app once and record pass/fail on the state.

    Pass criteria: the process either exits 0 quickly (CLI-style
    `--version` handling) or is still alive after the grace period (a GUI
    app that launched without crashing; it is then terminated). A missing
    binary or an early nonzero exit fails the check.
    """
    log("Running the Nexus desktop first-run health check...", "info")
    exe = state.desktop_exe_path
    if not exe or not os.path.exists(exe):
        log(f"Installed desktop binary not found at: {exe or '<unset>'}", "error")
        state.desktop_health_ok = False
        return False

    try:
        proc = subprocess.Popen(
            [exe, "--version"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **no_window_kwargs(),
        )
    except OSError as e:
        log(f"Failed to launch the desktop app: {e}", "error")
        state.desktop_health_ok = False
        return False

    try:
        code = proc.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        # Still running after the grace period: the GUI launched fine.
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log("Desktop app launched and stayed alive; health check passed.", "success")
        state.desktop_health_ok = True
        return True

    if code == 0:
        log("Desktop app health check passed.", "success")
        state.desktop_health_ok = True
        return True

    log(f"Desktop app exited immediately with code {code}.", "error")
    state.desktop_health_ok = False
    return False

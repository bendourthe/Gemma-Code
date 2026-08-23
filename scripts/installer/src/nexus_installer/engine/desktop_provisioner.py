"""v1.8.0 Phase 2 -- Nexus desktop app provisioner.

v1.11.0 Phase 4 (T401/T402): the desktop app is EMBEDDED in the installer.
The previous flow fetched the platform bundle from a pinned GitHub release,
verified against the release's SHA256SUMS.txt -- and 404'd whenever the tag
shipped without binary assets (semantic-release cut v2.1.0 during the Actions
freeze with no uploads), so the desktop step failed on every real install.
Now `build-windows.ps1` stages the Tauri NSIS bundle plus a build-time
manifest (name, version, sha256) into the PyInstaller payload, and this
provisioner installs from that embedded payload: hash-verified against the
manifest (fail closed on corruption), silent NSIS run, first-launch health
check. Zero network for the desktop step.

`InstallerState.desktop_bundle_override` remains the dev seam: a locally-built
bundle installs directly, skipping the payload and its verification.
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

from nexus_installer.engine.platform_utils import (
    is_linux,
    is_macos,
    is_windows,
    no_window_kwargs,
    run_command,
)
from nexus_installer.installer_state import InstallerState

# Bundle subdirectory inside the frozen payload (sys._MEIPASS) and the
# source-tree staging dir (scripts/installer/build/desktop-payload/).
DESKTOP_BUNDLE_SUBDIR = "desktop-bundle"

# Grace period for the first-run health check: a GUI app that is still
# alive after this many seconds launched successfully.
HEALTH_CHECK_GRACE_SECONDS = 5
# v2.2.0 Phase 1 (1.4): budget for `--healthcheck` (the app retries sidecar
# RPCs internally for up to ~25s on a slow cold start; give it headroom).
HEALTH_CHECK_BUDGET_SECONDS = 40

REDOWNLOAD_SUGGESTION = (
    "Re-download the installer; if it keeps failing, report this with the saved log."
)


def _sha256_file(path: str | Path) -> str:
    """Return the hex SHA-256 digest of a file."""
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def embedded_payload_dir() -> Path | None:
    """Locate the embedded desktop payload (frozen bundle first, then source).

    Mirrors `registry_paths.registry_file`'s bundle-first discipline: a frozen
    `NexusSetup.exe` resolves `sys._MEIPASS/desktop-bundle/`; a source run
    resolves `scripts/installer/build/desktop-payload/` (staged by
    build-windows.ps1) so the flow is testable without freezing.
    """
    if getattr(sys, "frozen", False):
        candidate = Path(getattr(sys, "_MEIPASS", "")) / DESKTOP_BUNDLE_SUBDIR
        if (candidate / "manifest.json").is_file():
            return candidate
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "build" / "desktop-payload"
        if (candidate / "manifest.json").is_file():
            return candidate
    return None


def load_payload_manifest(payload_dir: Path) -> dict[str, str] | None:
    """Read + validate the payload manifest. Returns None when malformed."""
    try:
        data = json.loads(
            (payload_dir / "manifest.json").read_text(encoding="utf-8-sig")
        )
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    for key in ("filename", "version", "sha256"):
        if not isinstance(data.get(key), str) or not data[key]:
            return None
    return {str(k): str(v) for k, v in data.items()}


class DesktopProvisioner:
    """Verifies and installs the embedded Nexus desktop app."""

    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        """Kept for engine compatibility; the embedded flow has no download."""
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

        bundle_path: str | None
        if state.desktop_bundle_override:
            bundle_path = state.desktop_bundle_override
            if not os.path.isfile(bundle_path):
                state.record_step_failure(
                    "desktop",
                    "The local desktop bundle override was not found.",
                    f"Check the path passed via --desktop-bundle: {bundle_path}",
                )
                log(f"Local desktop bundle not found: {bundle_path}", "error")
                return False
            log(
                f"Using local desktop bundle override: {bundle_path} "
                "(embedded payload and checksum verification skipped).",
                "warn",
            )
        else:
            bundle_path = self._resolve_embedded(state, log)
            if not bundle_path:
                return False
            progress(0.3)

        if not self._dispatch_install(bundle_path, state, log):
            return False
        progress(0.9)

        state.desktop_installed = True
        log("Nexus desktop installed.", "success")

        if not first_run_health_check(state, log):
            log(
                "Nexus desktop installed, but the first-run health check "
                "did not pass. You can still launch it from the OS menu.",
                "warn",
            )
        progress(1.0)
        return True

    # -- embedded payload ---------------------------------------------------

    def _resolve_embedded(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> str | None:
        """Locate + hash-verify the embedded bundle. Returns its path or None."""
        payload_dir = embedded_payload_dir()
        if payload_dir is None:
            state.record_step_failure(
                "desktop",
                "The desktop app package was missing from this installer build.",
                REDOWNLOAD_SUGGESTION,
            )
            log(
                "No embedded desktop payload found (this installer build did "
                "not stage one for this platform).",
                "error",
            )
            return None

        manifest = load_payload_manifest(payload_dir)
        if manifest is None:
            state.record_step_failure(
                "desktop",
                "The desktop app package inside the installer is unreadable.",
                REDOWNLOAD_SUGGESTION,
            )
            log(f"Malformed desktop payload manifest in {payload_dir}.", "error")
            return None

        bundle = payload_dir / manifest["filename"]
        if not bundle.is_file():
            state.record_step_failure(
                "desktop",
                "The desktop app package inside the installer is incomplete.",
                REDOWNLOAD_SUGGESTION,
            )
            log(f"Embedded desktop bundle missing: {bundle}", "error")
            return None

        log(
            f"Verifying the embedded Nexus desktop {manifest['version']} bundle...",
            "info",
        )
        if _sha256_file(bundle) != manifest["sha256"].lower():
            state.record_step_failure(
                "desktop",
                "The desktop app package inside the installer failed its "
                "integrity check.",
                REDOWNLOAD_SUGGESTION,
            )
            log(
                "Embedded desktop bundle checksum mismatch. Aborting to "
                "prevent installing a corrupted app.",
                "error",
            )
            return None
        log("Embedded bundle verified.", "success")
        return str(bundle)

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
        state.record_step_failure(
            "desktop",
            "This operating system is not supported for the desktop app.",
            "The Nexus desktop app supports Windows, macOS, and Linux.",
        )
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
            state.record_step_failure(
                "desktop",
                f"The desktop app's setup program reported an error (code {code}).",
                "Re-run the installer; if it keeps failing, save the log and "
                "report it.",
            )
            log(f"Desktop installer exited with code {code}: {stderr}", "error")
            return False
        install_dir = state.desktop_install_dir or os.path.join(
            os.environ.get("LOCALAPPDATA", ""), WINDOWS_DESKTOP_PRODUCT_DIR
        )
        state.desktop_exe_path = _locate_windows_exe(install_dir)
        log(f"Desktop binary: {state.desktop_exe_path}", "info")
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


def check_desktop_payload() -> int:
    """Diagnostic for the packaging smoke: 0 when the embedded payload is
    present, manifest-valid, and hash-verified (Windows builds embed it;
    other platforms return 1 until their build scripts stage one).

    Invoked via ``nexus-installer --check-desktop-payload`` against the frozen
    exe. Prints details when a console is attached (windowed frozen builds
    have no stdout; the exit code is the signal there).
    """

    def emit(message: str) -> None:
        if sys.stdout is not None:
            print(message)

    payload_dir = embedded_payload_dir()
    if payload_dir is None:
        emit("desktop payload: MISSING")
        return 1
    manifest = load_payload_manifest(payload_dir)
    if manifest is None:
        emit(f"desktop payload: MALFORMED manifest ({payload_dir})")
        return 1
    bundle = payload_dir / manifest["filename"]
    if not bundle.is_file():
        emit(f"desktop payload: bundle missing ({bundle})")
        return 1
    if _sha256_file(bundle) != manifest["sha256"].lower():
        emit("desktop payload: HASH MISMATCH")
        return 1
    emit(
        f"desktop payload: ok ({manifest['filename']} v{manifest['version']}, "
        f"{bundle.stat().st_size} bytes)"
    )
    return 0


#: Tauri NSIS currentUser default is `%LOCALAPPDATA%\{productName}`.
WINDOWS_DESKTOP_PRODUCT_DIR = "Nexus AI Studio"
WINDOWS_DESKTOP_DIR_FALLBACKS: tuple[str, ...] = ("Nexus AI Studio", "Nexus")
WINDOWS_EXE_CANDIDATES: tuple[str, ...] = (
    "Nexus AI Studio.exe",
    "Nexus.exe",
    "nexus-shell.exe",
)


def _windows_install_search_dirs(preferred_dir: str) -> list[str]:
    """Preferred install dir, then the well-known Tauri currentUser folders."""
    dirs: list[str] = []
    if preferred_dir:
        dirs.append(preferred_dir)
    local = os.environ.get("LOCALAPPDATA", "")
    for name in WINDOWS_DESKTOP_DIR_FALLBACKS:
        candidate = os.path.join(local, name) if local else name
        if candidate not in dirs:
            dirs.append(candidate)
    return dirs


def _resolve_windows_exe(install_dir: str) -> str:
    """Return the installed main binary path inside `install_dir`.

    The Tauri crate binary is `nexus-shell.exe`. Current `productName` is
    `Nexus AI Studio`; older bundles used `Nexus.exe`. Prefer those names
    in that order, then any other exe except the NSIS uninstaller.
    """
    for name in WINDOWS_EXE_CANDIDATES:
        candidate = os.path.join(install_dir, name)
        if os.path.isfile(candidate):
            return candidate
    others = [
        path
        for path in glob.glob(os.path.join(install_dir, "*.exe"))
        if os.path.basename(path).lower() != "uninstall.exe"
    ]
    return others[0] if others else os.path.join(install_dir, WINDOWS_EXE_CANDIDATES[0])


def _locate_windows_exe(preferred_dir: str) -> str:
    """Resolve the desktop exe, searching Tauri's default folders if needed.

    Silent NSIS without `/D` installs to `%LOCALAPPDATA%\\Nexus AI Studio`.
    A guess of `%LOCALAPPDATA%\\Nexus` (the pre-rename product folder) must
    not fail the first-run health check when the real binary is next door.
    Custom `/D=` directories are not rewritten.
    """
    resolved = _resolve_windows_exe(preferred_dir)
    if os.path.isfile(resolved):
        return resolved
    base = os.path.basename(preferred_dir.rstrip("\\/"))
    if base not in WINDOWS_DESKTOP_DIR_FALLBACKS:
        return resolved
    for directory in _windows_install_search_dirs(preferred_dir):
        candidate = _resolve_windows_exe(directory)
        if os.path.isfile(candidate):
            return candidate
    return resolved


def _find_installer_icon() -> str | None:
    """Best-effort lookup of the repo icon shipped next to the installer."""
    base = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.normpath(
        os.path.join(base, "..", "..", "..", "..", "..", "assets", "icon.png")
    )
    return candidate if os.path.isfile(candidate) else None


def _parse_healthcheck_verdict(stdout: str) -> dict | None:
    """Extract the single-line JSON verdict from `--healthcheck` output."""
    for line in reversed(stdout.strip().splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and "sidecar" in parsed:
            return parsed
    return None


def _format_healthcheck_failure(verdict: dict, sidecar: str) -> str:
    """One readable reason for the Complete page.

    v2.2.1: never join the last three stderr fragments with ``" / "``. That
    produced ``[ / / Nodejs v22.11.0]`` when the real stack sat earlier in
    the tail and the last lines were blanks plus a Node version banner.
    """
    parts = [sidecar]
    exit_code = verdict.get("exitCode")
    if exit_code is not None:
        parts.append(f"exitCode={exit_code}")
    node = verdict.get("nodePath")
    if node:
        parts.append(f"node={node}")
    script = verdict.get("scriptPath")
    if script:
        parts.append(f"script={script}")
    stderr_tail = verdict.get("stderrTail")
    if isinstance(stderr_tail, list):
        lines = [str(s).strip() for s in stderr_tail if str(s).strip()]
        if lines:
            preview = lines[-8:]
            parts.append("stderr: " + " | ".join(preview))
    return "; ".join(parts)


def first_run_health_check(
    state: InstallerState,
    log: Callable[[str, str], None],
    grace_seconds: int = HEALTH_CHECK_BUDGET_SECONDS,
) -> bool:
    """Prove the installed app actually works, not merely that it launches.

    v2.2.0 Phase 1 (1.4): runs `<exe> --healthcheck`, which spawns the Node
    sidecar headless, issues real `models.list` / `skills.status` RPCs, and
    prints one JSON verdict line. A sidecar that cannot spawn or answer fails
    the check with the reason (the pre-v2.2.0 check passed whenever the
    process survived 5 seconds -- exactly the state of a sidecar-less app).
    A legacy app build that does not understand `--healthcheck` (verdict
    line absent, exit 0) passes with a warning so installer/app version skew
    does not hard-fail the install.
    """
    log("Running the Nexus desktop first-run health check...", "info")
    exe = state.desktop_exe_path
    if not exe or not os.path.exists(exe):
        log(f"Installed desktop binary not found at: {exe or '<unset>'}", "error")
        state.desktop_health_ok = False
        state.desktop_health_detail = "desktop binary not found"
        return False

    try:
        proc = subprocess.Popen(
            [exe, "--healthcheck"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            **no_window_kwargs(),
        )
    except OSError as e:
        log(f"Failed to launch the desktop app: {e}", "error")
        state.desktop_health_ok = False
        state.desktop_health_detail = f"launch failed: {e}"
        return False

    try:
        stdout, _ = proc.communicate(timeout=grace_seconds)
        code = proc.returncode
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            stdout, _ = proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            stdout = ""
        log(
            "Desktop health check timed out; the app produced no verdict "
            f"within {grace_seconds}s.",
            "error",
        )
        state.desktop_health_ok = False
        state.desktop_health_detail = f"healthcheck timeout after {grace_seconds}s"
        return False

    verdict = _parse_healthcheck_verdict(stdout or "")
    if verdict is not None:
        sidecar = str(verdict.get("sidecar", "unknown"))
        catalog_rows = verdict.get("catalogRows", 0)
        hub = verdict.get("hubCatalog", "unknown")
        if code == 0 and sidecar == "ok":
            log(
                "Desktop health check passed: sidecar ok, "
                f"{catalog_rows} catalog model(s), hub catalog {hub}.",
                "success",
            )
            state.desktop_health_ok = True
            state.desktop_health_detail = (
                f"sidecar ok; catalogRows={catalog_rows}; hubCatalog={hub}"
            )
            if isinstance(catalog_rows, int) and catalog_rows == 0:
                log(
                    "Warning: the model catalog resolved 0 entries; models "
                    "will not appear in the app. Check the catalog bundling.",
                    "warn",
                )
            return True
        detail = _format_healthcheck_failure(verdict, sidecar)
        log(f"Desktop health check FAILED: {detail}", "error")
        log(
            "The app installed but its backend cannot start; the UI would "
            "show 'sidecar-not-running'. Re-run the installer or report "
            "this diagnostic.",
            "error",
        )
        state.desktop_health_ok = False
        state.desktop_health_detail = detail
        return False

    # No verdict line: an older app build without --healthcheck. Fall back to
    # the legacy semantics (exit 0 or survived = launched), with a warning.
    if code == 0:
        log(
            "Desktop app predates the sidecar health check; it launched, but "
            "backend health was not verified.",
            "warn",
        )
        state.desktop_health_ok = True
        state.desktop_health_detail = "legacy pass (no healthcheck verdict)"
        return True

    log(f"Desktop app exited with code {code} and no health verdict.", "error")
    state.desktop_health_ok = False
    state.desktop_health_detail = f"exit code {code}, no verdict"
    return False

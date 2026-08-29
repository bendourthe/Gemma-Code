"""VS Code extension installation via the code CLI."""

from __future__ import annotations

import glob
import os
import re
from collections.abc import Callable
from dataclasses import dataclass

from nexus_installer.engine.platform_utils import run_command
from nexus_installer.installer_state import InstallerState

EXTENSION_ID = "nexus-coding.nexus-coding"
LEGACY_EXTENSION_ID = "gemma-code.gemma-code"
SUPPORTED_VSCODE_VERSION = "1.134.0"
SUPPORTED_VSCODE_MAX_EXCLUSIVE = "1.136.0"
SUPPORTED_VSCODE_MINORS = frozenset({(1, 134), (1, 135)})
SUPPORTED_ELECTRON_VERSION = "42.8.1"
# @vscode/vsce 2.24.0 validateEngineCompatibility accepts only *, ^x.y.z, or >=x.y.z.
VSCE_ENGINES_VSCODE = f"^{SUPPORTED_VSCODE_VERSION}"

_SEMVER_LINE = re.compile(
    r"^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$"
)
_CLI_SUFFIXES = (".cmd", ".exe", ".bat", ".com")


@dataclass(frozen=True)
class VsCodeCliStatus:
    """Compatibility result for one VS Code-like command-line executable."""

    path: str | None
    cli_name: str | None
    version: str | None
    supported: bool
    reason: str


def vscode_version_is_supported(version: str) -> bool:
    """True when `version` is Microsoft stable 1.134 or 1.135 (Electron 42.8.1)."""
    core = version.split("-", 1)[0].split("+", 1)[0]
    parts = core.split(".")
    if len(parts) < 2:
        return False
    try:
        major, minor = int(parts[0]), int(parts[1])
    except ValueError:
        return False
    return (major, minor) in SUPPORTED_VSCODE_MINORS


def parse_vscode_version(output: str) -> str | None:
    """Return the first standalone semantic version in `code --version` output."""
    for raw_line in output.lstrip("\ufeff").splitlines():
        match = _SEMVER_LINE.fullmatch(raw_line.strip())
        if match:
            return match.group(1)
    return None


def _cli_name(cli_path: str) -> str:
    """Normalize a CLI path to its executable name on every supported OS."""
    name = os.path.basename(cli_path.replace("\\", "/")).lower()
    for suffix in _CLI_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name


def inspect_vscode_cli(
    cli_path: str,
    *,
    cli_name: str | None = None,
    run_fn=None,
) -> VsCodeCliStatus:
    """Verify that a CLI is Microsoft stable VS Code 1.134 or 1.135."""
    normalized_name = (cli_name or _cli_name(cli_path)).lower()
    if normalized_name != "code":
        return VsCodeCliStatus(
            path=cli_path,
            cli_name=normalized_name,
            version=None,
            supported=False,
            reason="unsupported-cli",
        )

    command_runner = run_fn or run_command
    exit_code, stdout, _ = command_runner([cli_path, "--version"], timeout=30)
    if exit_code != 0:
        return VsCodeCliStatus(
            path=cli_path,
            cli_name=normalized_name,
            version=None,
            supported=False,
            reason="version-check-failed",
        )

    version = parse_vscode_version(stdout)
    if version is None:
        return VsCodeCliStatus(
            path=cli_path,
            cli_name=normalized_name,
            version=None,
            supported=False,
            reason="version-unreadable",
        )
    if not vscode_version_is_supported(version):
        return VsCodeCliStatus(
            path=cli_path,
            cli_name=normalized_name,
            version=version,
            supported=False,
            reason="version-mismatch",
        )
    return VsCodeCliStatus(
        path=cli_path,
        cli_name=normalized_name,
        version=version,
        supported=True,
        reason="supported",
    )


def installed_nexus_extension_id(
    cli_path: str, *, run_fn=None
) -> tuple[str | None, str]:
    """Return an installed Nexus/legacy id, or (None, warning) if listing fails.

    A failed listing fails open: the caller must not invent a replace.
    """
    command_runner = run_fn or run_command
    exit_code, stdout, _stderr = command_runner(
        [cli_path, "--list-extensions"], timeout=30
    )
    if exit_code != 0:
        return None, (
            "Could not list installed extensions; install will not replace blindly."
        )
    listed = {line.strip() for line in stdout.splitlines() if line.strip()}
    for ext_id in (EXTENSION_ID, LEGACY_EXTENSION_ID):
        if ext_id in listed:
            return ext_id, ""
    return None, ""


def _unsupported_host_message(status: VsCodeCliStatus) -> str:
    if status.reason == "unsupported-cli":
        return (
            f"Skipped: {status.cli_name or 'the detected editor CLI'} is not "
            "Microsoft stable VS Code. The bundled extension supports Microsoft "
            f"VS Code 1.134 or 1.135 (Electron {SUPPORTED_ELECTRON_VERSION})."
        )
    if status.reason == "version-mismatch":
        return (
            f"Skipped: Microsoft VS Code {status.version} is installed, but the "
            "bundled extension supports Microsoft VS Code 1.134 or 1.135 "
            f"(Electron {SUPPORTED_ELECTRON_VERSION})."
        )
    return (
        "Skipped: the Microsoft VS Code version could not be verified. The "
        "bundled extension is installed only when the stable `code` CLI reports "
        "version 1.134 or 1.135."
    )


class ExtensionInstaller:
    """Installs the Nexus Coding VS Code extension from a VSIX file."""

    def install(
        self,
        state: InstallerState,
        log: Callable[[str, str], None],
    ) -> bool:
        """Install the VSIX. Returns True on success (or a clean skip)."""
        vscode = state.vscode_path
        if not vscode:
            # v1.11.0 Phase 3 (T302): a machine without VS Code is a normal
            # user machine, not an error condition -- skip with guidance.
            state.record_skipped_step("extension")
            log(
                "Skipped: VS Code was not found on this computer. Install VS "
                "Code from code.visualstudio.com and re-run this installer, "
                "or add the Nexus extension later from within VS Code.",
                "warn",
            )
            return True

        vsix_path = self._find_vsix()
        if not vsix_path:
            state.record_step_failure(
                "extension",
                "The VS Code extension package was missing from the installer bundle.",
                "Re-download the installer; if it keeps failing, report this "
                "with the saved log.",
            )
            log("VSIX file not found. Skipping extension installation.", "error")
            return False

        # The page check is advisory. Re-read the executable identity and version
        # here so a PATH or editor update between selection and installation
        # cannot feed an ABI-incompatible native module to VS Code.
        vscode_status = inspect_vscode_cli(vscode)
        if not vscode_status.supported:
            state.record_skipped_step("extension")
            log(_unsupported_host_message(vscode_status), "warn")
            return True

        log(f"Installing extension from {vsix_path}...", "info")
        installed_id, list_warning = installed_nexus_extension_id(vscode)
        if list_warning:
            log(list_warning, "warn")
        install_cmd = [vscode, "--install-extension", vsix_path]
        if installed_id:
            install_cmd.append("--force")
            log(
                f"Replacing installed extension {installed_id} with this "
                "installer's copy.",
                "info",
            )
        code, stdout, stderr = run_command(install_cmd, timeout=120)
        if code != 0:
            state.record_step_failure(
                "extension",
                "The VS Code extension could not be installed.",
                "Open VS Code and install the extension manually (Extensions "
                "panel -> ... -> Install from VSIX), or re-run the installer.",
            )
            log(f"Extension install failed (code {code}): {stderr}", "error")
            return False

        log("Verifying extension installation...", "info")
        code, stdout, _ = run_command([vscode, "--list-extensions"], timeout=30)
        if code == 0 and EXTENSION_ID in stdout:
            log("Extension installed successfully.", "success")
            return True

        log("Extension installed but verification failed.", "warn")
        return True  # Treat as success; listing may not reflect immediately

    @staticmethod
    def _find_vsix() -> str | None:
        """Locate the VSIX file relative to the installer."""
        # Check common locations
        search_dirs = [
            os.path.dirname(os.path.abspath(__file__)),  # engine/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", ".."
            ),  # src/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."
            ),  # installer/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."
            ),  # scripts/
            os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", ".."
            ),  # repo root
        ]
        for d in search_dirs:
            d = os.path.normpath(d)
            # v1.1.0 rename: prefer the new `nexus-coding-*.vsix` name; fall
            # back to the legacy `gemma-code-*.vsix` until the build pipeline
            # produces the renamed artifact in all paths.
            matches = glob.glob(os.path.join(d, "nexus-coding-*.vsix"))
            if not matches:
                matches = glob.glob(os.path.join(d, "gemma-code-*.vsix"))
            if matches:
                return matches[0]
        return None


__all__ = [
    "EXTENSION_ID",
    "LEGACY_EXTENSION_ID",
    "ExtensionInstaller",
    "SUPPORTED_ELECTRON_VERSION",
    "SUPPORTED_VSCODE_MAX_EXCLUSIVE",
    "SUPPORTED_VSCODE_VERSION",
    "VSCE_ENGINES_VSCODE",
    "VsCodeCliStatus",
    "inspect_vscode_cli",
    "installed_nexus_extension_id",
    "parse_vscode_version",
    "vscode_version_is_supported",
]

"""Nexus-Hub catalog provisioner (v2.2.0 Phase 3, sub-task 3.1).

Guarantees the harness (skills, commands, rules, hooks) is on disk at
`~/.nexus-ai/catalog/` when the install finishes, offline-first:

1. If the catalog is already present, refresh it when online; never clobber it
   on failure.
2. Otherwise extract the bundled, checksummed snapshot (works with no network).
3. When online, refresh from the latest upstream release on top of that.

All catalog work is delegated to the sidecar's dedicated `hub-catalog.js`
bundle (run with the Node the installer provisioned), so the sync logic,
prompt-injection scan, and atomic swap live in exactly one implementation
rather than being re-written in Python.

Before this step existed, the harness only arrived if the sidecar's
best-effort first-launch fetch happened to succeed; an offline machine (or one
where that fetch failed silently) ended up with an app that had zero skills and
zero commands, and a Skills page that blamed the user for not syncing.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from nexus_installer.engine.platform_utils import no_window_kwargs
from nexus_installer.installer_state import InstallerState

LogFn = Callable[[str, str], None]

SNAPSHOT_DIRNAME = "hub-snapshot"
SNAPSHOT_ARCHIVE = "catalog.tar.gz"
SNAPSHOT_MANIFEST = "manifest.json"
CLI_BUNDLE = "hub-catalog.js"

# Budget for one catalog operation. A sparse clone of the Hub is small, but a
# slow link plus the injection scan can take a while.
CLI_TIMEOUT_S = 300

# Plain-language remedy per failure class emitted by the CLI.
FAILURE_REMEDIES = {
    "network": (
        "The Nexus-Hub catalog could not be downloaded (network problem). The "
        "bundled snapshot is still installed; Settings > Skills can sync later."
    ),
    "git-unavailable": (
        "Git was not available for the catalog sync; the bundled snapshot is "
        "installed instead."
    ),
    "scan-quarantine": (
        "The downloaded catalog was blocked by the prompt-injection scanner. "
        "The previous catalog was left untouched. Report this."
    ),
    "checksum": (
        "The bundled catalog snapshot failed checksum verification, so it was "
        "not installed. Re-download the installer."
    ),
    "archive": "The bundled catalog snapshot could not be read.",
    "unknown": "The catalog step did not complete; Settings > Skills can sync later.",
}


@dataclass(frozen=True)
class HubCatalogOutcome:
    """Result of the provisioning step."""

    ok: bool
    #: "snapshot", "upstream", "installed" (already present), or "" on failure.
    source: str = ""
    tag: str | None = None
    failure_class: str = ""
    message: str = ""
    #: True when the user can retry later without reinstalling.
    retryable: bool = True


def payload_snapshot_dir() -> Path | None:
    """Locate the bundled snapshot inside the frozen installer (or dev tree)."""
    if getattr(sys, "frozen", False):
        base = Path(getattr(sys, "_MEIPASS", ""))
        candidate = base / SNAPSHOT_DIRNAME
        return candidate if candidate.is_dir() else None
    candidate = Path(__file__).resolve().parents[3] / "build" / SNAPSHOT_DIRNAME
    return candidate if candidate.is_dir() else None


def _cli_path(state: InstallerState) -> Path | None:
    """Resolve the installed `hub-catalog.js` next to the desktop app."""
    override = os.environ.get("NEXUS_HUB_CLI")
    if override and Path(override).is_file():
        return Path(override)
    exe = getattr(state, "desktop_exe_path", "") or ""
    if exe:
        candidate = Path(exe).parent / "sidecar" / "dist" / CLI_BUNDLE
        if candidate.is_file():
            return candidate
        mac = Path(exe).parent.parent / "Resources" / "sidecar" / "dist" / CLI_BUNDLE
        if mac.is_file():
            return mac
    # Dev checkout fallback.
    dev = (
        Path(__file__).resolve().parents[4]
        / "desktop"
        / "sidecar"
        / "dist"
        / CLI_BUNDLE
    )
    return dev if dev.is_file() else None


def _node_path(state: InstallerState) -> Path | None:
    """The Node the runtime step provisioned (recorded in runtime.json)."""
    from nexus_installer.engine.runtime_provisioner import runtime_config_path

    try:
        config = json.loads(runtime_config_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        config = {}
    node = config.get("nodePath")
    if isinstance(node, str) and Path(node).is_file():
        return Path(node)
    from nexus_installer.engine.node_provisioner import node_executable, runtime_root

    candidate = node_executable(runtime_root())
    return candidate if candidate.is_file() else None


def _run_cli(
    node: Path,
    cli: Path,
    args: list[str],
    log: LogFn,
) -> dict:
    """Run one CLI mode and return its final JSON event."""
    try:
        proc = subprocess.run(
            [str(node), str(cli), *args],
            capture_output=True,
            text=True,
            timeout=CLI_TIMEOUT_S,
            check=False,
            **no_window_kwargs(),
        )
    except subprocess.TimeoutExpired:
        return {
            "kind": "error",
            "failureClass": "network",
            "message": "catalog step timed out",
        }
    except OSError as exc:
        return {"kind": "error", "failureClass": "unknown", "message": str(exc)}

    final: dict = {}
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("kind") == "progress":
            log(str(event.get("message", "")), "info")
            continue
        final = event
    if not final:
        return {
            "kind": "error",
            "failureClass": "unknown",
            "message": (proc.stderr or "").strip()[-200:]
            or f"exit code {proc.returncode}",
        }
    return final


def provision_hub_catalog(
    state: InstallerState,
    log: LogFn,
    *,
    allow_network: bool = True,
) -> HubCatalogOutcome:
    """Ensure the hub catalog exists; refresh it when possible."""
    node = _node_path(state)
    cli = _cli_path(state)
    if node is None or cli is None:
        missing = "Node runtime" if node is None else "hub-catalog CLI bundle"
        log(f"Skipping the Nexus-Hub catalog step: {missing} not found.", "warn")
        return HubCatalogOutcome(
            ok=False,
            failure_class="unknown",
            message=f"{missing} unavailable",
        )

    status = _run_cli(node, cli, ["--hub-catalog-status"], log)
    already_present = status.get("source") == "installed"

    if not already_present:
        snapshot_dir = payload_snapshot_dir()
        if snapshot_dir is not None:
            archive = snapshot_dir / SNAPSHOT_ARCHIVE
            manifest_path = snapshot_dir / SNAPSHOT_MANIFEST
            digest = ""
            try:
                digest = json.loads(manifest_path.read_text(encoding="utf-8")).get(
                    "sha256", ""
                )
            except (OSError, json.JSONDecodeError):
                digest = ""
            if archive.is_file() and digest:
                log("Installing the bundled Nexus-Hub catalog...", "info")
                event = _run_cli(
                    node,
                    cli,
                    ["--extract-hub-snapshot", str(archive), "--sha256", digest],
                    log,
                )
                if event.get("kind") == "done":
                    already_present = True
                    log(
                        "Nexus-Hub catalog installed from the bundled snapshot.",
                        "success",
                    )
                else:
                    cls = str(event.get("failureClass", "unknown"))
                    log(FAILURE_REMEDIES.get(cls, FAILURE_REMEDIES["unknown"]), "warn")
            else:
                log(
                    "No bundled catalog snapshot in this build; will try a sync.",
                    "warn",
                )
        else:
            log("No bundled catalog snapshot in this build; will try a sync.", "warn")

    if not allow_network:
        if already_present:
            return HubCatalogOutcome(ok=True, source="snapshot", tag=status.get("tag"))
        return HubCatalogOutcome(
            ok=False,
            failure_class="network",
            message="offline and no bundled snapshot available",
        )

    log("Checking for the latest Nexus-Hub catalog...", "info")
    event = _run_cli(node, cli, ["--sync-hub-catalog"], log)
    if event.get("kind") == "done":
        log(f"Nexus-Hub catalog synced ({event.get('tag') or 'latest'}).", "success")
        return HubCatalogOutcome(ok=True, source="upstream", tag=event.get("tag"))

    cls = str(event.get("failureClass", "unknown"))
    message = str(event.get("message", ""))
    log(f"Nexus-Hub catalog sync did not complete: {message}", "warn")
    log(FAILURE_REMEDIES.get(cls, FAILURE_REMEDIES["unknown"]), "warn")
    if already_present:
        # The snapshot (or a pre-existing catalog) is on disk: the harness works,
        # it is simply not the newest tag. Not an install failure.
        return HubCatalogOutcome(
            ok=True,
            source="snapshot",
            tag=status.get("tag"),
            failure_class=cls,
            message=message,
        )
    return HubCatalogOutcome(ok=False, failure_class=cls, message=message)


class HubCatalogProvisioner:
    """Installer step wrapper."""

    def install(self, state: InstallerState, log: LogFn) -> bool:
        outcome = provision_hub_catalog(state, log)
        state.hub_catalog_source = outcome.source
        state.hub_catalog_tag = outcome.tag or ""
        if not outcome.ok:
            state.hub_catalog_error = outcome.message or outcome.failure_class
        return outcome.ok


__all__ = [
    "FAILURE_REMEDIES",
    "HubCatalogOutcome",
    "HubCatalogProvisioner",
    "payload_snapshot_dir",
    "provision_hub_catalog",
]

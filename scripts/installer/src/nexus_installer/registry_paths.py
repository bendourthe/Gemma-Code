"""Shared resolver for the model-registry data files (v1.8.0 Phase 6, T601).

The wizard reads two files from ``core/registry/`` -- ``catalog.json`` (the
typed model catalog with per-model weights manifests) and ``recommended.json``
(the per-VRAM-tier defaults matrix). Both the engine's model router and the
typed catalog page need them, from three runtime shapes:

- **Frozen bundle** (PyInstaller onefile): the spec packages both files under
  ``core/registry/`` inside the bundle, extracted to ``sys._MEIPASS`` at
  launch. Checked first -- a packaged ``NexusSetup.exe`` must never depend on
  a source checkout being present (`OSI004.P4.C`).
- **Source tree / editable install**: walk up from this module until a
  ``core/registry/<name>`` file appears (the repo root).
- **Neither**: return the bare relative path; every consumer treats a missing
  file gracefully (empty catalog, ollama-verbatim routing).
"""

from __future__ import annotations

import sys
from pathlib import Path


def registry_file(name: str) -> Path:
    """Locate ``core/registry/<name>`` for frozen and source runs alike."""
    if getattr(sys, "frozen", False):
        bundle_root = Path(getattr(sys, "_MEIPASS", ""))
        candidate = bundle_root / "core" / "registry" / name
        if candidate.is_file():
            return candidate
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "core" / "registry" / name
        if candidate.is_file():
            return candidate
    return Path("core") / "registry" / name


def default_catalog_path() -> Path:
    return registry_file("catalog.json")


def default_recommended_path() -> Path:
    return registry_file("recommended.json")


def check_registry() -> int:
    """Diagnostic used by the packaging smoke: 0 when both files resolve.

    Invoked via ``nexus-installer --check-registry`` against the frozen exe to
    assert the PyInstaller bundle actually packaged the registry data files.
    Prints resolved paths when a console is attached (windowed frozen builds
    have no stdout; the exit code is the signal there).
    """
    exit_code = 0
    for name in ("catalog.json", "recommended.json"):
        path = registry_file(name)
        found = path.is_file()
        if not found:
            exit_code = 1
        if sys.stdout is not None:
            status = "ok" if found else "MISSING"
            print(f"{name}: {status} ({path})")
    return exit_code


__all__ = [
    "check_registry",
    "default_catalog_path",
    "default_recommended_path",
    "registry_file",
]

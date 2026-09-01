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


def resource_file(*parts: str) -> Path:
    """Locate a bundled repository resource in frozen or source-tree mode."""
    if not parts or any(not part or part in {".", ".."} for part in parts):
        raise ValueError("resource path must contain safe non-empty segments")
    relative = Path(*parts)
    if relative.is_absolute():
        raise ValueError("resource path must be relative")
    if getattr(sys, "frozen", False):
        candidate = Path(getattr(sys, "_MEIPASS", "")) / relative
        if candidate.is_file():
            return candidate
    for parent in Path(__file__).resolve().parents:
        candidate = parent / relative
        if candidate.is_file():
            return candidate
    return relative


def registry_file(name: str) -> Path:
    """Locate ``core/registry/<name>`` for frozen and source runs alike."""
    return resource_file("core", "registry", name)


def asset_file(name: str) -> Path:
    """Locate ``assets/<name>`` for frozen and source runs alike (v1.9.0 T018).

    Same bundle-first discipline as :func:`registry_file`: a packaged wizard
    resolves the icon from ``sys._MEIPASS/assets`` (the spec stages it there),
    never depending on a source checkout. The old fixed-depth ``../../../..``
    relative walk silently missed in the frozen onefile, so the taskbar fell
    back to the generic Python host icon.
    """
    return resource_file("assets", name)


def tuning_file(name: str) -> Path:
    """Locate a validated file under ``core/tuning``."""
    return resource_file("core", "tuning", name)


def resolve_window_icon() -> Path | None:
    """Return the best available window / taskbar icon, or ``None``.

    Prefers the multi-resolution ``.ico`` (crispest for the Windows taskbar),
    then ``icon.png``, then the transparent brand mark. Returns ``None`` when no
    icon asset is staged so callers skip ``setWindowIcon`` rather than hand Qt a
    non-existent path.
    """
    for name in ("icon.ico", "icon.png", "nexus-ai-primary_no-background.png"):
        path = asset_file(name)
        if path.is_file():
            return path
    return None


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
    "asset_file",
    "check_registry",
    "default_catalog_path",
    "default_recommended_path",
    "registry_file",
    "resource_file",
    "resolve_window_icon",
    "tuning_file",
]

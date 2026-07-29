# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec file for Nexus Installer (renamed from Gemma Code in
v1.0.0 Phase 2.5).

Platform-adaptive: detects OS at build time and sets appropriate options.
"""

import sys
from pathlib import Path

block_cipher = None

# Resolve paths relative to this spec file
SPEC_DIR = Path(SPECPATH)
INSTALLER_ROOT = SPEC_DIR.parent
REPO_ROOT = INSTALLER_ROOT.parent.parent

# Platform-specific settings
if sys.platform == "win32":
    # v1.9.0 Phase 1 (T101): the PyInstaller onefile IS the distributable.
    # The NSIS outer shell was retired (moved to scripts/installer/legacy/), so
    # the frozen wizard carries the user-facing `NexusSetup.exe` name directly
    # -- one modern window, no generic pre-wizard dialog.
    APP_NAME = "NexusSetup"
    ICON = str(REPO_ROOT / "assets" / "icon.ico")
elif sys.platform == "darwin":
    # Shipped as the onefile `Nexus AI Studio Setup`, packaged into
    # NexusSetup.dmg by build-macos.sh.
    APP_NAME = "Nexus AI Studio Setup"
    # macOS needs .icns; fall back to .png if .icns not available
    icns_path = REPO_ROOT / "assets" / "icon.icns"
    ICON = str(icns_path) if icns_path.exists() else str(REPO_ROOT / "assets" / "icon.png")
else:
    # Shipped as the onefile `nexus-setup`, packaged into
    # NexusSetup-x86_64.AppImage by build-linux.sh.
    APP_NAME = "nexus-setup"
    ICON = str(REPO_ROOT / "assets" / "icon.png")

# Locate bundled data files.
# v1.10.0: the Nexus-Hub catalog is NOT bundled here -- it is fetched at runtime
# into ~/.nexus-ai/catalog/ by NexusHubSyncer (no baseline payload in the exe).
datas = []

# VSIX file. vsce emits `nexus-coding-*.vsix` (the root package name) since
# the v1.1.0 rename; the legacy `gemma-code-*.vsix` glob is kept as a
# fallback until the NAME.P1.A compat sweep retires it.
vsix_candidates = (
    list(REPO_ROOT.glob("nexus-coding-*.vsix"))
    + list((REPO_ROOT / "scripts" / "installer").glob("nexus-coding-*.vsix"))
    + list(REPO_ROOT.glob("gemma-code-*.vsix"))
    + list((REPO_ROOT / "scripts" / "installer").glob("gemma-code-*.vsix"))
)
if vsix_candidates:
    datas.append((str(vsix_candidates[0]), "."))

# Model-registry data files (v1.8.0 Phase 6, T601 / closes OSI004.P4.C): the
# typed catalog page and the engine's model router resolve these via
# `nexus_installer.registry_paths`, which checks the bundle (sys._MEIPASS)
# first. Without them a packaged wizard renders an empty catalog and routes
# every model id to ollama.
#
# v1.15.0 Phase 3 (Issue 2): FAIL CLOSED on catalog.json. A missing catalog was
# previously skipped silently, and a *stale* catalog is exactly what shipped the
# v1.13/v1.14 install-reliability defects (Gemma Ollama-400, unflagged gated
# SANA 401). Validate the content invariants at build time so a missing or
# regressed catalog can never be bundled. (Mirror-checked by the pytest
# `test_catalog_invariants.py` gate that runs in CI.)
catalog_path = REPO_ROOT / "core" / "registry" / "catalog.json"
if not catalog_path.is_file():
    raise SystemExit(f"catalog.json missing: expected {catalog_path}")
sys.path.insert(0, str(INSTALLER_ROOT / "src"))
import json as _json  # noqa: E402

from nexus_installer.catalog_invariants import validate_catalog  # noqa: E402

catalog_problems = validate_catalog(
    _json.loads(catalog_path.read_text(encoding="utf-8"))
)
if catalog_problems:
    raise SystemExit(
        "catalog.json failed invariant checks (run "
        "scripts/installer/build/check-catalog.py):\n  - "
        + "\n  - ".join(catalog_problems)
    )
datas.append((str(catalog_path), "core/registry"))

recommended_path = REPO_ROOT / "core" / "registry" / "recommended.json"
if recommended_path.exists():
    datas.append((str(recommended_path), "core/registry"))

# Backend requirements
req_candidates = [
    REPO_ROOT / "scripts" / "installer" / "backend-requirements.txt",
    REPO_ROOT / "scripts" / "installer" / "legacy" / "backend-requirements.txt",
]
for req in req_candidates:
    if req.exists():
        datas.append((str(req), "."))
        break

# Runtime UI icons + brand mark (v1.9.0 T019). Resolved by
# `nexus_installer.registry_paths` (asset_file / resolve_window_icon) from
# `sys._MEIPASS/assets` in the frozen bundle: `icon.ico` is the multi-resolution
# window/taskbar icon set via `setWindowIcon` (fixes the generic Python host
# icon fallback, T018), `icon.png` is the fallback, and the transparent mark
# feeds the header's StaticLogo. Without these staged, a packaged wizard shows
# the generic icon and a blank header mark.
for asset_name in ("icon.ico", "icon.png", "nexus-ai-primary_no-background.png"):
    asset_path = REPO_ROOT / "assets" / asset_name
    if asset_path.exists():
        datas.append((str(asset_path), "assets"))

# v1.11.0 Phase 4 (T401): the embedded desktop-app bundle + its build-time
# manifest (name, version, sha256), staged by build-windows.ps1 into
# build/desktop-payload/. The provisioner installs from this payload instead
# of fetching a GitHub release. FAIL CLOSED on Windows: an installer without
# the desktop app is not shippable (macOS/Linux staging lands with their
# build-script rework; the provisioner fail-softs there).
desktop_payload = INSTALLER_ROOT / "build" / "desktop-payload"
if sys.platform == "win32":
    _bundle = desktop_payload / "Nexus-Desktop-Setup.exe"
    _manifest = desktop_payload / "manifest.json"
    if not (_bundle.is_file() and _manifest.is_file()):
        raise SystemExit(
            "desktop payload missing: run scripts/installer/build/"
            "build-windows.ps1 (it stages build/desktop-payload/ from the "
            "Tauri NSIS bundle) instead of invoking pyinstaller directly."
        )
    datas.append((str(_bundle), "desktop-bundle"))
    datas.append((str(_manifest), "desktop-bundle"))

a = Analysis(
    [str(INSTALLER_ROOT / "src" / "nexus_installer" / "main.py")],
    pathex=[str(INSTALLER_ROOT / "src")],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "PyQt5.QtWidgets",
        "PyQt5.QtCore",
        "PyQt5.QtGui",
        "PyQt5.QtSvg",
        # v1.11.0 Phase 7 (T703): single-instance reattach uses QLocalServer /
        # QLocalSocket from QtNetwork. Listed explicitly so the Qt5Network DLL is
        # bundled even though single_instance.py is imported lazily from main().
        "PyQt5.QtNetwork",
    ],
    hookspath=[str(SPEC_DIR / "hooks")],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "scipy"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # Windowed mode
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON if Path(ICON).exists() else None,
)

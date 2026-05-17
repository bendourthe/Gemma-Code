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
PYQT_ROOT = SPEC_DIR.parent
REPO_ROOT = PYQT_ROOT.parent.parent.parent

# Platform-specific settings
if sys.platform == "win32":
    APP_NAME = "NexusSetup"
    ICON = str(REPO_ROOT / "assets" / "icon.ico")
elif sys.platform == "darwin":
    APP_NAME = "Nexus Installer"
    # macOS needs .icns; fall back to .png if .icns not available
    icns_path = REPO_ROOT / "assets" / "icon.icns"
    ICON = str(icns_path) if icns_path.exists() else str(REPO_ROOT / "assets" / "icon.png")
else:
    APP_NAME = "nexus-setup"
    ICON = str(REPO_ROOT / "assets" / "icon.png")

# Locate bundled data files
datas = []

# VSIX file
vsix_candidates = list(REPO_ROOT.glob("gemma-code-*.vsix")) + list(
    (REPO_ROOT / "scripts" / "installer").glob("gemma-code-*.vsix")
)
if vsix_candidates:
    datas.append((str(vsix_candidates[0]), "."))

# Backend requirements
req_candidates = [
    REPO_ROOT / "scripts" / "installer" / "backend-requirements.txt",
    REPO_ROOT / "scripts" / "installer" / "legacy" / "backend-requirements.txt",
]
for req in req_candidates:
    if req.exists():
        datas.append((str(req), "."))
        break

# Icon for the installer UI
icon_png = REPO_ROOT / "assets" / "icon.png"
if icon_png.exists():
    datas.append((str(icon_png), "assets"))

a = Analysis(
    [str(PYQT_ROOT / "src" / "nexus_installer" / "main.py")],
    pathex=[str(PYQT_ROOT / "src")],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "PyQt5.QtWidgets",
        "PyQt5.QtCore",
        "PyQt5.QtGui",
        "PyQt5.QtSvg",
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

#!/usr/bin/env bash
set -euo pipefail

# Build the Nexus Installer for Linux via PyInstaller.
# Produces dist/nexus-setup and optionally an AppImage.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYQT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PYQT_ROOT/../../.." && pwd)"

log_info()  { printf "[INFO]  %s\n" "$*" >&2; }
log_error() { printf "[ERROR] %s\n" "$*" >&2; }

log_info "[1/4] Installing build dependencies..."
cd "$PYQT_ROOT"
pip install pyinstaller pyqt5 httpx --quiet 2>/dev/null || true

log_info "[2/4] Running PyInstaller..."
cd "$PYQT_ROOT"
pyinstaller build/nexus-installer.spec --distpath dist --workpath build/work --clean --noconfirm 2>&1 | grep -v "^INFO\|^DEBUG" || true

BINARY_PATH="$PYQT_ROOT/dist/nexus-setup"
if [ ! -f "$BINARY_PATH" ]; then
    log_error "Build failed. $BINARY_PATH not found."
    exit 1
fi

chmod +x "$BINARY_PATH"
log_info "Binary: $BINARY_PATH"
log_info "Size: $(du -h "$BINARY_PATH" | cut -f1)"
log_info "SHA256: $(sha256sum "$BINARY_PATH" | cut -d' ' -f1)"

log_info "[3/4] Creating AppImage (optional)..."
APPIMAGE_TOOL="$(command -v appimagetool 2>/dev/null || true)"
if [ -z "$APPIMAGE_TOOL" ]; then
    APPIMAGE_TOOL="/tmp/appimagetool"
    if [ ! -f "$APPIMAGE_TOOL" ]; then
        log_info "Downloading appimagetool..."
        curl -fsSL "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" -o "$APPIMAGE_TOOL" || {
            log_info "AppImage tool download failed. Skipping AppImage creation."
            log_info "Build complete: $BINARY_PATH"
            exit 0
        }
        chmod +x "$APPIMAGE_TOOL"
    fi
fi

APPDIR=$(mktemp -d)/NexusSetup.AppDir
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/icons"
cp "$BINARY_PATH" "$APPDIR/usr/bin/nexus-setup"

if [ -f "$REPO_ROOT/assets/icon.png" ]; then
    cp "$REPO_ROOT/assets/icon.png" "$APPDIR/usr/share/icons/gemma-code.png"
    cp "$REPO_ROOT/assets/icon.png" "$APPDIR/gemma-code.png"
fi

cat > "$APPDIR/nexus-setup.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Nexus Installer
Exec=nexus-setup
Icon=gemma-code
Categories=Development;
DESKTOP

cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/bash
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
exec "${HERE}/usr/bin/nexus-setup" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

APPIMAGE_OUT="$PYQT_ROOT/dist/NexusSetup-x86_64.AppImage"
"$APPIMAGE_TOOL" "$APPDIR" "$APPIMAGE_OUT" 2>/dev/null || log_info "AppImage creation failed; binary is still available"

if [ -f "$APPIMAGE_OUT" ]; then
    log_info "AppImage: $APPIMAGE_OUT"
    log_info "Size: $(du -h "$APPIMAGE_OUT" | cut -f1)"
    log_info "SHA256: $(sha256sum "$APPIMAGE_OUT" | cut -d' ' -f1)"
fi

log_info "[4/4] Build complete."

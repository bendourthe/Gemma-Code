#!/usr/bin/env bash
set -euo pipefail

# Build the Nexus installer for Linux via PyInstaller.
# v1.9.0 Phase 1 (T102): a single onefile (spec APP_NAME "nexus-setup") is
# frozen into a staging dir, then packaged into exactly one artifact at the
# repo-root dist/: NexusSetup-x86_64.AppImage.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INSTALLER_ROOT/../.." && pwd)"
STAGE_DIR="$INSTALLER_ROOT/build/stage"
DIST_DIR="$REPO_ROOT/dist"

log_info()  { printf "[INFO]  %s\n" "$*" >&2; }
log_error() { printf "[ERROR] %s\n" "$*" >&2; }

log_info "[1/4] Installing build dependencies..."
cd "$INSTALLER_ROOT"
pip install pyinstaller pyqt5 httpx --quiet 2>/dev/null || true

log_info "[2/4] Running PyInstaller (single onefile)..."
cd "$INSTALLER_ROOT"
rm -rf "$STAGE_DIR"
pyinstaller build/nexus-installer.spec --distpath "$STAGE_DIR" --workpath build/work --clean --noconfirm 2>&1 | grep -v "^INFO\|^DEBUG" || true

BINARY_PATH="$STAGE_DIR/nexus-setup"
if [ ! -f "$BINARY_PATH" ]; then
    log_error "Build failed. $BINARY_PATH not found."
    exit 1
fi
chmod +x "$BINARY_PATH"
log_info "Onefile: $BINARY_PATH"
log_info "Size: $(du -h "$BINARY_PATH" | cut -f1)"

log_info "[3/4] Creating AppImage..."
APPIMAGE_TOOL="$(command -v appimagetool 2>/dev/null || true)"
if [ -z "$APPIMAGE_TOOL" ]; then
    APPIMAGE_TOOL="/tmp/appimagetool"
    if [ ! -f "$APPIMAGE_TOOL" ]; then
        log_info "Downloading appimagetool..."
        curl -fsSL "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" -o "$APPIMAGE_TOOL" || {
            log_error "AppImage tool download failed; cannot produce the single artifact."
            exit 1
        }
        chmod +x "$APPIMAGE_TOOL"
    fi
fi

APPDIR=$(mktemp -d)/NexusSetup.AppDir
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/icons"
cp "$BINARY_PATH" "$APPDIR/usr/bin/nexus-setup"

if [ -f "$REPO_ROOT/assets/icon.png" ]; then
    cp "$REPO_ROOT/assets/icon.png" "$APPDIR/usr/share/icons/nexus-ai.png"
    cp "$REPO_ROOT/assets/icon.png" "$APPDIR/nexus-ai.png"
fi

cat > "$APPDIR/nexus-setup.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Nexus AI Studio Setup
Exec=nexus-setup
Icon=nexus-ai
Categories=Development;
DESKTOP

cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/bash
SELF=$(readlink -f "$0")
HERE=${SELF%/*}
exec "${HERE}/usr/bin/nexus-setup" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

mkdir -p "$DIST_DIR"
APPIMAGE_OUT="$DIST_DIR/NexusSetup-x86_64.AppImage"
rm -f "$APPIMAGE_OUT"
"$APPIMAGE_TOOL" "$APPDIR" "$APPIMAGE_OUT" 2>/dev/null || {
    log_error "AppImage creation failed."
    exit 1
}

if [ -f "$APPIMAGE_OUT" ]; then
    log_info "AppImage: $APPIMAGE_OUT"
    log_info "Size: $(du -h "$APPIMAGE_OUT" | cut -f1)"
    log_info "SHA256: $(sha256sum "$APPIMAGE_OUT" | cut -d' ' -f1)"
else
    log_error "AppImage creation failed."
    exit 1
fi

log_info "[4/4] Build complete: $APPIMAGE_OUT"

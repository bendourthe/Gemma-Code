#!/usr/bin/env bash
set -euo pipefail

# Build the Nexus Installer for macOS via PyInstaller.
# Produces dist/Nexus Installer.app and optionally a .dmg.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYQT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PYQT_ROOT/../../.." && pwd)"

log_info()  { printf "[INFO]  %s\n" "$*" >&2; }
log_error() { printf "[ERROR] %s\n" "$*" >&2; }

log_info "[1/5] Installing build dependencies..."
cd "$PYQT_ROOT"
pip install pyinstaller pyqt5 httpx --quiet 2>/dev/null || true

log_info "[2/5] Creating .icns icon (if not present)..."
ICNS_PATH="$REPO_ROOT/assets/icon.icns"
if [ ! -f "$ICNS_PATH" ] && [ -f "$REPO_ROOT/assets/icon.png" ]; then
    ICONSET_DIR=$(mktemp -d)/GemmaCode.iconset
    mkdir -p "$ICONSET_DIR"
    for size in 16 32 64 128 256 512; do
        sips -z "$size" "$size" "$REPO_ROOT/assets/icon.png" --out "$ICONSET_DIR/icon_${size}x${size}.png" 2>/dev/null || true
    done
    iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH" 2>/dev/null || log_info "iconutil failed; using PNG fallback"
fi

log_info "[3/5] Running PyInstaller..."
cd "$PYQT_ROOT"
pyinstaller build/nexus-installer.spec --distpath dist --workpath build/work --clean --noconfirm 2>&1 | grep -v "^INFO\|^DEBUG" || true

APP_PATH="$PYQT_ROOT/dist/Nexus Installer.app"
if [ -d "$APP_PATH" ]; then
    log_info "App bundle created at: $APP_PATH"
else
    # Single-file mode produces a binary, not .app
    BINARY_PATH="$PYQT_ROOT/dist/Nexus Installer"
    if [ -f "$BINARY_PATH" ]; then
        log_info "Binary created at: $BINARY_PATH"
    else
        log_error "Build failed. No output found in dist/"
        exit 1
    fi
fi

log_info "[4/5] Creating .dmg..."
DMG_PATH="$PYQT_ROOT/dist/NexusSetup.dmg"
if [ -d "$APP_PATH" ]; then
    DMG_TMP=$(mktemp -d)
    cp -R "$APP_PATH" "$DMG_TMP/"
    ln -s /Applications "$DMG_TMP/Applications"
    hdiutil create -volname "Nexus Installer" -srcfolder "$DMG_TMP" -ov -format UDBZ "$DMG_PATH" 2>/dev/null || log_info "DMG creation failed; binary is still available"
    rm -rf "$DMG_TMP"
    if [ -f "$DMG_PATH" ]; then
        log_info "DMG created: $DMG_PATH"
        log_info "Size: $(du -h "$DMG_PATH" | cut -f1)"
        log_info "SHA256: $(shasum -a 256 "$DMG_PATH" | cut -d' ' -f1)"
    fi
fi

log_info "[5/5] Signing (if identity available)..."
if command -v codesign >/dev/null 2>&1 && [ -d "$APP_PATH" ]; then
    IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | head -1 | grep -o '"[^"]*"' | tr -d '"' || true)
    if [ -n "$IDENTITY" ]; then
        codesign --force --deep --sign "$IDENTITY" "$APP_PATH" 2>&1 || log_info "Signing failed"
    else
        log_info "No signing identity found. Skipping."
    fi
else
    log_info "Skipping code signing."
fi

log_info "Build complete."

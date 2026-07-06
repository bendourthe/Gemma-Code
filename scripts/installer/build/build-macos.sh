#!/usr/bin/env bash
set -euo pipefail

# Build the Nexus installer for macOS via PyInstaller.
# v1.9.0 Phase 1 (T102): a single onefile (spec APP_NAME "Nexus AI Studio
# Setup") is frozen into a staging dir, then packaged into exactly one
# artifact at the repo-root dist/: NexusSetup.dmg.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INSTALLER_ROOT/../.." && pwd)"
STAGE_DIR="$INSTALLER_ROOT/build/stage"
DIST_DIR="$REPO_ROOT/dist"
APP_NAME="Nexus AI Studio Setup"

log_info()  { printf "[INFO]  %s\n" "$*" >&2; }
log_error() { printf "[ERROR] %s\n" "$*" >&2; }

log_info "[1/4] Installing build dependencies..."
cd "$INSTALLER_ROOT"
pip install pyinstaller pyqt5 httpx --quiet 2>/dev/null || true

log_info "[2/4] Creating .icns icon (if not present)..."
ICNS_PATH="$REPO_ROOT/assets/icon.icns"
if [ ! -f "$ICNS_PATH" ] && [ -f "$REPO_ROOT/assets/icon.png" ]; then
    ICONSET_DIR=$(mktemp -d)/NexusAIStudio.iconset
    mkdir -p "$ICONSET_DIR"
    for size in 16 32 64 128 256 512; do
        sips -z "$size" "$size" "$REPO_ROOT/assets/icon.png" --out "$ICONSET_DIR/icon_${size}x${size}.png" 2>/dev/null || true
    done
    iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH" 2>/dev/null || log_info "iconutil failed; using PNG fallback"
fi

log_info "[3/4] Running PyInstaller (single onefile)..."
cd "$INSTALLER_ROOT"
rm -rf "$STAGE_DIR"
pyinstaller build/nexus-installer.spec --distpath "$STAGE_DIR" --workpath build/work --clean --noconfirm 2>&1 | grep -v "^INFO\|^DEBUG" || true

# PyInstaller (no BUNDLE section) emits a bare onefile binary; a windowed
# build on some configs may emit a .app. Accept either as the DMG payload.
APP_BUNDLE="$STAGE_DIR/$APP_NAME.app"
BINARY_PATH="$STAGE_DIR/$APP_NAME"
if [ -d "$APP_BUNDLE" ]; then
    PAYLOAD="$APP_BUNDLE"
elif [ -f "$BINARY_PATH" ]; then
    PAYLOAD="$BINARY_PATH"
else
    log_error "Build failed. No onefile output found in $STAGE_DIR"
    exit 1
fi
log_info "Onefile: $PAYLOAD"

log_info "[4/4] Creating NexusSetup.dmg..."
mkdir -p "$DIST_DIR"
DMG_PATH="$DIST_DIR/NexusSetup.dmg"
DMG_TMP=$(mktemp -d)
cp -R "$PAYLOAD" "$DMG_TMP/"
ln -s /Applications "$DMG_TMP/Applications"
rm -f "$DMG_PATH"
hdiutil create -volname "Nexus AI Studio" -srcfolder "$DMG_TMP" -ov -format UDBZ "$DMG_PATH"
rm -rf "$DMG_TMP"

if [ -f "$DMG_PATH" ]; then
    log_info "DMG: $DMG_PATH"
    log_info "Size: $(du -h "$DMG_PATH" | cut -f1)"
    log_info "SHA256: $(shasum -a 256 "$DMG_PATH" | cut -d' ' -f1)"
else
    log_error "DMG creation failed."
    exit 1
fi

# Best-effort code signing (unsigned Gatekeeper caveats are documented on the
# download page; notarization is a recorded deferral for this cycle).
if command -v codesign >/dev/null 2>&1 && [ -d "$APP_BUNDLE" ]; then
    IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | head -1 | grep -o '"[^"]*"' | tr -d '"' || true)
    if [ -n "$IDENTITY" ]; then
        codesign --force --deep --sign "$IDENTITY" "$APP_BUNDLE" 2>&1 || log_info "Signing failed"
    else
        log_info "No signing identity found. Skipping."
    fi
else
    log_info "Skipping code signing."
fi

log_info "Build complete: $DMG_PATH"

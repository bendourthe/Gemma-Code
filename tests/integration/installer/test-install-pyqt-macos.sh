#!/usr/bin/env bash
set -euo pipefail

# macOS integration test for the PyQt5 installer.

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
INSTALLER_DIR="$REPO_ROOT/scripts/installer/pyqt"
PASSED=0
FAILED=0

log_pass() { printf "  TEST: %s [\033[32mPASS\033[0m]\n" "$1"; ((PASSED++)) || true; }
log_fail() { printf "  TEST: %s [\033[31mFAIL\033[0m] %s\n" "$1" "$2"; ((FAILED++)) || true; }

printf "\nPyQt5 Installer Integration Tests (macOS)\n"
printf "==================================================\n"

# Test 1: Installer package imports
# Import the package, then read the version from the installed dist metadata
# rather than the module's `__version__` attribute: an editable install can
# expose `nexus_installer` as a namespace-style package whose top-level
# `__init__` attributes are not populated by the import hook, which made the
# bare `from nexus_installer import __version__` flaky on Linux/macOS while the
# submodule imports below kept working. `importlib.metadata.version` reads the
# `.dist-info` recorded by the editable install and is immune to that quirk.
cd "$INSTALLER_DIR"
if python -c "import nexus_installer; from importlib.metadata import version; print(version('nexus-installer'))" 2>/dev/null | grep -qE "^[0-9]+\.[0-9]+\.[0-9]+"; then
    log_pass "Installer package imports"
else
    log_fail "Installer package imports" "Import failed"
fi

# Test 2: GPU detection
cd "$INSTALLER_DIR"
if python -c "from nexus_installer.pages.gpu_detection import detect_gpu; name, vendor, vram = detect_gpu(); print(f'{vendor}:{vram}')" 2>/dev/null | grep -q ":"; then
    log_pass "GPU detection completes"
else
    log_fail "GPU detection completes" "Detection failed"
fi

# Test 3: Theme generation
cd "$INSTALLER_DIR"
if python -c "from nexus_installer.theme import generate_stylesheet; s = generate_stylesheet(); assert len(s) > 500; print('OK')" 2>/dev/null | grep -q "OK"; then
    log_pass "Theme generates valid QSS"
else
    log_fail "Theme generates valid QSS" "Theme generation failed"
fi

printf "\nResults: %d passed, %d failed\n" "$PASSED" "$FAILED"
exit "$FAILED"

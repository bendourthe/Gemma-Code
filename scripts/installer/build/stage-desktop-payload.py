"""Stage the current desktop NSIS bundle into desktop-payload/.

Invoked by build-windows.ps1. Fail-closed: missing, version-mismatched, or
stale-relative-to-source bundles exit 1 so PyInstaller never freezes last
week's desktop into NexusSetup.exe.

Usage:

    python scripts/installer/build/stage-desktop-payload.py \
        --source <nsis-exe> --dest <payload-dir> --version <product-version> \
        --repo-root <repo>
"""

from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from nexus_installer.engine.desktop_payload import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())

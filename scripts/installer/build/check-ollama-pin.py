"""v1.11.0 Phase 3 (T302) -- advisory Ollama pin-freshness check.

Compares the tag pinned in `nexus_installer.engine.ollama_installer` against
the latest upstream release (GitHub API) and prints the current asset digests
so an operator can rotate all three pin constants together. Advisory by
default (always exits 0 so offline builds never break); `--strict` exits 1
when the pin is behind.

Usage:
    python scripts/installer/build/check-ollama-pin.py [--strict]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from urllib import error as urlerror
from urllib import request as urlrequest

LATEST_URL = "https://api.github.com/repos/ollama/ollama/releases/latest"
INSTALLER_SRC = (
    Path(__file__).resolve().parents[1]
    / "src"
    / "nexus_installer"
    / "engine"
    / "ollama_installer.py"
)
PIN_ASSETS = ("OllamaSetup.exe", "ollama-linux-amd64.tar.zst")


def pinned_tag() -> str:
    text = INSTALLER_SRC.read_text(encoding="utf-8")
    match = re.search(r'OLLAMA_PINNED_TAG = "([^"]+)"', text)
    if not match:
        raise SystemExit("could not find OLLAMA_PINNED_TAG in ollama_installer.py")
    return match.group(1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--strict",
        action="store_true",
        help="exit 1 when the pin is behind the latest upstream release",
    )
    args = parser.parse_args(argv)

    pin = pinned_tag()
    try:
        with urlrequest.urlopen(LATEST_URL, timeout=30) as resp:
            release = json.loads(resp.read().decode("utf-8"))
    except (urlerror.URLError, OSError, json.JSONDecodeError) as exc:
        print(f"check-ollama-pin: could not reach the GitHub API ({exc}); skipping")
        return 0  # advisory: offline builds must not break

    latest = release.get("tag_name", "?")
    if latest == pin:
        print(f"check-ollama-pin: pinned {pin} is the latest release")
        return 0

    print(f"check-ollama-pin: pinned {pin} is BEHIND latest {latest}")
    print("  rotate OLLAMA_PINNED_TAG + both sha256 pins together; digests:")
    for asset in release.get("assets", []):
        if asset.get("name") in PIN_ASSETS:
            print(f"    {asset['name']}: {asset.get('digest', '?')}")
    return 1 if args.strict else 0


if __name__ == "__main__":
    sys.exit(main())

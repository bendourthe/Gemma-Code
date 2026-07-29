"""v1.15.0 Phase 3 (Issue 2) -- build/CI guard for the model catalog.

Validates ``core/registry/catalog.json`` against the content invariants in
``nexus_installer.catalog_invariants`` (the ones that encode the v1.13.0 /
v1.14.0 install-reliability fixes), so a stale or regressed catalog can never
ship. The PyInstaller spec bundles this same file straight from the repo, so a
green check here means the frozen installer carries a good catalog.

Exit 0 when the catalog is valid, 1 otherwise. Strict by design: a bad catalog
is a release blocker, and the check is offline / deterministic (it reads a local
file only), so it never needs the advisory-skip that network checks do.

Usage:
    python scripts/installer/build/check-catalog.py [--catalog PATH]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Allow running as a plain script (no installed package) by adding src/ to path.
_SRC = Path(__file__).resolve().parents[1] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from nexus_installer.catalog_invariants import validate_catalog  # noqa: E402

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_CATALOG = _REPO_ROOT / "core" / "registry" / "catalog.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--catalog",
        type=Path,
        default=_DEFAULT_CATALOG,
        help="path to catalog.json (defaults to core/registry/catalog.json)",
    )
    args = parser.parse_args(argv)

    try:
        catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"check-catalog: cannot read {args.catalog}: {exc}")
        return 1

    problems = validate_catalog(catalog)
    if not problems:
        model_count = len(catalog.get("models", []))
        print(f"check-catalog: {args.catalog} OK ({model_count} models)")
        return 0

    print(f"check-catalog: {len(problems)} problem(s) in {args.catalog}:")
    for problem in problems:
        print(f"  - {problem}")
    return 1


if __name__ == "__main__":
    sys.exit(main())

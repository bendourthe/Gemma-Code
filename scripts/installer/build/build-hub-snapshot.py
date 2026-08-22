"""Build the bundled Nexus-Hub catalog snapshot (v2.2.0 Phase 3, 3.1).

Packs a synced `~/.nexus-ai/catalog/` tree (or any explicit catalog dir) into
`scripts/installer/build/hub-snapshot/catalog.tar.gz` plus a `manifest.json`
recording the tag and a REAL sha256.

Why this exists: without a bundled snapshot the harness only arrives if the
sidecar's best-effort first-launch fetch succeeds, so an offline install ships
an app with no skills, no commands, and no rules. v1.10.0 removed an earlier
bundled baseline because its pins were placeholders (`REPLACE_ME`,
`example.invalid`); this builder therefore refuses to emit a manifest with a
placeholder digest, and `test_packaging.py` asserts the same invariant.

Usage:
    python scripts/installer/build/build-hub-snapshot.py [--catalog DIR] [--out DIR]

Exit codes: 0 built; 1 the source catalog is missing or unusable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path

INSTALLER_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = INSTALLER_ROOT / "build" / "hub-snapshot"
SNAPSHOT_NAME = "catalog.tar.gz"
MANIFEST_NAME = "manifest.json"

# Directories that must exist in a usable catalog: a snapshot without skills or
# commands would satisfy "catalog present" while delivering no harness at all.
REQUIRED_SUBDIRS = ("skills", "commands")
EXCLUDED_NAMES = {".git", "__pycache__", ".DS_Store", "node_modules"}


def default_catalog_dir() -> Path:
    override = os.environ.get("NEXUS_AI_HOME")
    base = Path(override) if override else Path.home() / ".nexus-ai"
    return base / "catalog"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_tag(catalog: Path) -> str | None:
    manifest = catalog / "nexus-hub-version.json"
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    version = data.get("version")
    return version if isinstance(version, str) and version.strip() else None


def _tar_filter(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    parts = Path(info.name).parts
    if any(part in EXCLUDED_NAMES for part in parts):
        return None
    # Normalize ownership so the archive is reproducible across build hosts.
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    return info


def build_snapshot(catalog: Path, out_dir: Path) -> int:
    if not catalog.is_dir():
        print(f"ERROR: catalog directory not found: {catalog}", file=sys.stderr)
        print(
            "Run a sync first (node desktop/sidecar/dist/hub-catalog.js "
            "--sync-hub-catalog) or pass --catalog.",
            file=sys.stderr,
        )
        return 1
    missing = [d for d in REQUIRED_SUBDIRS if not (catalog / d).is_dir()]
    if missing:
        print(
            f"ERROR: catalog at {catalog} is missing required subdirs: "
            f"{', '.join(missing)}",
            file=sys.stderr,
        )
        return 1

    tag = _read_tag(catalog)
    out_dir.mkdir(parents=True, exist_ok=True)
    archive = out_dir / SNAPSHOT_NAME

    # Write to a temp file then replace, so an interrupted build never leaves a
    # truncated archive that would still pass a "file exists" packaging check.
    fd, tmp_name = tempfile.mkstemp(
        prefix="hub-snapshot-", suffix=".tar.gz", dir=str(out_dir)
    )
    os.close(fd)
    tmp_path = Path(tmp_name)
    try:
        with tarfile.open(tmp_path, "w:gz") as tar:
            for entry in sorted(catalog.iterdir(), key=lambda p: p.name):
                if entry.name in EXCLUDED_NAMES:
                    continue
                tar.add(entry, arcname=entry.name, filter=_tar_filter)
        digest = _sha256(tmp_path)
        os.replace(tmp_path, archive)
    finally:
        tmp_path.unlink(missing_ok=True)

    manifest = {
        "schemaVersion": 1,
        "archive": SNAPSHOT_NAME,
        "sha256": digest,
        "tag": tag,
        "builtAt": datetime.now(UTC).isoformat(),
        "sourceCatalog": str(catalog),
        "sizeBytes": archive.stat().st_size,
    }
    (out_dir / MANIFEST_NAME).write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"built {archive} ({manifest['sizeBytes'] / 1024:.0f} KB), "
        f"tag={tag or 'unknown'}, sha256={digest[:12]}..."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build the bundled Nexus-Hub catalog snapshot."
    )
    parser.add_argument(
        "--catalog", type=Path, default=None, help="Source catalog directory."
    )
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help="Output directory."
    )
    args = parser.parse_args(argv)
    return build_snapshot(args.catalog or default_catalog_dir(), args.out)


if __name__ == "__main__":
    raise SystemExit(main())

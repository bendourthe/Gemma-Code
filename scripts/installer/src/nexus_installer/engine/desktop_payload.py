"""Build-time staging for the embedded desktop NSIS payload.

v2.4.6 Phase 1: ``build-windows.ps1`` must freeze the Tauri bundle that was
just built from this tree, not last week's exe that happens to share the
package version (still 2.4.1 until ``/update release``). A missing bundle,
a filename whose version does not match the product version, or a bundle
older than desktop source files is a failed build.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path

STAGED_FILENAME = "Nexus-Desktop-Setup.exe"
MANIFEST_FILENAME = "manifest.json"
IDENTITY_FILENAME = "desktop-payload.json"

_SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".rs", ".json", ".toml", ".css"}
_SKIP_DIR_NAMES = {
    "node_modules",
    "target",
    "dist",
    ".git",
    "__pycache__",
    "coverage",
}


class StageError(ValueError):
    """The desktop payload cannot be frozen into NexusSetup.exe."""


def original_name_matches_version(original_name: str, version: str) -> bool:
    """True when the NSIS filename encodes exactly this product version.

    ``2.4.1`` must not match ``2.4.10``. The Tauri and release artifact names
    both use ``_{version}_`` (``Nexus AI Studio_2.4.1_x64-setup.exe``).
    """
    if not original_name or not version:
        return False
    token = f"_{version}_"
    suffix = f"_{version}"
    return token in original_name or original_name.rsplit(".", 1)[0].endswith(suffix)


def default_desktop_source_roots(repo_root: Path) -> list[Path]:
    """Files whose mtime must not be newer than a freeze-able NSIS bundle."""
    desktop = repo_root / "desktop"
    return [
        desktop / "src",
        desktop / "sidecar" / "src",
        desktop / "src-tauri" / "src",
        desktop / "package.json",
        desktop / "src-tauri" / "Cargo.toml",
        desktop / "src-tauri" / "tauri.conf.json",
    ]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _iter_source_files(roots: Iterable[Path]) -> Iterable[Path]:
    for root in roots:
        if root.is_file():
            yield root
            continue
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [name for name in dirnames if name not in _SKIP_DIR_NAMES]
            for name in filenames:
                if Path(name).suffix.lower() not in _SOURCE_SUFFIXES:
                    continue
                yield Path(dirpath) / name


def newest_source_file(roots: Sequence[Path]) -> tuple[Path | None, float]:
    newest_path: Path | None = None
    newest_mtime = 0.0
    for path in _iter_source_files(roots):
        try:
            mtime = path.stat().st_mtime
        except OSError:
            continue
        if newest_path is None or mtime > newest_mtime:
            newest_path = path
            newest_mtime = mtime
    return newest_path, newest_mtime


def assert_bundle_fresh(bundle: Path, source_roots: Sequence[Path]) -> None:
    """Refuse a bundle whose mtime is older than desktop source files."""
    if not source_roots:
        return
    try:
        bundle_mtime = bundle.stat().st_mtime
    except OSError as exc:
        raise StageError(f"desktop bundle is unreadable: {bundle}") from exc
    newest, newest_mtime = newest_source_file(source_roots)
    if newest is not None and newest_mtime > bundle_mtime:
        raise StageError(
            "desktop bundle is stale relative to source "
            f"({newest} is newer than {bundle.name}). "
            "Build it first: cd desktop; npm run build:shell"
        )


def stage_desktop_payload(
    source: Path,
    dest_dir: Path,
    product_version: str,
    *,
    source_roots: Sequence[Path] | None = None,
    platform: str = "win32",
) -> dict[str, str]:
    """Copy ``source`` into ``dest_dir`` and write ``manifest.json``.

    Raises ``StageError`` when the source is missing, the filename version
    does not match ``product_version``, or the bundle is older than desktop
    sources.
    """
    source = Path(source)
    dest_dir = Path(dest_dir)
    if not source.is_file():
        raise StageError(
            f"desktop bundle not found: {source}. "
            "Build it first: cd desktop; npm run build:shell"
        )
    original_name = source.name
    if not original_name_matches_version(original_name, product_version):
        raise StageError(
            f"desktop bundle name {original_name!r} does not encode product "
            f"version {product_version!r}."
        )
    if source_roots:
        assert_bundle_fresh(source, source_roots)

    dest_dir.mkdir(parents=True, exist_ok=True)
    staged = dest_dir / STAGED_FILENAME
    shutil.copy2(source, staged)
    digest = sha256_file(staged)
    source_mtime = datetime.fromtimestamp(source.stat().st_mtime, tz=UTC)
    manifest = {
        "filename": STAGED_FILENAME,
        "original_name": original_name,
        "version": product_version,
        "sha256": digest,
        "platform": platform,
        "source_mtime_utc": source_mtime.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    (dest_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="ascii",
    )
    return manifest


def desktop_payload_identity_path(home: Path | None = None) -> Path:
    return (home or Path.home()) / ".nexus" / IDENTITY_FILENAME


def write_desktop_payload_identity(
    manifest: Mapping[str, str],
    *,
    home: Path | None = None,
) -> Path:
    """Persist the installer-embedded fingerprint under ``~/.nexus/``."""
    version = str(manifest.get("version") or "").strip()
    sha256 = str(manifest.get("sha256") or "").strip().lower()
    if not version or not sha256:
        raise StageError("desktop payload identity needs version and sha256")
    target = desktop_payload_identity_path(home)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": version,
        "sha256": sha256,
        "original_name": str(manifest.get("original_name") or ""),
        "writtenAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    tmp = target.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, target)
    return target


def format_payload_label(version: str, sha256: str) -> str:
    if not version or not sha256:
        return "Desktop payload unknown"
    return f"Desktop payload {version} ({sha256[:12].lower()})"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Stage the current desktop NSIS bundle for PyInstaller."
    )
    parser.add_argument("--source", required=True, help="Path to the NSIS setup exe")
    parser.add_argument(
        "--dest", required=True, help="desktop-payload output directory"
    )
    parser.add_argument(
        "--version", required=True, help="Product version from package.json"
    )
    parser.add_argument(
        "--repo-root", default="", help="Repo root for source freshness"
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    source = Path(args.source)
    dest = Path(args.dest)
    roots: list[Path] | None = None
    if args.repo_root:
        roots = default_desktop_source_roots(Path(args.repo_root))
    try:
        manifest = stage_desktop_payload(
            source,
            dest,
            args.version,
            source_roots=roots,
        )
    except StageError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(
        f"desktop payload staged: {manifest['original_name']} "
        f"v{manifest['version']} sha256 {manifest['sha256'][:12]}..."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

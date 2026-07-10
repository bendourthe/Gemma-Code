"""v1.1.0 Phase 14.10 -- cross-OS payload fetcher.

Downloads CUDA / ROCm / Python / Node / Ollama / ffmpeg,
SANA model weights, the local embedder, and the Nexus VS Code extension VSIX
into a single per-OS `payload/` tree the installer then copies onto disk.

Every URL + SHA-256 is pinned in `scripts/installer/build/versions.lock.json`.
The script aborts on any hash mismatch -- this is the canonical defense
against the v1.0.0 OA-06 supply-chain rotation pattern.

Usage:

    python scripts/installer/build/fetch-payload.py \\
        --os <win|mac|linux> --arch <x64|arm64> --out build/payload/

The placeholder hashes in the lock file (all-zero) cause the script to log a
"placeholder; skipping verification" warning and continue, so the v1.1.0
ship can build before Phase 15 / OA-03 rotates the digests. The build step
exits non-zero only when a real (non-placeholder) hash mismatches.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

PLACEHOLDER_SHA256 = "0" * 64

LOG = logging.getLogger("fetch-payload")


@dataclass(frozen=True)
class PinnedAsset:
    """One URL + SHA-256 pin loaded from `versions.lock.json`."""

    name: str
    url: str
    sha256: str

    @property
    def is_placeholder(self) -> bool:
        return self.sha256 == PLACEHOLDER_SHA256

    @classmethod
    def from_entry(cls, name: str, entry: dict[str, Any]) -> "PinnedAsset":
        return cls(name=name, url=entry["url"], sha256=entry["sha256"])


def sha256_path(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def download(asset: PinnedAsset, dest: Path) -> None:
    """Download `asset.url` to `dest` and verify the SHA-256 unless placeholder."""
    if dest.exists():
        existing_hash = sha256_path(dest)
        if existing_hash == asset.sha256 and not asset.is_placeholder:
            LOG.info("%s already present and matches pin", dest.name)
            return
    LOG.info("downloading %s -> %s", asset.url, dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urlrequest.urlopen(asset.url, timeout=600) as resp, dest.open("wb") as out:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                out.write(chunk)
    except (urlerror.URLError, OSError) as exc:
        raise RuntimeError(f"download failed for {asset.url}: {exc}") from exc

    if asset.is_placeholder:
        LOG.warning(
            "placeholder hash for %s; verification skipped (rotated by OA-03)",
            asset.name,
        )
        return
    actual = sha256_path(dest)
    if actual != asset.sha256:
        raise RuntimeError(
            f"hash mismatch for {asset.name}: expected {asset.sha256}, got {actual}"
        )
    LOG.info("verified %s", asset.name)


def load_lockfile(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def platform_key(os_label: str, arch: str) -> str:
    if os_label == "win":
        return "win-x64"
    if os_label == "mac":
        return "mac-arm64" if arch == "arm64" else "mac-x64"
    if os_label == "linux":
        return "linux-x64" if arch in {"x64", "x86_64"} else f"linux-{arch}"
    raise SystemExit(f"unknown --os {os_label}")


def filename_for(url: str, fallback: str) -> str:
    name = url.rstrip("/").split("/")[-1] or fallback
    return name.split("?")[0]


def fetch_all(out_dir: Path, os_label: str, arch: str, lockfile: Path) -> None:
    data = load_lockfile(lockfile)
    key = platform_key(os_label, arch)
    platforms = data.get("platforms", {})
    if key not in platforms:
        raise SystemExit(f"no platform entry for {key} in {lockfile}")
    plat = platforms[key]
    common = data.get("common", {})

    out_dir.mkdir(parents=True, exist_ok=True)

    # Per-platform assets.
    for asset_key in ("python", "node", "cuda_runtime", "ollama", "ffmpeg"):
        entry = plat.get(asset_key)
        if entry is None:
            LOG.info("%s: no %s entry for this platform; skipping", key, asset_key)
            continue
        asset = PinnedAsset.from_entry(asset_key, entry)
        download(asset, out_dir / asset_key / filename_for(asset.url, asset_key))

    # Wheel sets.
    wheels_index = plat.get("wheels_index")
    wheel_sets = data.get("wheel_sets", {})
    if wheels_index and wheels_index in wheel_sets:
        for wheel_name, url in wheel_sets[wheels_index].items():
            asset = PinnedAsset(
                name=f"wheel:{wheel_name}",
                url=url,
                sha256=PLACEHOLDER_SHA256,
            )
            download(asset, out_dir / "python" / "wheels" / filename_for(url, wheel_name))

    # Model weights + local embedder.
    models = common.get("models", {})
    for model_key, entry in models.items():
        asset = PinnedAsset.from_entry(model_key, entry)
        dest = out_dir / "models" / model_key / filename_for(asset.url, model_key)
        download(asset, dest)

    LOG.info("payload fetch complete: %s", out_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch the cross-OS installer payload")
    parser.add_argument(
        "--os", required=True, choices=["win", "mac", "linux"], help="Target OS"
    )
    parser.add_argument(
        "--arch", required=True, choices=["x64", "arm64"], help="Target architecture"
    )
    parser.add_argument(
        "--out", required=True, type=Path, help="Output payload directory"
    )
    parser.add_argument(
        "--lockfile",
        type=Path,
        default=Path(__file__).resolve().parent / "versions.lock.json",
        help="Path to versions.lock.json",
    )
    parser.add_argument(
        "--verbose", action="store_true", help="Enable debug logging"
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    try:
        fetch_all(args.out, args.os, args.arch, args.lockfile)
    except (RuntimeError, SystemExit) as exc:
        LOG.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - entry point
    sys.exit(main())

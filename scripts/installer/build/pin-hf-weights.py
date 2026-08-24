"""v1.8.0 Phase 3 -- Hugging Face weights pin rotation.

Rotates the placeholder SHA-256 digests in the per-model `weights`
manifests of `core/registry/catalog.json` (versions.lock.json discipline;
same placeholder convention as `fetch-payload.py`). Two digest sources:

  * default (API): read each repo's file tree from
    `https://huggingface.co/api/models/{repo}/tree/main?recursive=true`
    and pin the LFS `oid` sha256 of every manifest file. Files stored
    outside LFS expose no sha256 via the API and keep their placeholder
    (warned).
  * `--from-dir <models_root>`: hash files already downloaded by the
    installer under `<models_root>/weights/<model-id>/` (the GPU-box
    flow: run the wizard once with placeholder pins, then rotate from
    the verified working tree).

`--check` reports remaining placeholders and exits non-zero when any are
left (CI-gateable). `--model <id>` (repeatable) restricts the sweep.

The rewrite is line-based and format-preserving: only the `"sha256"`
lines inside `weights.files` entries change.

Usage:

    python scripts/installer/build/pin-hf-weights.py [--model <id>]...
    python scripts/installer/build/pin-hf-weights.py --from-dir ~/.nexus/models
    python scripts/installer/build/pin-hf-weights.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import sys
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

PLACEHOLDER_SHA256 = "0" * 64
HF_TREE_URL = "https://huggingface.co/api/models/{repo}/tree/main?recursive=true"
REPO_ROOT = Path(__file__).resolve().parents[3]
CATALOG_PATH = REPO_ROOT / "core" / "registry" / "catalog.json"

LOG = logging.getLogger("pin-hf-weights")

# Mirrors nexus_installer.engine.hf_weights_puller.safe_dir_name; keep in sync.
_SAFE_DIR_CHAR_RE = re.compile(r"[^A-Za-z0-9._-]")


def safe_dir_name(model_id: str) -> str:
    return _SAFE_DIR_CHAR_RE.sub("-", model_id)


def _weight_file_entries(model: dict[str, Any]) -> list[dict[str, Any]]:
    """Layout-v1 `files` plus every official variant's file list."""
    weights = model.get("weights") or {}
    files: list[dict[str, Any]] = []
    for file_entry in weights.get("files") or []:
        if isinstance(file_entry, dict):
            files.append(file_entry)
    for variant in weights.get("variants") or []:
        if not isinstance(variant, dict):
            continue
        for file_entry in variant.get("files") or []:
            if isinstance(file_entry, dict):
                files.append(file_entry)
    return files


def load_hf_entries(
    catalog: dict[str, Any], only: set[str]
) -> list[tuple[str, str, list[str]]]:
    """Return (model_id, repo, [file paths]) for huggingface entries."""
    entries: list[tuple[str, str, list[str]]] = []
    for model in catalog.get("models", []):
        source = model.get("source", {})
        if source.get("protocol") != "huggingface":
            continue
        model_id = model["id"]
        if only and model_id not in only:
            continue
        files = [f["path"] for f in _weight_file_entries(model) if f.get("path")]
        if files:
            entries.append((model_id, source["repo"], files))
    return entries


def digests_from_api(repo: str) -> dict[str, str]:
    """Map repo file path -> LFS sha256 via the public HF tree API."""
    url = HF_TREE_URL.format(repo=repo)
    try:
        with urlrequest.urlopen(url, timeout=60) as resp:
            tree = json.loads(resp.read().decode("utf-8"))
    except (urlerror.URLError, OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"tree fetch failed for {repo}: {exc}") from exc
    digests: dict[str, str] = {}
    for node in tree:
        lfs = node.get("lfs") or {}
        oid = lfs.get("oid", "")
        if node.get("type") == "file" and re.fullmatch(r"[a-f0-9]{64}", oid):
            digests[node["path"]] = oid
    return digests


def sha256_path(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def collect_pins(
    entries: list[tuple[str, str, list[str]]],
    from_dir: Path | None,
) -> dict[tuple[str, str], str]:
    """Compute {(model_id, file path): sha256} from the API or a local tree."""
    pins: dict[tuple[str, str], str] = {}
    api_cache: dict[str, dict[str, str]] = {}
    for model_id, repo, files in entries:
        for file_path in files:
            if from_dir is not None:
                local = from_dir / "weights" / safe_dir_name(model_id) / file_path
                if not local.is_file():
                    LOG.warning("%s/%s: not on disk; skipped", model_id, file_path)
                    continue
                pins[(model_id, file_path)] = sha256_path(local)
                continue
            if repo not in api_cache:
                try:
                    api_cache[repo] = digests_from_api(repo)
                except RuntimeError as exc:
                    LOG.error("%s", exc)
                    api_cache[repo] = {}
            digest = api_cache[repo].get(file_path)
            if digest:
                pins[(model_id, file_path)] = digest
            else:
                LOG.warning(
                    "%s/%s: no LFS sha256 exposed by the API; placeholder kept",
                    model_id,
                    file_path,
                )
    return pins


def rewrite_catalog(pins: dict[tuple[str, str], str]) -> int:
    """Rewrite pinned digests in place, preserving formatting. Returns count."""
    lines = CATALOG_PATH.read_text(encoding="utf-8").splitlines(keepends=True)
    current_id: str | None = None
    pending: tuple[str, str] | None = None
    rotated = 0
    out: list[str] = []
    for line in lines:
        id_match = re.match(r'^\s{6}"id": "([^"]+)",?\s*$', line)
        if id_match:
            current_id = id_match.group(1)
        path_match = re.match(r'^\s+"path": "([^"]+)",?\s*$', line)
        if path_match and current_id is not None:
            pending = (current_id, path_match.group(1))
        elif pending is not None:
            sha_match = re.match(r'^(\s+"sha256": ")([a-f0-9]{64})(".*)$', line)
            if sha_match:
                new_digest = pins.get(pending)
                if new_digest and new_digest != sha_match.group(2):
                    line = f"{sha_match.group(1)}{new_digest}{sha_match.group(3)}\n"
                    rotated += 1
                    LOG.info("pinned %s/%s", pending[0], pending[1])
                pending = None
        out.append(line)
    CATALOG_PATH.write_text("".join(out), encoding="utf-8")
    json.loads(CATALOG_PATH.read_text(encoding="utf-8"))  # sanity: valid JSON
    return rotated


def check_placeholders(entries: list[tuple[str, str, list[str]]]) -> int:
    """Report weights files still carrying a placeholder pin."""
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    unpinned = 0
    for model in catalog.get("models", []):
        for file_entry in _weight_file_entries(model):
            if file_entry.get("sha256") == PLACEHOLDER_SHA256:
                unpinned += 1
                LOG.warning("unpinned: %s/%s", model["id"], file_entry["path"])
    total = sum(len(files) for _, _, files in entries)
    LOG.info("%d unpinned weights file(s) (%d in scope)", unpinned, total)
    return unpinned


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--from-dir",
        type=Path,
        default=None,
        help="models root with downloaded weights (default: use the HF API)",
    )
    parser.add_argument(
        "--model",
        action="append",
        default=[],
        help="restrict to this catalog id (repeatable)",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="only report remaining placeholders; exit 1 when any are left",
    )
    args = parser.parse_args(argv)

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    entries = load_hf_entries(catalog, set(args.model))
    if not entries:
        LOG.error("no matching huggingface entries in %s", CATALOG_PATH)
        return 2

    if args.check:
        return 1 if check_placeholders(entries) else 0

    pins = collect_pins(entries, args.from_dir)
    if not pins:
        LOG.error("no digests collected; catalog left unchanged")
        return 1
    rotated = rewrite_catalog(pins)
    LOG.info("rotated %d pin(s) in %s", rotated, CATALOG_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())

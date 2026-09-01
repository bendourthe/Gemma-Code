"""Fail a release build when a Hugging Face catalog file is dead or mis-gated."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

SELECTABLE_TYPES = {"llm", "embed", "image", "video", "audio", "document"}


def catalog_path() -> Path:
    return Path(__file__).resolve().parents[3] / "core" / "registry" / "catalog.json"


def hf_file_urls(entry: dict[str, Any]) -> list[str]:
    source = entry.get("source") or {}
    if source.get("protocol") != "huggingface":
        return []
    repo = str(source.get("repo") or "")
    revision = str(source.get("revision") or "main")
    weights = entry.get("weights") or {}
    files = list(weights.get("files") or [])
    for variant in weights.get("variants") or []:
        if isinstance(variant, dict):
            files.extend(variant.get("files") or [])
    urls: list[str] = []
    seen: set[str] = set()
    for item in files:
        if not isinstance(item, dict) or not item.get("path"):
            continue
        url = f"https://huggingface.co/{repo}/resolve/{revision}/{item['path']}"
        if url not in seen:
            seen.add(url)
            urls.append(url)
    return urls


def check_catalog(
    catalog: dict[str, Any],
    head: Callable[..., Any],
) -> list[str]:
    issues: list[str] = []
    for entry in catalog.get("models", []):
        if not isinstance(entry, dict):
            continue
        if entry.get("type") not in SELECTABLE_TYPES:
            continue
        model_id = str(entry.get("id") or "<missing-id>")
        urls = hf_file_urls(entry)
        if (entry.get("source") or {}).get("protocol") == "huggingface" and not urls:
            issues.append(f"{model_id}: no Hugging Face files declared")
            continue
        for url in urls:
            try:
                response = head(url, follow_redirects=True, timeout=20)
            except httpx.HTTPError as exc:
                issues.append(f"{model_id}: network error for {url}: {exc}")
                continue
            status = int(response.status_code)
            if status == 404:
                issues.append(f"{model_id}: dead file (404): {url}")
            elif status in {401, 403} and not entry.get("gated"):
                issues.append(
                    f"{model_id}: public entry requires authorization ({status}): {url}"
                )
            elif status >= 400 and not (entry.get("gated") and status in {401, 403}):
                issues.append(f"{model_id}: unexpected HTTP {status}: {url}")
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=Path, default=catalog_path())
    args = parser.parse_args(argv)
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    issues = check_catalog(catalog, httpx.head)
    if issues:
        for issue in issues:
            print(f"ERROR: {issue}", file=sys.stderr)
        return 1
    print("Hugging Face catalog preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

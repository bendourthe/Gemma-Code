"""v1.1.0 Phase 14.10 -- smoke tests for the fetch-payload helper script.

The script lives outside the package so we import it via importlib + path.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


def _load_module():
    if "fetch_payload" in sys.modules:
        return sys.modules["fetch_payload"]
    repo_root = Path(__file__).resolve().parents[3]
    script_path = repo_root / "scripts" / "installer" / "build" / "fetch-payload.py"
    spec = importlib.util.spec_from_file_location("fetch_payload", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["fetch_payload"] = module
    spec.loader.exec_module(module)
    return module


def test_platform_key_mapping() -> None:
    mod = _load_module()
    assert mod.platform_key("win", "x64") == "win-x64"
    assert mod.platform_key("mac", "arm64") == "mac-arm64"
    assert mod.platform_key("linux", "x64") == "linux-x64"


def test_unknown_os_raises() -> None:
    mod = _load_module()
    with pytest.raises(SystemExit):
        mod.platform_key("plan9", "x64")


def test_placeholder_detection() -> None:
    mod = _load_module()
    asset = mod.PinnedAsset(name="x", url="https://x", sha256="0" * 64)
    assert asset.is_placeholder is True
    real = mod.PinnedAsset(name="y", url="https://y", sha256="a" * 64)
    assert real.is_placeholder is False


def test_lockfile_present_and_parses() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    lockfile = repo_root / "scripts" / "installer" / "build" / "versions.lock.json"
    data = json.loads(lockfile.read_text(encoding="utf-8"))
    assert "platforms" in data
    assert "win-x64" in data["platforms"]
    assert "mac-arm64" in data["platforms"]
    assert "linux-x64" in data["platforms"]


def test_filename_for() -> None:
    mod = _load_module()
    assert mod.filename_for("https://example.com/a/b.tar.gz", "fallback") == "b.tar.gz"
    assert mod.filename_for("", "fallback") == "fallback"

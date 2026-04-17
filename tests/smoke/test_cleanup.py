"""Unit tests for the smoke-test cleanup helpers."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parent / "cleanup.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("smoke_cleanup", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def cleanup_mod():
    return _load_module()


def test_remove_missing_path_is_noop(cleanup_mod, tmp_path: Path) -> None:
    missing = tmp_path / "nope"
    messages = cleanup_mod.remove_install_path(str(missing))
    assert any("does not exist" in m for m in messages)


def test_remove_existing_path(cleanup_mod, tmp_path: Path) -> None:
    target = tmp_path / "install"
    (target / "sub").mkdir(parents=True)
    (target / "sub" / "file.txt").write_text("x", encoding="utf-8")
    messages = cleanup_mod.remove_install_path(str(target))
    assert any("removed" in m for m in messages)
    assert not target.exists()


def test_uninstall_extension_without_code(cleanup_mod, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(cleanup_mod.shutil, "which", lambda _n: None)
    messages = cleanup_mod.uninstall_extension()
    assert any("skipping" in m for m in messages)

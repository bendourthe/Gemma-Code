"""Smoke-test verifier unit tests (exercise the pure branches).

Only the pieces that can be driven without an actual VS Code / Ollama /
installed-venv environment are covered here. Live checks are exercised by
the per-platform scripts themselves.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parent / "verify-components.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("verify_components", MODULE_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["verify_components"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def verify_mod():
    return _load_module()


def test_missing_vscode_returns_failed_check(verify_mod, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(verify_mod.shutil, "which", lambda _name: None)
    check = verify_mod.check_vscode_extension()
    assert check.name == "vscode-extension"
    assert check.passed is False
    assert "code" in check.detail


def test_missing_python_venv(verify_mod, tmp_path: Path) -> None:
    check = verify_mod.check_venv(str(tmp_path))
    assert check.passed is False
    assert "no python" in check.detail


def test_run_returns_error_for_missing_binary(verify_mod) -> None:
    rc, out, err = verify_mod._run(["definitely-not-a-real-binary-xyz"])
    assert rc == -1
    assert "Error" in err or err  # any error text is acceptable


def test_main_emits_json_and_exits_cleanly(
    verify_mod, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # Make all checks return deterministic results by monkey-patching them.
    monkeypatch.setattr(
        verify_mod,
        "check_vscode_extension",
        lambda: verify_mod.Check("vscode-extension", True, "fake"),
    )
    monkeypatch.setattr(
        verify_mod,
        "check_ollama_reachable",
        lambda _url: verify_mod.Check("ollama-reachable", True, "fake"),
    )
    monkeypatch.setattr(
        verify_mod,
        "check_venv",
        lambda _path: verify_mod.Check("python-venv", True, "fake"),
    )
    argv = [
        "verify-components.py",
        "--install-path",
        str(tmp_path),
        "--skip-model",
        "--skip-backend",
    ]
    monkeypatch.setattr(sys, "argv", argv)
    rc = verify_mod.main()
    out = capsys.readouterr().out
    data = json.loads(out)
    assert rc == 0
    assert data["success"] is True
    # With --skip-backend the venv check (a removed-backend artifact) and the
    # backend-start check are both skipped, leaving the extension + ollama
    # checks.
    assert len(data["checks"]) == 2
    names = {c["name"] for c in data["checks"]}
    assert names == {"vscode-extension", "ollama-reachable"}


def test_main_skip_extension_omits_vscode_check(
    verify_mod, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        verify_mod,
        "check_ollama_reachable",
        lambda _url: verify_mod.Check("ollama-reachable", True, "fake"),
    )
    argv = [
        "verify-components.py",
        "--install-path",
        str(tmp_path),
        "--skip-model",
        "--skip-backend",
        "--skip-extension",
    ]
    monkeypatch.setattr(sys, "argv", argv)
    rc = verify_mod.main()
    data = json.loads(capsys.readouterr().out)
    assert rc == 0
    names = {c["name"] for c in data["checks"]}
    assert names == {"ollama-reachable"}

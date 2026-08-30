"""Release-gate tests for Hugging Face catalog file reachability."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock


def _module() -> ModuleType:
    path = Path(__file__).parents[1] / "build" / "check-hf-catalog.py"
    spec = importlib.util.spec_from_file_location("check_hf_catalog", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _catalog(*, gated: bool = False) -> dict:
    return {
        "models": [
            {
                "id": "image",
                "gated": gated,
                "source": {"protocol": "huggingface", "repo": "org/model"},
                "weights": {"files": [{"path": "model.safetensors"}]},
            }
        ]
    }


def test_public_file_200_passes() -> None:
    mod = _module()
    assert (
        mod.check_catalog(_catalog(), lambda *_a, **_k: MagicMock(status_code=200))
        == []
    )


def test_public_file_404_blocks_release() -> None:
    mod = _module()
    issues = mod.check_catalog(_catalog(), lambda *_a, **_k: MagicMock(status_code=404))
    assert any("dead file" in issue for issue in issues)


def test_public_file_cannot_silently_become_gated() -> None:
    mod = _module()
    issues = mod.check_catalog(_catalog(), lambda *_a, **_k: MagicMock(status_code=401))
    assert any("requires authorization" in issue for issue in issues)


def test_declared_gated_file_may_require_auth_but_not_be_missing() -> None:
    mod = _module()

    def head(*_args: object, **_kwargs: object) -> MagicMock:
        return MagicMock(status_code=401)

    assert mod.check_catalog(_catalog(gated=True), head) == []

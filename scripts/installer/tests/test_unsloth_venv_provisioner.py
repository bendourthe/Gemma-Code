"""Unsloth Core provisioner: opt-in, hardware gate, no AGPL extras."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from nexus_installer.engine.host_detect import HostProfile
from nexus_installer.engine.unsloth_venv_provisioner import (
    UnslothVenvProvisioner,
    argv_is_forbidden,
    load_pins,
    pip_args,
    training_supported,
)


def test_pins_match_core_json() -> None:
    pins = load_pins()
    names = [p["name"] for p in pins["provisioned"]]
    assert names == ["unsloth", "unsloth-zoo"]
    assert pins["provisioned"][0]["license"] == "Apache-2.0"
    assert pins["provisioned"][1]["license"] == "LGPL-3.0-or-later"
    assert "unsloth==2026.8.18" in pip_args(pins)
    assert argv_is_forbidden(["uv", "pip", "install", "unsloth[studio]"], pins)


def test_frozen_pins_resolve_from_bundle(tmp_path: Path, monkeypatch: object) -> None:
    import json
    import sys

    from nexus_installer.engine import unsloth_venv_provisioner as module

    target = tmp_path / "core" / "tuning" / "unsloth-pins.json"
    target.parent.mkdir(parents=True)
    target.write_text(
        json.dumps(
            {
                "provisioned": [
                    {"name": "unsloth", "version": "1", "license": "Apache-2.0"}
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert module.load_pins()["provisioned"][0]["name"] == "unsloth"


def test_missing_pins_has_actionable_error(tmp_path: Path, monkeypatch: object) -> None:
    import pytest

    from nexus_installer.engine import unsloth_venv_provisioner as module

    monkeypatch.setattr(module, "tuning_file", lambda _name: tmp_path / "missing")
    with pytest.raises(ValueError, match="missing from the installer"):
        module.load_pins()


def test_hardware_gate() -> None:
    nvidia = HostProfile(os_family="windows", gpu_vendor="nvidia", total_vram_gb=16)
    assert training_supported(nvidia)[0] is True
    amd_win = HostProfile(os_family="windows", gpu_vendor="amd", total_vram_gb=24)
    assert training_supported(amd_win)[0] is False
    intel = HostProfile(os_family="linux", gpu_vendor="intel", total_vram_gb=24)
    assert training_supported(intel)[0] is False


def test_opt_in_off_is_success(tmp_path: Path) -> None:
    p = UnslothVenvProvisioner(root=tmp_path, opt_in=False)
    logs: list[str] = []
    assert (
        p.install(
            HostProfile(gpu_vendor="nvidia", total_vram_gb=24),
            lambda *_a: logs.append("x"),
        )
        is True
    )
    assert p.state()["status"] == "pending"


def test_install_records_pip_args_without_studio(tmp_path: Path) -> None:
    seen: list[list[str]] = []

    def runner(argv: list[str]):
        seen.append(argv)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")

    p = UnslothVenvProvisioner(root=tmp_path, opt_in=True, runner=runner)
    ok = p.install(
        HostProfile(os_family="linux", gpu_vendor="nvidia", total_vram_gb=24),
        lambda *_a: None,
    )
    assert ok is True
    pip = next(a for a in seen if "unsloth==2026.8.18" in a)
    assert not argv_is_forbidden(pip)
    assert p.state()["status"] == "ready"


def test_failed_install_is_resumable(tmp_path: Path) -> None:
    def runner(argv: list[str]):
        return SimpleNamespace(returncode=1, stdout="", stderr="network down")

    p = UnslothVenvProvisioner(root=tmp_path, opt_in=True, runner=runner)
    ok = p.install(
        HostProfile(os_family="linux", gpu_vendor="nvidia", total_vram_gb=24),
        lambda *_a: None,
    )
    assert ok is False
    assert p.state()["status"] == "failed"
    assert "network" in p.state()["error"]


def test_preflight_missing_venv(tmp_path: Path) -> None:
    p = UnslothVenvProvisioner(root=tmp_path, opt_in=True)
    ok, msg = p.preflight()
    assert ok is False
    assert "missing" in msg

"""Tests for the Node 22 provisioner (Phase 9.4)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from nexus_installer.engine import node_provisioner
from nexus_installer.engine.node_provisioner import (
    NodeProvisioner,
    add_to_user_path_windows,
    node_executable,
    ollama_service_running_windows,
    offline_ollama_installer_path,
    run_bundled_ollama_setup,
    runtime_root,
)


def _logs() -> tuple[list[tuple[str, str]], "callable"]:
    log: list[tuple[str, str]] = []

    def fn(msg: str, level: str) -> None:
        log.append((level, msg))

    return log, fn


class TestRuntimeRoot:
    def test_returns_a_per_user_directory(self) -> None:
        path = runtime_root()
        assert "Nexus" in str(path) or "nexus" in str(path)


class TestNodeExecutable:
    def test_uses_node_exe_on_windows(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(node_provisioner, "is_windows", lambda: True)
        path = node_executable(Path("/runtime"))
        assert path.name == "node.exe"

    def test_uses_bin_node_on_posix(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(node_provisioner, "is_windows", lambda: False)
        path = node_executable(Path("/runtime"))
        assert str(path).endswith("bin/node") or str(path).endswith("bin\\node")


class TestNodeProvisionerInstall:
    def test_install_with_no_payload_logs_warning(self, tmp_path: Path) -> None:
        provisioner = NodeProvisioner(tmp_path)
        log, fn = _logs()
        assert provisioner.payload_exists() is False
        assert provisioner.install(fn) is False
        assert any(level == "warn" for level, _ in log)

    def test_install_copies_payload(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = tmp_path / "payload"
        node_src = payload / "node"
        node_src.mkdir(parents=True)
        (node_src / "node.exe").write_bytes(b"\x00")
        target = tmp_path / "runtime"
        monkeypatch.setattr(node_provisioner, "runtime_root", lambda: target)
        provisioner = NodeProvisioner(payload)
        _, fn = _logs()
        assert provisioner.install(fn) is True
        assert (target / "node.exe").exists()

    def test_install_replaces_existing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = tmp_path / "payload"
        (payload / "node").mkdir(parents=True)
        (payload / "node" / "node.exe").write_bytes(b"new")
        target = tmp_path / "runtime"
        target.mkdir()
        (target / "stale.exe").write_bytes(b"stale")
        monkeypatch.setattr(node_provisioner, "runtime_root", lambda: target)
        provisioner = NodeProvisioner(payload)
        _, fn = _logs()
        assert provisioner.install(fn) is True
        assert not (target / "stale.exe").exists()
        assert (target / "node.exe").exists()


class TestVerify:
    def test_returns_false_when_node_executable_missing(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(node_provisioner, "runtime_root", lambda: tmp_path)
        provisioner = NodeProvisioner(tmp_path / "payload")
        _, fn = _logs()
        assert provisioner.verify(fn) is False


class TestPathRegistration:
    def test_non_windows_short_circuits_to_true(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(node_provisioner, "is_windows", lambda: False)
        _, fn = _logs()
        assert add_to_user_path_windows(tmp_path, fn) is True


class TestOllamaHelpers:
    def test_offline_installer_path(self, tmp_path: Path) -> None:
        path = offline_ollama_installer_path(tmp_path)
        assert path.name == "OllamaSetup.exe"
        assert path.parent.name == "ollama"

    def test_service_check_non_windows_returns_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(node_provisioner, "is_windows", lambda: False)
        assert ollama_service_running_windows() is False

    def test_run_bundled_setup_skips_off_windows(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(node_provisioner, "is_windows", lambda: False)
        _, fn = _logs()
        assert run_bundled_ollama_setup(tmp_path, fn) is False

    def test_run_bundled_setup_missing_payload(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(node_provisioner, "is_windows", lambda: True)
        log, fn = _logs()
        assert run_bundled_ollama_setup(tmp_path, fn) is False
        assert any(level == "error" for level, _ in log)

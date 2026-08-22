"""v2.2.0 Phase 1 (1.3) -- runtime wiring provisioner tests.

Covers the ~/.nexus/runtime.json contract writer, Node provisioning reuse
semantics, the diffusion runtime source copy, and the step's fail/success
routing. Network downloads are never exercised here (the download leg is
covered by checksum/URL pinning and the packaged-build smoke).
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from nexus_installer.engine import runtime_provisioner as rp
from nexus_installer.installer_state import InstallerState


@pytest.fixture()
def log() -> MagicMock:
    return MagicMock()


class TestRuntimeConfigWrite:
    def test_writes_atomic_json_with_expected_fields(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))
        node = tmp_path / "node.exe"
        node.write_bytes(b"stub")
        state = InstallerState()
        ok = rp.write_runtime_config(
            state,
            log,
            node_path=node,
            diffusion_cwd=tmp_path / "runtimes-root",
            app_version="9.9.9",
        )
        assert ok is True
        target = tmp_path / ".nexus" / "runtime.json"
        data = json.loads(target.read_text(encoding="utf-8"))
        assert data["schemaVersion"] == rp.RUNTIME_CONFIG_SCHEMA_VERSION
        assert data["nodePath"] == str(node)
        assert data["diffusionCwd"] == str(tmp_path / "runtimes-root")
        assert data["modelsRoot"].endswith("models")
        assert "9.9.9" in data["writtenBy"]
        # No temp file left behind.
        leftovers = list((tmp_path / ".nexus").glob("*.tmp"))
        assert leftovers == []

    def test_missing_diffusion_venv_records_null_not_crash(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))
        state = InstallerState()
        ok = rp.write_runtime_config(state, log, node_path=None, diffusion_cwd=None)
        assert ok is True
        data = json.loads(
            (tmp_path / ".nexus" / "runtime.json").read_text(encoding="utf-8")
        )
        assert data["nodePath"] is None
        assert data["diffusionPython"] is None
        assert data["diffusionCwd"] is None


class TestProvisionNode:
    def test_reuses_existing_provisioned_node(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        root = tmp_path / "runtime" / "node"
        root.mkdir(parents=True)
        exe = rp.node_executable(root)
        exe.parent.mkdir(parents=True, exist_ok=True)
        exe.write_bytes(b"stub")
        monkeypatch.setattr(rp, "runtime_root", lambda: root)
        result = rp.provision_node(None, log)
        assert result == exe

    def test_unknown_arch_without_payload_returns_none(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        root = tmp_path / "runtime" / "node"
        monkeypatch.setattr(rp, "runtime_root", lambda: root)
        monkeypatch.setattr(rp, "_node_download_key", lambda: None)
        assert rp.provision_node(None, log) is None


class TestProvisionRuntimesSources:
    def test_copies_repo_runtimes_tree(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        source_root = tmp_path / "repo" / "runtimes"
        (source_root / "diffusion").mkdir(parents=True)
        (source_root / "diffusion" / "main.py").write_text("print('hi')\n")
        (source_root / "diffusion" / "__pycache__").mkdir()
        (source_root / "diffusion" / "__pycache__" / "junk.pyc").write_bytes(b"x")
        dest_root = tmp_path / "installed"
        monkeypatch.setattr(rp, "_bundled_runtimes_source", lambda: source_root)
        monkeypatch.setattr(rp, "runtimes_sources_root", lambda: dest_root)
        result = rp.provision_runtimes_sources(log)
        assert result == dest_root
        assert (dest_root / "runtimes" / "diffusion" / "main.py").is_file()
        assert not (dest_root / "runtimes" / "diffusion" / "__pycache__").exists()

    def test_missing_bundle_is_warned_noop(
        self, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        monkeypatch.setattr(rp, "_bundled_runtimes_source", lambda: None)
        assert rp.provision_runtimes_sources(log) is None


class TestRuntimeProvisionerStep:
    def test_fails_only_when_node_unavailable(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))
        monkeypatch.setattr(rp, "provision_node", lambda payload, log: None)
        monkeypatch.setattr(rp, "provision_runtimes_sources", lambda log: None)
        assert rp.RuntimeProvisioner().install(InstallerState(), log) is False

    def test_succeeds_with_node_even_without_diffusion(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))
        node = tmp_path / "node.exe"
        node.write_bytes(b"stub")
        monkeypatch.setattr(rp, "provision_node", lambda payload, log: node)
        monkeypatch.setattr(rp, "provision_runtimes_sources", lambda log: None)
        assert rp.RuntimeProvisioner().install(InstallerState(), log) is True
        data = json.loads(
            (tmp_path / ".nexus" / "runtime.json").read_text(encoding="utf-8")
        )
        assert data["nodePath"] == str(node)


class TestNodePins:
    def test_download_pins_are_real_hashes(self) -> None:
        for key, pin in rp.NODE_DOWNLOADS.items():
            assert pin["url"].startswith("https://nodejs.org/dist/"), key
            assert len(pin["sha256"]) == 64, key
            assert pin["sha256"] != "0" * 64, f"{key} still has a placeholder pin"

    def test_lock_file_node_pins_match_module_pins(self) -> None:
        lock_path = Path(__file__).resolve().parents[1] / "build" / "versions.lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        mapping = {
            "win-x64": "win-x64",
            "mac-arm64": "darwin-arm64",
            "linux-x64": "linux-x64",
        }
        for lock_key, module_key in mapping.items():
            node = lock["platforms"][lock_key]["node"]
            assert node["url"] == rp.NODE_DOWNLOADS[module_key]["url"]
            assert node["sha256"] == rp.NODE_DOWNLOADS[module_key]["sha256"]

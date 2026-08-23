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


class TestModelIdMarker:
    """v2.2.0 Phase 2 (2.1) -- the `.nexus-model-id` marker.

    The installer writes weights to `safe_dir_name(id)`, so an id containing
    ":" or "/" cannot be recovered from the directory path. The marker carries
    the true id, and the app's probe prefers it.
    """

    def test_marker_records_the_true_catalog_id(self, tmp_path, log) -> None:
        from nexus_installer.engine.hf_weights_puller import (
            MODEL_ID_MARKER,
            safe_dir_name,
            write_model_id_marker,
        )

        model_id = "sam2:hiera-tiny"
        model_dir = tmp_path / safe_dir_name(model_id)
        model_dir.mkdir()
        assert write_model_id_marker(model_dir, model_id, log) is True
        written = (model_dir / MODEL_ID_MARKER).read_text(encoding="utf-8").strip()
        assert written == model_id
        # The directory name is NOT the id -- which is the whole point.
        assert model_dir.name != model_id

    def test_marker_failure_is_non_fatal(self, tmp_path, log) -> None:
        from nexus_installer.engine.hf_weights_puller import write_model_id_marker

        missing = tmp_path / "does-not-exist"
        assert write_model_id_marker(missing, "some-model", log) is False
        assert log.called

    def test_sanitization_matches_the_typescript_probe(self) -> None:
        # Mirror of `safeDirName` in core/registry/installedProbe.ts.
        from nexus_installer.engine.hf_weights_puller import safe_dir_name

        assert safe_dir_name("sam2:hiera-tiny") == "sam2-hiera-tiny"
        assert safe_dir_name("qwen2.5-coder:14b") == "qwen2.5-coder-14b"
        assert safe_dir_name("org/model") == "org-model"
        assert safe_dir_name("sana-1.6b-2k") == "sana-1.6b-2k"


class TestSelectionSnapshotWrite:
    def test_writes_ordered_ids_matching_the_sidecar_schema(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, log: MagicMock
    ) -> None:
        monkeypatch.setattr(Path, "home", staticmethod(lambda: tmp_path))
        monkeypatch.setattr(
            rp,
            "_recommended_by_task",
            lambda _ids: {"chat": "lfm2.5:1.2b", "image": "sana-1.5-1.6b"},
        )
        state = InstallerState()
        state.selected_model_ids = ["lfm2.5:1.2b", "sana-1.5-1.6b"]
        assert rp.write_selection_snapshot(state, log) is True
        target = tmp_path / ".nexus" / "selected-models.json"
        data = json.loads(target.read_text(encoding="utf-8"))
        assert data["schemaVersion"] == 1
        assert data["orderedIds"] == ["lfm2.5:1.2b", "sana-1.5-1.6b"]
        assert data["recommendedByTask"]["chat"] == "lfm2.5:1.2b"
        assert data["downloadedSinceInstall"] == []

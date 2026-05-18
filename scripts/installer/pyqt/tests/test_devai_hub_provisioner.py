"""Tests for the DevAI-Hub baseline provisioner (Phase 9.6)."""

from __future__ import annotations

import json
import tarfile
from pathlib import Path

import pytest

from nexus_installer.engine.devai_hub_provisioner import (
    DevAIBaselineManifest,
    DevAIHubProvisioner,
    sha256_file,
)


def _write_manifest(path: Path, target_dir: Path, content_hash: str) -> None:
    payload = {
        "source": {
            "repo": "https://github.com/bendourthe/DevAI-Hub.git",
            "tag": "v1.0.0-test",
            "sha": "0000000000000000000000000000000000000000",
        },
        "artifact": {
            "filename": "devai-hub-baseline.tar.gz",
            "contentHash": content_hash,
        },
        "install": {
            "targetDir": str(target_dir),
            "namespace": "devai-hub",
            "registerWithSkillCatalog": True,
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def _build_tarball(path: Path) -> None:
    tmp_root = path.parent / "tar-build"
    tmp_root.mkdir(parents=True, exist_ok=True)
    (tmp_root / "catalog").mkdir()
    (tmp_root / "catalog" / "skills.json").write_text("[]", encoding="utf-8")
    (tmp_root / "rules.md").write_text("# rules", encoding="utf-8")
    with tarfile.open(path, "w:gz") as tf:
        tf.add(tmp_root / "catalog", arcname="catalog")
        tf.add(tmp_root / "rules.md", arcname="rules.md")


def _logs() -> tuple[list[tuple[str, str]], "callable"]:
    log: list[tuple[str, str]] = []

    def fn(msg: str, level: str) -> None:
        log.append((level, msg))

    return log, fn


class TestManifestParsing:
    def test_loads_required_fields(self, tmp_path: Path) -> None:
        target = tmp_path / "skills" / "devai-hub" / "v1.0.0-test"
        manifest_path = tmp_path / "manifest.json"
        _write_manifest(manifest_path, target, content_hash="sha256:" + "0" * 64)
        manifest = DevAIBaselineManifest.from_json(manifest_path)
        assert manifest.tag == "v1.0.0-test"
        assert manifest.namespace == "devai-hub"
        assert manifest.register_with_catalog is True


class TestProvisionerExtract:
    def test_install_with_no_tarball_warns(self, tmp_path: Path) -> None:
        target = tmp_path / "skills" / "devai-hub" / "v1.0.0-test"
        manifest_path = tmp_path / "manifest.json"
        _write_manifest(manifest_path, target, content_hash="sha256:" + "0" * 64)
        provisioner = DevAIHubProvisioner(tmp_path, manifest_path)
        log, fn = _logs()
        assert provisioner.install(fn) is False
        assert any(level == "warn" for level, _ in log)

    def test_install_extracts_and_logs(self, tmp_path: Path) -> None:
        target = tmp_path / "skills" / "devai-hub" / "v1.0.0-test"
        manifest_path = tmp_path / "manifest.json"
        _write_manifest(manifest_path, target, content_hash="sha256:" + "0" * 64)

        payload = tmp_path / "payload"
        payload.mkdir()
        tarball = payload / "devai-hub-baseline.tar.gz"
        _build_tarball(tarball)

        provisioner = DevAIHubProvisioner(payload, manifest_path)
        log, fn = _logs()
        assert provisioner.install(fn) is True
        assert (target / "catalog" / "skills.json").exists()
        assert (target / "rules.md").exists()
        assert any(level == "success" for level, _ in log)

    def test_install_replaces_existing_directory(self, tmp_path: Path) -> None:
        target = tmp_path / "skills" / "devai-hub" / "v1.0.0-test"
        target.mkdir(parents=True)
        (target / "stale.txt").write_text("stale", encoding="utf-8")
        manifest_path = tmp_path / "manifest.json"
        _write_manifest(manifest_path, target, content_hash="sha256:" + "0" * 64)
        payload = tmp_path / "payload"
        payload.mkdir()
        _build_tarball(payload / "devai-hub-baseline.tar.gz")
        provisioner = DevAIHubProvisioner(payload, manifest_path)
        _, fn = _logs()
        assert provisioner.install(fn) is True
        assert not (target / "stale.txt").exists()
        assert (target / "rules.md").exists()


class TestContentHashGuard:
    def test_hash_mismatch_fails(self, tmp_path: Path) -> None:
        target = tmp_path / "skills" / "devai-hub" / "v1.0.0-test"
        manifest_path = tmp_path / "manifest.json"
        wrong_hash = "sha256:" + "a" * 64
        _write_manifest(manifest_path, target, content_hash=wrong_hash)
        payload = tmp_path / "payload"
        payload.mkdir()
        _build_tarball(payload / "devai-hub-baseline.tar.gz")
        provisioner = DevAIHubProvisioner(payload, manifest_path)
        log, fn = _logs()
        assert provisioner.install(fn) is False
        assert any(level == "error" for level, _ in log)

    def test_correct_hash_succeeds(self, tmp_path: Path) -> None:
        target = tmp_path / "skills" / "devai-hub" / "v1.0.0-test"
        payload = tmp_path / "payload"
        payload.mkdir()
        tarball = payload / "devai-hub-baseline.tar.gz"
        _build_tarball(tarball)
        actual_hash = sha256_file(tarball)
        manifest_path = tmp_path / "manifest.json"
        _write_manifest(manifest_path, target, content_hash=actual_hash)
        provisioner = DevAIHubProvisioner(payload, manifest_path)
        _, fn = _logs()
        assert provisioner.install(fn) is True


class TestPathTraversalGuard:
    def test_refuses_tarball_with_escaping_member(self, tmp_path: Path) -> None:
        target = tmp_path / "skills" / "devai-hub" / "v1.0.0-test"
        payload = tmp_path / "payload"
        payload.mkdir()
        manifest_path = tmp_path / "manifest.json"
        _write_manifest(manifest_path, target, content_hash="sha256:" + "0" * 64)

        evil = payload / "devai-hub-baseline.tar.gz"
        with tarfile.open(evil, "w:gz") as tf:
            tmp_file = tmp_path / "evil.txt"
            tmp_file.write_text("nope", encoding="utf-8")
            info = tarfile.TarInfo(name="../escape.txt")
            data = tmp_file.read_bytes()
            info.size = len(data)
            import io

            tf.addfile(info, io.BytesIO(data))

        provisioner = DevAIHubProvisioner(payload, manifest_path)
        log, fn = _logs()
        assert provisioner.install(fn) is False
        assert any(level == "error" for level, _ in log)

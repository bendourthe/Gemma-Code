"""v2.2.0 Phase 3 (3.1) -- Nexus-Hub catalog provisioning tests.

The step is offline-first: extract the bundled checksummed snapshot when the
catalog is absent, then refresh from upstream when the network allows. Before
it existed the harness only arrived if the sidecar's best-effort first-launch
fetch happened to succeed, so an offline install shipped an app with zero
skills and a Skills page that blamed the user for not syncing.

The sidecar CLI is stubbed throughout: no real git, network, or Node here.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.engine import hub_catalog_provisioner as hcp
from nexus_installer.installer_state import InstallerState

_MOD = "nexus_installer.engine.hub_catalog_provisioner"


@pytest.fixture()
def log() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def fake_binaries(tmp_path: Path):
    """Give the provisioner a resolvable Node + CLI so it reaches the CLI calls."""
    node = tmp_path / "node.exe"
    node.write_bytes(b"stub")
    cli = tmp_path / "hub-catalog.js"
    cli.write_text("// stub", encoding="utf-8")
    with (
        patch(f"{_MOD}._node_path", return_value=node),
        patch(f"{_MOD}._cli_path", return_value=cli),
    ):
        yield node, cli


def _events(*payloads: dict):
    """Sequence the stubbed `_run_cli` returns, one per call."""
    it = iter(payloads)

    def _run(node, cli, args, log):  # noqa: ANN001 - test stub
        return next(it)

    return _run


class TestMissingPrerequisites:
    def test_no_node_is_a_soft_skip(self, log: MagicMock) -> None:
        with (
            patch(f"{_MOD}._node_path", return_value=None),
            patch(f"{_MOD}._cli_path", return_value=Path("x")),
        ):
            outcome = hcp.provision_hub_catalog(InstallerState(), log)
        assert outcome.ok is False
        assert "Node" in outcome.message

    def test_no_cli_bundle_is_a_soft_skip(self, tmp_path: Path, log: MagicMock) -> None:
        node = tmp_path / "node.exe"
        node.write_bytes(b"stub")
        with (
            patch(f"{_MOD}._node_path", return_value=node),
            patch(f"{_MOD}._cli_path", return_value=None),
        ):
            outcome = hcp.provision_hub_catalog(InstallerState(), log)
        assert outcome.ok is False


class TestProvisionFlow:
    def test_already_installed_then_synced(self, fake_binaries, log: MagicMock) -> None:
        run = _events(
            {"kind": "done", "source": "installed", "tag": "v3.12.0"},
            {"kind": "done", "tag": "v3.13.0", "applied": True},
        )
        with patch(f"{_MOD}._run_cli", side_effect=run):
            outcome = hcp.provision_hub_catalog(InstallerState(), log)
        assert outcome.ok is True
        assert outcome.source == "upstream"
        assert outcome.tag == "v3.13.0"

    def test_absent_catalog_extracts_the_bundled_snapshot(
        self, fake_binaries, tmp_path: Path, log: MagicMock
    ) -> None:
        snapshot = tmp_path / "hub-snapshot"
        snapshot.mkdir()
        (snapshot / "catalog.tar.gz").write_bytes(b"archive")
        (snapshot / "manifest.json").write_text(
            json.dumps({"sha256": "b" * 64, "tag": "v3.12.0"}), encoding="utf-8"
        )
        run = _events(
            {"kind": "done", "source": "absent", "tag": None},
            {"kind": "done", "source": "snapshot", "tag": "v3.12.0"},
            {"kind": "done", "tag": "v3.12.0", "applied": True},
        )
        with (
            patch(f"{_MOD}.payload_snapshot_dir", return_value=snapshot),
            patch(f"{_MOD}._run_cli", side_effect=run),
        ):
            outcome = hcp.provision_hub_catalog(InstallerState(), log)
        assert outcome.ok is True

    def test_offline_after_snapshot_still_succeeds(
        self, fake_binaries, tmp_path: Path, log: MagicMock
    ) -> None:
        """A network failure must not undo a working bundled harness."""
        snapshot = tmp_path / "hub-snapshot"
        snapshot.mkdir()
        (snapshot / "catalog.tar.gz").write_bytes(b"archive")
        (snapshot / "manifest.json").write_text(
            json.dumps({"sha256": "c" * 64}), encoding="utf-8"
        )
        run = _events(
            {"kind": "done", "source": "absent", "tag": None},
            {"kind": "done", "source": "snapshot", "tag": "v3.12.0"},
            {"kind": "error", "failureClass": "network", "message": "ENOTFOUND"},
        )
        with (
            patch(f"{_MOD}.payload_snapshot_dir", return_value=snapshot),
            patch(f"{_MOD}._run_cli", side_effect=run),
        ):
            outcome = hcp.provision_hub_catalog(InstallerState(), log)
        assert outcome.ok is True
        assert outcome.source == "snapshot"
        assert outcome.failure_class == "network"

    def test_no_snapshot_and_no_network_fails_retryable(
        self, fake_binaries, log: MagicMock
    ) -> None:
        run = _events(
            {"kind": "done", "source": "absent", "tag": None},
            {"kind": "error", "failureClass": "network", "message": "ENOTFOUND"},
        )
        with (
            patch(f"{_MOD}.payload_snapshot_dir", return_value=None),
            patch(f"{_MOD}._run_cli", side_effect=run),
        ):
            outcome = hcp.provision_hub_catalog(InstallerState(), log)
        assert outcome.ok is False
        assert outcome.failure_class == "network"
        assert outcome.retryable is True

    def test_offline_mode_skips_the_sync_entirely(
        self, fake_binaries, tmp_path: Path, log: MagicMock
    ) -> None:
        snapshot = tmp_path / "hub-snapshot"
        snapshot.mkdir()
        (snapshot / "catalog.tar.gz").write_bytes(b"archive")
        (snapshot / "manifest.json").write_text(
            json.dumps({"sha256": "d" * 64}), encoding="utf-8"
        )
        calls: list[list[str]] = []

        def _run(node, cli, args, log_fn):  # noqa: ANN001 - test stub
            calls.append(args)
            if "--hub-catalog-status" in args:
                return {"kind": "done", "source": "absent", "tag": None}
            return {"kind": "done", "source": "snapshot", "tag": "v3.12.0"}

        with (
            patch(f"{_MOD}.payload_snapshot_dir", return_value=snapshot),
            patch(f"{_MOD}._run_cli", side_effect=_run),
        ):
            outcome = hcp.provision_hub_catalog(
                InstallerState(), log, allow_network=False
            )
        assert outcome.ok is True
        assert not any("--sync-hub-catalog" in a for a in calls)

    def test_snapshot_with_placeholder_digest_is_not_extracted(
        self, fake_binaries, tmp_path: Path, log: MagicMock
    ) -> None:
        """A manifest with no usable digest must not be trusted."""
        snapshot = tmp_path / "hub-snapshot"
        snapshot.mkdir()
        (snapshot / "catalog.tar.gz").write_bytes(b"archive")
        (snapshot / "manifest.json").write_text(json.dumps({}), encoding="utf-8")
        calls: list[list[str]] = []

        def _run(node, cli, args, log_fn):  # noqa: ANN001 - test stub
            calls.append(args)
            if "--hub-catalog-status" in args:
                return {"kind": "done", "source": "absent", "tag": None}
            return {"kind": "error", "failureClass": "network", "message": "offline"}

        with (
            patch(f"{_MOD}.payload_snapshot_dir", return_value=snapshot),
            patch(f"{_MOD}._run_cli", side_effect=_run),
        ):
            hcp.provision_hub_catalog(InstallerState(), log)
        assert not any("--extract-hub-snapshot" in a for a in calls)


class TestStepWrapper:
    def test_records_outcome_on_state(self, fake_binaries, log: MagicMock) -> None:
        run = _events(
            {"kind": "done", "source": "installed", "tag": "v3.12.0"},
            {"kind": "done", "tag": "v3.13.0", "applied": True},
        )
        state = InstallerState()
        with patch(f"{_MOD}._run_cli", side_effect=run):
            assert hcp.HubCatalogProvisioner().install(state, log) is True
        assert state.hub_catalog_source == "upstream"
        assert state.hub_catalog_tag == "v3.13.0"

    def test_every_failure_class_has_a_remedy(self) -> None:
        for cls in (
            "network",
            "git-unavailable",
            "scan-quarantine",
            "checksum",
            "archive",
            "unknown",
        ):
            assert len(hcp.FAILURE_REMEDIES[cls]) > 20


class TestSnapshotBuilder:
    def test_builder_refuses_a_catalog_without_skills(self, tmp_path: Path) -> None:
        import importlib.util

        builder_path = (
            Path(__file__).resolve().parents[1] / "build" / "build-hub-snapshot.py"
        )
        spec = importlib.util.spec_from_file_location(
            "build_hub_snapshot", builder_path
        )
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        empty = tmp_path / "catalog"
        empty.mkdir()
        assert module.build_snapshot(empty, tmp_path / "out") == 1

    def test_builder_emits_a_real_digest(self, tmp_path: Path) -> None:
        import importlib.util

        builder_path = (
            Path(__file__).resolve().parents[1] / "build" / "build-hub-snapshot.py"
        )
        spec = importlib.util.spec_from_file_location(
            "build_hub_snapshot", builder_path
        )
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        catalog = tmp_path / "catalog"
        (catalog / "skills" / "demo").mkdir(parents=True)
        (catalog / "skills" / "demo" / "SKILL.md").write_text("---\nname: Demo\n---\n")
        (catalog / "commands").mkdir()
        (catalog / "commands" / "plan.md").write_text("body")
        (catalog / "nexus-hub-version.json").write_text(
            json.dumps({"version": "v3.12.0"})
        )

        out = tmp_path / "out"
        assert module.build_snapshot(catalog, out) == 0
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        assert len(manifest["sha256"]) == 64
        assert manifest["sha256"] != "0" * 64
        assert manifest["tag"] == "v3.12.0"
        assert (out / "catalog.tar.gz").is_file()


class TestSnapshotRoundTrip:
    """End-to-end: the real builder's archive must be readable by the real
    sidecar extractor. Both sides are implementations under test, so a format
    mismatch (the risk in a hand-rolled tar reader) cannot hide behind mocks.

    Skipped when the sidecar bundle has not been built, so a fresh checkout
    that has not run `npm run build:sidecar` still passes.
    """

    def _build_snapshot(self, tmp_path: Path) -> tuple[Path, str]:
        import importlib.util

        builder_path = (
            Path(__file__).resolve().parents[1] / "build" / "build-hub-snapshot.py"
        )
        spec = importlib.util.spec_from_file_location(
            "build_hub_snapshot", builder_path
        )
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        catalog = tmp_path / "source-catalog"
        (catalog / "skills" / "code-quality").mkdir(parents=True)
        (catalog / "skills" / "code-quality" / "SKILL.md").write_text(
            "---\nname: Code Quality\n---\nbody\n", encoding="utf-8"
        )
        (catalog / "commands").mkdir()
        (catalog / "commands" / "plan.md").write_text(
            "---\ndescription: Plan it.\n---\nbody\n", encoding="utf-8"
        )
        (catalog / "nexus-hub-version.json").write_text(
            json.dumps({"version": "v3.12.0"}), encoding="utf-8"
        )
        out = tmp_path / "snapshot"
        assert module.build_snapshot(catalog, out) == 0
        digest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))[
            "sha256"
        ]
        return out / "catalog.tar.gz", digest

    def test_builder_output_extracts_through_the_sidecar_cli(
        self, tmp_path: Path
    ) -> None:
        import shutil
        import subprocess

        cli = (
            Path(__file__).resolve().parents[3]
            / "desktop"
            / "sidecar"
            / "dist"
            / "hub-catalog.js"
        )
        if not cli.is_file():
            pytest.skip("sidecar bundle not built (npm run build:sidecar)")
        node = shutil.which("node")
        if node is None:
            pytest.skip("node not on PATH")

        archive, digest = self._build_snapshot(tmp_path)
        target = tmp_path / "installed" / "catalog"
        target.parent.mkdir(parents=True, exist_ok=True)

        # `--catalog-dir` is MANDATORY here: without it the CLI targets the
        # real ~/.nexus-ai/catalog and this test would destroy the developer's
        # installed harness (it did, once, before the flag existed).
        proc = subprocess.run(
            [
                node,
                str(cli),
                "--extract-hub-snapshot",
                str(archive),
                "--sha256",
                digest,
                "--catalog-dir",
                str(target),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
            env={**os.environ, "NEXUS_HUB_CATALOG_DIR": str(target)},
        )
        assert proc.returncode == 0, str(proc.stdout) + str(proc.stderr)
        # The builder's archive is readable by the reader, and the content
        # survives the round trip.
        assert (target / "skills" / "code-quality" / "SKILL.md").is_file()
        assert (target / "commands" / "plan.md").is_file()
        assert (
            json.loads((target / "nexus-hub-version.json").read_text(encoding="utf-8"))[
                "version"
            ]
            == "v3.12.0"
        )
        # And it never wrote outside the target.
        assert not (Path.home() / ".nexus-ai" / "catalog" / "code-quality").exists()

    def test_archive_contains_no_symlinks_or_long_names(self, tmp_path: Path) -> None:
        """Pin the format constraint the minimal tar reader relies on (DF-8)."""
        import tarfile

        archive, _ = self._build_snapshot(tmp_path)
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                assert not member.issym(), f"symlink in snapshot: {member.name}"
                assert not member.islnk(), f"hard link in snapshot: {member.name}"
                # ustar name+prefix fields cap at 100/155 bytes.
                assert len(member.name.encode("utf-8")) <= 255, member.name

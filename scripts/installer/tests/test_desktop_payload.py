"""v2.4.6 Phase 1 -- desktop payload staging, freshness, and identity."""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.engine.desktop_payload import (
    StageError,
    format_payload_label,
    original_name_matches_version,
    stage_desktop_payload,
    write_desktop_payload_identity,
)
from nexus_installer.engine.desktop_payload import (
    main as stage_main,
)
from nexus_installer.engine.desktop_provisioner import DesktopProvisioner
from nexus_installer.installer_state import InstallerState
from nexus_installer.main import present_installer_window

_MOD = "nexus_installer.engine.desktop_provisioner"


def _nsis_name(version: str = "2.4.1") -> str:
    return f"Nexus AI Studio_{version}_x64-setup.exe"


def _touch_bundle(path: Path, content: bytes = b"bundle-bytes") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


class TestOriginalNameVersion:
    def test_tauri_nsis_name_matches(self) -> None:
        assert original_name_matches_version(_nsis_name("2.4.1"), "2.4.1")

    def test_release_artifact_name_matches(self) -> None:
        assert original_name_matches_version(
            "Nexus-Desktop_2.4.1_x64-setup.exe", "2.4.1"
        )

    def test_neighbor_patch_does_not_match(self) -> None:
        assert not original_name_matches_version(_nsis_name("2.4.10"), "2.4.1")
        assert not original_name_matches_version(_nsis_name("2.4.0"), "2.4.1")


class TestStageDesktopPayload:
    def test_stages_manifest_with_hash(self, tmp_path: Path) -> None:
        source = _touch_bundle(tmp_path / "nsis" / _nsis_name())
        dest = tmp_path / "desktop-payload"
        manifest = stage_desktop_payload(source, dest, "2.4.1")
        staged = dest / "Nexus-Desktop-Setup.exe"
        assert staged.is_file()
        assert manifest["version"] == "2.4.1"
        assert manifest["original_name"] == _nsis_name()
        assert manifest["sha256"] == hashlib.sha256(b"bundle-bytes").hexdigest()
        on_disk = json.loads((dest / "manifest.json").read_text(encoding="utf-8"))
        assert on_disk["sha256"] == manifest["sha256"]

    def test_missing_source_fails(self, tmp_path: Path) -> None:
        with pytest.raises(StageError, match="not found"):
            stage_desktop_payload(tmp_path / "missing.exe", tmp_path / "out", "2.4.1")

    def test_version_mismatch_fails(self, tmp_path: Path) -> None:
        source = _touch_bundle(tmp_path / _nsis_name("2.4.0"))
        with pytest.raises(StageError, match="does not encode product version"):
            stage_desktop_payload(source, tmp_path / "out", "2.4.1")

    def test_stale_bundle_older_than_source_fails(self, tmp_path: Path) -> None:
        src_root = tmp_path / "desktop" / "src"
        src_root.mkdir(parents=True)
        newer = src_root / "App.tsx"
        newer.write_text("export {}", encoding="utf-8")
        source = _touch_bundle(tmp_path / _nsis_name())
        old = time.time() - 3600
        os.utime(source, (old, old))
        os.utime(newer, (old + 10, old + 10))
        with pytest.raises(StageError, match="stale"):
            stage_desktop_payload(
                source,
                tmp_path / "out",
                "2.4.1",
                source_roots=[src_root],
            )

    def test_fresh_bundle_newer_than_source_passes(self, tmp_path: Path) -> None:
        src_root = tmp_path / "desktop" / "src"
        src_root.mkdir(parents=True)
        older = src_root / "App.tsx"
        older.write_text("export {}", encoding="utf-8")
        old = time.time() - 3600
        os.utime(older, (old, old))
        source = _touch_bundle(tmp_path / _nsis_name())
        os.utime(source, (old + 10, old + 10))
        manifest = stage_desktop_payload(
            source,
            tmp_path / "out",
            "2.4.1",
            source_roots=[src_root],
        )
        assert manifest["version"] == "2.4.1"

    def test_cli_stale_exits_one(self, tmp_path: Path) -> None:
        src_root = tmp_path / "desktop" / "src"
        src_root.mkdir(parents=True)
        newer = src_root / "App.tsx"
        newer.write_text("export {}", encoding="utf-8")
        source = _touch_bundle(tmp_path / _nsis_name())
        old = time.time() - 3600
        os.utime(source, (old, old))
        os.utime(newer, (old + 10, old + 10))
        code = stage_main(
            [
                "--source",
                str(source),
                "--dest",
                str(tmp_path / "out"),
                "--version",
                "2.4.1",
                "--repo-root",
                str(tmp_path),
            ]
        )
        assert code == 1


class TestPayloadIdentity:
    def test_writes_nexus_file(self, tmp_path: Path) -> None:
        target = write_desktop_payload_identity(
            {"version": "2.4.1", "sha256": "ab" * 32, "original_name": _nsis_name()},
            home=tmp_path,
        )
        body = json.loads(target.read_text(encoding="utf-8"))
        assert target == tmp_path / ".nexus" / "desktop-payload.json"
        assert body["version"] == "2.4.1"
        assert body["sha256"] == "ab" * 32

    def test_label_short_hash(self) -> None:
        assert (
            format_payload_label("2.4.1", "abcdef0123456789")
            == "Desktop payload 2.4.1 (abcdef012345)"
        )

    def test_label_unknown_when_empty(self) -> None:
        assert format_payload_label("", "") == "Desktop payload unknown"

    def test_install_records_identity(self, tmp_path: Path) -> None:
        payload = tmp_path / "payload"
        payload.mkdir()
        content = b"bundle-bytes"
        (payload / "Nexus-Desktop-Setup.exe").write_bytes(content)
        (payload / "manifest.json").write_text(
            json.dumps(
                {
                    "filename": "Nexus-Desktop-Setup.exe",
                    "version": "2.4.1",
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "original_name": _nsis_name(),
                }
            ),
            encoding="utf-8",
        )
        state = InstallerState()
        provisioner = DesktopProvisioner()
        provisioner.identity_home = tmp_path
        with (
            patch(f"{_MOD}.embedded_payload_dir", return_value=payload),
            patch.object(DesktopProvisioner, "_dispatch_install", return_value=True),
            patch(f"{_MOD}.first_run_health_check", return_value=True),
        ):
            ok = provisioner.install(state, MagicMock())
        assert ok is True
        identity = json.loads(
            (tmp_path / ".nexus" / "desktop-payload.json").read_text(encoding="utf-8")
        )
        assert identity["version"] == "2.4.1"
        assert identity["sha256"] == hashlib.sha256(content).hexdigest()


class TestPresentInstallerWindow:
    def test_first_show_calls_maximize_not_show(self) -> None:
        window = MagicMock()
        present_installer_window(window)
        window.showMaximized.assert_called_once()
        window.show.assert_not_called()
        window.showNormal.assert_not_called()

    def test_main_source_uses_present_helper(self) -> None:
        source = (
            Path(__file__).resolve().parents[1] / "src" / "nexus_installer" / "main.py"
        ).read_text(encoding="utf-8")
        assert "present_installer_window(window)" in source
        assert "window.show()" not in source.split("def present_installer_window")[1]


class TestBuildWindowsScript:
    def test_stages_via_python_helper_not_copy_item(self) -> None:
        script = (
            Path(__file__).resolve().parents[1] / "build" / "build-windows.ps1"
        ).read_text(encoding="utf-8")
        assert "stage-desktop-payload.py" in script
        assert "stale, version-mismatched, or missing bundle" in script
        freeze = script.split("# v1.11.0 Phase 4 (T401)", maxsplit=1)[1]
        assert "Copy-Item $DesktopBundle" not in freeze

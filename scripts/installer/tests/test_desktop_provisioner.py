"""Tests for the Nexus desktop provisioner.

v1.11.0 Phase 4 (T402/T404): the desktop app installs from an EMBEDDED,
manifest-verified payload (no GitHub-release fetch). Covers payload
resolution + hash verification (fail closed), the packaging diagnostic,
per-OS dispatch, state threading, and the local-override dev seam.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.engine.desktop_provisioner import (
    DesktopProvisioner,
    _locate_windows_exe,
    _resolve_windows_exe,
    check_desktop_payload,
    first_run_health_check,
    load_payload_manifest,
)
from nexus_installer.installer_state import InstallerState

_MOD = "nexus_installer.engine.desktop_provisioner"


def _write_payload(
    tmp_path: Path,
    content: bytes = b"bundle-bytes",
    version: str = "2.1.0",
    sha: str | None = None,
    filename: str = "Nexus-Desktop-Setup.exe",
) -> Path:
    """Stage a payload dir shaped like build-windows.ps1's output."""
    payload = tmp_path / "desktop-payload"
    payload.mkdir(parents=True, exist_ok=True)
    (payload / filename).write_bytes(content)
    manifest = {
        "filename": filename,
        "version": version,
        "sha256": sha or hashlib.sha256(content).hexdigest(),
    }
    (payload / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return payload


class TestPayloadManifest:
    def test_valid_manifest_loads(self, tmp_path: Path) -> None:
        payload = _write_payload(tmp_path)
        manifest = load_payload_manifest(payload)
        assert manifest is not None
        assert manifest["filename"] == "Nexus-Desktop-Setup.exe"
        assert manifest["version"] == "2.1.0"

    def test_malformed_json_returns_none(self, tmp_path: Path) -> None:
        payload = tmp_path / "p"
        payload.mkdir()
        (payload / "manifest.json").write_text("{nope", encoding="utf-8")
        assert load_payload_manifest(payload) is None

    def test_missing_keys_return_none(self, tmp_path: Path) -> None:
        payload = tmp_path / "p"
        payload.mkdir()
        (payload / "manifest.json").write_text(
            json.dumps({"filename": "x.exe"}), encoding="utf-8"
        )
        assert load_payload_manifest(payload) is None

    def test_bom_manifest_loads(self, tmp_path: Path) -> None:
        """PowerShell-authored manifests may carry a BOM (IO.P2.C lesson)."""
        payload = tmp_path / "p"
        payload.mkdir()
        body = json.dumps({"filename": "x.exe", "version": "1.0.0", "sha256": "a" * 64})
        (payload / "manifest.json").write_bytes(b"\xef\xbb\xbf" + body.encode())
        assert load_payload_manifest(payload) is not None


class TestResolveEmbedded:
    """The embedded bundle is hash-verified against its build-time manifest;
    every failure mode is fail-closed with a structured, plain-language
    reason (T303)."""

    def _resolve(
        self, payload_dir: Path | None
    ) -> tuple[str | None, InstallerState, MagicMock]:
        state = InstallerState()
        log = MagicMock()
        with patch(f"{_MOD}.embedded_payload_dir", return_value=payload_dir):
            result = DesktopProvisioner()._resolve_embedded(state, log)
        return result, state, log

    def test_intact_payload_resolves(self, tmp_path: Path) -> None:
        payload = _write_payload(tmp_path)
        result, state, _ = self._resolve(payload)
        assert result == str(payload / "Nexus-Desktop-Setup.exe")
        assert state.step_failures == []

    def test_missing_payload_fails_with_reason(self) -> None:
        result, state, _ = self._resolve(None)
        assert result is None
        assert state.step_failures
        assert state.step_failures[0]["step"] == "desktop"
        assert "missing" in state.step_failures[0]["summary"].lower()

    def test_malformed_manifest_fails_closed(self, tmp_path: Path) -> None:
        payload = tmp_path / "p"
        payload.mkdir()
        (payload / "manifest.json").write_text("{nope", encoding="utf-8")
        result, state, _ = self._resolve(payload)
        assert result is None
        assert state.step_failures

    def test_missing_bundle_file_fails_closed(self, tmp_path: Path) -> None:
        payload = _write_payload(tmp_path)
        (payload / "Nexus-Desktop-Setup.exe").unlink()
        result, state, _ = self._resolve(payload)
        assert result is None
        assert state.step_failures

    def test_hash_mismatch_fails_closed(self, tmp_path: Path) -> None:
        payload = _write_payload(tmp_path, sha="0" * 64)
        result, state, log = self._resolve(payload)
        assert result is None
        assert any(
            "checksum mismatch" in call.args[0].lower()
            for call in log.call_args_list
            if call.args
        )
        assert "integrity" in state.step_failures[0]["summary"]


class TestInstallFromEmbedded:
    def test_install_verifies_then_dispatches(self, tmp_path: Path) -> None:
        payload = _write_payload(tmp_path)
        state = InstallerState()
        with (
            patch(f"{_MOD}.embedded_payload_dir", return_value=payload),
            patch.object(
                DesktopProvisioner, "_dispatch_install", return_value=True
            ) as mock_dispatch,
            patch(f"{_MOD}.first_run_health_check", return_value=True),
        ):
            ok = DesktopProvisioner().install(state, MagicMock())
        assert ok is True
        assert state.desktop_installed is True
        assert mock_dispatch.call_args[0][0] == str(payload / "Nexus-Desktop-Setup.exe")

    def test_missing_payload_fails_install(self) -> None:
        state = InstallerState()
        with patch(f"{_MOD}.embedded_payload_dir", return_value=None):
            ok = DesktopProvisioner().install(state, MagicMock())
        assert ok is False
        assert state.desktop_installed is False


class TestCheckDesktopPayloadDiagnostic:
    def test_intact_payload_exits_zero(self, tmp_path: Path) -> None:
        payload = _write_payload(tmp_path)
        with patch(f"{_MOD}.embedded_payload_dir", return_value=payload):
            assert check_desktop_payload() == 0

    def test_missing_payload_exits_one(self) -> None:
        with patch(f"{_MOD}.embedded_payload_dir", return_value=None):
            assert check_desktop_payload() == 1

    def test_hash_mismatch_exits_one(self, tmp_path: Path) -> None:
        payload = _write_payload(tmp_path, sha="0" * 64)
        with patch(f"{_MOD}.embedded_payload_dir", return_value=payload):
            assert check_desktop_payload() == 1


class TestInstallDispatchWindows:
    @patch(f"{_MOD}.is_windows", return_value=True)
    @patch(f"{_MOD}.is_macos", return_value=False)
    @patch(f"{_MOD}.is_linux", return_value=False)
    def test_silent_nsis_default_dir(
        self, _l: object, _m: object, _w: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LOCALAPPDATA", r"C:\Users\u\AppData\Local")
        state = InstallerState()
        with patch(f"{_MOD}.run_command", return_value=(0, "", "")) as mock_run:
            ok = DesktopProvisioner()._dispatch_install(
                "bundle.exe", state, MagicMock()
            )
        assert ok is True
        cmd = mock_run.call_args[0][0]
        assert cmd == ["bundle.exe", "/S"]
        assert state.desktop_exe_path == os.path.join(
            r"C:\Users\u\AppData\Local", "Nexus AI Studio", "Nexus AI Studio.exe"
        )

    @patch(f"{_MOD}.is_windows", return_value=True)
    @patch(f"{_MOD}.is_macos", return_value=False)
    @patch(f"{_MOD}.is_linux", return_value=False)
    def test_custom_dir_appends_unquoted_d_flag_last(
        self, _l: object, _m: object, _w: object
    ) -> None:
        state = InstallerState(desktop_install_dir=r"D:\Apps\Nexus Desktop")
        with patch(f"{_MOD}.run_command", return_value=(0, "", "")) as mock_run:
            ok = DesktopProvisioner()._dispatch_install(
                "bundle.exe", state, MagicMock()
            )
        assert ok is True
        cmd = mock_run.call_args[0][0]
        assert cmd[-1] == r"/D=D:\Apps\Nexus Desktop"  # NSIS: last arg, no quotes
        assert state.desktop_exe_path == os.path.join(
            r"D:\Apps\Nexus Desktop", "Nexus AI Studio.exe"
        )

    @patch(f"{_MOD}.is_windows", return_value=True)
    @patch(f"{_MOD}.is_macos", return_value=False)
    @patch(f"{_MOD}.is_linux", return_value=False)
    def test_nonzero_exit_fails(self, _l: object, _m: object, _w: object) -> None:
        state = InstallerState()
        with patch(f"{_MOD}.run_command", return_value=(1, "", "boom")):
            ok = DesktopProvisioner()._dispatch_install(
                "bundle.exe", state, MagicMock()
            )
        assert ok is False

    def test_resolve_exe_finds_tauri_shell_binary(self, tmp_path: Path) -> None:
        # The T104 bundle ships nexus-shell.exe, not a product-named exe.
        (tmp_path / "nexus-shell.exe").write_bytes(b"x")
        (tmp_path / "uninstall.exe").write_bytes(b"x")
        assert _resolve_windows_exe(str(tmp_path)) == str(tmp_path / "nexus-shell.exe")

    def test_resolve_exe_prefers_product_name(self, tmp_path: Path) -> None:
        (tmp_path / "Nexus.exe").write_bytes(b"x")
        (tmp_path / "nexus-shell.exe").write_bytes(b"x")
        assert _resolve_windows_exe(str(tmp_path)) == str(tmp_path / "Nexus.exe")

    def test_resolve_exe_prefers_current_product_name(self, tmp_path: Path) -> None:
        (tmp_path / "Nexus AI Studio.exe").write_bytes(b"x")
        (tmp_path / "Nexus.exe").write_bytes(b"x")
        (tmp_path / "nexus-shell.exe").write_bytes(b"x")
        assert _resolve_windows_exe(str(tmp_path)) == str(
            tmp_path / "Nexus AI Studio.exe"
        )

    def test_locate_exe_finds_tauri_product_dir(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        local = tmp_path / "Local"
        (local / "Nexus").mkdir(parents=True)
        studio = local / "Nexus AI Studio"
        studio.mkdir()
        (studio / "nexus-shell.exe").write_bytes(b"x")
        monkeypatch.setenv("LOCALAPPDATA", str(local))
        found = _locate_windows_exe(str(local / "Nexus"))
        assert found == str(studio / "nexus-shell.exe")

    def test_resolve_exe_skips_uninstaller(self, tmp_path: Path) -> None:
        (tmp_path / "uninstall.exe").write_bytes(b"x")
        (tmp_path / "other-app.exe").write_bytes(b"x")
        assert _resolve_windows_exe(str(tmp_path)) == str(tmp_path / "other-app.exe")


class TestInstallDispatchMacos:
    @patch(f"{_MOD}.is_windows", return_value=False)
    @patch(f"{_MOD}.is_macos", return_value=True)
    @patch(f"{_MOD}.is_linux", return_value=False)
    def test_mounts_copies_and_detaches(
        self, _l: object, _m: object, _w: object, tmp_path: Path
    ) -> None:
        state = InstallerState()
        calls: list[list[str]] = []

        def fake_run(cmd: list[str], **_kw: object) -> tuple[int, str, str]:
            calls.append(cmd)
            return 0, "", ""

        with (
            patch(f"{_MOD}.run_command", side_effect=fake_run),
            patch(f"{_MOD}.tempfile.mkdtemp", return_value=str(tmp_path)),
            patch(f"{_MOD}.glob.glob") as mock_glob,
        ):
            mock_glob.side_effect = [
                [str(tmp_path / "Nexus.app")],  # apps inside the mounted DMG
                ["/Applications/Nexus.app/Contents/MacOS/Nexus"],  # binaries
            ]
            ok = DesktopProvisioner()._dispatch_install("nexus.dmg", state, MagicMock())

        assert ok is True
        assert calls[0][:2] == ["hdiutil", "attach"]
        assert calls[1][0] == "ditto"
        assert calls[1][2] == "/Applications/Nexus.app"
        assert calls[-1][:2] == ["hdiutil", "detach"]
        assert state.desktop_exe_path == "/Applications/Nexus.app/Contents/MacOS/Nexus"

    @patch(f"{_MOD}.is_windows", return_value=False)
    @patch(f"{_MOD}.is_macos", return_value=True)
    @patch(f"{_MOD}.is_linux", return_value=False)
    def test_empty_dmg_fails_but_detaches(
        self, _l: object, _m: object, _w: object, tmp_path: Path
    ) -> None:
        state = InstallerState()
        calls: list[list[str]] = []

        def fake_run(cmd: list[str], **_kw: object) -> tuple[int, str, str]:
            calls.append(cmd)
            return 0, "", ""

        with (
            patch(f"{_MOD}.run_command", side_effect=fake_run),
            patch(f"{_MOD}.tempfile.mkdtemp", return_value=str(tmp_path)),
            patch(f"{_MOD}.glob.glob", return_value=[]),
        ):
            ok = DesktopProvisioner()._dispatch_install("nexus.dmg", state, MagicMock())

        assert ok is False
        assert calls[-1][:2] == ["hdiutil", "detach"]


class TestInstallDispatchLinux:
    @patch(f"{_MOD}.is_windows", return_value=False)
    @patch(f"{_MOD}.is_macos", return_value=False)
    @patch(f"{_MOD}.is_linux", return_value=True)
    def test_installs_appimage_and_desktop_entry(
        self,
        _l: object,
        _m: object,
        _w: object,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        home = tmp_path / "home"
        monkeypatch.setattr(
            os.path,
            "expanduser",
            lambda p: p.replace("~", str(home)),
        )
        bundle = tmp_path / "Nexus-Desktop_2.1.0_amd64.AppImage"
        bundle.write_bytes(b"appimage-bytes")
        state = InstallerState()

        ok = DesktopProvisioner()._dispatch_install(str(bundle), state, MagicMock())

        assert ok is True
        appimage = Path(state.desktop_exe_path)
        assert appimage.name == "nexus-desktop.AppImage"
        assert appimage.parent == home / ".local" / "bin"
        assert appimage.read_bytes() == b"appimage-bytes"
        if sys.platform != "win32":  # chmod bits are meaningless on Windows
            assert os.access(str(appimage), os.X_OK)
        entry = home / ".local" / "share" / "applications" / "nexus-desktop.desktop"
        content = entry.read_text(encoding="utf-8")
        assert "[Desktop Entry]" in content
        assert f"Exec={state.desktop_exe_path}" in content
        assert "Name=Nexus" in content


class TestInstallOrchestration:
    def test_local_override_skips_embedded_payload(self, tmp_path: Path) -> None:
        bundle = tmp_path / "Nexus_2.1.0_x64-setup.exe"
        bundle.write_bytes(b"local-bundle")
        state = InstallerState(desktop_bundle_override=str(bundle))
        log = MagicMock()
        provisioner = DesktopProvisioner()

        with (
            patch(f"{_MOD}.embedded_payload_dir") as mock_payload,
            patch.object(provisioner, "_dispatch_install", return_value=True),
            patch(f"{_MOD}.first_run_health_check", return_value=True),
        ):
            ok = provisioner.install(state, log)

        assert ok is True
        assert state.desktop_installed is True
        mock_payload.assert_not_called()  # the dev seam bypasses the payload

    def test_missing_override_fails(self, tmp_path: Path) -> None:
        state = InstallerState(
            desktop_bundle_override=str(tmp_path / "does-not-exist.exe")
        )
        ok = DesktopProvisioner().install(state, MagicMock())
        assert ok is False
        assert state.desktop_installed is False

    def test_failed_verification_never_dispatches_install(self) -> None:
        state = InstallerState()
        provisioner = DesktopProvisioner()
        with (
            patch.object(provisioner, "_resolve_embedded", return_value=None),
            patch.object(provisioner, "_dispatch_install") as mock_dispatch,
        ):
            ok = provisioner.install(state, MagicMock())
        assert ok is False
        mock_dispatch.assert_not_called()

    def test_health_check_failure_does_not_fail_step(self, tmp_path: Path) -> None:
        bundle = tmp_path / "bundle.exe"
        bundle.write_bytes(b"x")
        state = InstallerState(desktop_bundle_override=str(bundle))
        log = MagicMock()
        provisioner = DesktopProvisioner()

        with (
            patch.object(provisioner, "_dispatch_install", return_value=True),
            patch(f"{_MOD}.first_run_health_check", return_value=False),
        ):
            ok = provisioner.install(state, log)

        assert ok is True  # install landed; health surfaced separately
        assert state.desktop_installed is True
        assert any(
            "health check" in call.args[0].lower()
            for call in log.call_args_list
            if call.args and call.args[-1] == "warn"
        )


class TestFirstRunHealthCheck:
    """v2.2.0 Phase 1 (1.4): the check runs `<exe> --healthcheck` and parses a
    single-line JSON verdict; a sidecar failure fails the install step."""

    def test_missing_binary_fails(self) -> None:
        state = InstallerState(desktop_exe_path="")
        assert first_run_health_check(state, MagicMock()) is False
        assert state.desktop_health_ok is False

    def _check(self, proc: MagicMock) -> InstallerState:
        state = InstallerState(desktop_exe_path="/apps/nexus")
        with (
            patch(f"{_MOD}.os.path.exists", return_value=True),
            patch(f"{_MOD}.subprocess.Popen", return_value=proc),
        ):
            first_run_health_check(state, MagicMock(), grace_seconds=1)
        return state

    def test_ok_verdict_passes_with_detail(self) -> None:
        proc = MagicMock()
        proc.communicate.return_value = (
            '{"sidecar":"ok","catalogRows":42,"hubCatalog":"present"}\n',
            None,
        )
        proc.returncode = 0
        state = self._check(proc)
        assert state.desktop_health_ok is True
        assert "catalogRows=42" in state.desktop_health_detail

    def test_fail_verdict_fails_with_reason(self) -> None:
        proc = MagicMock()
        proc.communicate.return_value = (
            '{"sidecar":"fail: script-not-found: C:/x/main.js",'
            '"catalogRows":0,"stderrTail":["boom"]}\n',
            None,
        )
        proc.returncode = 1
        state = self._check(proc)
        assert state.desktop_health_ok is False
        assert "script-not-found" in state.desktop_health_detail

    def test_zero_catalog_rows_still_passes_but_detail_records_it(self) -> None:
        proc = MagicMock()
        proc.communicate.return_value = (
            '{"sidecar":"ok","catalogRows":0,"hubCatalog":"absent"}\n',
            None,
        )
        proc.returncode = 0
        state = self._check(proc)
        assert state.desktop_health_ok is True
        assert "catalogRows=0" in state.desktop_health_detail

    def test_legacy_app_without_verdict_passes_with_warning(self) -> None:
        proc = MagicMock()
        proc.communicate.return_value = ("", None)
        proc.returncode = 0
        state = self._check(proc)
        assert state.desktop_health_ok is True
        assert "legacy" in state.desktop_health_detail

    def test_nonzero_exit_without_verdict_fails(self) -> None:
        proc = MagicMock()
        proc.communicate.return_value = ("", None)
        proc.returncode = 3
        state = self._check(proc)
        assert state.desktop_health_ok is False

    def test_timeout_fails(self) -> None:
        proc = MagicMock()
        proc.communicate.side_effect = [
            subprocess.TimeoutExpired(cmd="nexus", timeout=1),
            ("", None),
        ]
        state = self._check(proc)
        assert state.desktop_health_ok is False
        proc.kill.assert_called_once()

    def test_dead_child_verdict_names_exception(self) -> None:
        proc = MagicMock()
        proc.communicate.return_value = (
            '{"sidecar":"fail: sidecar-exited:7","exitCode":7,'
            '"nodePath":"C:/Nexus/runtime/node/node.exe",'
            '"scriptPath":"C:/apps/sidecar/dist/main.js","catalogRows":0,'
            '"stderrTail":["","", "Nodejs v22.11.0",'
            "\"Cannot find module 'better-sqlite3'\"]}\n",
            None,
        )
        proc.returncode = 1
        state = self._check(proc)
        assert state.desktop_health_ok is False
        assert "better-sqlite3" in state.desktop_health_detail
        assert "exitCode=7" in state.desktop_health_detail
        assert " / " not in state.desktop_health_detail
        assert "[ / /" not in state.desktop_health_detail

    def test_format_skips_blank_stderr_fragments(self) -> None:
        from nexus_installer.engine.desktop_provisioner import (
            _format_healthcheck_failure,
        )

        detail = _format_healthcheck_failure(
            {
                "exitCode": 1,
                "nodePath": "C:/node.exe",
                "scriptPath": "C:/main.js",
                "stderrTail": ["", "  ", "Nodejs v22.11.0"],
            },
            "fail: sidecar-exited:1",
        )
        assert "Nodejs v22.11.0" in detail
        assert " / " not in detail
        assert "[ / /" not in detail

    def test_spawn_failure_fails(self) -> None:
        state = InstallerState(desktop_exe_path="/apps/nexus")
        with (
            patch(f"{_MOD}.os.path.exists", return_value=True),
            patch(f"{_MOD}.subprocess.Popen", side_effect=OSError("no exec")),
        ):
            assert first_run_health_check(state, MagicMock()) is False
        assert state.desktop_health_ok is False


# -- T204 integration leg: real NSIS install of the T104 fixture ------------

_REPO_ROOT = Path(__file__).resolve().parents[3]
_FIXTURE = _REPO_ROOT / ".local-fixtures" / "Nexus_2.1.0_x64-setup.exe"


@pytest.mark.skipif(
    sys.platform != "win32"
    or os.environ.get("NEXUS_DESKTOP_FIXTURE_TEST") != "1"
    or not _FIXTURE.is_file(),
    reason=(
        "Windows-only integration test against the T104 local bundle; "
        "opt in with NEXUS_DESKTOP_FIXTURE_TEST=1"
    ),
)
class TestWindowsFixtureIntegration:
    def test_installs_fixture_end_to_end(self, tmp_path: Path) -> None:
        install_dir = tmp_path / "NexusDesktop"
        state = InstallerState(
            desktop_bundle_override=str(_FIXTURE),
            desktop_install_dir=str(install_dir),
        )
        logs: list[tuple[str, str]] = []

        try:
            ok = DesktopProvisioner().install(
                state, lambda msg, level="info": logs.append((msg, level))
            )
            assert ok is True, logs
            assert state.desktop_installed is True
            assert os.path.isfile(state.desktop_exe_path), state.desktop_exe_path
            assert state.desktop_health_ok is True, logs
        finally:
            uninstaller = install_dir / "uninstall.exe"
            if uninstaller.is_file():
                subprocess.run(
                    [str(uninstaller), "/S", f"_?={install_dir}"],
                    timeout=300,
                    check=False,
                )

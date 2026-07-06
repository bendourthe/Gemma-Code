"""Tests for the Nexus desktop provisioner (v1.8.0 Phase 2, T204).

Mirrors the existing provisioner suites: mocked httpx / subprocess, real
temp files for the download + verify path, per-OS dispatch, state
threading, and an env-gated Windows integration test against the T104
local fixture bundle.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.engine.desktop_provisioner import (
    NEXUS_DESKTOP_PINNED_TAG,
    NEXUS_DESKTOP_VERSION,
    DesktopProvisioner,
    _resolve_windows_exe,
    first_run_health_check,
    parse_sha256sums,
    resolve_asset_name,
)
from nexus_installer.installer_state import InstallerState

_MOD = "nexus_installer.engine.desktop_provisioner"


def _mock_stream_response(chunks: list[bytes], status_code: int = 200, headers=None):
    """Build a context-manager mock for httpx.stream()."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = headers or {"content-length": str(sum(len(c) for c in chunks))}
    resp.iter_bytes.return_value = iter(chunks)
    resp.__enter__ = lambda s: resp
    resp.__exit__ = MagicMock(return_value=False)
    return resp


class TestResolveAssetName:
    def test_windows_x64(self) -> None:
        name = resolve_asset_name("win32", "AMD64")
        assert name == f"Nexus-Desktop_{NEXUS_DESKTOP_VERSION}_x64-setup.exe"

    def test_windows_arm64_unsupported(self) -> None:
        assert resolve_asset_name("win32", "ARM64") is None

    def test_macos_universal_serves_both_arches(self) -> None:
        for arch in ("arm64", "x86_64"):
            name = resolve_asset_name("darwin", arch)
            assert name == f"Nexus-Desktop_{NEXUS_DESKTOP_VERSION}_universal.dmg"

    def test_linux_amd64(self) -> None:
        name = resolve_asset_name("linux", "x86_64")
        assert name == f"Nexus-Desktop_{NEXUS_DESKTOP_VERSION}_amd64.AppImage"

    def test_linux_aarch64_unsupported(self) -> None:
        assert resolve_asset_name("linux", "aarch64") is None

    def test_unknown_platform_unsupported(self) -> None:
        assert resolve_asset_name("freebsd14", "x86_64") is None

    def test_version_derived_from_pinned_tag(self) -> None:
        assert f"v{NEXUS_DESKTOP_VERSION}" == NEXUS_DESKTOP_PINNED_TAG


class TestParseSha256sums:
    def test_parses_text_mode_lines(self) -> None:
        digest = "a" * 64
        entries = parse_sha256sums(f"{digest}  Nexus-Desktop_2.1.0_x64-setup.exe\n")
        assert entries == {"Nexus-Desktop_2.1.0_x64-setup.exe": digest}

    def test_parses_binary_mode_asterisk(self) -> None:
        digest = "b" * 64
        entries = parse_sha256sums(f"{digest} *NexusSetup.exe\n")
        assert entries == {"NexusSetup.exe": digest}

    def test_skips_malformed_lines(self) -> None:
        text = "\n".join(
            [
                "not-a-hash  file.exe",  # bad digest length
                "z" * 64 + "  file2.exe",  # non-hex digest
                "c" * 64,  # no filename
                "",
                "d" * 64 + "  good.exe",
            ]
        )
        assert parse_sha256sums(text) == {"good.exe": "d" * 64}

    def test_lowercases_digests(self) -> None:
        entries = parse_sha256sums("A" * 64 + "  X.exe")
        assert entries["X.exe"] == "a" * 64


class TestDownloadAndVerify:
    """Exercise the real download/verify path with mocked httpx + temp files."""

    def _run(
        self,
        tmp_path: Path,
        payload: bytes,
        manifest_digest: str,
        asset: str = "Nexus-Desktop_2.1.0_x64-setup.exe",
    ) -> tuple[str | None, MagicMock]:
        state = InstallerState()
        log = MagicMock()
        provisioner = DesktopProvisioner()

        sums_resp = MagicMock()
        sums_resp.status_code = 200
        sums_resp.text = f"{manifest_digest}  {asset}\n"
        sums_resp.raise_for_status = MagicMock()

        with (
            patch(f"{_MOD}.resolve_asset_name", return_value=asset),
            patch(f"{_MOD}._download_dir", return_value=str(tmp_path)),
            patch(f"{_MOD}.httpx") as mock_httpx,
        ):
            mock_httpx.get.return_value = sums_resp
            mock_httpx.stream.return_value = _mock_stream_response([payload])
            mock_httpx.HTTPError = Exception
            result = provisioner._download_and_verify(
                state, log, lambda _pct: None
            )
        return result, log

    def test_matching_hash_returns_bundle_path(self, tmp_path: Path) -> None:
        payload = b"bundle-bytes"
        digest = hashlib.sha256(payload).hexdigest()
        result, _log = self._run(tmp_path, payload, digest)
        assert result is not None
        assert os.path.isfile(result)
        with open(result, "rb") as f:
            assert f.read() == payload

    def test_hash_mismatch_fails_closed_and_deletes(self, tmp_path: Path) -> None:
        result, log = self._run(tmp_path, b"bundle-bytes", "0" * 64)
        assert result is None
        assert not any(tmp_path.iterdir())  # downloaded file removed
        assert any(
            "checksum mismatch" in call.args[0].lower()
            for call in log.call_args_list
            if call.args
        )

    def test_missing_manifest_entry_fails_closed(self, tmp_path: Path) -> None:
        state = InstallerState()
        log = MagicMock()
        provisioner = DesktopProvisioner()

        sums_resp = MagicMock()
        sums_resp.status_code = 200
        sums_resp.text = "a" * 64 + "  some-other-asset.exe\n"
        sums_resp.raise_for_status = MagicMock()

        with (
            patch(f"{_MOD}.resolve_asset_name", return_value="wanted.exe"),
            patch(f"{_MOD}._download_dir", return_value=str(tmp_path)),
            patch(f"{_MOD}.httpx") as mock_httpx,
        ):
            mock_httpx.get.return_value = sums_resp
            mock_httpx.HTTPError = Exception
            result = provisioner._download_and_verify(state, log, lambda _p: None)

        assert result is None
        mock_httpx.stream.assert_not_called()  # never downloads unverifiable bytes

    def test_manifest_fetch_error_fails(self, tmp_path: Path) -> None:
        state = InstallerState()
        log = MagicMock()
        provisioner = DesktopProvisioner()

        import httpx as real_httpx

        with (
            patch(f"{_MOD}.resolve_asset_name", return_value="wanted.exe"),
            patch(f"{_MOD}._download_dir", return_value=str(tmp_path)),
            patch(f"{_MOD}.httpx") as mock_httpx,
        ):
            mock_httpx.HTTPError = real_httpx.HTTPError
            mock_httpx.get.side_effect = real_httpx.ConnectError("offline")
            result = provisioner._download_and_verify(state, log, lambda _p: None)

        assert result is None

    def test_unsupported_arch_fails(self, tmp_path: Path) -> None:
        state = InstallerState()
        log = MagicMock()
        with patch(f"{_MOD}.resolve_asset_name", return_value=None):
            result = DesktopProvisioner()._download_and_verify(
                state, log, lambda _p: None
            )
        assert result is None


class TestDownloadResume:
    def _download(
        self,
        tmp_path: Path,
        response: MagicMock,
        partial_content: bytes | None = None,
        provisioner: DesktopProvisioner | None = None,
    ) -> tuple[bool, Path, DesktopProvisioner]:
        dest = tmp_path / "asset.bin"
        if partial_content is not None:
            (tmp_path / "asset.bin.partial").write_bytes(partial_content)
        provisioner = provisioner or DesktopProvisioner()
        with patch(f"{_MOD}.httpx") as mock_httpx:
            mock_httpx.stream.return_value = response
            mock_httpx.HTTPError = Exception
            ok = provisioner._download_with_resume(
                "https://example.invalid/asset.bin",
                str(dest),
                MagicMock(),
                lambda _p: None,
            )
            stream_kwargs = mock_httpx.stream.call_args.kwargs
        self._last_headers = stream_kwargs.get("headers", {})
        return ok, dest, provisioner

    def test_resume_sends_range_and_appends_on_206(self, tmp_path: Path) -> None:
        resp = _mock_stream_response([b"-tail"], status_code=206)
        ok, dest, _ = self._download(tmp_path, resp, partial_content=b"head")
        assert ok is True
        assert self._last_headers == {"Range": "bytes=4-"}
        assert dest.read_bytes() == b"head-tail"

    def test_restarts_when_server_ignores_range(self, tmp_path: Path) -> None:
        resp = _mock_stream_response([b"fresh"], status_code=200)
        ok, dest, _ = self._download(tmp_path, resp, partial_content=b"stale")
        assert ok is True
        assert dest.read_bytes() == b"fresh"

    def test_416_promotes_complete_partial(self, tmp_path: Path) -> None:
        resp = _mock_stream_response([], status_code=416)
        ok, dest, _ = self._download(tmp_path, resp, partial_content=b"whole-file")
        assert ok is True
        assert dest.read_bytes() == b"whole-file"

    def test_cancel_keeps_partial_for_resume(self, tmp_path: Path) -> None:
        provisioner = DesktopProvisioner()
        provisioner.cancel()
        resp = _mock_stream_response([b"chunk1", b"chunk2"])
        ok, dest, _ = self._download(tmp_path, resp, provisioner=provisioner)
        assert ok is False
        assert not dest.exists()
        assert (tmp_path / "asset.bin.partial").exists()


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
            r"C:\Users\u\AppData\Local", "Nexus", "Nexus.exe"
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
            r"D:\Apps\Nexus Desktop", "Nexus.exe"
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
        assert _resolve_windows_exe(str(tmp_path)) == str(
            tmp_path / "nexus-shell.exe"
        )

    def test_resolve_exe_prefers_product_name(self, tmp_path: Path) -> None:
        (tmp_path / "Nexus.exe").write_bytes(b"x")
        (tmp_path / "nexus-shell.exe").write_bytes(b"x")
        assert _resolve_windows_exe(str(tmp_path)) == str(tmp_path / "Nexus.exe")

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
    def test_local_override_skips_release_fetch(self, tmp_path: Path) -> None:
        bundle = tmp_path / "Nexus_2.1.0_x64-setup.exe"
        bundle.write_bytes(b"local-bundle")
        state = InstallerState(desktop_bundle_override=str(bundle))
        log = MagicMock()
        provisioner = DesktopProvisioner()

        with (
            patch(f"{_MOD}.httpx") as mock_httpx,
            patch.object(provisioner, "_dispatch_install", return_value=True),
            patch(f"{_MOD}.first_run_health_check", return_value=True),
        ):
            ok = provisioner.install(state, log)

        assert ok is True
        assert state.desktop_installed is True
        mock_httpx.get.assert_not_called()
        mock_httpx.stream.assert_not_called()

    def test_missing_override_fails(self, tmp_path: Path) -> None:
        state = InstallerState(
            desktop_bundle_override=str(tmp_path / "does-not-exist.exe")
        )
        ok = DesktopProvisioner().install(state, MagicMock())
        assert ok is False
        assert state.desktop_installed is False

    def test_failed_download_never_dispatches_install(self) -> None:
        state = InstallerState()
        provisioner = DesktopProvisioner()
        with (
            patch.object(provisioner, "_download_and_verify", return_value=None),
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

    def test_clean_exit_zero_passes(self) -> None:
        proc = MagicMock()
        proc.wait.return_value = 0
        state = self._check(proc)
        assert state.desktop_health_ok is True

    def test_immediate_nonzero_exit_fails(self) -> None:
        proc = MagicMock()
        proc.wait.return_value = 3
        state = self._check(proc)
        assert state.desktop_health_ok is False

    def test_still_alive_after_grace_passes_and_terminates(self) -> None:
        proc = MagicMock()
        proc.wait.side_effect = [subprocess.TimeoutExpired(cmd="nexus", timeout=1), 0]
        state = self._check(proc)
        assert state.desktop_health_ok is True
        proc.terminate.assert_called_once()

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

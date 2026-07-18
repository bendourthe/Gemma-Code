"""Tests for OllamaInstaller with mocked subprocess calls."""

from __future__ import annotations

import io
import re
import tarfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from nexus_installer.engine.ollama_installer import (
    MIN_OLLAMA_VERSION,
    OLLAMA_LINUX_SHA256,
    OLLAMA_PINNED_TAG,
    OLLAMA_WINDOWS_SHA256,
    OllamaInstaller,
    _extract_tar_zst,
    _meets_min_version,
    _version_tuple,
)
from nexus_installer.installer_state import InstallerState


class TestPinsAreReal:
    """v1.11.0 Phase 3 (T302, closes IO.P1.B): the old v0.3.6 pin shipped
    all-zero checksums that could NEVER match, so a clean machine always
    aborted. The pins must be real digests, forever."""

    def test_windows_pin_is_a_real_digest(self) -> None:
        assert re.fullmatch(r"[a-f0-9]{64}", OLLAMA_WINDOWS_SHA256)
        assert OLLAMA_WINDOWS_SHA256 != "0" * 64

    def test_linux_pin_is_a_real_digest(self) -> None:
        assert re.fullmatch(r"[a-f0-9]{64}", OLLAMA_LINUX_SHA256)
        assert OLLAMA_LINUX_SHA256 != "0" * 64

    def test_tag_shape(self) -> None:
        assert re.fullmatch(r"v\d+\.\d+\.\d+", OLLAMA_PINNED_TAG)


def _make_tar_zst(tmp_path: Path, members: dict[str, bytes]) -> Path:
    """Build a tiny .tar.zst fixture with the given member paths."""
    import zstandard

    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as tar:
        for name, payload in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    archive = tmp_path / "fixture.tar.zst"
    archive.write_bytes(zstandard.ZstdCompressor().compress(raw.getvalue()))
    return archive


class TestExtractTarZst:
    def test_extracts_members(self, tmp_path: Path) -> None:
        archive = _make_tar_zst(tmp_path, {"bin/ollama": b"#!fake"})
        dest = tmp_path / "out"
        _extract_tar_zst(archive, dest)
        assert (dest / "bin" / "ollama").read_bytes() == b"#!fake"

    def test_blocks_path_traversal(self, tmp_path: Path) -> None:
        archive = _make_tar_zst(tmp_path, {"../evil": b"x"})
        with pytest.raises(tarfile.TarError):
            _extract_tar_zst(archive, tmp_path / "out")
        assert not (tmp_path / "evil").exists()


class TestOllamaVersionGate:
    """v1.13.0 Phase 1: a pre-existing Ollama must meet the Gemma 4 floor
    (MIN_OLLAMA_VERSION) or be upgraded; the whole default chat/agentic line is
    Gemma 4, which older Ollama builds cannot pull or load."""

    def test_version_tuple_parses(self) -> None:
        assert _version_tuple("v0.32.0") == (0, 32, 0)
        assert _version_tuple("0.22.0") == (0, 22, 0)

    def test_meets_min_version(self) -> None:
        assert _meets_min_version("0.32.0", MIN_OLLAMA_VERSION) is True
        assert _meets_min_version(MIN_OLLAMA_VERSION, MIN_OLLAMA_VERSION) is True
        assert _meets_min_version("0.20.4", MIN_OLLAMA_VERSION) is False

    def test_min_version_shape(self) -> None:
        assert re.fullmatch(r"\d+\.\d+\.\d+", MIN_OLLAMA_VERSION)

    def test_skips_when_existing_meets_floor(self) -> None:
        state = InstallerState(ollama_installed=True)
        log = MagicMock()
        with patch.object(OllamaInstaller, "_ollama_version", return_value="0.32.0"):
            result = OllamaInstaller().install(state, log)
        assert result is True
        assert any(
            "supports gemma 4" in c.args[0].lower()
            for c in log.call_args_list
            if c.args
        )

    def test_skips_when_version_undetermined(self) -> None:
        state = InstallerState(ollama_installed=True)
        log = MagicMock()
        with patch.object(OllamaInstaller, "_ollama_version", return_value=None):
            result = OllamaInstaller().install(state, log)
        assert result is True
        assert any(
            "undetermined" in c.args[0].lower() for c in log.call_args_list if c.args
        )

    def test_below_floor_proceeds_to_install(self) -> None:
        # An older pre-existing Ollama must NOT short-circuit as "already
        # installed"; install proceeds to lay down the pinned build. With every
        # platform predicate False, the unsupported-platform path returns False,
        # which proves the skip was bypassed.
        state = InstallerState(ollama_installed=True)
        log = MagicMock()
        with (
            patch.object(OllamaInstaller, "_ollama_version", return_value="0.20.4"),
            patch(
                "nexus_installer.engine.ollama_installer.is_windows",
                return_value=False,
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_macos",
                return_value=False,
            ),
            patch(
                "nexus_installer.engine.ollama_installer.is_linux",
                return_value=False,
            ),
        ):
            result = OllamaInstaller().install(state, log)
        assert result is False
        assert any(
            "older than" in c.args[0].lower() for c in log.call_args_list if c.args
        )

    def test_ollama_version_from_api(self) -> None:
        resp = MagicMock(status_code=200)
        resp.json.return_value = {"version": "0.32.0"}
        with patch(
            "nexus_installer.engine.ollama_installer.httpx.get", return_value=resp
        ):
            assert OllamaInstaller()._ollama_version(InstallerState()) == "0.32.0"

    def test_ollama_version_from_cli_when_api_down(self) -> None:
        import httpx as _httpx

        cli = MagicMock(stdout="ollama version is 0.31.2\n", stderr="")
        with (
            patch(
                "nexus_installer.engine.ollama_installer.httpx.get",
                side_effect=_httpx.ConnectError("down"),
            ),
            patch(
                "nexus_installer.engine.ollama_installer.subprocess.run",
                return_value=cli,
            ),
        ):
            assert OllamaInstaller()._ollama_version(InstallerState()) == "0.31.2"

    def test_ollama_version_none_when_both_fail(self) -> None:
        import httpx as _httpx

        with (
            patch(
                "nexus_installer.engine.ollama_installer.httpx.get",
                side_effect=_httpx.ConnectError("down"),
            ),
            patch(
                "nexus_installer.engine.ollama_installer.subprocess.run",
                side_effect=OSError("no ollama"),
            ),
        ):
            assert OllamaInstaller()._ollama_version(InstallerState()) is None


class TestOllamaInstallerWindows:
    @patch("nexus_installer.engine.ollama_installer.is_windows", return_value=True)
    @patch("nexus_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_linux", return_value=False)
    def test_windows_aborts_on_hash_mismatch(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with (
            patch("nexus_installer.engine.ollama_installer.httpx") as mock_httpx,
            patch(
                "nexus_installer.engine.ollama_installer._verify_sha256",
                return_value=False,
            ),
            patch(
                "nexus_installer.engine.ollama_installer.run_command",
                return_value=(0, "", ""),
            ) as mock_run,
            patch(
                "nexus_installer.engine.ollama_installer.tempfile.NamedTemporaryFile"
            ),
            patch("nexus_installer.engine.ollama_installer.os.unlink"),
            patch(
                "nexus_installer.engine.ollama_installer.os.path.exists",
                return_value=False,
            ),
            patch.object(OllamaInstaller, "_verify_ollama", return_value=True),
        ):
            mock_resp = MagicMock()
            mock_resp.iter_bytes.return_value = [b"data"]
            mock_resp.__enter__ = lambda s: mock_resp
            mock_resp.__exit__ = MagicMock(return_value=False)
            mock_httpx.stream.return_value = mock_resp

            result = OllamaInstaller().install(state, log)
            assert result is False
            mock_run.assert_not_called()
            assert any(
                "checksum mismatch" in call.args[0].lower()
                for call in log.call_args_list
                if call.args
            )

    @patch("nexus_installer.engine.ollama_installer.is_windows", return_value=True)
    @patch("nexus_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_linux", return_value=False)
    def test_windows_aborts_on_authenticode_failure(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with (
            patch("nexus_installer.engine.ollama_installer.httpx") as mock_httpx,
            patch(
                "nexus_installer.engine.ollama_installer._verify_sha256",
                return_value=True,
            ),
            patch(
                "nexus_installer.engine.ollama_installer._verify_authenticode_windows",
                return_value=False,
            ),
            patch(
                "nexus_installer.engine.ollama_installer.run_command",
                return_value=(0, "", ""),
            ) as mock_run,
            patch(
                "nexus_installer.engine.ollama_installer.tempfile.NamedTemporaryFile"
            ),
            patch("nexus_installer.engine.ollama_installer.os.unlink"),
            patch(
                "nexus_installer.engine.ollama_installer.os.path.exists",
                return_value=False,
            ),
            patch.object(OllamaInstaller, "_verify_ollama", return_value=True),
        ):
            mock_resp = MagicMock()
            mock_resp.iter_bytes.return_value = [b"data"]
            mock_resp.__enter__ = lambda s: mock_resp
            mock_resp.__exit__ = MagicMock(return_value=False)
            mock_httpx.stream.return_value = mock_resp

            result = OllamaInstaller().install(state, log)
            assert result is False
            mock_run.assert_not_called()
            assert any(
                "authenticode" in call.args[0].lower()
                for call in log.call_args_list
                if call.args
            )


def _fake_stream(payload: bytes = b"data") -> MagicMock:
    """A httpx.stream(...) context-manager mock yielding `payload`."""
    mock_resp = MagicMock()
    mock_resp.iter_bytes.return_value = [payload]
    mock_resp.__enter__ = lambda s: mock_resp
    mock_resp.__exit__ = MagicMock(return_value=False)
    mock = MagicMock()
    mock.stream.return_value = mock_resp
    return mock


class TestOllamaInstallerLinux:
    """v1.11.0 Phase 3 (T302): Linux installs the pinned release archive
    user-locally (deterministic, hash-verified) -- no more install.sh."""

    @patch("nexus_installer.engine.ollama_installer.is_windows", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_linux", return_value=True)
    def test_linux_aborts_on_hash_mismatch(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()
        with (
            patch("nexus_installer.engine.ollama_installer.httpx", _fake_stream()),
            patch(
                "nexus_installer.engine.ollama_installer._verify_sha256",
                return_value=False,
            ),
            patch(
                "nexus_installer.engine.ollama_installer._extract_tar_zst"
            ) as mock_extract,
            patch.object(OllamaInstaller, "_verify_ollama", return_value=True),
        ):
            result = OllamaInstaller().install(state, log)
        assert result is False
        mock_extract.assert_not_called()
        assert any(
            "checksum mismatch" in call.args[0].lower()
            for call in log.call_args_list
            if call.args
        )
        assert state.step_failures and state.step_failures[0]["step"] == "ollama"

    @patch("nexus_installer.engine.ollama_installer.is_windows", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_linux", return_value=True)
    def test_linux_extracts_user_locally_and_prepends_path(
        self,
        _linux: object,
        _macos: object,
        _windows: object,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()
        root = tmp_path / "ollama-root"
        monkeypatch.setenv("PATH", "/usr/bin")

        def fake_extract(_archive: Path, dest: Path) -> None:
            (dest / "bin").mkdir(parents=True, exist_ok=True)
            (dest / "bin" / "ollama").write_bytes(b"#!fake")

        with (
            patch("nexus_installer.engine.ollama_installer.httpx", _fake_stream()),
            patch(
                "nexus_installer.engine.ollama_installer._verify_sha256",
                return_value=True,
            ),
            patch(
                "nexus_installer.engine.ollama_installer.linux_install_root",
                return_value=root,
            ),
            patch(
                "nexus_installer.engine.ollama_installer._extract_tar_zst",
                side_effect=fake_extract,
            ),
            patch.object(OllamaInstaller, "_verify_ollama", return_value=True),
        ):
            result = OllamaInstaller().install(state, log)
        assert result is True
        assert (root / "bin" / "ollama").exists()
        import os as _os

        assert _os.environ["PATH"].startswith(str(root / "bin"))
        assert state.step_failures == []

    @patch("nexus_installer.engine.ollama_installer.is_windows", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("nexus_installer.engine.ollama_installer.is_linux", return_value=True)
    def test_linux_fails_when_binary_missing_after_extract(
        self,
        _linux: object,
        _macos: object,
        _windows: object,
        tmp_path: Path,
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()
        with (
            patch("nexus_installer.engine.ollama_installer.httpx", _fake_stream()),
            patch(
                "nexus_installer.engine.ollama_installer._verify_sha256",
                return_value=True,
            ),
            patch(
                "nexus_installer.engine.ollama_installer.linux_install_root",
                return_value=tmp_path / "empty-root",
            ),
            patch(
                "nexus_installer.engine.ollama_installer._extract_tar_zst",
                side_effect=lambda _a, dest: dest.mkdir(parents=True, exist_ok=True),
            ),
            patch.object(OllamaInstaller, "_verify_ollama", return_value=True),
        ):
            result = OllamaInstaller().install(state, log)
        assert result is False
        assert state.step_failures
        assert "program file" in state.step_failures[0]["summary"]

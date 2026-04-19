"""Tests for OllamaInstaller with mocked subprocess calls."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from gemma_installer.engine.ollama_installer import OllamaInstaller
from gemma_installer.installer_state import InstallerState


class TestOllamaInstallerSkip:
    def test_skips_when_already_installed(self) -> None:
        state = InstallerState(ollama_installed=True)
        log = MagicMock()
        result = OllamaInstaller().install(state, log)
        assert result is True
        log.assert_called_once()
        assert "already installed" in log.call_args[0][0].lower()


class TestOllamaInstallerWindows:
    @patch("gemma_installer.engine.ollama_installer.is_windows", return_value=True)
    @patch("gemma_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_linux", return_value=False)
    def test_windows_aborts_on_hash_mismatch(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with (
            patch("gemma_installer.engine.ollama_installer.httpx") as mock_httpx,
            patch(
                "gemma_installer.engine.ollama_installer._verify_sha256",
                return_value=False,
            ),
            patch(
                "gemma_installer.engine.ollama_installer.run_command",
                return_value=(0, "", ""),
            ) as mock_run,
            patch(
                "gemma_installer.engine.ollama_installer.tempfile.NamedTemporaryFile"
            ),
            patch("gemma_installer.engine.ollama_installer.os.unlink"),
            patch(
                "gemma_installer.engine.ollama_installer.os.path.exists",
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

    @patch("gemma_installer.engine.ollama_installer.is_windows", return_value=True)
    @patch("gemma_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_linux", return_value=False)
    def test_windows_aborts_on_authenticode_failure(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with (
            patch("gemma_installer.engine.ollama_installer.httpx") as mock_httpx,
            patch(
                "gemma_installer.engine.ollama_installer._verify_sha256",
                return_value=True,
            ),
            patch(
                "gemma_installer.engine.ollama_installer._verify_authenticode_windows",
                return_value=False,
            ),
            patch(
                "gemma_installer.engine.ollama_installer.run_command",
                return_value=(0, "", ""),
            ) as mock_run,
            patch(
                "gemma_installer.engine.ollama_installer.tempfile.NamedTemporaryFile"
            ),
            patch("gemma_installer.engine.ollama_installer.os.unlink"),
            patch(
                "gemma_installer.engine.ollama_installer.os.path.exists",
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


class TestOllamaInstallerLinux:
    @patch("gemma_installer.engine.ollama_installer.is_windows", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_linux", return_value=True)
    def test_linux_aborts_on_hash_mismatch(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with (
            patch("gemma_installer.engine.ollama_installer.httpx") as mock_httpx,
            patch(
                "gemma_installer.engine.ollama_installer._verify_sha256",
                return_value=False,
            ),
            patch(
                "gemma_installer.engine.ollama_installer.subprocess.call"
            ) as mock_call,
            patch(
                "gemma_installer.engine.ollama_installer.tempfile.NamedTemporaryFile"
            ),
            patch("gemma_installer.engine.ollama_installer.os.chmod"),
            patch("gemma_installer.engine.ollama_installer.os.unlink"),
            patch(
                "gemma_installer.engine.ollama_installer.os.path.exists",
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
            mock_call.assert_not_called()
            assert any(
                "checksum mismatch" in call.args[0].lower()
                for call in log.call_args_list
                if call.args
            )

    @patch("gemma_installer.engine.ollama_installer.is_windows", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_linux", return_value=True)
    def test_linux_downloads_and_executes_on_matching_hash(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with (
            patch("gemma_installer.engine.ollama_installer.httpx") as mock_httpx,
            patch(
                "gemma_installer.engine.ollama_installer._verify_sha256",
                return_value=True,
            ),
            patch(
                "gemma_installer.engine.ollama_installer.subprocess.call",
                return_value=0,
            ) as mock_call,
            patch(
                "gemma_installer.engine.ollama_installer.tempfile.NamedTemporaryFile"
            ),
            patch("gemma_installer.engine.ollama_installer.os.chmod"),
            patch("gemma_installer.engine.ollama_installer.os.unlink"),
            patch(
                "gemma_installer.engine.ollama_installer.os.path.exists",
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
            assert result is True
            mock_call.assert_called_once()
            # Install script runs via bash, not piped from curl.
            args = mock_call.call_args[0][0]
            assert args[0] == "bash"

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
    def test_windows_calls_download_and_silent_install(
        self, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with (
            patch("gemma_installer.engine.ollama_installer.httpx") as mock_httpx,
            patch(
                "gemma_installer.engine.ollama_installer.run_command",
                return_value=(0, "", ""),
            ),
            patch("gemma_installer.engine.ollama_installer.os.unlink"),
            patch(
                "gemma_installer.engine.ollama_installer.tempfile.NamedTemporaryFile"
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


class TestOllamaInstallerLinux:
    @patch("gemma_installer.engine.ollama_installer.is_windows", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_macos", return_value=False)
    @patch("gemma_installer.engine.ollama_installer.is_linux", return_value=True)
    @patch(
        "gemma_installer.engine.ollama_installer.run_command_streaming", return_value=0
    )
    def test_linux_uses_curl_script(
        self, mock_stream: MagicMock, _linux: object, _macos: object, _windows: object
    ) -> None:
        state = InstallerState(ollama_installed=False)
        log = MagicMock()

        with patch.object(OllamaInstaller, "_verify_ollama", return_value=True):
            result = OllamaInstaller().install(state, log)
            assert result is True
            mock_stream.assert_called_once()
            cmd = mock_stream.call_args[0][0]
            assert "curl" in " ".join(cmd)

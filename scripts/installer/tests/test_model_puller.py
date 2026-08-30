"""Tests for ModelPuller: progress parsing, the byte-mode reader, and the
v1.11.0 T101 decode-bomb regression (braille spinner bytes must never kill a
pull)."""

from __future__ import annotations

import io
from unittest.mock import MagicMock, patch

from nexus_installer.engine.model_puller import (
    _PROGRESS_RE,
    ModelPuller,
    clean_terminal_text,
    summarize_pull_failure,
)
from nexus_installer.installer_state import InstallerState


def _mock_proc(output: bytes, returncode: int) -> MagicMock:
    """A Popen mock whose stdout is a real byte stream (has read1)."""
    proc = MagicMock()
    proc.stdout = io.BytesIO(output)
    proc.poll.return_value = returncode
    proc.returncode = returncode
    return proc


class TestProgressRegex:
    def test_matches_percentage(self) -> None:
        line = "pulling abc123... 45% |####      |  2.3 GB/5.1 GB"
        match = _PROGRESS_RE.search(line)
        assert match is not None
        assert match.group(1) == "45"

    def test_matches_100_percent(self) -> None:
        line = "pulling abc123... 100% |##########|  5.1 GB/5.1 GB"
        match = _PROGRESS_RE.search(line)
        assert match is not None
        assert match.group(1) == "100"

    def test_no_match_on_text_only(self) -> None:
        assert _PROGRESS_RE.search("pulling manifest...") is None

    def test_matches_single_digit(self) -> None:
        match = _PROGRESS_RE.search("pulling... 5%")
        assert match is not None
        assert match.group(1) == "5"


class TestCleanTerminalText:
    def test_strips_csi_and_private_modes(self) -> None:
        raw = "\x1b[?2026h\x1b[?25l\x1b[1Gpulling manifest \x1b[K\x1b[?25h"
        assert clean_terminal_text(raw) == "pulling manifest"

    def test_strips_control_chars(self) -> None:
        assert clean_terminal_text("a\x07b\x08c") == "abc"

    def test_plain_text_unchanged(self) -> None:
        assert clean_terminal_text("verifying sha256 digest") == (
            "verifying sha256 digest"
        )


class TestModelPullerSkip:
    def test_skips_when_no_model_selected(self) -> None:
        state = InstallerState(selected_model="")
        result = ModelPuller().pull(state, MagicMock(), MagicMock())
        assert result is True


class TestModelPullerCancel:
    def test_cancel_sets_flag(self) -> None:
        puller = ModelPuller()
        puller.cancel()
        assert puller._cancelled is True


class TestModelPullerExecution:
    def test_successful_pull(self) -> None:
        state = InstallerState(selected_model="gemma4:e2b")
        log = MagicMock()
        progress = MagicMock()
        proc = _mock_proc(
            b"pulling manifest...\n"
            b"pulling abc123... 50% |#####     | 2.5 GB/5.1 GB\n"
            b"pulling abc123... 100% |##########| 5.1 GB/5.1 GB\n",
            returncode=0,
        )
        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=proc,
        ):
            puller = ModelPuller()
            result = puller.pull(state, log, progress)
        assert result is True
        assert progress.call_count >= 2
        assert puller.last_error == ""

    def test_pull_failure_captures_reason(self) -> None:
        state = InstallerState(selected_model="gemma4:e2b")
        proc = _mock_proc(
            b"Error: pull model manifest: file does not exist\n", returncode=1
        )
        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=proc,
        ):
            puller = ModelPuller()
            result = puller.pull(state, MagicMock(), MagicMock())
        assert result is False
        assert "manifest" in puller.last_error

    def test_pull_failure_prefers_newer_version_over_download_url(self) -> None:
        state = InstallerState(selected_model="gemma4:12b")
        proc = _mock_proc(
            b"Error: pull model manifest: 412:\n"
            b"The model you are attempting to pull requires a newer version "
            b"of Ollama.\n"
            b"Please download the latest version at:\n"
            b"https://ollama.com/download\n",
            returncode=1,
        )
        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=proc,
        ):
            puller = ModelPuller()
            result = puller.pull(state, MagicMock(), MagicMock())
        assert result is False
        assert "newer version" in puller.last_error.lower()
        assert puller.last_error != "https://ollama.com/download"

    def test_summarize_pull_failure_skips_bare_url(self) -> None:
        reason = summarize_pull_failure(
            [
                "Error: pull model manifest: 412:",
                "The model you are attempting to pull requires a newer version "
                "of Ollama.",
                "https://ollama.com/download",
            ],
            1,
        )
        assert "newer version" in reason.lower()

    def test_pull_command_not_found(self) -> None:
        state = InstallerState(selected_model="gemma4:e2b")
        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            side_effect=FileNotFoundError,
        ):
            puller = ModelPuller()
            result = puller.pull(state, MagicMock(), MagicMock())
        assert result is False
        assert "not found" in puller.last_error

    def test_pull_cancelled(self) -> None:
        state = InstallerState(selected_model="gemma4:e2b")
        proc = _mock_proc(b"pulling...\n", returncode=-1)
        puller = ModelPuller()
        puller._cancelled = True
        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=proc,
        ):
            result = puller.pull(state, MagicMock(), MagicMock())
        assert result is False
        proc.terminate.assert_called()

    def test_braille_spinner_bytes_do_not_kill_the_pull(self) -> None:
        """T101 regression: the braille spinner frame U+280F ends in byte
        0x8f, which is unmapped in cp1252. The v1.10 text-mode reader raised
        UnicodeDecodeError there, faked an EOF, and the healthy download was
        terminated and reported as exit -1. The byte-mode reader must survive
        arbitrary bytes and still parse progress."""
        state = InstallerState(selected_model="nomic-embed-text")
        log = MagicMock()
        progress = MagicMock()
        proc = _mock_proc(
            b"\x1b[?2026h\x1b[?25l\x1b[1Gpulling manifest \xe2\xa0\x8f \x1b[K\r"
            b"pulling abc... 45% \xe2\x96\x95\xe2\x96\x88 2.3 GB/5.1 GB\r"
            b"pulling abc... 100% \xe2\x96\x88 5.1 GB/5.1 GB\n"
            b"verifying sha256 digest\n"
            b"success\n",
            returncode=0,
        )
        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=proc,
        ):
            puller = ModelPuller()
            result = puller.pull(state, log, progress)
        assert result is True
        fractions = [call.args[0] for call in progress.call_args_list]
        assert 0.45 in fractions
        assert 1.0 in fractions
        # No raw escape bytes may reach the log.
        for call in log.call_args_list:
            assert "\x1b" not in call.args[0]

    def test_progress_rewrites_split_on_carriage_return(self) -> None:
        """Ollama rewrites its progress line with \\r (no newline); each
        rewrite must still be parsed for the percentage."""
        state = InstallerState(selected_model="gemma4:e2b")
        progress = MagicMock()
        proc = _mock_proc(
            b"pulling x... 10%\rpulling x... 60%\rpulling x... 100%\n",
            returncode=0,
        )
        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=proc,
        ):
            result = ModelPuller().pull(state, MagicMock(), progress)
        assert result is True
        fractions = [call.args[0] for call in progress.call_args_list]
        assert 0.1 in fractions
        assert 0.6 in fractions

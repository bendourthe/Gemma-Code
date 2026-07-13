"""Tests for ModelPuller progress parsing."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from nexus_installer.engine.model_puller import _PROGRESS_RE, ModelPuller
from nexus_installer.installer_state import InstallerState


class TestProgressRegex:
    def test_matches_percentage(self) -> None:
        line = "pulling abc123... 45% |â–ˆâ–ˆâ–ˆâ–ˆ      |  2.3 GB/5.1 GB"
        match = _PROGRESS_RE.search(line)
        assert match is not None
        assert match.group(1) == "45"

    def test_matches_100_percent(self) -> None:
        line = "pulling abc123... 100% |â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ|  5.1 GB/5.1 GB"
        match = _PROGRESS_RE.search(line)
        assert match is not None
        assert match.group(1) == "100"

    def test_no_match_on_text_only(self) -> None:
        line = "pulling manifest..."
        match = _PROGRESS_RE.search(line)
        assert match is None

    def test_matches_single_digit(self) -> None:
        line = "pulling... 5%"
        match = _PROGRESS_RE.search(line)
        assert match is not None
        assert match.group(1) == "5"


class TestModelPullerSkip:
    def test_skips_when_no_model_selected(self) -> None:

        state = InstallerState(selected_model="")
        log = MagicMock()
        progress = MagicMock()
        result = ModelPuller().pull(state, log, progress)
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

        mock_proc = MagicMock()
        mock_proc.stdout = iter(
            [
                "pulling manifest...\n",
                "pulling abc123... 50% |â–ˆâ–ˆâ–ˆâ–ˆâ–ˆ     | 2.5 GB/5.1 GB\n",
                "pulling abc123... 100% |â–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆâ–ˆ| 5.1 GB/5.1 GB\n",
            ]
        )
        mock_proc.wait.return_value = None
        mock_proc.returncode = 0
        mock_proc.poll.return_value = None  # "still running"; stdout EOF ends the loop

        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=mock_proc,
        ):
            result = ModelPuller().pull(state, log, progress)
            assert result is True
            assert progress.call_count >= 2

    def test_pull_failure(self) -> None:

        state = InstallerState(selected_model="gemma4:e2b")
        log = MagicMock()
        progress = MagicMock()

        mock_proc = MagicMock()
        mock_proc.stdout = iter(["error: model not found\n"])
        mock_proc.wait.return_value = None
        mock_proc.returncode = 1
        mock_proc.poll.return_value = None  # "still running"; stdout EOF ends the loop

        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=mock_proc,
        ):
            result = ModelPuller().pull(state, log, progress)
            assert result is False

    def test_pull_command_not_found(self) -> None:

        state = InstallerState(selected_model="gemma4:e2b")
        log = MagicMock()
        progress = MagicMock()

        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            side_effect=FileNotFoundError,
        ):
            result = ModelPuller().pull(state, log, progress)
            assert result is False

    def test_pull_cancelled(self) -> None:

        state = InstallerState(selected_model="gemma4:e2b")
        log = MagicMock()
        progress = MagicMock()

        mock_proc = MagicMock()
        # Simulate lines but cancellation happens
        mock_proc.stdout = iter(["pulling...\n"])
        mock_proc.wait.return_value = None
        mock_proc.returncode = -1

        puller = ModelPuller()
        puller._cancelled = True

        with patch(
            "nexus_installer.engine.model_puller.subprocess.Popen",
            return_value=mock_proc,
        ):
            result = puller.pull(state, log, progress)
            assert result is False

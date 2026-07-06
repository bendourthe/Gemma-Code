"""Tests for platform_utils module."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from nexus_installer.engine.platform_utils import (
    find_executable,
    run_command,
    run_command_streaming,
)


class TestRunCommand:
    def test_successful_command(self) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "hello"
        mock_result.stderr = ""
        with patch(
            "nexus_installer.engine.platform_utils.subprocess.run",
            return_value=mock_result,
        ):
            code, stdout, stderr = run_command(["echo", "hello"])
            assert code == 0
            assert stdout == "hello"

    def test_command_not_found(self) -> None:
        with patch(
            "nexus_installer.engine.platform_utils.subprocess.run",
            side_effect=FileNotFoundError,
        ):
            code, stdout, stderr = run_command(["nonexistent"])
            assert code == -1
            assert "not found" in stderr.lower()

    def test_timeout(self) -> None:
        import subprocess

        with patch(
            "nexus_installer.engine.platform_utils.subprocess.run",
            side_effect=subprocess.TimeoutExpired("cmd", 5),
        ):
            code, stdout, stderr = run_command(["slow"], timeout=5)
            assert code == -1
            assert "timed out" in stderr.lower()

    def test_os_error(self) -> None:
        with patch(
            "nexus_installer.engine.platform_utils.subprocess.run",
            side_effect=OSError("fail"),
        ):
            code, stdout, stderr = run_command(["broken"])
            assert code == -1


class TestRunCommandStreaming:
    def test_streams_lines(self) -> None:
        lines_received: list[str] = []
        mock_proc = MagicMock()
        mock_proc.stdout = iter(["line1\n", "line2\n"])
        mock_proc.wait.return_value = None
        mock_proc.returncode = 0
        with patch(
            "nexus_installer.engine.platform_utils.subprocess.Popen",
            return_value=mock_proc,
        ):
            code = run_command_streaming(
                ["cmd"], lambda line: lines_received.append(line)
            )
            assert code == 0
            assert lines_received == ["line1", "line2"]

    def test_returns_negative_on_not_found(self) -> None:
        lines: list[str] = []
        with patch(
            "nexus_installer.engine.platform_utils.subprocess.Popen",
            side_effect=FileNotFoundError,
        ):
            code = run_command_streaming(["missing"], lambda line: lines.append(line))
            assert code == -1


class TestFindExecutable:
    def test_found_on_path(self) -> None:
        with patch(
            "nexus_installer.engine.platform_utils.shutil.which",
            return_value="/usr/bin/python3",
        ):
            result = find_executable("python3")
            assert result == "/usr/bin/python3"

    def test_not_found(self) -> None:
        with patch(
            "nexus_installer.engine.platform_utils.shutil.which", return_value=None
        ):
            with patch(
                "nexus_installer.engine.platform_utils.os.path.isfile",
                return_value=False,
            ):
                result = find_executable("nonexistent", ["/tmp"])
                assert result is None

    def test_found_in_extra_paths(self) -> None:
        with patch(
            "nexus_installer.engine.platform_utils.shutil.which", return_value=None
        ):
            with (
                patch(
                    "nexus_installer.engine.platform_utils.os.path.isfile",
                    return_value=True,
                ),
                patch(
                    "nexus_installer.engine.platform_utils.os.access", return_value=True
                ),
            ):
                result = find_executable("tool", ["/opt/bin"])
                assert result is not None

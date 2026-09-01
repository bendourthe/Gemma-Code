"""Extended detection tests for GPU and prerequisite functions to boost coverage."""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

from nexus_installer.pages.gpu_detection import (
    _run_cmd,
    detect_amd_windows,
    detect_fallback_windows,
    recommend_model,
)
from nexus_installer.pages.prerequisites import (
    _find_vscode_windows,
    find_ollama,
)


class TestRunCmd:
    def test_successful_command(self) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "output"
        with patch(
            "nexus_installer.pages.gpu_detection.subprocess.run",
            return_value=mock_result,
        ):
            result = _run_cmd(["echo", "hi"])
            assert result == "output"

    def test_timeout(self) -> None:
        import subprocess

        with patch(
            "nexus_installer.pages.gpu_detection.subprocess.run",
            side_effect=subprocess.TimeoutExpired("cmd", 5),
        ):
            result = _run_cmd(["slow"])
            assert result is None

    def test_file_not_found(self) -> None:
        with patch(
            "nexus_installer.pages.gpu_detection.subprocess.run",
            side_effect=FileNotFoundError,
        ):
            result = _run_cmd(["nonexistent"])
            assert result is None

    def test_nonzero_exit_code(self) -> None:
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stdout = ""
        with patch(
            "nexus_installer.pages.gpu_detection.subprocess.run",
            return_value=mock_result,
        ):
            result = _run_cmd(["failing"])
            assert result is None


class TestDetectAmdWindows:
    def test_parses_amd_gpu(self) -> None:
        csv_output = '"Name","AdapterRAM"\n"AMD Radeon RX 7900 XTX","25769803776"'
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=csv_output
        ):
            name, vram = detect_amd_windows()
            assert "Radeon" in name
            assert vram > 0

    def test_ignores_non_amd(self) -> None:
        csv_output = '"Name","AdapterRAM"\n"NVIDIA GeForce","8589934592"'
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=csv_output
        ):
            name, vram = detect_amd_windows()
            assert name == ""

    def test_returns_empty_on_failure(self) -> None:
        with patch("nexus_installer.pages.gpu_detection._run_cmd", return_value=None):
            name, vram = detect_amd_windows()
            assert name == ""


class TestDetectFallbackWindows:
    def test_parses_wmi_output(self) -> None:
        csv_output = "Node,AdapterRAM,Name\nPC,8589934592,NVIDIA GeForce RTX 3070"
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=csv_output
        ):
            name, vendor, vram = detect_fallback_windows()
            assert "NVIDIA" in name
            assert vendor == "nvidia"
            assert vram > 0

    def test_intel_gpu(self) -> None:
        csv_output = "Node,AdapterRAM,Name\nPC,2147483648,Intel UHD Graphics 770"
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=csv_output
        ):
            name, vendor, vram = detect_fallback_windows()
            assert vendor == "intel"

    def test_returns_empty_on_failure(self) -> None:
        with patch("nexus_installer.pages.gpu_detection._run_cmd", return_value=None):
            name, vendor, vram = detect_fallback_windows()
            assert name == ""


class TestFindVscodeWindows:
    def test_well_known_path_found(self) -> None:
        with (
            patch(
                "nexus_installer.pages.prerequisites.os.path.isfile",
                side_effect=lambda p: "Microsoft VS Code" in p,
            ),
            patch.dict(
                os.environ,
                {
                    "LOCALAPPDATA": r"C:\Users\test\AppData\Local",
                    "PROGRAMFILES": r"C:\Program Files",
                },
            ),
        ):
            if sys.platform == "win32":
                path = _find_vscode_windows()
                # Well-known path should be found
                assert "code.cmd" in path.lower() or path != ""

    def test_path_fallback(self) -> None:
        with (
            patch(
                "nexus_installer.pages.prerequisites.os.path.isfile", return_value=False
            ),
            patch(
                "nexus_installer.pages.prerequisites.shutil.which",
                return_value=r"C:\path\code.cmd",
            ),
        ):
            if sys.platform == "win32":
                path = _find_vscode_windows()
                assert path != ""


class TestFindOllamaWindows:
    def test_found_in_localappdata(self) -> None:
        with (
            patch(
                "nexus_installer.pages.prerequisites.shutil.which", return_value=None
            ),
            patch("nexus_installer.pages.prerequisites.sys") as mock_sys,
            patch(
                "nexus_installer.pages.prerequisites.os.path.isfile", return_value=True
            ),
            patch(
                "nexus_installer.pages.prerequisites.os.environ",
                {"LOCALAPPDATA": r"C:\Users\test\AppData\Local"},
            ),
            patch("nexus_installer.pages.prerequisites.subprocess.run") as mock_run,
        ):
            mock_sys.platform = "win32"
            mock_run.return_value.stdout = "ollama version 0.1.44"
            installed, version = find_ollama()
            assert installed is True


class TestRecommendModelEdgeCases:
    def test_boundary_20480(self) -> None:
        name, _, _ = recommend_model(20480)
        assert name == "gemma4:31b"

    def test_boundary_8192(self) -> None:
        name, _, _ = recommend_model(8192)
        assert name == "gemma4:26b"

    def test_boundary_6144(self) -> None:
        name, _, _ = recommend_model(6144)
        assert name == "gemma4:e4b"

    def test_boundary_4096(self) -> None:
        name, _, _ = recommend_model(4096)
        assert name == "gemma4:e2b"

    def test_just_below_boundary(self) -> None:
        name, _, _ = recommend_model(4095)
        assert name == "gemma4:e2b"
        assert "CPU" in recommend_model(4095)[2]

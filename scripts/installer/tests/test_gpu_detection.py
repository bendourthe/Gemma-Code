"""Tests for GPU detection logic with mocked subprocess calls."""

from __future__ import annotations

from unittest.mock import patch

from nexus_installer.pages.gpu_detection import (
    detect_amd_linux,
    detect_apple,
    detect_fallback_linux,
    detect_gpu,
    detect_nvidia,
    recommend_model,
)


class TestRecommendModel:
    def test_high_vram_recommends_31b(self) -> None:
        name, label, _ = recommend_model(24576)
        assert name == "gemma4:31b"
        # v1.9.0 T026: the label is a plain-language descriptor (the size "31B"
        # is already shown in the model name), so assert it exists, not its text.
        assert label

    def test_20gb_recommends_31b(self) -> None:
        name, _, _ = recommend_model(20480)
        assert name == "gemma4:31b"

    def test_8gb_recommends_26b(self) -> None:
        name, _, _ = recommend_model(8192)
        assert name == "gemma4:26b"

    def test_6gb_recommends_e4b(self) -> None:
        name, _, _ = recommend_model(6144)
        assert name == "gemma4:e4b"

    def test_4gb_recommends_e2b(self) -> None:
        name, _, _ = recommend_model(4096)
        assert name == "gemma4:e2b"

    def test_low_vram_recommends_e2b_with_warning(self) -> None:
        name, _, desc = recommend_model(2048)
        assert name == "gemma4:e2b"
        assert "CPU" in desc

    def test_zero_vram_recommends_e2b(self) -> None:
        name, _, _ = recommend_model(0)
        assert name == "gemma4:e2b"


class TestDetectNvidia:
    def test_parses_csv_output(self) -> None:
        mock_output = "NVIDIA GeForce RTX 4090, 24576, 20000, 550.54.14"
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=mock_output
        ):
            name, vram, driver = detect_nvidia()
            assert name == "NVIDIA GeForce RTX 4090"
            assert vram == 24576
            assert driver == "550.54.14"

    def test_returns_empty_on_failure(self) -> None:
        with patch("nexus_installer.pages.gpu_detection._run_cmd", return_value=None):
            name, vram, driver = detect_nvidia()
            assert name == ""
            assert vram == 0

    def test_8gb_gpu(self) -> None:
        mock_output = "NVIDIA GeForce RTX 3060, 8192, 6000, 545.29"
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=mock_output
        ):
            name, vram, _ = detect_nvidia()
            assert vram == 8192


class TestDetectAmdLinux:
    def test_parses_rocm_smi_csv(self) -> None:
        mock_output = "GPU,VRAM Total,VRAM Used\n0,8589934592,1073741824"
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=mock_output
        ):
            name, vram = detect_amd_linux()
            assert "AMD" in name
            assert vram == 8192  # 8589934592 / (1024*1024)

    def test_returns_empty_on_failure(self) -> None:
        with patch("nexus_installer.pages.gpu_detection._run_cmd", return_value=None):
            name, vram = detect_amd_linux()
            assert name == ""
            assert vram == 0


class TestDetectApple:
    @patch("nexus_installer.pages.gpu_detection.sys")
    def test_non_darwin_returns_empty(self, mock_sys: object) -> None:
        import nexus_installer.pages.gpu_detection as mod

        original = mod.sys.platform
        mod.sys.platform = "win32"  # type: ignore[attr-defined]
        try:
            name, vram = detect_apple()
            assert name == ""
            assert vram == 0
        finally:
            mod.sys.platform = original  # type: ignore[attr-defined]


class TestDetectFallbackLinux:
    def test_parses_lspci_nvidia(self) -> None:
        mock_output = (
            "01:00.0 VGA compatible controller: NVIDIA Corporation "
            "GA102 [GeForce RTX 3090]"
        )
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=mock_output
        ):
            name, vendor = detect_fallback_linux()
            assert "NVIDIA" in name
            assert vendor == "nvidia"

    def test_parses_lspci_amd(self) -> None:
        mock_output = (
            "06:00.0 VGA compatible controller: Advanced Micro Devices "
            "[AMD/ATI] Navi 21 [Radeon RX 6800]"
        )
        with patch(
            "nexus_installer.pages.gpu_detection._run_cmd", return_value=mock_output
        ):
            name, vendor = detect_fallback_linux()
            assert vendor == "amd"

    def test_returns_empty_on_failure(self) -> None:
        with patch("nexus_installer.pages.gpu_detection._run_cmd", return_value=None):
            name, vendor = detect_fallback_linux()
            assert name == ""


class TestDetectGpuPipeline:
    def test_nvidia_found_first(self) -> None:
        with patch(
            "nexus_installer.pages.gpu_detection.detect_nvidia",
            return_value=("RTX 4090", 24576, "550"),
        ):
            name, vendor, vram = detect_gpu()
            assert vendor == "nvidia"
            assert vram == 24576

    def test_falls_through_to_none(self) -> None:
        with (
            patch(
                "nexus_installer.pages.gpu_detection.detect_nvidia",
                return_value=("", 0, ""),
            ),
            patch(
                "nexus_installer.pages.gpu_detection.detect_amd_linux",
                return_value=("", 0),
            ),
            patch(
                "nexus_installer.pages.gpu_detection.detect_amd_windows",
                return_value=("", 0),
            ),
            patch(
                "nexus_installer.pages.gpu_detection.detect_apple", return_value=("", 0)
            ),
            patch(
                "nexus_installer.pages.gpu_detection.detect_fallback_windows",
                return_value=("", "", 0),
            ),
            patch(
                "nexus_installer.pages.gpu_detection.detect_fallback_linux",
                return_value=("", ""),
            ),
        ):
            name, vendor, vram = detect_gpu()
            assert vendor == "none"
            assert vram == 0

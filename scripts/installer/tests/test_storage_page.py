"""v1.1.0 Phase 14.11 -- tests for the storage review page."""

from __future__ import annotations

import pytest

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.storage import (
    RUNTIME_COMPONENT_COSTS_GB,
    StoragePage,
    build_breakdown,
    compute_runtime_cost_gb,
    net_color,
)


class TestComputeRuntimeCost:
    def test_windows_cuda(self) -> None:
        cost = compute_runtime_cost_gb("windows", cuda_compatible=True)
        assert cost == pytest.approx(
            RUNTIME_COMPONENT_COSTS_GB["python_venv"]
            + RUNTIME_COMPONENT_COSTS_GB["node"]
            + RUNTIME_COMPONENT_COSTS_GB["ollama"]
            + RUNTIME_COMPONENT_COSTS_GB["ffmpeg"]
            + RUNTIME_COMPONENT_COSTS_GB["cuda"]
        )

    def test_macos_no_cuda(self) -> None:
        cost = compute_runtime_cost_gb("macos", cuda_compatible=False)
        assert cost == pytest.approx(
            RUNTIME_COMPONENT_COSTS_GB["python_venv"]
            + RUNTIME_COMPONENT_COSTS_GB["node"]
            + RUNTIME_COMPONENT_COSTS_GB["ollama"]
            + RUNTIME_COMPONENT_COSTS_GB["ffmpeg"]
        )

    def test_linux_cpu(self) -> None:
        cost = compute_runtime_cost_gb("linux", cuda_compatible=False)
        assert cost < compute_runtime_cost_gb("linux", cuda_compatible=True)


class TestNetColor:
    @pytest.mark.parametrize(
        ("remaining", "reserve", "expected"),
        [
            (5, 10, "#ef4444"),
            (15, 10, "#f59e0b"),
            (25, 10, "#22c55e"),
        ],
    )
    def test_colors(self, remaining: float, reserve: float, expected: str) -> None:
        assert net_color(remaining, reserve) == expected


class TestBuildBreakdown:
    def test_uses_state(self) -> None:
        state = InstallerState()
        state.free_disk_gb = 200
        state.selected_models_gb = 50
        state.gpu_vendor = "nvidia"
        state.platform = "win32"
        b = build_breakdown(state)
        assert b.free_gb == 200
        assert b.models_gb == 50
        assert b.runtime_gb > 0
        assert b.net_remaining_gb < 200


class TestStoragePage:
    def test_renders(self, qt_app) -> None:
        state = InstallerState()
        state.free_disk_gb = 200
        state.selected_models_gb = 30
        state.gpu_vendor = "nvidia"
        page = StoragePage(state)
        # Card should have at least 5 rows (free, runtime, models, reserve, net).
        assert page._card_layout.count() >= 5

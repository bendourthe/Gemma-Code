"""v1.1.0 Phase 14.8 -- tests for the final install-click disk guard."""

from __future__ import annotations

import pytest

from nexus_installer.engine.install_guard import evaluate_install_guard


class TestEvaluateInstallGuard:
    def test_passes_with_room(self) -> None:
        r = evaluate_install_guard(free_disk_gb=100, selection_gb=45, reserve_gb=10)
        assert r.ok is True
        assert r.message == "ok"

    def test_boundary_passes(self) -> None:
        r = evaluate_install_guard(free_disk_gb=100, selection_gb=90, reserve_gb=10)
        # 90 + 10 == 100 -> exactly on the boundary; allow.
        assert r.ok is True

    def test_blocks_below_reserve(self) -> None:
        r = evaluate_install_guard(free_disk_gb=50, selection_gb=45, reserve_gb=10)
        assert r.ok is False
        assert "Insufficient disk space" in r.message
        assert "need 55.0" in r.message
        assert "have 50.0" in r.message

    def test_zero_free_disk_blocked(self) -> None:
        r = evaluate_install_guard(free_disk_gb=0, selection_gb=10, reserve_gb=10)
        assert r.ok is False
        assert "Could not read free disk space" in r.message

    @pytest.mark.parametrize(
        ("free", "sel", "reserve", "expected_ok"),
        [
            (90, 80, 10, True),  # exact boundary
            (90, 81, 10, False),  # 81 + 10 = 91 > 90
            (100, 0, 10, True),
            (5, 0, 10, False),  # reserve alone exceeds free
        ],
    )
    def test_matrix(
        self, free: float, sel: float, reserve: float, expected_ok: bool
    ) -> None:
        r = evaluate_install_guard(
            free_disk_gb=free, selection_gb=sel, reserve_gb=reserve
        )
        assert r.ok is expected_ok

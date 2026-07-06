"""Tests for the ConstellationBackground widget + its pure helpers (T204)."""

from __future__ import annotations

import pytest

from nexus_installer.widgets.constellation import (
    ConstellationBackground,
    compute_node_count,
    prefers_reduced_motion,
)


class TestComputeNodeCount:
    def test_floor_at_18(self) -> None:
        assert compute_node_count(100) == 18
        assert compute_node_count(0) == 18

    def test_cap_at_46(self) -> None:
        assert compute_node_count(5000) == 46

    def test_scales_with_width(self) -> None:
        # ~40 nodes at a typical window width; 912 // 34 == 26.
        assert compute_node_count(912) == 26
        assert compute_node_count(34 * 40) == 40


class TestPrefersReducedMotion:
    def test_true_values(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for value in ("1", "true", "TRUE", "yes", "on"):
            monkeypatch.setenv("NEXUS_REDUCED_MOTION", value)
            assert prefers_reduced_motion() is True

    def test_false_when_absent_or_empty(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("NEXUS_REDUCED_MOTION", raising=False)
        assert prefers_reduced_motion() is False
        monkeypatch.setenv("NEXUS_REDUCED_MOTION", "0")
        assert prefers_reduced_motion() is False


class TestConstellationBackground:
    def test_node_count_tracks_width(self, qt_app: object) -> None:
        widget = ConstellationBackground(reduced_motion=False)
        widget.resize(912, 600)
        widget.start()
        assert widget.node_count() == compute_node_count(912)

    def test_start_stop_toggles_running(self, qt_app: object) -> None:
        widget = ConstellationBackground(reduced_motion=False)
        widget.resize(800, 500)
        assert widget.is_running() is False
        widget.start()
        assert widget.is_running() is True
        widget.stop()
        assert widget.is_running() is False

    def test_reduced_motion_never_runs(self, qt_app: object) -> None:
        widget = ConstellationBackground(reduced_motion=True)
        widget.resize(800, 500)
        widget.start()
        assert widget.is_running() is False

    def test_resume_after_stop_keeps_node_count(self, qt_app: object) -> None:
        widget = ConstellationBackground(reduced_motion=False)
        widget.resize(912, 600)
        widget.start()
        count = widget.node_count()
        widget.stop()
        widget.start()
        assert widget.node_count() == count

    def test_hide_event_pauses_show_event_resumes(self, qt_app: object) -> None:
        from PyQt5.QtGui import QHideEvent, QShowEvent

        widget = ConstellationBackground(reduced_motion=False)
        widget.resize(800, 500)
        widget.showEvent(QShowEvent())
        assert widget.is_running() is True
        widget.hideEvent(QHideEvent())
        assert widget.is_running() is False
        widget.showEvent(QShowEvent())
        assert widget.is_running() is True
        widget.stop()

    def test_advance_bounces_off_edges(self, qt_app: object) -> None:
        widget = ConstellationBackground(reduced_motion=False)
        widget.resize(400, 300)
        widget.start()
        node = widget._nodes[0]
        node.x = -1.0
        node.vx = -0.5
        widget._advance()
        # Out-of-bounds on the left flips the x velocity to positive.
        assert node.vx > 0

    def test_render_does_not_crash(self, qt_app: object) -> None:
        widget = ConstellationBackground(reduced_motion=False)
        widget.resize(600, 400)
        widget.start()
        pixmap = widget.grab()
        assert pixmap.width() > 0
        widget.stop()

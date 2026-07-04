"""Tests for the constellation body treatment + reduced-motion resolver (T302)."""

from __future__ import annotations

import pytest


class TestResolveReducedMotion:
    def test_env_var_forces_reduced_motion(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from nexus_installer.widgets.background import resolve_reduced_motion

        monkeypatch.setenv("NEXUS_REDUCED_MOTION", "1")
        assert resolve_reduced_motion() is True

    def test_non_windows_without_env_is_motion_on(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from nexus_installer.widgets import background

        monkeypatch.delenv("NEXUS_REDUCED_MOTION", raising=False)
        monkeypatch.setattr(background.sys, "platform", "linux")
        assert background.resolve_reduced_motion() is False

    def test_windows_probe_disabled_animations(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A Windows box with in-window animations off reduces motion."""
        from nexus_installer.widgets import background

        monkeypatch.delenv("NEXUS_REDUCED_MOTION", raising=False)
        monkeypatch.setattr(background.sys, "platform", "win32")
        monkeypatch.setattr(background, "_windows_animations_disabled", lambda: True)
        assert background.resolve_reduced_motion() is True

    def test_windows_probe_enabled_animations(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from nexus_installer.widgets import background

        monkeypatch.delenv("NEXUS_REDUCED_MOTION", raising=False)
        monkeypatch.setattr(background.sys, "platform", "win32")
        monkeypatch.setattr(background, "_windows_animations_disabled", lambda: False)
        assert background.resolve_reduced_motion() is False

    def test_returns_bool_on_this_platform(self) -> None:
        from nexus_installer.widgets.background import resolve_reduced_motion

        assert isinstance(resolve_reduced_motion(), bool)


class TestBackgroundWidget:
    def test_hosts_constellation(self, qt_app: object) -> None:
        from nexus_installer.widgets.background import BackgroundWidget

        widget = BackgroundWidget(reduced_motion=False)
        assert widget.constellation is not None
        assert widget.reduced_motion is False

    def test_reduced_motion_propagates(self, qt_app: object) -> None:
        from nexus_installer.widgets.background import BackgroundWidget

        widget = BackgroundWidget(reduced_motion=True)
        assert widget.reduced_motion is True
        assert widget.constellation.reduced_motion is True

    def test_resize_sizes_constellation(self, qt_app: object) -> None:
        from nexus_installer.widgets.background import BackgroundWidget

        widget = BackgroundWidget(reduced_motion=False)
        widget.resize(700, 500)
        widget.layout().activate()  # apply the zero-margin layout synchronously
        assert widget.constellation.width() == 700
        assert widget.constellation.height() == 500

    def test_render_does_not_crash(self, qt_app: object) -> None:
        from nexus_installer.widgets.background import BackgroundWidget

        widget = BackgroundWidget(reduced_motion=True)
        widget.resize(600, 400)
        pixmap = widget.grab()
        assert pixmap.width() > 0

    def test_default_reduced_motion_uses_resolver(
        self, qt_app: object, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from nexus_installer.widgets import background

        monkeypatch.setenv("NEXUS_REDUCED_MOTION", "1")
        widget = background.BackgroundWidget()
        assert widget.reduced_motion is True

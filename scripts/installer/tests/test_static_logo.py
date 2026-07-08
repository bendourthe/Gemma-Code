"""Tests for the StaticLogo primitive (v1.9.0 T012).

StaticLogo replaces the retired FloatingLogo: a still, glowing transparent mark
with no bob animation (the header/welcome lag source is gone).
"""

from __future__ import annotations

from nexus_installer.widgets.static_logo import StaticLogo


class TestStaticLogo:
    def test_creates_with_default_asset(self, qt_app: object) -> None:
        logo = StaticLogo()
        assert logo.width() == 40
        assert logo.height() == 40
        # The transparent brand mark resolves from the repo-root assets/ dir.
        assert logo.has_pixmap is True
        assert not logo.pixmap().isNull()

    def test_missing_pixmap_is_graceful(self, qt_app: object) -> None:
        logo = StaticLogo("does/not/exist.png")
        assert logo.has_pixmap is False

    def test_custom_size(self, qt_app: object) -> None:
        logo = StaticLogo(size=64)
        assert logo.width() == 64
        assert logo.height() == 64

    def test_has_glow_effect(self, qt_app: object) -> None:
        logo = StaticLogo()
        assert logo.graphicsEffect() is not None

    def test_is_not_animated(self, qt_app: object) -> None:
        """No animation API -- StaticLogo is a plain, still QLabel."""
        logo = StaticLogo()
        assert not hasattr(logo, "start")
        assert not hasattr(logo, "is_animating")

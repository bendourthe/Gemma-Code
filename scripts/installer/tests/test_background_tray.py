"""v1.11.0 Phase 7 (T702/T705) -- tray tooltip/notification + controller."""

from __future__ import annotations

import pytest

from nexus_installer.background.tray import (
    TrayController,
    completion_message,
    tray_tooltip,
)


class _FakeIcon:
    """Duck-typed stand-in for QSystemTrayIcon (no real system tray needed)."""

    def __init__(self) -> None:
        self.tooltip: str | None = None
        self.shown = False
        self.messages: list[tuple[str, str]] = []
        self.menu: object | None = None

    def setToolTip(self, tip: str) -> None:  # noqa: N802
        self.tooltip = tip

    def show(self) -> None:
        self.shown = True

    def hide(self) -> None:
        self.shown = False

    def setContextMenu(self, menu: object) -> None:  # noqa: N802
        self.menu = menu

    def showMessage(self, title: str, msg: str) -> None:  # noqa: N802
        self.messages.append((title, msg))


class TestPureHelpers:
    def test_tooltip_formats_percent(self) -> None:
        assert tray_tooltip("Installing...", 0.42) == (
            "Nexus AI Studio - Installing... 42%"
        )

    def test_tooltip_clamps(self) -> None:
        assert "100%" in tray_tooltip("x", 1.5)
        assert "0%" in tray_tooltip("x", -0.3)

    def test_completion_message_success(self) -> None:
        title, body = completion_message(True)
        assert "complete" in title.lower()
        assert "ready" in body.lower()

    def test_completion_message_failure_counts(self) -> None:
        title, body = completion_message(False, failed_count=3)
        assert "warning" in title.lower()
        assert "3" in body


class TestTrayController:
    def test_update_sets_tooltip(self, qt_app: object) -> None:
        icon = _FakeIcon()
        ctrl = TrayController(icon)
        ctrl.update(0.5)
        assert icon.tooltip == "Nexus AI Studio - Installing... 50%"
        assert ctrl.tooltip == icon.tooltip

    def test_show_and_hide_toggle_visibility(self, qt_app: object) -> None:
        icon = _FakeIcon()
        ctrl = TrayController(icon)
        assert ctrl.visible is False
        ctrl.show()
        assert ctrl.visible is True
        assert icon.shown is True
        ctrl.hide()
        assert ctrl.visible is False
        assert icon.shown is False

    def test_notify_complete_shows_message(self, qt_app: object) -> None:
        icon = _FakeIcon()
        ctrl = TrayController(icon)
        ctrl.notify_complete(True)
        assert len(icon.messages) == 1
        assert "Complete" in icon.tooltip  # type: ignore[operator]

    def test_menu_actions_emit_signals(self, qt_app: object) -> None:
        icon = _FakeIcon()
        ctrl = TrayController(icon)
        opened: list[bool] = []
        cancelled: list[bool] = []
        ctrl.open_requested.connect(lambda: opened.append(True))
        ctrl.cancel_requested.connect(lambda: cancelled.append(True))
        actions = ctrl._menu.actions()
        assert [a.text() for a in actions] == [
            "Open installer",
            "Cancel install",
        ]
        actions[0].trigger()
        actions[1].trigger()
        assert opened == [True]
        assert cancelled == [True]

    def test_context_menu_installed_on_icon(self, qt_app: object) -> None:
        icon = _FakeIcon()
        TrayController(icon)
        assert icon.menu is not None


def test_module_imports_without_real_tray() -> None:
    # is_tray_available() must be callable without raising even headless.
    from nexus_installer.background import tray

    assert isinstance(tray.is_tray_available(), bool)


@pytest.mark.parametrize("fraction", [0.0, 0.5, 1.0])
def test_tooltip_never_out_of_range(fraction: float) -> None:
    text = tray_tooltip("Installing...", fraction)
    pct = int(text.rstrip("%").split()[-1])
    assert 0 <= pct <= 100

"""Tests for the frameless TitleBar widget (v1.9.0 T301 / T307)."""

from __future__ import annotations

from PyQt5.QtCore import QPoint, Qt


class _FakeMouseEvent:
    """Minimal stand-in for QMouseEvent used by the drag/double-click handlers."""

    def __init__(
        self,
        button: Qt.MouseButton = Qt.MouseButton.LeftButton,
        buttons: Qt.MouseButton = Qt.MouseButton.LeftButton,
        global_pos: QPoint | None = None,
    ) -> None:
        self._button = button
        self._buttons = buttons
        self._global = global_pos or QPoint(0, 0)
        self.accepted = False

    def button(self) -> Qt.MouseButton:
        return self._button

    def buttons(self) -> Qt.MouseButton:
        return self._buttons

    def globalPos(self) -> QPoint:  # noqa: N802
        return self._global

    def accept(self) -> None:
        self.accepted = True


class TestTitleBarConstruction:
    def test_default_title_and_controls(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        assert bar.title() == "Nexus AI Studio"
        assert bar.minimize_button is not None
        assert bar.maximize_button is not None
        assert bar.close_button is not None

    def test_set_title(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar("Custom")
        assert bar.title() == "Custom"
        bar.set_title("Nexus AI Studio")
        assert bar.title() == "Nexus AI Studio"

    def test_brand_mark_present(self, qt_app: object) -> None:
        # assets/icon.png is regenerated transparent in Phase 2 and resolvable
        # from the source tree, so the mark renders.
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        assert bar.has_mark is True

    def test_missing_mark_degrades(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar(mark_path="does/not/exist.png")
        assert bar.has_mark is False


class TestTitleBarSignals:
    def test_minimize_button_emits(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        fired: list[bool] = []
        bar.minimize_requested.connect(lambda: fired.append(True))
        bar.minimize_button.click()
        assert fired == [True]

    def test_maximize_button_emits(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        fired: list[bool] = []
        bar.maximize_toggle_requested.connect(lambda: fired.append(True))
        bar.maximize_button.click()
        assert fired == [True]

    def test_close_button_emits(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        fired: list[bool] = []
        bar.close_requested.connect(lambda: fired.append(True))
        bar.close_button.click()
        assert fired == [True]

    def test_double_click_emits_maximize(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        fired: list[bool] = []
        bar.maximize_toggle_requested.connect(lambda: fired.append(True))
        event = _FakeMouseEvent()
        bar.mouseDoubleClickEvent(event)
        assert fired == [True]
        assert event.accepted is True

    def test_right_double_click_ignored(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        fired: list[bool] = []
        bar.maximize_toggle_requested.connect(lambda: fired.append(True))
        bar.mouseDoubleClickEvent(_FakeMouseEvent(button=Qt.MouseButton.RightButton))
        assert fired == []


class TestTitleBarBehaviour:
    def test_set_maximized_swaps_glyph(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        maximized_glyph = bar.maximize_button.text()
        bar.set_maximized(True)
        assert bar.maximize_button.text() != maximized_glyph
        bar.set_maximized(False)
        assert bar.maximize_button.text() == maximized_glyph

    def test_drag_math(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        # No drag started yet -> no target.
        assert bar._drag_target(QPoint(50, 50)) is None
        bar._begin_drag(QPoint(50, 40), QPoint(10, 10))
        # offset = (40, 30); moving the cursor to (100, 90) -> window (60, 60).
        assert bar._drag_target(QPoint(100, 90)) == QPoint(60, 60)

    def test_system_move_false_without_handle(self, qt_app: object) -> None:
        # An unshown top-level widget has no windowHandle(), so the native move
        # path reports "not started" and the manual fallback takes over.
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        assert bar._try_system_move() is False

    def test_mouse_press_begins_manual_drag(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        event = _FakeMouseEvent(global_pos=QPoint(20, 20))
        bar.mousePressEvent(event)
        # With no window handle, the manual offset is recorded and a later move
        # produces a target.
        assert bar._drag_target(QPoint(30, 30)) is not None
        assert event.accepted is True
        bar.mouseReleaseEvent(_FakeMouseEvent())
        assert bar._drag_target(QPoint(30, 30)) is None

    def test_mouse_move_moves_window(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()  # a parentless widget is its own top-level window
        bar._begin_drag(QPoint(20, 20), QPoint(0, 0))  # offset (20, 20)
        move = _FakeMouseEvent(global_pos=QPoint(120, 90))
        bar.mouseMoveEvent(move)
        assert bar.pos() == QPoint(100, 70)
        assert move.accepted is True

    def test_mouse_move_without_button_ignored(self, qt_app: object) -> None:
        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        bar._begin_drag(QPoint(20, 20), QPoint(0, 0))
        move = _FakeMouseEvent(buttons=Qt.MouseButton.NoButton)
        bar.mouseMoveEvent(move)  # no left button held -> ignored
        assert move.accepted is False

    def test_non_left_press_delegates_to_super(self, qt_app: object) -> None:
        from PyQt5.QtCore import QEvent, QPointF
        from PyQt5.QtGui import QMouseEvent

        from nexus_installer.widgets.title_bar import TitleBar

        bar = TitleBar()
        event = QMouseEvent(
            QEvent.Type.MouseButtonPress,
            QPointF(0.0, 0.0),
            Qt.MouseButton.RightButton,
            Qt.MouseButton.RightButton,
            Qt.KeyboardModifier.NoModifier,
        )
        bar.mousePressEvent(event)  # right-click delegates; no drag begins
        assert bar._drag_target(QPoint(5, 5)) is None

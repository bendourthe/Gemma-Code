"""v1.11.0 Phase 7 (T702/T703/T705) -- window close-choice + reattach."""

from __future__ import annotations

from PyQt5.QtWidgets import QWidget

from nexus_installer.installer_state import InstallerState
from nexus_installer.window import InstallerWindow


class _FakeEvent:
    """Minimal QCloseEvent stand-in recording accept/ignore."""

    def __init__(self) -> None:
        self.accepted: bool | None = None

    def accept(self) -> None:
        self.accepted = True

    def ignore(self) -> None:
        self.accepted = False


class _RunningPage(QWidget):
    """A page that looks like a live install to the window."""

    def __init__(self) -> None:
        super().__init__()
        self.is_running = True
        self.cancels = 0

    def cancel_install(self) -> None:
        self.cancels += 1
        self.is_running = False


def _window_with_running_install(
    qt_app: object,
) -> tuple[InstallerWindow, _RunningPage]:
    win = InstallerWindow()
    page = _RunningPage()
    win.add_page(page)
    win.show_first_page()
    return win, page


class TestCloseDuringInstall:
    def test_background_choice_detaches_and_emits(self, qt_app: object) -> None:
        win, _page = _window_with_running_install(qt_app)
        win._close_choice_provider = lambda: win.CLOSE_BACKGROUND
        emitted: list[bool] = []
        win.background_requested.connect(lambda: emitted.append(True))
        event = _FakeEvent()
        win.closeEvent(event)  # type: ignore[arg-type]
        # Detached, not closed: the event is ignored and the tray is asked for.
        assert event.accepted is False
        assert emitted == [True]
        assert win.isHidden()

    def test_cancel_choice_cancels_and_closes(self, qt_app: object) -> None:
        win, page = _window_with_running_install(qt_app)
        win._close_choice_provider = lambda: win.CLOSE_CANCEL
        event = _FakeEvent()
        win.closeEvent(event)  # type: ignore[arg-type]
        assert page.cancels == 1
        assert event.accepted is True

    def test_keep_open_choice_ignores_close(self, qt_app: object) -> None:
        win, page = _window_with_running_install(qt_app)
        win._close_choice_provider = lambda: win.CLOSE_KEEP
        event = _FakeEvent()
        win.closeEvent(event)  # type: ignore[arg-type]
        assert event.accepted is False
        assert page.cancels == 0

    def test_close_without_running_install_accepts(self, qt_app: object) -> None:
        win = InstallerWindow()
        win.add_page(QWidget())
        win.show_first_page()
        event = _FakeEvent()
        win.closeEvent(event)  # type: ignore[arg-type]
        assert event.accepted is True


class TestReattach:
    def test_show_and_raise_unhides(self, qt_app: object) -> None:
        win = InstallerWindow()
        win.add_page(QWidget())
        win.show_first_page()
        win.hide()
        assert win.isHidden()
        win.show_and_raise()
        assert not win.isHidden()


class TestInstallingPageCancel:
    def test_cancel_install_finishes_without_prompt(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        page = InstallingPage(InstallerState())
        page._is_running = True  # simulate a live install (no real thread)
        results: list[bool] = []
        page.finished.connect(results.append)
        page.cancel_install()
        assert page._is_running is False
        assert results == [False]

    def test_cancel_install_is_noop_when_not_running(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        page = InstallingPage(InstallerState())
        results: list[bool] = []
        page.finished.connect(results.append)
        page.cancel_install()
        assert results == []

    def test_engine_created_hook_is_stored(self, qt_app: object) -> None:
        from nexus_installer.pages.installing import InstallingPage

        seen: list[object] = []

        def hook(engine: object) -> None:
            seen.append(engine)

        page = InstallingPage(InstallerState(), on_engine_created=hook)
        assert page._on_engine_created is hook

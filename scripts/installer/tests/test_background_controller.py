"""v1.11.0 Phase 7 (T701-T705) -- BackgroundController wiring with fakes."""

from __future__ import annotations

from types import SimpleNamespace

from nexus_installer.background.controller import BackgroundController
from nexus_installer.engine.installer import InstallEngine
from nexus_installer.installer_state import InstallerState


class _FakeTray:
    def __init__(self, visible: bool = False) -> None:
        self.visible = visible
        self.updates: list[float] = []
        self.notifications: list[tuple[bool, int]] = []

    def update(self, fraction: float, status_text: str = "Installing...") -> None:
        self.updates.append(fraction)

    def show(self) -> None:
        self.visible = True

    def hide(self) -> None:
        self.visible = False

    def notify_complete(self, success: bool, failed_count: int = 0) -> None:
        self.notifications.append((success, failed_count))


class _FakeRecorder:
    def __init__(self) -> None:
        self.state = SimpleNamespace(overall_progress=0.6)
        self.began: list[tuple[object, list[str]]] = []
        self.attached: list[object] = []
        self.cancelled = 0

    def begin(self, installer_state: object, model_ids: list[str]) -> None:
        self.began.append((installer_state, model_ids))

    def attach(self, engine: object) -> None:
        self.attached.append(engine)

    def mark_cancelled(self) -> None:
        self.cancelled += 1


class _FakeWindow:
    def __init__(self) -> None:
        self.raised = 0

    def show_and_raise(self) -> None:
        self.raised += 1


class _FakePage:
    def __init__(self) -> None:
        self.cancels = 0

    def cancel_install(self) -> None:
        self.cancels += 1


def _controller(
    tray: _FakeTray | None,
) -> tuple[BackgroundController, _FakeRecorder, _FakeWindow, _FakePage]:
    recorder = _FakeRecorder()
    window = _FakeWindow()
    page = _FakePage()
    state = InstallerState(components_to_install=["model"])
    state.selected_model_ids = ["m1"]
    ctrl = BackgroundController(
        window=window, installer_state=state, recorder=recorder, tray=tray
    )
    ctrl.attach_installing_page(page)
    return ctrl, recorder, window, page


class TestEngineWiring:
    def test_on_engine_created_begins_and_attaches(self) -> None:
        tray = _FakeTray()
        ctrl, recorder, _win, _page = _controller(tray)
        engine = InstallEngine()
        ctrl.on_engine_created(engine)
        assert recorder.began and recorder.began[0][1] == ["m1"]
        assert recorder.attached == [engine]

    def test_progress_forwards_to_tray(self) -> None:
        tray = _FakeTray()
        ctrl, _rec, _win, _page = _controller(tray)
        engine = InstallEngine()
        ctrl.on_engine_created(engine)
        engine.progress_update.emit(0.5)
        assert tray.updates[-1] == 0.5

    def test_finish_notifies_only_when_backgrounded(self) -> None:
        tray = _FakeTray(visible=False)
        ctrl, _rec, _win, _page = _controller(tray)
        engine = InstallEngine()
        ctrl.on_engine_created(engine)
        engine.install_finished.emit(True, "")
        assert tray.notifications == []  # foreground finish: no popup
        ctrl.request_background()  # user detaches
        engine.install_finished.emit(False, "warnings")
        assert tray.notifications == [(False, 0)]


class TestDetachReattachCancel:
    def test_request_background_shows_tray(self) -> None:
        tray = _FakeTray()
        ctrl, _rec, _win, _page = _controller(tray)
        ctrl.request_background()
        assert tray.visible is True
        assert tray.updates[-1] == 0.6  # seeded from recorder.state

    def test_open_from_tray_raises_window_and_hides_tray(self) -> None:
        tray = _FakeTray(visible=True)
        ctrl, _rec, window, _page = _controller(tray)
        ctrl.open_from_tray()
        assert window.raised == 1
        assert tray.visible is False

    def test_cancel_from_tray_marks_and_cancels(self) -> None:
        tray = _FakeTray(visible=True)
        ctrl, recorder, _win, page = _controller(tray)
        ctrl.cancel_from_tray()
        assert recorder.cancelled == 1
        assert page.cancels == 1
        assert tray.visible is False

    def test_works_without_tray(self) -> None:
        ctrl, _rec, window, _page = _controller(None)
        # No tray configured (headless / no system tray): these are safe no-ops.
        ctrl.request_background()
        ctrl.open_from_tray()
        assert window.raised == 1

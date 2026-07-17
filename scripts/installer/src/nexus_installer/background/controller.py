"""Background-continuation wiring (v1.11.0 Phase 7, T701-T704).

:class:`BackgroundController` ties the window, the install engine, the state
recorder, and the tray icon together. It is a plain (non-QObject) class whose
handler methods are directly callable, so the wiring behavior is unit-testable
with fakes -- the GUI entry point only has to connect Qt signals to these
methods.

The controller owns three flows:

* **detach** -- ``request_background`` moves progress to the tray (T702);
* **reattach** -- ``open_from_tray`` / a second-launch handshake brings the live
  window back (T703);
* **cancel from tray** -- ``cancel_from_tray`` records the cancel and stops the
  engine (T702).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from nexus_installer.engine.model_router import resolve_selected_models

if TYPE_CHECKING:
    from nexus_installer.background.recorder import StateRecorder
    from nexus_installer.background.tray import TrayController
    from nexus_installer.engine.installer import InstallEngine
    from nexus_installer.installer_state import InstallerState


class BackgroundController:
    """Coordinate persistence, tray detach/reattach, and cancel for one run."""

    def __init__(
        self,
        *,
        window: object,
        installer_state: InstallerState,
        recorder: StateRecorder,
        tray: TrayController | None = None,
    ) -> None:
        self._window = window
        self._state = installer_state
        self._recorder = recorder
        self._tray = tray
        self._installing_page: object | None = None
        self._finished = False

    def attach_installing_page(self, page: object) -> None:
        """Give the controller the page it cancels on a tray cancel."""
        self._installing_page = page

    # -- engine lifecycle -------------------------------------------------

    def on_engine_created(self, engine: InstallEngine) -> None:
        """Attach persistence + tray to a freshly-created engine (T701)."""
        self._recorder.begin(self._state, resolve_selected_models(self._state))
        self._recorder.attach(engine)
        engine.progress_update.connect(self._on_progress)
        engine.install_finished.connect(self._on_finished)

    def _on_progress(self, value: float) -> None:
        if self._tray is not None:
            self._tray.update(value)

    def _on_finished(self, success: bool, _message: str) -> None:
        self._finished = True
        # Only pop a notification when the user is actually in the background;
        # a foreground finish is already visible in the window.
        if self._tray is not None and self._tray.visible:
            self._tray.notify_complete(success, len(self._state.failed_steps))

    # -- detach / reattach / cancel --------------------------------------

    def request_background(self) -> None:
        """User chose "Continue in background": surface the tray (T702)."""
        if self._tray is not None:
            self._tray.update(self._recorder.state.overall_progress)
            self._tray.show()

    def open_from_tray(self) -> None:
        """Tray "Open installer" / reattach handshake: bring the window back."""
        show = getattr(self._window, "show_and_raise", None)
        if callable(show):
            show()
        if self._tray is not None:
            self._tray.hide()

    def cancel_from_tray(self) -> None:
        """Tray "Cancel install": record the cancel and stop the engine."""
        self._recorder.mark_cancelled()
        cancel = getattr(self._installing_page, "cancel_install", None)
        if callable(cancel):
            cancel()
        if self._tray is not None:
            self._tray.hide()

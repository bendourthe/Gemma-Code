"""Main QMainWindow: frameless title bar, header, step indicator, content, footer.

v1.9.0 Phase 3 (T301/T302): the window is frameless by default -- the OS chrome
is replaced by a custom :class:`TitleBar`, and an animated constellation over a
radial-glow body treatment is mounted behind the transparent content band. A
``NEXUS_NATIVE_TITLEBAR`` env var (or ``frameless=False``) restores native
decorations as the documented fallback (see the plan's Risks table).
"""

from __future__ import annotations

import os
from collections.abc import Callable

from PyQt5.QtCore import QEvent, Qt, pyqtSignal
from PyQt5.QtGui import QIcon
from PyQt5.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QScrollArea,
    QShortcut,
    QSizeGrip,
    QVBoxLayout,
    QWidget,
)

from nexus_installer.constants import (
    ACCENT,
    ERROR,
    FS_CAPTION,
    SIDE_MARGIN,
    STEP_NAMES,
    TEXT_PRIMARY,
    VERTICAL_MARGIN,
    WINDOW_DEFAULT_HEIGHT,
    WINDOW_DEFAULT_WIDTH,
    WINDOW_MIN_HEIGHT,
    WINDOW_MIN_WIDTH,
)
from nexus_installer.engine.install_guard import evaluate_install_guard
from nexus_installer.installer_state import InstallerState
from nexus_installer.registry_paths import resolve_window_icon
from nexus_installer.theme import generate_stylesheet
from nexus_installer.widgets.background import BackgroundWidget
from nexus_installer.widgets.footer import Footer
from nexus_installer.widgets.header import HEADER_STEP_PX, Header
from nexus_installer.widgets.sidebar import Sidebar
from nexus_installer.widgets.step_indicator import StepIndicator
from nexus_installer.widgets.title_bar import TitleBar

#: Window title / OS taskbar caption (T304).
WINDOW_TITLE = "Nexus AI Studio"


def _native_titlebar_forced() -> bool:
    """True when the operator opts out of the frameless chrome (fallback)."""
    return os.environ.get("NEXUS_NATIVE_TITLEBAR", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


class InstallerWindow(QMainWindow):
    """Resizable window with title bar, header, step indicator, content, footer."""

    # v1.11.0 Phase 7 (T702): emitted when the user closes the window mid-install
    # and chooses "Continue in background". The GUI entry point reacts by showing
    # the tray icon; the window has already hidden itself (the engine keeps
    # running in the same process, so this is a detach, not a close).
    background_requested = pyqtSignal()

    # Close-during-install choices (returned by the swappable close-choice
    # provider so the decision handling is unit-testable without the dialog).
    CLOSE_BACKGROUND = "background"
    CLOSE_CANCEL = "cancel"
    CLOSE_KEEP = "keep"

    # v1.1.0 Phase 14.8 -- index of the Review page in the wizard chain. The
    # final disk + hardware guard fires when the user clicks "Install" on
    # this page. Kept as a class attribute so test code can override it.
    review_page_index: int = 6

    def __init__(
        self, state: InstallerState | None = None, *, frameless: bool | None = None
    ) -> None:
        super().__init__()
        self._state = state
        # Initialized before the first resize()/changeEvent so the overridden
        # handlers (below) never touch attributes that do not exist yet.
        self._background: BackgroundWidget | None = None
        self._grips: list[QSizeGrip] = []
        self._title_bar: TitleBar | None = None
        self._central: QWidget | None = None
        self.setWindowTitle(WINDOW_TITLE)
        # Set the window icon explicitly (not only app-wide) so the taskbar
        # button reliably shows the Nexus mark in the frozen build (T018).
        _icon_path = resolve_window_icon()
        if _icon_path is not None:
            self.setWindowIcon(QIcon(str(_icon_path)))
        self.setMinimumSize(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT)
        self.resize(WINDOW_DEFAULT_WIDTH, WINDOW_DEFAULT_HEIGHT)
        self.setStyleSheet(generate_stylesheet())

        # Frameless by default; native decorations as the documented fallback.
        if frameless is None:
            frameless = not _native_titlebar_forced()
        self._frameless = frameless
        if frameless:
            self.setWindowFlags(
                Qt.WindowType.FramelessWindowHint | Qt.WindowType.Window
            )

        # Central widget
        central = QWidget()
        self._central = central
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Custom frameless title bar (T301). Omitted under native decorations.
        if frameless:
            self._title_bar = TitleBar(WINDOW_TITLE)
            self._title_bar.minimize_requested.connect(self.showMinimized)
            self._title_bar.maximize_toggle_requested.connect(self._toggle_maximized)
            self._title_bar.close_requested.connect(self.close)
            main_layout.addWidget(self._title_bar)

        # v1.11.0 Phase 6 (T601): below the title bar the window splits into a
        # fixed-width navigation sidebar (brand + section rows + help block) and
        # the content column (stepper + step counter, scroll content, footer).
        # This replaces the old full-width header band -- the brand now lives in
        # the sidebar and the step counter moves to the content top-right.
        split = QHBoxLayout()
        split.setContentsMargins(0, 0, 0, 0)
        split.setSpacing(0)
        main_layout.addLayout(split, stretch=1)

        self._sidebar = Sidebar(STEP_NAMES)
        self._sidebar.section_clicked.connect(self._on_sidebar_click)
        split.addWidget(self._sidebar)
        # The brand block (logo + wordmark + "Setup Wizard") relocated to the
        # sidebar (T604). `header` stays a public accessor for it.
        self._header: Header = self._sidebar.brand

        content_col = QVBoxLayout()
        content_col.setContentsMargins(0, 0, 0, 0)
        content_col.setSpacing(0)
        split.addLayout(content_col, stretch=1)

        # Content top band: the step indicator (stretch) + a right-aligned step
        # counter ("Step X of Y" over the current step name).
        top_band = QHBoxLayout()
        top_band.setContentsMargins(SIDE_MARGIN, 12, SIDE_MARGIN, 0)
        top_band.setSpacing(16)
        self._step_indicator = StepIndicator(STEP_NAMES)
        top_band.addWidget(self._step_indicator, stretch=1)

        counter_col = QVBoxLayout()
        counter_col.setSpacing(0)
        self._step_counter = QLabel("")
        self._step_counter.setStyleSheet(
            f"color: {TEXT_PRIMARY}; font-size: {HEADER_STEP_PX}px; "
            "font-weight: 600; background: transparent;"
        )
        self._step_counter.setAlignment(Qt.AlignmentFlag.AlignRight)
        counter_col.addWidget(self._step_counter)
        self._step_name = QLabel("")
        self._step_name.setStyleSheet(
            f"color: {ACCENT}; font-size: {FS_CAPTION}px; background: transparent;"
        )
        self._step_name.setAlignment(Qt.AlignmentFlag.AlignRight)
        counter_col.addWidget(self._step_name)
        top_band.addLayout(counter_col)
        content_col.addLayout(top_band)

        # Scrollable content area
        self._scroll = QScrollArea()
        self._scroll.setObjectName("contentScroll")
        self._scroll.setWidgetResizable(True)
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._scroll.viewport().setObjectName("scrollViewport")
        self._content_wrapper = QWidget()
        self._content_wrapper.setObjectName("contentWrapper")
        self._content_layout = QVBoxLayout(self._content_wrapper)
        self._content_layout.setContentsMargins(
            SIDE_MARGIN, VERTICAL_MARGIN, SIDE_MARGIN, VERTICAL_MARGIN
        )
        self._scroll.setWidget(self._content_wrapper)
        content_col.addWidget(self._scroll, stretch=1)

        # Error label (hidden by default)
        self._error_label = QLabel("")
        self._error_label.setObjectName("errorLabel")
        self._error_label.setVisible(False)
        # Font size comes from the QLabel#errorLabel scale-class in theme.py.
        self._error_label.setStyleSheet(
            f"color: {ERROR}; padding: 4px 32px; background: transparent;"
        )
        content_col.addWidget(self._error_label)

        # Footer band (height: FOOTER_HEIGHT)
        self._footer = Footer()
        self._footer.back_clicked.connect(self._go_back)
        self._footer.next_clicked.connect(self._go_next)
        content_col.addWidget(self._footer)

        # Animated constellation + radial-glow body treatment mounted behind
        # the transparent content band (T302). Created last, then lowered so
        # the layout bands paint on top of it.
        self._background = BackgroundWidget(central)
        self._background.setGeometry(central.rect())
        self._background.lower()

        # Resize grips for the frameless window (bottom corners). Under native
        # decorations the OS frame handles resizing, so they are hidden.
        self._grips = [QSizeGrip(central), QSizeGrip(central)]
        for grip in self._grips:
            grip.setVisible(frameless)
            grip.raise_()

        # Page management
        self._pages: list[QWidget] = []
        self._current_index = -1
        self._current_page: QWidget | None = None
        # v1.11.0 Phase 6 (T602): once the install begins the choice pages are
        # locked (view-only) and the sidebar becomes a free-review surface that
        # never stops or restarts the running install.
        self._install_active = False
        self._install_finished = False

        # v1.11.0 Phase 7 (T702): the close-during-install choice is produced by
        # a swappable provider (default: the 3-button dialog) so the decision
        # handling can be unit-tested without a modal dialog.
        self._close_choice_provider: Callable[[], str] = self._prompt_close_choice

        # Keyboard shortcuts
        QShortcut(Qt.Key.Key_Return, self, self._go_next)
        QShortcut(Qt.Key.Key_Escape, self, self._go_back)

    @property
    def header(self) -> Header:
        return self._header

    @property
    def title_bar(self) -> TitleBar | None:
        return self._title_bar

    @property
    def frameless(self) -> bool:
        return self._frameless

    @property
    def footer(self) -> Footer:
        return self._footer

    @property
    def step_indicator(self) -> StepIndicator:
        return self._step_indicator

    @property
    def sidebar(self) -> Sidebar:
        return self._sidebar

    @property
    def current_index(self) -> int:
        return self._current_index

    @property
    def installing_page_index(self) -> int:
        """Index of the Installing page (the step after Review)."""
        return self.review_page_index + 1

    def add_page(self, page: QWidget) -> None:
        """Register a page. Pages are navigated in registration order."""
        self._pages.append(page)
        # v1.11.0 Phase 6 (T602): the installing page announces its lifecycle so
        # the shell can lock the choice sections and free up the sidebar for
        # review. Connected by duck-type -- only the installing page has these.
        started = getattr(page, "started", None)
        if started is not None and hasattr(started, "connect"):
            started.connect(self._on_install_started)
        finished = getattr(page, "finished", None)
        if finished is not None and hasattr(finished, "connect"):
            finished.connect(self._on_install_finished)
        # v1.11.0 Phase 6 (T603): the Models page reports category-flow progress
        # so the sidebar can annotate its "Models" row.
        category_progress = getattr(page, "category_progress", None)
        if category_progress is not None and hasattr(category_progress, "connect"):
            category_progress.connect(self.set_category_progress)

    def switch_page(self, index: int) -> None:
        """Replace the content area with the page at the given index."""
        if index < 0 or index >= len(self._pages):
            return

        self._error_label.setVisible(False)

        # Remove current page from layout
        if self._current_page is not None:
            self._content_layout.removeWidget(self._current_page)
            self._current_page.setParent(None)

        page = self._pages[index]
        self._content_layout.addWidget(page)
        self._current_page = page
        self._current_index = index

        # Auto-start installation when switching to the installing page. The
        # page guards against a re-run, so revisiting it during install (T602)
        # never restarts the engine.
        if hasattr(page, "start_installation"):
            page.start_installation()

        # The stepper + step counter track the wizard's real progress. While an
        # install is running they stay pinned to the Installing step even when
        # the user is reviewing an earlier (locked) page via the sidebar.
        progress_index = (
            self.installing_page_index if self._install_active else index
        )
        self._step_indicator.set_current(progress_index)
        self._set_step_display(progress_index)

        # The sidebar highlights the section being viewed and reflects every
        # section's progression / lock state.
        self._refresh_navigation()
        self._refresh_footer()

    def show_first_page(self) -> None:
        """Display the first registered page."""
        if self._pages:
            self.switch_page(0)

    def _go_back(self) -> None:
        # Once the install has begun, sequential Back is retired: the sidebar is
        # the review surface (T602). Applied choices cannot be walked back.
        if self._install_active:
            return
        if self._current_index > 0:
            # Block back during installation
            page = self._pages[self._current_index]
            if hasattr(page, "is_running") and page.is_running:
                return
            self.switch_page(self._current_index - 1)

    def _go_next(self) -> None:
        # While the install is mid-flight the footer Next is inert (the sidebar
        # drives review); it re-enables once the install finishes so the user
        # can proceed to the Complete page.
        if self._install_active and not self._install_finished:
            return
        if self._current_index < len(self._pages) - 1:
            # Run page validation if available
            page = self._pages[self._current_index]
            if hasattr(page, "validate"):
                ok, msg = page.validate()
                if not ok:
                    self._error_label.setText(msg)
                    self._error_label.setVisible(True)
                    return
            # v1.1.0 Phase 14.8 -- final disk + hardware guard at the
            # Review -> Installing transition. Re-detect free disk so the
            # user freeing space in another app counts; bounce back to the
            # picker with an error dialog if the selection no longer fits.
            if self._is_install_step() and not self._run_install_guard():
                return
            self._error_label.setVisible(False)
            self.switch_page(self._current_index + 1)
        elif self._current_index == len(self._pages) - 1:
            # Last page: "Finish" runs the page's finish hook (e.g. launching
            # the Nexus desktop app), then closes the app.
            page = self._pages[self._current_index]
            if hasattr(page, "on_finish"):
                page.on_finish()
            self.close()

    # -- sidebar navigation + install lifecycle (v1.11.0 Phase 6) -----------

    LOCK_TOOLTIP = (
        "Locked while installing -- this choice has already been applied. "
        "You can still review it here."
    )

    def _on_sidebar_click(self, index: int) -> None:
        """Handle a sidebar section click with the free-navigation rules (T602)."""
        if index < 0 or index >= len(self._pages):
            return
        if self._install_active:
            # Free review of any section; Complete stays unreachable until the
            # install actually finishes.
            if index == len(self._pages) - 1 and not self._install_finished:
                return
            self.switch_page(index)
            return
        # Before install, the sidebar only walks BACK to already-visited steps;
        # moving forward still goes through Next so page validation runs.
        if index <= self._current_index:
            self.switch_page(index)

    def _on_install_started(self) -> None:
        self._install_active = True
        self._apply_install_lock()
        # Re-pin the stepper/counter to the install step and refresh the shell.
        self._step_indicator.set_current(self.installing_page_index)
        self._set_step_display(self.installing_page_index)
        self._refresh_navigation()
        self._refresh_footer()

    def _on_install_finished(self, _success: bool = True) -> None:
        self._install_finished = True
        self._refresh_navigation()
        self._refresh_footer()

    def _apply_install_lock(self) -> None:
        """Put every choice page into read-only mode (best-effort, T602)."""
        for i, page in enumerate(self._pages):
            if i >= self.installing_page_index:
                continue
            set_interactive = getattr(page, "set_interactive", None)
            if callable(set_interactive):
                set_interactive(False)

    def _nav_state(self, index: int) -> str:
        """Progression / lock state for a sidebar row's icon."""
        installing = self.installing_page_index
        if self._install_active:
            if index == installing:
                return "done" if self._install_finished else "current"
            if index < installing:
                return "locked"
            # The Complete row.
            return "done" if self._install_finished else "pending"
        if index < self._current_index:
            return "done"
        if index == self._current_index:
            return "current"
        return "pending"

    def _refresh_navigation(self) -> None:
        """Sync the sidebar's selected highlight, icon states, and lock tips."""
        states = [self._nav_state(i) for i in range(len(self._sidebar.rows))]
        self._sidebar.set_states(states)
        self._sidebar.set_selected(self._current_index)
        for i, state in enumerate(states):
            tip = self.LOCK_TOOLTIP if state == "locked" else ""
            self._sidebar.set_row_tooltip(i, tip)

    def _refresh_footer(self) -> None:
        """Footer Back/Next state, aware of the install lifecycle."""
        index = self._current_index
        total = len(self._pages)
        if self._install_active and not self._install_finished:
            self._footer.set_back_enabled(False)
            self._footer.set_next_enabled(False)
            return
        self._footer.set_back_enabled(index > 0 and not self._install_active)
        self._footer.set_next_enabled(True)
        is_review = index == self.review_page_index
        is_last = index == total - 1
        if is_last:
            self._footer.set_next_text("Finish")
        elif is_review:
            self._footer.set_next_text("Install")
        else:
            self._footer.set_next_text("Next")

    def _set_step_display(self, index: int) -> None:
        """Update the content-area step counter + current step name."""
        total = len(self._pages)
        self._step_counter.setText(f"Step {index + 1} of {total}")
        name = STEP_NAMES[index] if 0 <= index < len(STEP_NAMES) else ""
        self._step_name.setText(name)

    def set_category_progress(self, done: int, total: int) -> None:
        """Reflect Models-page category progress on the sidebar (T603)."""
        try:
            models_index = STEP_NAMES.index("Models")
        except ValueError:
            return
        label = "Models" if done >= total else f"Models  ({done}/{total})"
        self._sidebar.set_row_label(models_index, label)

    def _is_install_step(self) -> bool:
        return self._current_index == self.review_page_index

    def _run_install_guard(self) -> bool:
        """Re-evaluate the disk + hardware guard. Returns True when safe."""
        if self._state is None:
            return True
        free_disk_gb = self._state.free_disk_gb
        # Best-effort fresh probe: prefer host_detect when available.
        try:
            from nexus_installer.engine.host_detect import detect_host

            profile = detect_host(
                install_path_override=self._state.install_path or None
            )
            free_disk_gb = profile.free_disk_gb or free_disk_gb
            self._state.free_disk_gb = free_disk_gb
        except Exception:  # noqa: BLE001 -- probe is best-effort
            pass
        result = evaluate_install_guard(
            free_disk_gb=free_disk_gb,
            selection_gb=self._state.selected_models_gb,
            reserve_gb=self._state.disk_reserve_gb,
        )
        if result.ok:
            return True
        QMessageBox.critical(self, "Insufficient disk space", result.message)
        # Bounce the user back to the model picker page (one step before
        # configuration / review). The page index for the wizard chain is
        # Models (the typed catalog) = 4 in `STEP_NAMES`.
        target = max(0, self.review_page_index - 2)
        self.switch_page(target)
        return False

    def _toggle_maximized(self) -> None:
        """Toggle maximize/restore and sync the title-bar glyph (T301)."""
        if self.isMaximized():
            self.showNormal()
        else:
            self.showMaximized()

    def _reposition_background_and_grips(self) -> None:
        """Keep the background full-bleed and pin the grips to the corners."""
        if self._background is not None:
            self._background.setGeometry(self._central.rect())
            self._background.lower()
        if self._grips:
            grip = self._grips[0].sizeHint()
            gw, gh = grip.width(), grip.height()
            w, h = self._central.width(), self._central.height()
            # [0] bottom-right, [1] bottom-left.
            self._grips[0].move(w - gw, h - gh)
            self._grips[1].move(0, h - gh)
            for g in self._grips:
                g.raise_()

    def resizeEvent(self, event: QEvent) -> None:  # noqa: N802
        super().resizeEvent(event)  # type: ignore[arg-type]
        self._reposition_background_and_grips()

    def changeEvent(self, event: QEvent) -> None:  # noqa: N802
        """Sync the title-bar maximize glyph when the window state changes."""
        if (
            event.type() == QEvent.Type.WindowStateChange
            and self._title_bar is not None
        ):
            self._title_bar.set_maximized(self.isMaximized())
        super().changeEvent(event)  # type: ignore[arg-type]

    # -- background continuation (v1.11.0 Phase 7, T702/T703) ---------------

    def show_and_raise(self) -> None:
        """Reattach: bring the (hidden/minimized) window back to the front.

        Wired to the tray "Open installer" action and the single-instance
        reattach handshake, so both a tray reopen and a second launch land on
        the live wizard rather than a duplicate (T703).
        """
        self.showNormal()
        self.raise_()
        self.activateWindow()

    def _running_install_page(self) -> QWidget | None:
        """Return the page whose install is currently running, if any."""
        for page in self._pages:
            if getattr(page, "is_running", False):
                return page
        return None

    def _prompt_close_choice(self) -> str:
        """Ask the user how to close mid-install (the 3-button dialog, T702)."""
        box = QMessageBox(self)
        box.setWindowTitle("Close Installer")
        box.setText("Installation is still in progress.")
        box.setInformativeText(
            "You can keep installing in the background, cancel the install, "
            "or keep this window open."
        )
        bg_btn = box.addButton(
            "Continue in background", QMessageBox.ButtonRole.AcceptRole
        )
        cancel_btn = box.addButton(
            "Cancel install", QMessageBox.ButtonRole.DestructiveRole
        )
        keep_btn = box.addButton("Keep open", QMessageBox.ButtonRole.RejectRole)
        box.setDefaultButton(keep_btn)
        box.exec()
        clicked = box.clickedButton()
        if clicked is bg_btn:
            return self.CLOSE_BACKGROUND
        if clicked is cancel_btn:
            return self.CLOSE_CANCEL
        return self.CLOSE_KEEP

    def _apply_close_choice(
        self, choice: str, event: QEvent, page: QWidget
    ) -> None:
        """Act on the close-during-install choice (extracted for testability)."""
        if choice == self.CLOSE_BACKGROUND:
            # Detach, do not destroy: hide the window and surface the tray. The
            # engine thread keeps running in this same process.
            event.ignore()
            self.hide()
            self.background_requested.emit()
        elif choice == self.CLOSE_CANCEL:
            cancel = getattr(page, "cancel_install", None)
            if callable(cancel):
                cancel()
            event.accept()
        else:  # CLOSE_KEEP
            event.ignore()

    def closeEvent(self, event: QEvent) -> None:  # noqa: N802
        """Offer background / cancel / keep-open when an install is running."""
        page = self._running_install_page()
        if page is None:
            event.accept()
            return
        choice = self._close_choice_provider()
        self._apply_close_choice(choice, event, page)

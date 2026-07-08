"""Main QMainWindow: frameless title bar, header, step indicator, content, footer.

v1.9.0 Phase 3 (T301/T302): the window is frameless by default -- the OS chrome
is replaced by a custom :class:`TitleBar`, and an animated constellation over a
radial-glow body treatment is mounted behind the transparent content band. A
``NEXUS_NATIVE_TITLEBAR`` env var (or ``frameless=False``) restores native
decorations as the documented fallback (see the plan's Risks table).
"""

from __future__ import annotations

import os

from PyQt5.QtCore import QEvent, Qt
from PyQt5.QtGui import QIcon
from PyQt5.QtWidgets import (
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
    ERROR,
    SIDE_MARGIN,
    STEP_NAMES,
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
from nexus_installer.widgets.header import Header
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

        # Header band (height: HEADER_HEIGHT)
        self._header = Header()
        main_layout.addWidget(self._header)

        # Step indicator (height: STEP_BAR_HEIGHT)
        self._step_indicator = StepIndicator(STEP_NAMES)
        main_layout.addWidget(self._step_indicator)

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
        main_layout.addWidget(self._scroll, stretch=1)

        # Error label (hidden by default)
        self._error_label = QLabel("")
        self._error_label.setObjectName("errorLabel")
        self._error_label.setVisible(False)
        # Font size comes from the QLabel#errorLabel scale-class in theme.py.
        self._error_label.setStyleSheet(
            f"color: {ERROR}; padding: 4px 32px; background: transparent;"
        )
        main_layout.addWidget(self._error_label)

        # Footer band (height: FOOTER_HEIGHT)
        self._footer = Footer()
        self._footer.back_clicked.connect(self._go_back)
        self._footer.next_clicked.connect(self._go_next)
        main_layout.addWidget(self._footer)

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
    def current_index(self) -> int:
        return self._current_index

    def add_page(self, page: QWidget) -> None:
        """Register a page. Pages are navigated in registration order."""
        self._pages.append(page)

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

        # Auto-start installation when switching to the installing page
        if hasattr(page, "start_installation"):
            page.start_installation()

        # Update header and step indicator
        self._step_indicator.set_current(index)
        total = len(self._pages)
        self._header.set_step_text(f"Step {index + 1} of {total}")

        # Update footer buttons
        self._footer.set_back_enabled(index > 0)
        is_review = index == self.review_page_index
        is_last = index == total - 1

        if is_last:
            self._footer.set_next_text("Finish")
        elif is_review:
            self._footer.set_next_text("Install")
        else:
            self._footer.set_next_text("Next")

        # Disable back during installation
        if hasattr(page, "is_running") and page.is_running:
            self._footer.set_back_enabled(False)

    def show_first_page(self) -> None:
        """Display the first registered page."""
        if self._pages:
            self.switch_page(0)

    def _go_back(self) -> None:
        if self._current_index > 0:
            # Block back during installation
            page = self._pages[self._current_index]
            if hasattr(page, "is_running") and page.is_running:
                return
            self.switch_page(self._current_index - 1)

    def _go_next(self) -> None:
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

    def closeEvent(self, event: QEvent) -> None:  # noqa: N802
        """Confirm close if installation is in progress."""
        installing_page = None
        for page in self._pages:
            if hasattr(page, "is_running") and page.is_running:
                installing_page = page
                break

        if installing_page:
            reply = QMessageBox.question(
                self,
                "Close Installer",
                "Installation is in progress. Are you sure you want to close?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if reply != QMessageBox.StandardButton.Yes:
                event.ignore()
                return

        event.accept()

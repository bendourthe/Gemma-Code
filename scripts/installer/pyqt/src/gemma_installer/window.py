"""Main QMainWindow with three-band layout: header, step indicator, content, footer."""

from __future__ import annotations

from PyQt5.QtCore import QEvent, Qt
from PyQt5.QtWidgets import (
    QLabel,
    QMainWindow,
    QMessageBox,
    QScrollArea,
    QShortcut,
    QVBoxLayout,
    QWidget,
)

from gemma_installer.constants import (
    SIDE_MARGIN,
    STEP_NAMES,
    VERTICAL_MARGIN,
    WINDOW_DEFAULT_HEIGHT,
    WINDOW_DEFAULT_WIDTH,
    WINDOW_MIN_HEIGHT,
    WINDOW_MIN_WIDTH,
)
from gemma_installer.theme import generate_stylesheet
from gemma_installer.widgets.footer import Footer
from gemma_installer.widgets.header import Header
from gemma_installer.widgets.step_indicator import StepIndicator


class InstallerWindow(QMainWindow):
    """Resizable main window with header, step indicator, scroll content, and footer."""

    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Gemma Code -- Setup")
        self.setMinimumSize(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT)
        self.resize(WINDOW_DEFAULT_WIDTH, WINDOW_DEFAULT_HEIGHT)
        self.setStyleSheet(generate_stylesheet())

        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Header band (fixed 64px)
        self._header = Header()
        main_layout.addWidget(self._header)

        # Step indicator (fixed 88px)
        self._step_indicator = StepIndicator(STEP_NAMES)
        main_layout.addWidget(self._step_indicator)

        # Scrollable content area
        self._scroll = QScrollArea()
        self._scroll.setWidgetResizable(True)
        self._scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self._content_wrapper = QWidget()
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
        self._error_label.setStyleSheet(
            "color: #ef4444; font-size: 12px; padding: 4px 32px; background: transparent;"
        )
        main_layout.addWidget(self._error_label)

        # Footer band (fixed 56px)
        self._footer = Footer()
        self._footer.back_clicked.connect(self._go_back)
        self._footer.next_clicked.connect(self._go_next)
        main_layout.addWidget(self._footer)

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
        is_review = index == 6  # Review page
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
            self._error_label.setVisible(False)
            self.switch_page(self._current_index + 1)
        elif self._current_index == len(self._pages) - 1:
            # Last page: "Finish" closes the app
            self.close()

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

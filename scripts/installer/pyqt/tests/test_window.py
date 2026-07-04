"""Tests for the InstallerWindow."""

from __future__ import annotations

from PyQt5.QtWidgets import QWidget


class TestInstallerWindow:
    def test_creates_with_correct_title(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        assert "Nexus" in window.windowTitle()

    def test_title_is_nexus_ai_studio(self, qt_app: object) -> None:
        # v1.9.0 Phase 3 (T304): the OS/taskbar caption is the product name.
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        assert window.windowTitle() == "Nexus AI Studio"
        assert "Setup" not in window.windowTitle()

    def test_frameless_by_default_mounts_title_bar(self, qt_app: object) -> None:
        # v1.9.0 Phase 3 (T301): frameless window with a custom title bar.
        from PyQt5.QtCore import Qt

        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        assert window.frameless is True
        assert window.title_bar is not None
        assert window.title_bar.title() == "Nexus AI Studio"
        assert bool(window.windowFlags() & Qt.WindowType.FramelessWindowHint)

    def test_native_fallback_has_no_title_bar(self, qt_app: object) -> None:
        # The documented fallback (frameless=False) keeps native decorations.
        from PyQt5.QtCore import Qt

        from nexus_installer.window import InstallerWindow

        window = InstallerWindow(frameless=False)
        assert window.frameless is False
        assert window.title_bar is None
        assert not (window.windowFlags() & Qt.WindowType.FramelessWindowHint)

    def test_background_mounted(self, qt_app: object) -> None:
        # v1.9.0 Phase 3 (T302): constellation body treatment behind content.
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        assert window._background is not None
        assert window._background.constellation is not None

    def test_resize_grips_present_when_frameless(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        assert len(window._grips) == 2
        assert all(g.isVisibleTo(window._central) for g in window._grips)

    def test_resize_grips_hidden_when_native(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow(frameless=False)
        assert all(not g.isVisibleTo(window._central) for g in window._grips)

    def test_title_bar_close_wired_to_window(self, qt_app: object) -> None:
        # Clicking the title-bar close button closes the window.
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        window.add_page(QWidget())
        window.show_first_page()
        assert window.title_bar is not None
        window.title_bar.close_button.click()
        assert window.isHidden()

    def test_toggle_maximized_does_not_crash(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        window._toggle_maximized()
        window._toggle_maximized()

    def test_has_header_and_footer(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        assert window.header is not None
        assert window.footer is not None
        assert window.step_indicator is not None

    def test_add_and_switch_page(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        page1 = QWidget()
        page2 = QWidget()
        window.add_page(page1)
        window.add_page(page2)
        window.switch_page(0)
        assert window.current_index == 0
        window.switch_page(1)
        assert window.current_index == 1

    def test_show_first_page(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        page = QWidget()
        window.add_page(page)
        window.show_first_page()
        assert window.current_index == 0

    def test_switch_page_out_of_bounds_ignored(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        page = QWidget()
        window.add_page(page)
        window.show_first_page()
        window.switch_page(99)  # Out of bounds
        assert window.current_index == 0

    def test_footer_text_changes_on_last_page(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        window.add_page(QWidget())
        window.add_page(QWidget())
        window.switch_page(1)  # Last page
        assert window.footer.next_button.text() == "Finish"

    def test_back_disabled_on_first_page(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        window.add_page(QWidget())
        window.add_page(QWidget())
        window.show_first_page()
        assert not window.footer.back_button.isVisible()

    def test_validation_blocks_navigation(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        class FailingPage(QWidget):
            def validate(self) -> tuple[bool, str]:
                return False, "Validation failed"

        window = InstallerWindow()
        window.add_page(FailingPage())
        window.add_page(QWidget())
        window.show_first_page()
        window._go_next()
        assert window.current_index == 0  # Blocked by validation

    def test_finish_runs_last_page_hook(self, qt_app: object) -> None:
        # v1.8.0 Phase 2 (T203): Finish invokes the page's on_finish hook
        # (the complete page uses it to launch the Nexus desktop app).
        from nexus_installer.window import InstallerWindow

        finished: list[bool] = []

        class LastPage(QWidget):
            def on_finish(self) -> None:
                finished.append(True)

        window = InstallerWindow()
        window.add_page(QWidget())
        window.add_page(LastPage())
        window.switch_page(1)
        window._go_next()  # "Finish"
        assert finished == [True]

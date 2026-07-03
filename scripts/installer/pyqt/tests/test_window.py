"""Tests for the InstallerWindow."""

from __future__ import annotations

from PyQt5.QtWidgets import QWidget


class TestInstallerWindow:
    def test_creates_with_correct_title(self, qt_app: object) -> None:
        from nexus_installer.window import InstallerWindow

        window = InstallerWindow()
        assert "Nexus" in window.windowTitle()

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

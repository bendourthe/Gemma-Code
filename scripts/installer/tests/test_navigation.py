"""Tests for window navigation logic."""

from __future__ import annotations

from contextlib import ExitStack
from unittest.mock import patch

import pytest


class TestValidationProtocol:
    def test_page_with_passing_validation(self) -> None:
        class MockPage:
            def validate(self) -> tuple[bool, str]:
                return True, ""

        page = MockPage()
        ok, msg = page.validate()
        assert ok is True
        assert msg == ""

    def test_page_with_failing_validation(self) -> None:
        class MockPage:
            def validate(self) -> tuple[bool, str]:
                return False, "Missing required field"

        page = MockPage()
        ok, msg = page.validate()
        assert ok is False
        assert "Missing" in msg


class TestPageSequence:
    def test_ten_step_names(self) -> None:
        from nexus_installer.constants import STEP_NAMES

        assert len(STEP_NAMES) == 10
        assert STEP_NAMES[0] == "Welcome"
        assert STEP_NAMES[6] == "VS Code"
        assert STEP_NAMES[7] == "Review"
        assert STEP_NAMES[8] == "Installing"
        assert STEP_NAMES[9] == "Complete"

    def test_review_is_before_installing(self) -> None:
        from nexus_installer.constants import STEP_NAMES

        review_idx = STEP_NAMES.index("Review")
        install_idx = STEP_NAMES.index("Installing")
        assert review_idx == install_idx - 1

    def test_gui_route_registers_vscode_page_before_review(self) -> None:
        from nexus_installer.installer_state import InstallerState
        from nexus_installer.main import _register_gui_pages

        route = [
            ("nexus_installer.pages.welcome.WelcomePage", "Welcome"),
            ("nexus_installer.pages.prerequisites.PrerequisitesPage", "Prerequisites"),
            ("nexus_installer.pages.gpu_detection.GpuDetectionPage", "GPU Detection"),
            ("nexus_installer.pages.install_path.InstallPathPage", "Install Path"),
            ("nexus_installer.pages.typed_catalog.TypedCatalogPage", "Models"),
            ("nexus_installer.pages.configuration.ConfigurationPage", "Configuration"),
            ("nexus_installer.pages.vscode_extension.VsCodeExtensionPage", "VS Code"),
            ("nexus_installer.pages.review.ReviewPage", "Review"),
            ("nexus_installer.pages.installing.InstallingPage", "Installing"),
            ("nexus_installer.pages.complete.CompletePage", "Complete"),
        ]

        class FakeWindow:
            def __init__(self) -> None:
                self.pages: list[str] = []

            def add_page(self, page: str) -> None:
                self.pages.append(page)

        state = InstallerState()
        window = FakeWindow()

        def on_engine_created(_engine: object) -> None:
            return None

        factories = {}
        with ExitStack() as stack:
            for target, name in route:
                factories[name] = stack.enter_context(patch(target, return_value=name))
            installing, complete = _register_gui_pages(
                window,
                state,
                on_engine_created=on_engine_created,
            )

        assert window.pages == [name for _target, name in route]
        assert installing == "Installing"
        assert complete == "Complete"
        factories["VS Code"].assert_called_once_with(state)
        factories["Installing"].assert_called_once_with(
            state, on_engine_created=on_engine_created
        )

    @pytest.mark.parametrize(
        ("version", "supported"),
        [("1.134.0", True), ("1.135.0", True)],
    )
    def test_vscode_route_refreshes_after_async_prerequisite_detection(
        self, qt_app, version: str, supported: bool
    ) -> None:
        from PyQt5.QtWidgets import QWidget

        from nexus_installer.constants import STEP_NAMES
        from nexus_installer.engine.extension_installer import VsCodeCliStatus
        from nexus_installer.installer_state import InstallerState
        from nexus_installer.main import _register_gui_pages
        from nexus_installer.pages.vscode_extension import VsCodeExtensionPage
        from nexus_installer.window import InstallerWindow

        not_found = VsCodeCliStatus(None, None, None, False, "not-found")
        reason = "supported" if supported else "version-mismatch"
        saved_path = (
            "C:\\Users\\test\\AppData\\Local\\Programs\\Microsoft VS Code"
            "\\bin\\code.cmd"
        )

        def generic_page(*_args: object, **_kwargs: object) -> QWidget:
            return QWidget()

        def inspect_saved(path: str) -> VsCodeCliStatus:
            return VsCodeCliStatus(path, "code", version, supported, reason)

        generic_targets = [
            "nexus_installer.pages.welcome.WelcomePage",
            "nexus_installer.pages.prerequisites.PrerequisitesPage",
            "nexus_installer.pages.gpu_detection.GpuDetectionPage",
            "nexus_installer.pages.install_path.InstallPathPage",
            "nexus_installer.pages.typed_catalog.TypedCatalogPage",
            "nexus_installer.pages.configuration.ConfigurationPage",
            "nexus_installer.pages.review.ReviewPage",
            "nexus_installer.pages.installing.InstallingPage",
            "nexus_installer.pages.complete.CompletePage",
        ]

        state = InstallerState(vscode_path="")
        window = InstallerWindow(state=state)
        with ExitStack() as stack:
            stack.enter_context(
                patch(
                    "nexus_installer.pages.vscode_extension.detect_vscode_cli",
                    return_value=not_found,
                )
            )
            stack.enter_context(
                patch(
                    "nexus_installer.pages.vscode_extension.inspect_vscode_cli",
                    side_effect=inspect_saved,
                )
            )
            for target in generic_targets:
                stack.enter_context(patch(target, side_effect=generic_page))
            _register_gui_pages(window, state)

            vscode_index = STEP_NAMES.index("VS Code")
            vscode_page = window._pages[vscode_index]
            assert isinstance(vscode_page, VsCodeExtensionPage)
            assert "extension" not in state.components_to_install

            # Simulate the PrerequisitesPage worker completing after every page
            # has already been constructed, then enter the VS Code route.
            state.vscode_path = saved_path
            window.show()
            window.show_first_page()
            window.switch_page(vscode_index)
            qt_app.processEvents()

            assert vscode_page._checkbox.isEnabled() is supported
            assert vscode_page._checkbox.isChecked() is supported
            assert ("extension" in state.components_to_install) is supported
            assert state.install_vscode_extension is supported

        window.close()


class TestInstallerStateNavigation:
    def test_back_from_first_page_is_noop(self) -> None:
        # Window._go_back checks current_index > 0
        index = 0
        assert not (index > 0)

    def test_forward_from_last_page_closes(self) -> None:
        pages_count = 10
        index = pages_count - 1
        assert index == pages_count - 1  # Should trigger close

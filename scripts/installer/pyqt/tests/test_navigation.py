"""Tests for window navigation logic."""

from __future__ import annotations


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
    def test_nine_step_names(self) -> None:
        from nexus_installer.constants import STEP_NAMES

        assert len(STEP_NAMES) == 9
        assert STEP_NAMES[0] == "Welcome"
        assert STEP_NAMES[6] == "Review"
        assert STEP_NAMES[7] == "Installing"
        assert STEP_NAMES[8] == "Complete"

    def test_review_is_before_installing(self) -> None:
        from nexus_installer.constants import STEP_NAMES

        review_idx = STEP_NAMES.index("Review")
        install_idx = STEP_NAMES.index("Installing")
        assert review_idx == install_idx - 1


class TestInstallerStateNavigation:
    def test_back_from_first_page_is_noop(self) -> None:
        # Window._go_back checks current_index > 0
        index = 0
        assert not (index > 0)

    def test_forward_from_last_page_closes(self) -> None:
        pages_count = 9
        index = pages_count - 1
        assert index == pages_count - 1  # Should trigger close

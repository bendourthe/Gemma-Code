"""Tests for UI widgets using QApplication."""

from __future__ import annotations

from nexus_installer.constants import STEP_NAMES


class TestStepIndicator:
    def test_creates_with_steps(self, qt_app: object) -> None:
        from nexus_installer.widgets.step_indicator import StepIndicator

        indicator = StepIndicator(STEP_NAMES)
        assert indicator.current_step == 0

    def test_set_current_updates(self, qt_app: object) -> None:
        from nexus_installer.widgets.step_indicator import StepIndicator

        indicator = StepIndicator(STEP_NAMES)
        indicator.set_current(3)
        assert indicator.current_step == 3

    def test_clamps_to_valid_range(self, qt_app: object) -> None:
        from nexus_installer.widgets.step_indicator import StepIndicator

        indicator = StepIndicator(STEP_NAMES)
        indicator.set_current(100)
        assert indicator.current_step == len(STEP_NAMES) - 1
        indicator.set_current(-5)
        assert indicator.current_step == 0

    def test_render_does_not_crash(self, qt_app: object) -> None:
        from nexus_installer.widgets.step_indicator import StepIndicator

        indicator = StepIndicator(STEP_NAMES)
        indicator.resize(800, 88)
        indicator.set_current(4)
        pixmap = indicator.grab()
        assert pixmap.width() > 0

    def test_glow_restyle_renders_at_every_step(self, qt_app: object) -> None:
        """v1.9.0 Phase 3 (T303) -- glowing completed + highlighted current dot."""
        from nexus_installer.widgets.step_indicator import StepIndicator

        assert hasattr(StepIndicator, "_draw_glow")
        indicator = StepIndicator(STEP_NAMES)
        indicator.resize(800, 88)
        for step in (0, len(STEP_NAMES) // 2, len(STEP_NAMES) - 1):
            indicator.set_current(step)
            assert indicator.grab().width() > 0


class TestLogPanel:
    def test_append_log(self, qt_app: object) -> None:
        from nexus_installer.widgets.log_panel import LogPanel

        panel = LogPanel()
        panel.append_log("Hello world", "info")
        panel.append_log("Error!", "error")
        text = panel.get_full_log()
        assert "Hello world" in text
        assert "Error!" in text

    def test_append_100_lines(self, qt_app: object) -> None:
        from nexus_installer.widgets.log_panel import LogPanel

        panel = LogPanel()
        for i in range(100):
            panel.append_log(f"Line {i}", "info")
        text = panel.get_full_log()
        assert "Line 99" in text


class TestPrimaryButton:
    def test_object_name(self, qt_app: object) -> None:
        from nexus_installer.widgets.primary_button import PrimaryButton

        btn = PrimaryButton("Test")
        assert btn.objectName() == "primaryButton"
        assert btn.text() == "Test"


class TestSecondaryButton:
    def test_object_name(self, qt_app: object) -> None:
        from nexus_installer.widgets.secondary_button import SecondaryButton

        btn = SecondaryButton("Cancel")
        assert btn.objectName() == "secondaryButton"


class TestCalloutBox:
    def test_creates_with_title_and_body(self, qt_app: object) -> None:
        from nexus_installer.widgets.callout_box import CalloutBox

        box = CalloutBox(title="Warning", body="Something happened")
        assert box.objectName() == "calloutBox"


class TestHeader:
    def test_brand_block_builds(self, qt_app: object) -> None:
        # v1.11.0 Phase 6 (T604): the header is now the sidebar brand block
        # (logo + wordmark + "Setup Wizard"), not a full-width band with a step
        # counter. The step counter moved to the content area (window.py).
        from nexus_installer.widgets.header import HEADER_STEP_PX, Header

        header = Header()
        # The wordmark renders at a hero size, clearly larger than the step
        # counter -- and is set via QSS, not setFont (the T604 root-cause fix).
        assert header.wordmark_px > HEADER_STEP_PX


class TestFooter:
    def test_buttons_exist(self, qt_app: object) -> None:
        from nexus_installer.widgets.footer import Footer

        footer = Footer()
        assert footer.back_button is not None
        assert footer.next_button is not None

    def test_set_next_text(self, qt_app: object) -> None:
        from nexus_installer.widgets.footer import Footer

        footer = Footer()
        footer.set_next_text("Install")
        assert footer.next_button.text() == "Install"

    def test_set_back_disabled(self, qt_app: object) -> None:
        from nexus_installer.widgets.footer import Footer

        footer = Footer()
        footer.set_back_enabled(False)
        assert not footer.back_button.isVisible()

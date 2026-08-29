"""Phase 1 tests for the prominent overall installer progress surface."""

from __future__ import annotations

from PyQt5.QtWidgets import QProgressBar

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.installing import InstallingPage
from nexus_installer.widgets.overall_progress import (
    OVERALL_PROGRESS_HEIGHT,
    OverallProgressBar,
)


def test_overall_bar_is_larger_and_percentage_bearing(qt_app: object) -> None:
    bar = OverallProgressBar(reduced_motion=True)
    subordinate = QProgressBar()
    subordinate.setFixedHeight(8)
    bar.set_fraction(0.42)

    assert bar.height() == OVERALL_PROGRESS_HEIGHT
    assert bar.height() > subordinate.height()
    assert bar.maximum() == 1000
    assert bar.value() == 420
    assert bar.format() == "%p%"
    assert "42%" in bar.accessibleDescription()


def test_overall_bar_is_monotonic_and_ignores_invalid_values(qt_app: object) -> None:
    bar = OverallProgressBar(reduced_motion=True)
    bar.set_fraction(0.6)
    bar.set_fraction(0.2)
    bar.set_fraction(float("nan"))
    assert bar.value() == 600


def test_overall_animation_stops_when_hidden_or_complete(qt_app: object) -> None:
    bar = OverallProgressBar(reduced_motion=False)
    bar.show()
    qt_app.processEvents()
    assert bar.is_animation_running()

    bar.hide()
    qt_app.processEvents()
    assert not bar.is_animation_running()

    bar.show()
    qt_app.processEvents()
    assert bar.is_animation_running()
    bar.complete()
    assert not bar.is_animation_running()


def test_reduced_motion_never_starts_timer(qt_app: object) -> None:
    bar = OverallProgressBar(reduced_motion=True)
    bar.show()
    qt_app.processEvents()
    assert not bar.is_animation_running()


def test_page_uses_warning_title_for_optional_failures(qt_app: object) -> None:
    page = InstallingPage(InstallerState())
    page._on_finished(True, "Optional Unsloth provisioning needs attention.")
    assert page._title.text() == "Installation Complete with Warnings"
    assert page._progress.value() == 1000
    assert not page._progress.is_animation_running()


def test_page_cancel_stops_overall_animation(qt_app: object) -> None:
    page = InstallingPage(InstallerState())
    page._is_running = True
    page._progress.show()
    page._progress.set_running(True)
    qt_app.processEvents()
    page.cancel_install()
    assert not page._progress.is_animation_running()

"""v1.11.0 Phase 6 -- mockup shell: sidebar navigation, free navigation during
install, Models category flow, and the header sizing fix (T601-T605)."""

from __future__ import annotations

import tempfile
from pathlib import Path

from PyQt5.QtCore import pyqtSignal
from PyQt5.QtWidgets import QWidget

from nexus_installer.constants import STEP_NAMES
from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.typed_catalog import TYPE_TABS, TypedCatalogPage
from nexus_installer.window import InstallerWindow
from tests.test_typed_catalog import _write_catalog, _write_recommended

# --- fakes -----------------------------------------------------------------


class _FakeInstallingPage(QWidget):
    """Minimal stand-in for the installing page's lifecycle contract."""

    started = pyqtSignal()
    finished = pyqtSignal(bool)

    def __init__(self) -> None:
        super().__init__()
        self._is_running = False
        self._has_started = False
        self.start_calls = 0

    @property
    def is_running(self) -> bool:
        return self._is_running

    def start_installation(self) -> None:
        if self._is_running or self._has_started:
            return
        self._has_started = True
        self._is_running = True
        self.start_calls += 1
        self.started.emit()

    def validate(self) -> tuple[bool, str]:
        return (not self._is_running), ("" if not self._is_running else "running")

    def finish(self, success: bool = True) -> None:
        self._is_running = False
        self.finished.emit(success)


class _FakeChoicePage(QWidget):
    """A choice page that records whether it has been locked read-only."""

    def __init__(self) -> None:
        super().__init__()
        self.interactive = True

    def set_interactive(self, enabled: bool) -> None:
        self.interactive = enabled


def _build_window(qt_app: object) -> tuple[InstallerWindow, list[QWidget]]:
    win = InstallerWindow()
    pages: list[QWidget] = []
    for i in range(len(STEP_NAMES)):
        if i == win.installing_page_index:
            page: QWidget = _FakeInstallingPage()
        elif i == STEP_NAMES.index("Models"):
            page = _FakeChoicePage()
        else:
            page = QWidget()
        win.add_page(page)
        pages.append(page)
    win.show_first_page()
    return win, pages


# --- T601: sidebar structure ----------------------------------------------


class TestSidebar:
    def test_one_row_per_step(self, qt_app: object) -> None:
        from nexus_installer.widgets.sidebar import Sidebar

        bar = Sidebar(STEP_NAMES)
        assert len(bar.rows) == len(STEP_NAMES)

    def test_section_click_emits_index(self, qt_app: object) -> None:
        from nexus_installer.widgets.sidebar import Sidebar

        bar = Sidebar(STEP_NAMES)
        seen: list[int] = []
        bar.section_clicked.connect(seen.append)
        bar.rows[3].click()
        assert seen == [3]

    def test_set_states_and_selected(self, qt_app: object) -> None:
        from nexus_installer.widgets.sidebar import Sidebar

        bar = Sidebar(STEP_NAMES)
        states = ["done"] * len(STEP_NAMES)
        states[2] = "current"
        bar.set_states(states)
        bar.set_selected(2)
        assert bar.rows[2].nav_state == "current"
        assert bar.rows[2].property("selected") is True
        assert bar.rows[0].property("selected") is False

    def test_row_label_override(self, qt_app: object) -> None:
        from nexus_installer.widgets.sidebar import Sidebar

        bar = Sidebar(STEP_NAMES)
        bar.set_row_label(4, "Models  (3/5)")
        assert "3/5" in bar.rows[4].text()


# --- T604: header sizing ----------------------------------------------------


class TestHeaderSizing:
    def test_logo_shrunk_to_84(self, qt_app: object) -> None:
        from nexus_installer.widgets import header

        assert header.HEADER_LOGO_SIZE == 84

    def test_wordmark_larger_than_step_counter(self, qt_app: object) -> None:
        from nexus_installer.widgets import header

        # The T604 root-cause fix: the wordmark size is a real, prominent value
        # (set via QSS, not the overridden setFont), larger than the counter.
        assert header.HEADER_WORDMARK_PX > header.HEADER_STEP_PX

    def test_wordmark_size_carried_by_custom_paint(self, qt_app: object) -> None:
        from nexus_installer.theme import generate_stylesheet
        from nexus_installer.widgets.gradient_wordmark import GradientWordmark
        from nexus_installer.widgets.header import HEADER_WORDMARK_PX, Header

        hdr = Header()
        # v1.13.0 Phase 3: the wordmark is a custom-painted GradientWordmark, so
        # its size comes from QPainter, not QSS -- fully immune to the global
        # `QWidget { font-size }` rule that used to shrink the setFont label
        # (a stronger form of the T604 "renders tiny" regression guard).
        assert isinstance(hdr._title, GradientWordmark)
        assert hdr._title.base_px == HEADER_WORDMARK_PX
        hdr.setStyleSheet(generate_stylesheet())
        # At an ample width the wordmark paints at the full base size; the
        # global body rule cannot shrink it.
        assert hdr._title.fitted_px(10_000) == HEADER_WORDMARK_PX


# --- T601/T602: shell navigation state machine ------------------------------


class TestShellNavigation:
    def test_sidebar_back_only_before_install(self, qt_app: object) -> None:
        win, _pages = _build_window(qt_app)
        win.switch_page(3)
        # Clicking a visited (<= current) section navigates back.
        win.sidebar.rows[1].click()
        assert win.current_index == 1
        # Clicking a forward section is ignored (Next + validation owns forward).
        win.sidebar.rows[5].click()
        assert win.current_index == 1

    def test_install_start_locks_choice_pages(self, qt_app: object) -> None:
        win, pages = _build_window(qt_app)
        models = pages[STEP_NAMES.index("Models")]
        win.switch_page(win.installing_page_index)
        assert win._install_active is True
        assert isinstance(models, _FakeChoicePage)
        assert models.interactive is False

    def test_free_navigation_during_install(self, qt_app: object) -> None:
        win, _pages = _build_window(qt_app)
        win.switch_page(win.installing_page_index)
        # Any earlier section is reviewable while the install runs.
        win.sidebar.rows[STEP_NAMES.index("Models")].click()
        assert win.current_index == STEP_NAMES.index("Models")

    def test_complete_blocked_until_finished(self, qt_app: object) -> None:
        win, pages = _build_window(qt_app)
        last = len(pages) - 1
        win.switch_page(win.installing_page_index)
        win.sidebar.rows[last].click()
        assert win.current_index != last  # Complete unreachable pre-finish
        pages[win.installing_page_index].finish(True)
        win.sidebar.rows[last].click()
        assert win.current_index == last

    def test_install_not_restarted_on_revisit(self, qt_app: object) -> None:
        win, pages = _build_window(qt_app)
        installing = pages[win.installing_page_index]
        win.switch_page(win.installing_page_index)
        assert installing.start_calls == 1
        win.sidebar.rows[STEP_NAMES.index("Models")].click()
        win.sidebar.rows[win.installing_page_index].click()
        assert installing.start_calls == 1  # guarded, not restarted

    def test_nav_states_during_install(self, qt_app: object) -> None:
        win, _pages = _build_window(qt_app)
        win.switch_page(win.installing_page_index)
        rows = win.sidebar.rows
        assert rows[0].nav_state == "locked"
        assert rows[win.installing_page_index].nav_state == "current"
        assert rows[len(_pages) - 1].nav_state == "pending"

    def test_stepper_pinned_to_install_when_reviewing(self, qt_app: object) -> None:
        win, _pages = _build_window(qt_app)
        win.switch_page(win.installing_page_index)
        win.sidebar.rows[STEP_NAMES.index("Models")].click()
        # Content shows Models, but the wizard progress stays on Installing.
        assert win.step_indicator.current_step == win.installing_page_index

    def test_footer_disabled_during_install_reenabled_on_finish(
        self, qt_app: object
    ) -> None:
        win, pages = _build_window(qt_app)
        win.switch_page(win.installing_page_index)
        assert not win.footer.next_button.isEnabled()
        assert not win.footer.back_button.isVisible()
        pages[win.installing_page_index].finish(True)
        assert win.footer.next_button.isEnabled()

    def test_footer_cancel_shown_during_install_removed_on_finish(
        self, qt_app: object
    ) -> None:
        # v1.14.0 Phase 4: Cancel lives on the footer row only while the install
        # runs; it is removed (not left grayed) the moment it finishes.
        win, pages = _build_window(qt_app)
        assert win.footer.cancel_button.isHidden()  # hidden before install
        win.switch_page(win.installing_page_index)
        assert not win.footer.cancel_button.isHidden()  # shown during install
        pages[win.installing_page_index].finish(True)
        assert win.footer.cancel_button.isHidden()  # removed on completion


# --- T603: Models category flow ---------------------------------------------


def _catalog_paths() -> tuple[Path, Path]:
    tmp = Path(tempfile.mkdtemp())
    return _write_catalog(tmp), _write_recommended(tmp)


def _models_state() -> InstallerState:
    state = InstallerState()
    state.gpu_vendor = "nvidia"
    state.gpu_name = "Test GPU"
    state.vram_mb = 8192
    state.free_disk_gb = 400
    return state


class TestCategoryFlow:
    def _page(self) -> TypedCatalogPage:
        catalog, recommended = _catalog_paths()
        return TypedCatalogPage(
            _models_state(), catalog_path=catalog, recommended_path=recommended
        )

    def test_all_decided_passes_validation(self, qt_app: object) -> None:
        page = self._page()
        ok, _msg = page.validate()
        assert ok is True

    def test_undecided_category_blocks_and_switches_tab(self, qt_app: object) -> None:
        page = self._page()
        # Un-pick every image model -> the Image category is now undecided.
        for mid in list(page._selection.selected):
            if mid == "juggernaut-xl-v9":
                page._selection.selected.discard(mid)
        page._user_touched = True
        page._update_selection_state()
        ok, msg = page.validate()
        assert ok is False
        assert "Image" in msg
        assert page._tabs.currentIndex() == 2  # switched to the Image tab

    def test_explicit_skip_decides_category(self, qt_app: object) -> None:
        page = self._page()
        page._selection.selected.discard("juggernaut-xl-v9")
        page._update_selection_state()
        assert page._category_decided("image") is False
        page._on_skip_clicked("image")
        assert page._category_decided("image") is True
        ok, _msg = page.validate()
        assert ok is True

    def test_selection_decides_category(self, qt_app: object) -> None:
        page = self._page()
        page._selection.selected.discard("juggernaut-xl-v9")
        page._update_selection_state()
        assert page._category_decided("image") is False
        page._selection.selected.add("juggernaut-xl-v9")
        page._update_selection_state()
        assert page._category_decided("image") is True

    def test_empty_category_auto_decided(self, qt_app: object) -> None:
        page = self._page()
        # The test catalog has no audio models.
        assert page._models_for_section("audio") == []
        assert page._category_decided("audio") is True

    def test_category_progress_signal(self, qt_app: object) -> None:
        page = self._page()
        seen: list[tuple[int, int]] = []
        page.category_progress.connect(lambda d, t: seen.append((d, t)))
        page._update_selection_state()
        assert seen
        done, total = seen[-1]
        assert total == len(TYPE_TABS)
        assert done == total  # all decided with the GPU defaults

    def test_decided_tab_gets_check_prefix(self, qt_app: object) -> None:
        page = self._page()
        page._update_category_flow()
        assert page._tabs.tabText(0).startswith("\u2713")

    def test_locked_page_is_read_only(self, qt_app: object) -> None:
        page = self._page()
        page.set_interactive(False)
        assert all(not c.checkbox.isEnabled() for c in page._cards)
        # Skip is inert while locked.
        before = set(page._skipped_categories)
        page._on_skip_clicked("image")
        assert page._skipped_categories == before

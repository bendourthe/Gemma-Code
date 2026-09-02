"""v2.4.5 Phase 2 (T008) -- picker marks and auto-selection for downloaded models.

The operator asked that already-downloaded models be detected, selected on
load, and visibly marked, so a reinstall on a host that already holds its
models does not look like a fresh 194 GB download.

Every test injects its own `InstalledReport`. The page's default probe reads
the real model stores under the user's home, so a test relying on it would
pass or fail depending on what the developer had downloaded -- the same
host-dependence that made the v2.4.4 shuffle assertion flaky.
"""

from __future__ import annotations

from pathlib import Path

from PyQt5.QtWidgets import QLabel

from nexus_installer.engine.installed_models import InstalledReport
from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.typed_catalog import (
    CatalogModel,
    TypedCatalogPage,
    _ModelCard,
)

from .test_typed_catalog import _gpu_state, _write_catalog, _write_recommended


def _page(
    state: InstallerState,
    tmp_path: Path,
    report: InstalledReport,
) -> TypedCatalogPage:
    return TypedCatalogPage(
        state,
        catalog_path=_write_catalog(tmp_path),
        recommended_path=_write_recommended(tmp_path),
        installed_probe=lambda: report,
    )


def _downloaded(*ids: str, gb: float = 0.0) -> InstalledReport:
    return InstalledReport(downloaded=frozenset(ids), downloaded_gb=gb)


class TestDownloadedPill:
    """The pill is a property of the card widget, so build cards directly.

    Reaching it through the page would mean holding a QWidget reference in the
    page's card records, which outlived QApplication teardown and crashed the
    suite with a COM RPC_E_DISCONNECTED at interpreter shutdown.
    """

    def _card(self, *, downloaded: bool, vram_gb: int = 16) -> _ModelCard:
        model = CatalogModel(
            id="juggernaut-xl-v9",
            display_name="Juggernaut XL v9",
            type="image",
            task="image",
            size_gb=6.7,
            required_vram_gb=8,
            required_ram_gb=16,
            release_date="",
            license_name="",
            context_window_in=0,
            context_window_out=0,
            multimodal=False,
            uncensored=False,
            description="A test image model.",
        )
        return _ModelCard(
            model,
            recommended=True,
            checked=True,
            host_vram_gb=vram_gb,
            host_ram_gb=32,
            gpu_vendor="nvidia",
            downloaded=downloaded,
        )

    def test_downloaded_card_carries_the_pill(self, qt_app) -> None:
        card = self._card(downloaded=True)
        assert card.downloaded is True
        pill = card.findChild(QLabel, "downloadedPill")
        assert pill is not None
        assert pill.text() == "Downloaded"

    def test_undownloaded_card_has_no_pill(self, qt_app) -> None:
        card = self._card(downloaded=False)
        assert card.downloaded is False
        assert card.findChild(QLabel, "downloadedPill") is None

    def test_pill_does_not_replace_the_incompatibility_badge(self, qt_app) -> None:
        # Overloading the status badge would drop a hardware-incompatibility
        # warning on a downloaded model -- the case where it matters most.
        card = self._card(downloaded=True, vram_gb=4)
        assert card.fits is False
        assert card.findChild(QLabel, "downloadedPill") is not None

    def test_page_records_the_downloaded_flag_per_card(
        self, qt_app, tmp_path: Path
    ) -> None:
        page = _page(_gpu_state(), tmp_path, _downloaded("juggernaut-xl-v9"))
        page.refresh_from_state()
        downloaded_card = page._find_card("juggernaut-xl-v9")
        other_card = page._find_card("wan2.1-t2v-1.3b")
        assert downloaded_card is not None and downloaded_card.downloaded is True
        assert other_card is not None and other_card.downloaded is False


class TestAutoSelection:
    def test_downloaded_models_are_selected_on_load(
        self, qt_app, tmp_path: Path
    ) -> None:
        # `qwen2.5-coder:7b` is not a tier default at ANY VRAM in the test
        # catalog, so its presence can only come from the downloaded
        # auto-select. Using a model that IS a default would pass vacuously.
        state = _gpu_state(vram_mb=8192)
        baseline = _page(_gpu_state(vram_mb=8192), tmp_path, InstalledReport())
        baseline.refresh_from_state()
        assert "qwen2.5-coder:7b" not in baseline.selection().selected

        page = _page(state, tmp_path, _downloaded("qwen2.5-coder:7b"))
        page.refresh_from_state()
        assert "qwen2.5-coder:7b" in page.selection().selected

    def test_auto_selection_does_not_override_a_user_deselection(
        self, qt_app, tmp_path: Path
    ) -> None:
        # Deselecting a downloaded model to skip its verification pass is a
        # legitimate thing to want on a reinstall; a refresh must not undo it.
        state = _gpu_state(vram_mb=8192)
        page = _page(state, tmp_path, _downloaded("juggernaut-xl-v9"))
        page.refresh_from_state()
        card = page._find_card("juggernaut-xl-v9")
        assert card is not None
        card.checkbox.setChecked(False)
        assert "juggernaut-xl-v9" not in page.selection().selected
        page.refresh_from_state()
        assert "juggernaut-xl-v9" not in page.selection().selected

    def test_auto_selection_applies_once_not_on_every_refresh(
        self, qt_app, tmp_path: Path
    ) -> None:
        # Again a non-default model: a default would be restored by the tier
        # defaults on the next refresh regardless of auto-select, which would
        # make this assertion prove nothing.
        state = _gpu_state(vram_mb=8192)
        page = _page(state, tmp_path, _downloaded("qwen2.5-coder:7b"))
        page.refresh_from_state()
        page._selection.selected.discard("qwen2.5-coder:7b")
        page.refresh_from_state()
        assert "qwen2.5-coder:7b" not in page.selection().selected

    def test_an_empty_report_leaves_defaults_untouched(
        self, qt_app, tmp_path: Path
    ) -> None:
        # With nothing downloaded the picker must behave exactly as before.
        state_a = _gpu_state(vram_mb=8192)
        baseline = _page(state_a, tmp_path, InstalledReport())
        baseline.refresh_from_state()
        state_b = _gpu_state(vram_mb=8192)
        probed = _page(state_b, tmp_path, InstalledReport())
        probed.refresh_from_state()
        assert probed.selection().selected == baseline.selection().selected

    def test_downloaded_id_absent_from_the_catalog_is_ignored(
        self, qt_app, tmp_path: Path
    ) -> None:
        # A model on disk that this catalog does not list must not be injected
        # into the selection, or the engine would be handed an unknown id.
        state = _gpu_state(vram_mb=8192)
        page = _page(state, tmp_path, _downloaded("some-retired-model"))
        page.refresh_from_state()
        assert "some-retired-model" not in page.selection().selected


class TestProbeSafety:
    def test_a_raising_probe_does_not_break_the_page(
        self, qt_app, tmp_path: Path
    ) -> None:
        # Fail open: a probe that throws must leave a usable picker, not an
        # exception on the wizard's load path.
        def boom() -> InstalledReport:
            raise OSError("models root unreadable")

        page = TypedCatalogPage(
            _gpu_state(),
            catalog_path=_write_catalog(tmp_path),
            recommended_path=_write_recommended(tmp_path),
            installed_probe=boom,
        )
        page.refresh_from_state()
        assert page._find_card("juggernaut-xl-v9") is not None
        assert page.selection().selected

    def test_state_carries_the_report_for_later_pages(
        self, qt_app, tmp_path: Path
    ) -> None:
        # Review and the install guard read the report off state rather than
        # re-walking the filesystem themselves.
        state = _gpu_state(vram_mb=8192)
        page = _page(state, tmp_path, _downloaded("juggernaut-xl-v9", gb=6.7))
        page.refresh_from_state()
        assert state.installed_report.is_downloaded("juggernaut-xl-v9")
        assert state.installed_report.downloaded_gb == 6.7

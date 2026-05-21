"""Tests for the recommended-models picker page (Phase 9.5)."""

from __future__ import annotations

import pytest

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.recommended_models import (
    FULL_PRESET,
    LIGHT_PRESET,
    PRESETS,
    RECOMMENDED_PRESET,
    ModelEntry,
    ModelSelection,
    PresetBundle,
    RecommendedModelsPage,
    estimate_download_minutes,
    pick_default_preset,
)


class TestPresetData:
    def test_three_presets_defined(self) -> None:
        assert len(PRESETS) == 3
        assert {p.name for p in PRESETS} == {"Light", "Recommended", "Full"}

    def test_increasing_vram(self) -> None:
        assert LIGHT_PRESET.min_vram_gb < RECOMMENDED_PRESET.min_vram_gb
        assert RECOMMENDED_PRESET.min_vram_gb < FULL_PRESET.min_vram_gb

    def test_total_gb_matches_models(self) -> None:
        for preset in PRESETS:
            assert preset.total_gb == pytest.approx(
                sum(m.size_gb for m in preset.models)
            )


class TestPickDefaultPreset:
    @pytest.mark.parametrize(
        ("vram_gb", "expected"),
        [
            (4, LIGHT_PRESET),
            (8, LIGHT_PRESET),
            (12, RECOMMENDED_PRESET),
            (16, RECOMMENDED_PRESET),
            (24, FULL_PRESET),
            (48, FULL_PRESET),
        ],
    )
    def test_picks_largest_fitting_preset(
        self, vram_gb: int, expected: PresetBundle
    ) -> None:
        assert pick_default_preset(vram_gb) is expected


class TestEstimateDownloadMinutes:
    def test_zero_size_returns_zero(self) -> None:
        assert estimate_download_minutes(0.0) == 0

    def test_estimate_at_default_throughput(self) -> None:
        # 12 GB at 200 Mbps -> ~ 8 min after accounting for rounding.
        minutes = estimate_download_minutes(12.0, mbps=200.0)
        assert minutes > 0
        assert minutes <= 30

    def test_higher_throughput_means_fewer_minutes(self) -> None:
        slow = estimate_download_minutes(25.0, mbps=100.0)
        fast = estimate_download_minutes(25.0, mbps=500.0)
        assert slow > fast


class TestModelSelection:
    def test_total_gb_sums_across_presets(self) -> None:
        # v1.1.0 Phase 12.8 -- SANA-1.6B replaced SDXL Turbo as the default
        # image entry in Light / Recommended; sum across both presets.
        sel = ModelSelection(
            preset=RECOMMENDED_PRESET,
            selected_models={"gemma4:e4b", "sana-1.6b-1024"},
        )
        assert sel.total_gb() == pytest.approx(4.5 + 3.2)

    def test_total_ignores_unknown_ids(self) -> None:
        sel = ModelSelection(
            preset=LIGHT_PRESET,
            selected_models={"unknown-id"},
        )
        assert sel.total_gb() == 0.0

    def test_phase_12_defaults_auto_tick_sana(self) -> None:
        # v1.1.0 Phase 12.8 acceptance: every preset auto-includes both
        # `sana-1.6b-1024` and `sana-sprint-1024`. SDXL Turbo no longer
        # appears in Light / Recommended (opt-in via Advanced).
        for preset in (LIGHT_PRESET, RECOMMENDED_PRESET, FULL_PRESET):
            ids = {m.model_id for m in preset.models}
            assert "sana-1.6b-1024" in ids, preset.name
            assert "sana-sprint-1024" in ids, preset.name
        light_ids = {m.model_id for m in LIGHT_PRESET.models}
        recommended_ids = {m.model_id for m in RECOMMENDED_PRESET.models}
        assert "sdxl-turbo" not in light_ids
        assert "sdxl-turbo" not in recommended_ids

    def test_phase_13_sana_video_visible_in_every_preset(self) -> None:
        # v1.1.0 Phase 13.3 acceptance: SANA-Video appears in every
        # preset so users can opt in without leaving the preset view.
        for preset in (LIGHT_PRESET, RECOMMENDED_PRESET, FULL_PRESET):
            ids = {m.model_id for m in preset.models}
            assert "sana-video-2b-720p" in ids, preset.name

    def test_phase_13_sana_video_opt_in_on_light_and_recommended(self) -> None:
        # v1.1.0 Phase 13.3 acceptance: unticked-by-default in Light +
        # Recommended; ticked-by-default in Full.
        def _entry(preset: PresetBundle, model_id: str) -> ModelEntry:
            for m in preset.models:
                if m.model_id == model_id:
                    return m
            raise AssertionError(
                f"sana-video-2b-720p missing from {preset.name}",
            )

        assert _entry(LIGHT_PRESET, "sana-video-2b-720p").default_checked is False
        assert (
            _entry(RECOMMENDED_PRESET, "sana-video-2b-720p").default_checked is False
        )
        assert _entry(FULL_PRESET, "sana-video-2b-720p").default_checked is True

    def test_model_entry_default_checked_defaults_to_true(self) -> None:
        # Backwards compatibility: existing entries that do not specify
        # `default_checked` continue to seed the selection.
        entry = ModelEntry("foo", "Foo", 1.0, "desc")
        assert entry.default_checked is True


class TestRecommendedModelsPageRender:
    def test_renders_with_default_state(self, qt_app) -> None:  # noqa: ANN001
        state = InstallerState(
            gpu_name="NVIDIA GeForce RTX 4090",
            vram_mb=24 * 1024,
        )
        page = RecommendedModelsPage(state)
        selection = page.selection()
        # 24 GB VRAM -> Full preset by default.
        assert selection.preset.name == "Full"
        # The Full preset seeds the selection with every ticked-by-default
        # model (Phase 13.3 opt-in rows are still default_checked=True
        # within Full).
        assert selection.selected_models == {
            m.model_id for m in FULL_PRESET.models if m.default_checked
        }

    def test_renders_for_low_vram_default_to_light(self, qt_app) -> None:  # noqa: ANN001
        state = InstallerState(gpu_name="cpu-only", vram_mb=2 * 1024)
        page = RecommendedModelsPage(state)
        assert page.selection().preset.name == "Light"

    def test_light_preset_skips_opt_in_rows_in_initial_selection(
        self, qt_app  # noqa: ANN001
    ) -> None:
        # v1.1.0 Phase 13.3 acceptance: SANA-Video appears in the Light
        # preset but is NOT seeded into the initial selection because it
        # is opt-in (default_checked=False).
        state = InstallerState(gpu_name="cpu-only", vram_mb=4 * 1024)
        page = RecommendedModelsPage(state)
        selection = page.selection()
        assert selection.preset.name == "Light"
        assert "sana-video-2b-720p" not in selection.selected_models
        assert "sana-1.6b-1024" in selection.selected_models

    def test_recommended_preset_skips_opt_in_rows_in_initial_selection(
        self, qt_app  # noqa: ANN001
    ) -> None:
        # v1.1.0 Phase 13.3 acceptance: SANA-Video stays opt-in on
        # Recommended too.
        state = InstallerState(gpu_name="NVIDIA GeForce RTX 4070", vram_mb=12 * 1024)
        page = RecommendedModelsPage(state)
        selection = page.selection()
        assert selection.preset.name == "Recommended"
        assert "sana-video-2b-720p" not in selection.selected_models

    def test_full_preset_seeds_sana_video_in_initial_selection(
        self, qt_app  # noqa: ANN001
    ) -> None:
        # v1.1.0 Phase 13.3 acceptance: Full ticks SANA-Video by default
        # (creator-tier user opted into the heaviest payload).
        state = InstallerState(gpu_name="NVIDIA GeForce RTX 4090", vram_mb=24 * 1024)
        page = RecommendedModelsPage(state)
        selection = page.selection()
        assert selection.preset.name == "Full"
        assert "sana-video-2b-720p" in selection.selected_models

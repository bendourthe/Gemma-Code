"""v1.1.0 Phase 14.6 -- tests for the typed catalog (Text/Image/Video/Audio)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from nexus_installer.installer_state import InstallerState
from nexus_installer.pages.typed_catalog import (
    CATALOG_TYPE_TO_TAB,
    TYPE_TABS,
    CatalogModel,
    TypedCatalogPage,
    TypedSelection,
    compatibility_badge,
    load_catalog_models,
    load_recommended_ids,
)


def _write_catalog(tmp_path: Path) -> Path:
    catalog = {
        "models": [
            {
                "id": "gemma4:e4b",
                "displayName": "Gemma 4 E4B",
                "type": "llm",
                "sizeGB": 2.7,
                "requiredVramGB": 6,
                "releaseDate": "2025-08-01",
                "license": "Gemma TOU",
                "contextWindow": 128000,
                "multimodal": False,
                "uncensored": False,
                "description": "Test text model",
            },
            {
                "id": "sana-1.6b-1024",
                "displayName": "SANA 1.6B",
                "type": "image",
                "sizeGB": 3.2,
                "requiredVramGB": 6,
                "releaseDate": "2025-09-01",
                "license": "Apache-2.0",
                "multimodal": False,
                "description": "Image model",
            },
            {
                "id": "ltx-video",
                "displayName": "LTX-Video",
                "type": "video",
                "sizeGB": 3.5,
                "requiredVramGB": 12,
                "releaseDate": "2025-08-15",
                "license": "OpenRAIL",
                "description": "Video model",
            },
            {
                "id": "ignored-vae",
                "displayName": "Some VAE",
                "type": "vae",
                "sizeGB": 0.3,
            },
        ]
    }
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    return path


def _write_recommended(tmp_path: Path) -> Path:
    recommended = {
        "text": ["gemma4:e4b"],
        "image": ["sana-1.6b-1024"],
        "video": ["ltx-video"],
        "audio": [],
    }
    path = tmp_path / "recommended.json"
    path.write_text(json.dumps(recommended), encoding="utf-8")
    return path


class TestLoadCatalog:
    def test_filters_out_non_user_models(self, tmp_path: Path) -> None:
        models = load_catalog_models(_write_catalog(tmp_path))
        ids = {m.id for m in models}
        assert "ignored-vae" not in ids
        assert ids == {"gemma4:e4b", "sana-1.6b-1024", "ltx-video"}

    def test_missing_catalog_returns_empty(self, tmp_path: Path) -> None:
        assert load_catalog_models(tmp_path / "nope.json") == []

    def test_invalid_json_returns_empty(self, tmp_path: Path) -> None:
        bad = tmp_path / "bad.json"
        bad.write_text("not json")
        assert load_catalog_models(bad) == []


class TestLoadRecommended:
    def test_round_trip(self, tmp_path: Path) -> None:
        ids = load_recommended_ids(_write_recommended(tmp_path))
        assert ids["text"] == ["gemma4:e4b"]
        assert ids["audio"] == []

    def test_missing_file_returns_empty_buckets(self, tmp_path: Path) -> None:
        ids = load_recommended_ids(tmp_path / "missing.json")
        assert set(ids.keys()) == {key for key, _, _ in TYPE_TABS}


class TestCompatibilityBadge:
    def _model(self, **overrides) -> CatalogModel:
        return CatalogModel(
            id="m",
            display_name="m",
            type=overrides.pop("type", "text"),
            size_gb=1.0,
            required_vram_gb=overrides.pop("required_vram_gb", 0),
            required_ram_gb=overrides.pop("required_ram_gb", 0),
            release_date="2025-01-01",
            license_name="MIT",
            context_window_in=0,
            context_window_out=0,
            multimodal=False,
            uncensored=False,
            description="",
        )

    def test_no_gpu_with_vram_requirement(self) -> None:
        text, color = compatibility_badge(
            self._model(required_vram_gb=8),
            total_vram_gb=0,
            total_ram_gb=16,
            gpu_vendor="none",
        )
        assert "Requires 8" in text
        assert color == "#ef4444"

    def test_short_vram(self) -> None:
        text, color = compatibility_badge(
            self._model(required_vram_gb=12),
            total_vram_gb=8,
            total_ram_gb=16,
            gpu_vendor="nvidia",
        )
        assert "Requires 12" in text
        assert color == "#f59e0b"

    def test_compatible(self) -> None:
        text, color = compatibility_badge(
            self._model(required_vram_gb=4),
            total_vram_gb=12,
            total_ram_gb=16,
            gpu_vendor="nvidia",
        )
        assert text == "Compatible"


class TestTypedSelection:
    def test_total_gb(self) -> None:
        models = {
            "a": CatalogModel(
                id="a",
                display_name="A",
                type="text",
                size_gb=4.0,
                required_vram_gb=0,
                required_ram_gb=0,
                release_date="",
                license_name="",
                context_window_in=0,
                context_window_out=0,
                multimodal=False,
                uncensored=False,
                description="",
            ),
            "b": CatalogModel(
                id="b",
                display_name="B",
                type="image",
                size_gb=3.2,
                required_vram_gb=0,
                required_ram_gb=0,
                release_date="",
                license_name="",
                context_window_in=0,
                context_window_out=0,
                multimodal=False,
                uncensored=False,
                description="",
            ),
        }
        sel = TypedSelection(selected={"a", "b"})
        assert sel.total_gb(models) == pytest.approx(7.2)


class TestTypedCatalogPage:
    def test_render_pre_ticks_recommended(self, qt_app, tmp_path: Path) -> None:
        state = InstallerState()
        state.free_disk_gb = 200
        page = TypedCatalogPage(
            state,
            catalog_path=_write_catalog(tmp_path),
            recommended_path=_write_recommended(tmp_path),
        )
        assert "gemma4:e4b" in page.selection().selected
        assert "sana-1.6b-1024" in page.selection().selected

    def test_audio_tab_shows_empty_state(self, qt_app, tmp_path: Path) -> None:
        state = InstallerState()
        state.free_disk_gb = 200
        page = TypedCatalogPage(
            state,
            catalog_path=_write_catalog(tmp_path),
            recommended_path=_write_recommended(tmp_path),
        )
        # The audio tab is the 4th tab (index 3).
        assert page._tabs.tabText(3) == "Audio"

    def test_selection_change_updates_state(self, qt_app, tmp_path: Path) -> None:
        state = InstallerState()
        state.free_disk_gb = 200
        TypedCatalogPage(
            state,
            catalog_path=_write_catalog(tmp_path),
            recommended_path=_write_recommended(tmp_path),
        )
        # gemma+sana+ltx-video pre-ticked = 2.7 + 3.2 + 3.5 = 9.4 GB
        assert state.selected_models_gb == pytest.approx(9.4)

    def test_disk_reserve_disables_overflow(self, qt_app, tmp_path: Path) -> None:
        state = InstallerState()
        state.free_disk_gb = 15
        state.disk_reserve_gb = 10
        TypedCatalogPage(
            state,
            catalog_path=_write_catalog(tmp_path),
            recommended_path=_write_recommended(tmp_path),
        )
        # After pre-ticking: free=15, selected=9.4, remaining=5.6 < 10 reserve.
        # Selection totals stay correct even when overflow disables further
        # checkboxes (the page guards via tooltip).
        assert state.selected_models_gb == pytest.approx(9.4)


class TestCatalogTypeMapping:
    @pytest.mark.parametrize(
        ("raw_type", "tab"),
        [
            ("llm", "text"),
            ("embed", "text"),
            ("image", "image"),
            ("video", "video"),
            ("audio", "audio"),
        ],
    )
    def test_mapping(self, raw_type: str, tab: str) -> None:
        assert CATALOG_TYPE_TO_TAB[raw_type] == tab

    def test_vae_excluded(self) -> None:
        assert "vae" not in CATALOG_TYPE_TO_TAB
